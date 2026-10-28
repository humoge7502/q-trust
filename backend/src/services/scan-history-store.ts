/**
 * Scan history storage.
 *
 * `/v1/stats` reports how many scans this deployment has served. The history
 * used to live in a process-local array, so on Vercel every cold start reset
 * the counters to zero and two instances disagreed about the totals.
 *
 * With `QTRUST_PG_URL`/`DATABASE_URL` configured the history is stored in
 * Postgres and shared by every instance. Without a database URL (local dev,
 * tests) the in-memory behaviour is preserved.
 *
 * Privacy (Audit M-7): only the keyed target hash, the scan type, the finding
 * count and the timestamp are stored — never the scanned path or repo name.
 */
import { createHash } from "node:crypto";
import pg from "pg";
import { PG_URL } from "../config.js";

const { Pool } = pg;

/** Stable, non-reversible label for a scan target (path or repo id). */
export function hashScanTarget(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export interface ScanHistoryEntry {
  targetHash: string;
  type: string;
  timestamp: string;
  count: number;
}

export interface ScanHistoryStats {
  totalScans: number;
  totalFindings: number;
}

export type ScanHistoryMode = "postgres" | "memory";

export interface ScanHistoryStore {
  readonly mode: ScanHistoryMode;
  append(entry: ScanHistoryEntry): Promise<void>;
  list(limit?: number): Promise<ScanHistoryEntry[]>;
  stats(): Promise<ScanHistoryStats>;
}

/** Keep in line with the old in-memory cap; older rows are pruned. */
const MAX_ENTRIES = 10_000;
/** Prune at most once per this many appends to keep the write path cheap. */
const PRUNE_EVERY = 100;

const TABLE = "scan_history";

/** Distinct advisory-lock keys from the evidence chain (7_326_001/2). */
const SCHEMA_LOCK_KEY = 7_326_003;

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function createMemoryStore(): ScanHistoryStore {
  const entries: ScanHistoryEntry[] = [];
  return {
    mode: "memory",
    async append(entry) {
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) entries.shift();
    },
    async list(limit = MAX_ENTRIES) {
      return entries.slice(-limit);
    },
    async stats() {
      return {
        totalScans: entries.length,
        totalFindings: entries.reduce((sum, entry) => sum + entry.count, 0),
      };
    },
  };
}

interface ScanHistoryRow {
  target_hash: string;
  scan_type: string;
  findings_count: number | string;
  created_at: Date | string;
}

function rowToEntry(row: ScanHistoryRow): ScanHistoryEntry {
  return {
    targetHash: row.target_hash,
    type: row.scan_type,
    timestamp: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    count: Number(row.findings_count),
  };
}

function createPostgresStore(connectionString: string, table = TABLE): ScanHistoryStore {
  if (!IDENTIFIER.test(table)) {
    throw new Error(`invalid scan history table name: ${table}`);
  }
  const pool = new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  pool.on("error", (err) => {
    console.error(`[pg] scan history pool recycled an idle client: ${err.message}`);
  });

  let schemaReady: Promise<void> | null = null;
  function ensureSchema(): Promise<void> {
    if (!schemaReady) {
      schemaReady = (async () => {
        // Concurrent cold starts would otherwise race the catalog insert and
        // one of them would fail with a duplicate pg_type error.
        const client = await pool.connect();
        try {
          await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
          await client.query(
            `CREATE TABLE IF NOT EXISTS ${table} (
               id             BIGSERIAL PRIMARY KEY,
               target_hash    TEXT NOT NULL,
               scan_type      TEXT NOT NULL,
               findings_count INTEGER NOT NULL,
               created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
             )`,
          );
          await client.query(
            `CREATE INDEX IF NOT EXISTS ${table}_created_idx ON ${table} (created_at DESC, id DESC)`,
          );
        } finally {
          await client
            .query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY])
            .catch(() => undefined);
          client.release();
        }
      })().catch((err) => {
        schemaReady = null;
        throw err;
      });
    }
    return schemaReady;
  }

  let appendsSincePrune = 0;

  async function prune(): Promise<void> {
    // Skip when the table is at or below the cap: the subselect returns no row
    // and the delete is a no-op anyway, so this only fires once there is work.
    await pool.query(
      `DELETE FROM ${table}
       WHERE id <= (SELECT id FROM ${table} ORDER BY id DESC OFFSET $1 LIMIT 1)`,
      [MAX_ENTRIES],
    );
  }

  return {
    mode: "postgres",

    async append(entry) {
      await ensureSchema();
      const createdAt = new Date(entry.timestamp);
      await pool.query(
        `INSERT INTO ${table} (target_hash, scan_type, findings_count, created_at)
         VALUES ($1, $2, $3, $4)`,
        [
          entry.targetHash,
          entry.type,
          entry.count,
          Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
        ],
      );
      appendsSincePrune += 1;
      if (appendsSincePrune >= PRUNE_EVERY) {
        appendsSincePrune = 0;
        await prune().catch((err) => {
          console.error(`[pg] scan history prune failed: ${err.message}`);
        });
      }
    },

    async list(limit = 500) {
      await ensureSchema();
      const { rows } = await pool.query<ScanHistoryRow>(
        `SELECT target_hash, scan_type, findings_count, created_at
         FROM ${table} ORDER BY id DESC LIMIT $1`,
        [limit],
      );
      return rows.map(rowToEntry).reverse();
    },

    async stats() {
      await ensureSchema();
      const { rows } = await pool.query<{ total: string; findings: string | null }>(
        `SELECT COUNT(*)::text AS total, COALESCE(SUM(findings_count), 0)::text AS findings FROM ${table}`,
      );
      return {
        totalScans: Number(rows[0]?.total ?? 0),
        totalFindings: Number(rows[0]?.findings ?? 0),
      };
    },
  };
}

export function createScanHistoryStore(
  connectionString = PG_URL,
  table = TABLE,
): ScanHistoryStore {
  return connectionString
    ? createPostgresStore(connectionString, table)
    : createMemoryStore();
}

/** Process-wide store used by the routes; Postgres when configured. */
export const scanHistoryStore = createScanHistoryStore();

/**
 * Append without letting history I/O stall the scan response it belongs to.
 * The write still completes in the background if it outlives the wait.
 */
export async function appendScanHistory(
  entry: ScanHistoryEntry,
  timeoutMs = 2_000,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      scanHistoryStore.append(entry),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`scan history append timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

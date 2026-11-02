/**
 * Evidence ledger storage.
 *
 * The evidence chain is a SHA-256 hash chain over scan attestations. It used to
 * live in a process-local array backed by a JSONL file, which meant two
 * serverless instances kept two divergent chains: `/v1/evidence/create` could
 * append index 7 on one instance and `/v1/evidence/verify` on another would
 * report `unknown_chain_index` for a perfectly valid ledger.
 *
 * When `QTRUST_PG_URL`/`DATABASE_URL` is configured the chain is stored in
 * Postgres. Appends take a transaction-scoped advisory lock, then read the last
 * link and insert the successor in the same transaction, so concurrent writers
 * across instances cannot fork the chain. Without a database URL (local dev,
 * tests) the original JSONL + in-memory behaviour is preserved.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { PG_URL } from "../config.js";

const { Pool } = pg;

export interface LedgerEntry {
  version: string;
  data: unknown;
  integrityHash: string;
  previousHash: string;
  chainIndex: number;
}

export const GENESIS_HASH = "0".repeat(64);

/** Hard cap on the JSONL fallback chain length; Postgres keeps full history. */
const MAX_EVIDENCE_CHAIN_LENGTH = 10_000;

const TABLE = "evidence_chain";

/** Arbitrary constant for `pg_advisory_xact_lock`; scoped to this table. */
const CHAIN_LOCK_KEY = 7_326_001;
/** Separate key for schema creation. */
const SCHEMA_LOCK_KEY = 7_326_002;

export type EvidenceStoreMode = "postgres" | "jsonl";

export interface EvidenceStore {
  readonly mode: EvidenceStoreMode;
  append(data: unknown): Promise<LedgerEntry>;
  list(): Promise<LedgerEntry[]>;
  find(chainIndex: number): Promise<LedgerEntry | null>;
}

/**
 * Sort object keys recursively before hashing.
 *
 * JSONB does not preserve key order, so hashing `JSON.stringify(data)` as
 * written made a stored entry fail its own integrity check after a round trip
 * through Postgres (`chain_broken_at_index_0` in the production canary).
 * Canonical JSON makes the hash depend on values only, not on storage order
 * or on the order the caller happened to serialize the fields in.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = canonicalize(source[key]);
    return sorted;
  }
  return value;
}

export function computeIntegrityHash(entry: Omit<LedgerEntry, "integrityHash">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        data: canonicalize(entry.data),
        previousHash: entry.previousHash,
        chainIndex: entry.chainIndex,
      }),
    )
    .digest("hex");
}

/** Re-compute every hash and validate the whole chain. Returns a reason on any mismatch/tamper. */
export function verifyChain(entries: LedgerEntry[]): {
  valid: boolean;
  reason?: string;
  failedIndex?: number;
} {
  if (entries.length === 0) return { valid: true };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (typeof entry.chainIndex !== "number" || typeof entry.previousHash !== "string") {
      return { valid: false, reason: "malformed_entry", failedIndex: entry.chainIndex ?? i };
    }
    // The retained view may intentionally start after an evicted prefix. The
    // first retained entry must still point to a valid predecessor; its own
    // predecessor is not available for local verification.
    const expectedPrevious =
      i === 0
        ? entry.chainIndex === 0
          ? GENESIS_HASH
          : entry.previousHash
        : entries[i - 1].integrityHash;
    if (entry.previousHash !== expectedPrevious) {
      return { valid: false, reason: "previous_hash_mismatch", failedIndex: entry.chainIndex };
    }
    if (i > 0 && entry.chainIndex !== entries[i - 1].chainIndex + 1) {
      return { valid: false, reason: "chain_index_mismatch", failedIndex: entry.chainIndex };
    }
    const recomputed = computeIntegrityHash(entry);
    if (recomputed !== entry.integrityHash) {
      return { valid: false, reason: "integrity_hash_mismatch", failedIndex: entry.chainIndex };
    }
  }
  return { valid: true };
}

/* -------------------------------------------------------------------------- */
/* Postgres backend                                                            */
/* -------------------------------------------------------------------------- */

interface EvidenceRow {
  chain_index: string | number;
  version: string;
  data: unknown;
  previous_hash: string;
  integrity_hash: string;
}

function rowToEntry(row: EvidenceRow): LedgerEntry {
  return {
    version: row.version,
    data: row.data,
    integrityHash: row.integrity_hash,
    previousHash: row.previous_hash,
    chainIndex: Number(row.chain_index),
  };
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function createPostgresStore(connectionString: string, table = TABLE): EvidenceStore {
  if (!IDENTIFIER.test(table)) {
    throw new Error(`invalid evidence table name: ${table}`);
  }
  const pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  pool.on("error", (err) => {
    console.error(`[pg] evidence pool recycled an idle client: ${err.message}`);
  });

  let schemaReady: Promise<void> | null = null;
  function ensureSchema(): Promise<void> {
    if (!schemaReady) {
      schemaReady = (async () => {
        // Two cold serverless instances can reach the first append at the same
        // time. Concurrent `CREATE TABLE IF NOT EXISTS` then races inside the
        // catalog and one of them fails with a duplicate pg_type error, so
        // creation is serialized under a session advisory lock.
        const client = await pool.connect();
        try {
          await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
          await client.query(
            `CREATE TABLE IF NOT EXISTS ${table} (
               chain_index    BIGINT PRIMARY KEY,
               version        TEXT NOT NULL,
               data           JSONB NOT NULL,
               previous_hash  TEXT NOT NULL,
               integrity_hash TEXT NOT NULL,
               created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
             )`,
          );
        } finally {
          // Unlock on every path; a dropped connection releases it anyway.
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

  return {
    mode: "postgres",

    async append(data) {
      await ensureSchema();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [CHAIN_LOCK_KEY]);
        const { rows } = await client.query<{ chain_index: string; integrity_hash: string }>(
          `SELECT chain_index, integrity_hash FROM ${table} ORDER BY chain_index DESC LIMIT 1`,
        );
        const last = rows[0] ?? null;
        const chainIndex = last ? Number(last.chain_index) + 1 : 0;
        const entry: Omit<LedgerEntry, "integrityHash"> = {
          version: "1.0",
          data,
          previousHash: last ? last.integrity_hash : GENESIS_HASH,
          chainIndex,
        };
        const full: LedgerEntry = { ...entry, integrityHash: computeIntegrityHash(entry) };
        await client.query(
          `INSERT INTO ${table} (chain_index, version, data, previous_hash, integrity_hash)
           VALUES ($1, $2, $3, $4, $5)`,
          [full.chainIndex, full.version, data, full.previousHash, full.integrityHash],
        );
        await client.query("COMMIT");
        return full;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },

    async list() {
      await ensureSchema();
      const { rows } = await pool.query<EvidenceRow>(
        `SELECT chain_index, version, data, previous_hash, integrity_hash
         FROM ${table} ORDER BY chain_index ASC`,
      );
      return rows.map(rowToEntry);
    },

    async find(chainIndex) {
      await ensureSchema();
      const { rows } = await pool.query<EvidenceRow>(
        `SELECT chain_index, version, data, previous_hash, integrity_hash
         FROM ${table} WHERE chain_index = $1`,
        [chainIndex],
      );
      return rows[0] ? rowToEntry(rows[0]) : null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* JSONL backend (local dev / no database)                                     */
/* -------------------------------------------------------------------------- */

function createJsonlStore(): EvidenceStore {
  const filePath =
    process.env.QTRUST_EVIDENCE_DB_PATH ||
    path.join(process.env.QTRUST_DATA_DIR || "/var/lib/qtrust", "evidence_chain.jsonl");

  const chain: LedgerEntry[] = [];

  function push(entry: LedgerEntry): void {
    chain.push(entry);
    if (chain.length > MAX_EVIDENCE_CHAIN_LENGTH) {
      console.warn(
        `Evidence chain exceeded ${MAX_EVIDENCE_CHAIN_LENGTH} entries — oldest entry evicted from memory (file log retains full history)`,
      );
      chain.shift();
    }
  }

  function load(): void {
    if (!existsSync(filePath)) return;
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (err) {
      console.warn(
        "Evidence chain unreadable at",
        filePath,
        "— starting empty:",
        err instanceof Error ? err.message : err,
      );
      return;
    }
    const lines = raw.split("\n");
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as LedgerEntry;
        if (
          typeof entry.chainIndex !== "number" ||
          typeof entry.previousHash !== "string" ||
          typeof entry.integrityHash !== "string"
        ) {
          throw new Error("entry missing chain metadata");
        }
        push(entry);
      } catch {
        // A torn final write (crash mid-append) leaves a partial trailing line —
        // skip it quietly-ish; corruption elsewhere is worth a louder warning.
        if (i === lines.length - 1) {
          console.warn(`Evidence chain: skipping incomplete trailing line in ${filePath}`);
        } else {
          console.warn(`Evidence chain: skipping corrupt line ${i + 1} in ${filePath}`);
        }
      }
    }
  }

  function persist(entry: LedgerEntry): void {
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch (err) {
      console.warn(
        "Evidence chain persistence failed at",
        filePath,
        "— continuing in memory only:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  load();

  return {
    mode: "jsonl",
    async append(data) {
      const last = chain.length ? chain[chain.length - 1] : null;
      const entry: Omit<LedgerEntry, "integrityHash"> = {
        version: "1.0",
        data,
        previousHash: last ? last.integrityHash : GENESIS_HASH,
        chainIndex: last ? last.chainIndex + 1 : 0,
      };
      const full: LedgerEntry = { ...entry, integrityHash: computeIntegrityHash(entry) };
      push(full);
      persist(full);
      return full;
    },
    async list() {
      return [...chain];
    },
    async find(chainIndex) {
      return chain.find((entry) => entry.chainIndex === chainIndex) ?? null;
    },
  };
}

/* -------------------------------------------------------------------------- */

export function createEvidenceStore(connectionString = PG_URL, table = TABLE): EvidenceStore {
  return connectionString ? createPostgresStore(connectionString, table) : createJsonlStore();
}

/** Process-wide store used by the routes; Postgres when configured. */
export const evidenceStore = createEvidenceStore();

import { afterAll, describe, expect, it } from "vitest";

/**
 * Scan history storage.
 *
 * `/v1/stats` totals used to reset on every serverless cold start because the
 * history was a process-local array. Postgres is the shared source of truth
 * when QTRUST_PG_URL is configured; the in-memory fallback is used locally.
 */

process.env.QTRUST_API_KEYS = "scan-history-test-key";

const { createScanHistoryStore, scanHistoryStore } = await import(
  "../src/services/scan-history-store.js"
);
const { registerScannerRoutes } = await import("../src/routes/scanner.js");

const PG_TEST_URL = process.env.QTRUST_TEST_PG_URL ?? "";

const entry = (hash: string, type: string, timestamp: string, count: number) => ({
  targetHash: hash,
  type,
  timestamp,
  count,
});

afterAll(() => {
  delete process.env.QTRUST_API_KEYS;
});

describe("scan history store (memory fallback)", () => {
  it("counts appends and lists them chronologically", async () => {
    const store = createScanHistoryStore("");
    expect(store.mode).toBe("memory");

    await store.append(entry("h1", "source", "2026-10-01T10:00:00.000Z", 2));
    await store.append(entry("h2", "full", "2026-10-01T10:01:00.000Z", 5));
    await store.append(entry("h3", "repo", "2026-10-01T10:02:00.000Z", 1));

    expect(await store.stats()).toEqual({ totalScans: 3, totalFindings: 8 });
    const all = await store.list();
    expect(all.map((e) => e.targetHash)).toEqual(["h1", "h2", "h3"]);

    // A limit returns the most recent entries, still in chronological order.
    const recent = await store.list(2);
    expect(recent.map((e) => e.targetHash)).toEqual(["h2", "h3"]);
  });
});

describe("scan history routes", () => {
  it("reports totals and history through GET /v1/stats", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify({ logger: false });
    await app.register(registerScannerRoutes);

    await scanHistoryStore.append(entry("route-a", "source", "2026-10-02T09:00:00.000Z", 4));
    await scanHistoryStore.append(entry("route-b", "repo", "2026-10-02T09:01:00.000Z", 6));

    const response = await app.inject({
      method: "GET",
      url: "/v1/stats",
      headers: { "x-api-key": "scan-history-test-key" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.totalScans).toBeGreaterThanOrEqual(2);
    expect(body.totalFindings).toBeGreaterThanOrEqual(10);
    const hashes = body.scanHistory.map((e: { targetHash: string }) => e.targetHash);
    expect(hashes).toContain("route-a");
    expect(hashes).toContain("route-b");
    // Audit M-7: history carries the keyed hash and count only.
    for (const item of body.scanHistory) {
      expect(Object.keys(item).sort()).toEqual(["count", "targetHash", "timestamp", "type"]);
    }

    await app.close();
  });
});

describe.skipIf(!PG_TEST_URL)("scan history store (Postgres, cross-instance)", () => {
  const table = `scan_history_test_${process.pid}`;

  afterAll(async () => {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: PG_TEST_URL });
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await pool.end();
  });

  it("shares totals and entries across two independent store instances", async () => {
    const a = createScanHistoryStore(PG_TEST_URL, table);
    const b = createScanHistoryStore(PG_TEST_URL, table);
    expect(a.mode).toBe("postgres");

    await a.append(entry("pg-1", "source", "2026-10-03T08:00:00.000Z", 3));
    await b.append(entry("pg-2", "repo", "2026-10-03T08:05:00.000Z", 4));

    // Instance b sees the row written by instance a.
    expect(await b.stats()).toEqual({ totalScans: 2, totalFindings: 7 });
    expect(await a.stats()).toEqual({ totalScans: 2, totalFindings: 7 });

    const list = await b.list();
    expect(list.map((e) => e.targetHash)).toEqual(["pg-1", "pg-2"]);
    expect(list[0].timestamp).toBe("2026-10-03T08:00:00.000Z");
    expect(list[1].count).toBe(4);
  });
});

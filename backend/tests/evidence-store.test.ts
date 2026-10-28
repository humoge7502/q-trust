import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Evidence ledger storage + routes.
 *
 * The chain must be shared across instances (Postgres) so a ledger created on
 * one backend verifies on another. Locally the JSONL fallback keeps the same
 * hash-chain semantics; the cross-instance test runs when QTRUST_TEST_PG_URL
 * points at a disposable database.
 */

const TEST_DIR = mkdtempSync(path.join(tmpdir(), "qtrust-evidence-"));
process.env.QTRUST_EVIDENCE_DB_PATH = path.join(TEST_DIR, "chain.jsonl");
process.env.QTRUST_API_KEYS = "evidence-test-key";

const { createEvidenceStore, computeIntegrityHash, verifyChain, GENESIS_HASH } = await import(
  "../src/services/evidence-store.js"
);
const { registerScannerRoutes } = await import("../src/routes/scanner.js");

const PG_TEST_URL = process.env.QTRUST_TEST_PG_URL ?? "";

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.QTRUST_EVIDENCE_DB_PATH;
  delete process.env.QTRUST_API_KEYS;
});

describe("evidence store (JSONL fallback)", () => {
  it("links each append to the previous hash, persists, and detects tampering", async () => {
    const store = createEvidenceStore("");
    expect(store.mode).toBe("jsonl");

    const first = await store.append({ scanTarget: "a", findingsCount: 1 });
    const second = await store.append({ scanTarget: "b", findingsCount: 2 });

    expect(first.chainIndex).toBe(0);
    expect(first.previousHash).toBe(GENESIS_HASH);
    expect(second.chainIndex).toBe(1);
    expect(second.previousHash).toBe(first.integrityHash);

    const entries = await store.list();
    expect(entries.map((e) => e.chainIndex)).toEqual([0, 1]);
    expect(verifyChain(entries)).toEqual({ valid: true });
    expect((await store.find(1))?.integrityHash).toBe(second.integrityHash);

    // A second store instance reads the same JSONL file.
    const reloaded = createEvidenceStore("");
    expect((await reloaded.list()).map((e) => e.chainIndex)).toEqual([0, 1]);

    const tampered = entries.map((entry, i) =>
      i === 1 ? { ...entry, data: { scanTarget: "tampered" } } : entry,
    );
    expect(verifyChain(tampered)).toMatchObject({ valid: false, reason: "integrity_hash_mismatch" });

    const forked = entries.map((entry, i) =>
      i === 1 ? { ...entry, previousHash: "f".repeat(64) } : entry,
    );
    expect(verifyChain(forked).valid).toBe(false);
  });

  it("hashes by value, not by key order (survives a JSONB round trip)", () => {
    const entry = {
      version: "1.0",
      data: { b: 2, a: { d: 4, c: 3 } },
      previousHash: GENESIS_HASH,
      chainIndex: 0,
    };
    const hash = computeIntegrityHash(entry);
    expect(computeIntegrityHash({ ...entry, data: { a: { c: 3, d: 4 }, b: 2 } })).toBe(hash);

    // JSONB returns keys in its own order; the stored hash must still verify.
    const stored = JSON.parse(JSON.stringify({ ...entry, integrityHash: hash }));
    const reordered = { ...stored, data: { a: stored.data.a, b: stored.data.b } };
    expect(verifyChain([reordered])).toEqual({ valid: true });
  });

  it("creates and verifies a ledger through the HTTP routes", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify({ logger: false });
    await app.register(registerScannerRoutes);

    const payload = {
      scanResultHash: createHashLike("scan-1"),
      scanTarget: "demo-estate",
      findingsCount: 20,
      riskSummary: { totalFindings: 20, critical: 3, high: 4 },
    };
    const create = await app.inject({
      method: "POST",
      url: "/v1/evidence/create",
      headers: { "x-api-key": "evidence-test-key" },
      payload,
    });
    expect(create.statusCode).toBe(200);
    const ledger = create.json().ledger;
    expect(ledger.chainIndex).toBeGreaterThanOrEqual(0);
    expect(computeIntegrityHash(ledger)).toBe(ledger.integrityHash);

    const verify = await app.inject({
      method: "POST",
      url: "/v1/evidence/verify",
      payload: { ledger },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({
      valid: true,
      providedHash: ledger.integrityHash,
    });

    const tampered = { ...ledger, data: { ...ledger.data, findingsCount: 1 } };
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/evidence/verify",
      payload: { ledger: tampered },
    });
    expect(rejected.json()).toMatchObject({ valid: false, reason: "integrity_hash_mismatch" });

    await app.close();
  });
});

describe.skipIf(!PG_TEST_URL)("evidence store (Postgres, cross-instance)", () => {
  const table = `evidence_chain_test_${process.pid}`;

  afterAll(async () => {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: PG_TEST_URL });
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await pool.end();
  });

  it("shares one serialized chain across two independent store instances", async () => {
    const pg = await import("pg");
    const setup = new pg.default.Pool({ connectionString: PG_TEST_URL });
    await setup.query(`DROP TABLE IF EXISTS ${table}`);
    await setup.end();

    const a = createEvidenceStore(PG_TEST_URL, table);
    const b = createEvidenceStore(PG_TEST_URL, table);
    expect(a.mode).toBe("postgres");

    const results = await Promise.all([
      a.append({ scanTarget: "a-1" }),
      b.append({ scanTarget: "b-1" }),
      a.append({ scanTarget: "a-2" }),
      b.append({ scanTarget: "b-2" }),
    ]);
    const indices = results.map((r) => r.chainIndex).sort((x, y) => x - y);
    expect(indices).toEqual([0, 1, 2, 3]);

    const fromA = await a.list();
    const fromB = await b.list();
    expect(fromA.map((e) => e.chainIndex)).toEqual([0, 1, 2, 3]);
    expect(fromB.map((e) => e.integrityHash)).toEqual(fromA.map((e) => e.integrityHash));
    expect(verifyChain(fromA)).toEqual({ valid: true });

    const entryZero = await b.find(0);
    expect(entryZero).not.toBeNull();
    expect((await a.find(0))?.integrityHash).toBe(entryZero?.integrityHash);
  });
});

function createHashLike(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16).padStart(64, "0");
}

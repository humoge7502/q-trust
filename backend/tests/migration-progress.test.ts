import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("pg", () => {
  class Pool {
    query = query;
    connect = vi.fn().mockResolvedValue({ query, release: vi.fn() });
    end = vi.fn().mockResolvedValue(undefined);
  }
  return { default: { Pool } };
});

const ORG = "0xE610569aE0352DC3262419bb051a86145f52875c" as const;

describe("getMigrationProgress read model", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      QTRUST_PG_URL: "postgres://test",
      QTRUST_ASSET_REGISTRY_ADDRESS: "0x1111111111111111111111111111111111111111",
      QTRUST_VENDOR_REGISTRY_ADDRESS: "0x2222222222222222222222222222222222222222",
      QTRUST_MIGRATION_REGISTRY_ADDRESS: "0x3333333333333333333333333333333333333333",
      QTRUST_AUDIT_REGISTRY_ADDRESS: "0x4444444444444444444444444444444444444444",
    };
    query.mockReset();
    query.mockResolvedValue({
      rows: [
        {
          total_migrations: 1,
          verified_migrations: 0,
          asset_count: 3,
          attestation_count: 2,
        },
      ],
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("matches org and vendor addresses case-insensitively and counts all assets", async () => {
    const { getMigrationProgress } = await import("../src/services/verify.js");

    const progress = await getMigrationProgress(ORG);

    expect(progress).toMatchObject({
      total_migrations: 1,
      verified_migrations: 0,
      unverified_migrations: 1,
      asset_count: 3,
      attestation_count: 2,
    });

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("lower(m.org_did) = $1");
    expect(String(sql)).toContain("lower(a.org_did) = $1");
    expect(String(sql)).toContain("lower(att.vendor_did) = $1");
    expect(params).toEqual([ORG.toLowerCase()]);
  });
});

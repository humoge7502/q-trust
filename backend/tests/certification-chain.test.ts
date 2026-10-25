import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Address } from "viem";

/**
 * Chain-facing half of certification: the optional re-anchor inside the
 * verifier, and the two live RPC readers used at issuance.
 *
 * Everything else in the suite deliberately avoids the network, which is
 * exactly why this file exists — the two paths that do touch a node are the two
 * most likely to fail open. A re-anchor that silently treats "RPC died" as
 * "checked and fine" turns a security control into decoration, and an anchor
 * reader that reports `anchored: true` without a block hash lets a bundle claim
 * a commitment that does not exist.
 */
const rpc = vi.hoisted(() => ({
  getBlock: vi.fn(),
  readContract: vi.fn(),
}));
const chain = vi.hoisted(() => ({ revocationAnchor: "0x0000000000000000000000000000000000000000" }));

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const contracts = Object.defineProperty(
    { ...actual.CONTRACTS as Record<string, unknown> },
    "revocationAnchor",
    { get: () => chain.revocationAnchor as Address, enumerable: true },
  );
  return { ...actual, publicClient: rpc, CONTRACTS: contracts };
});

const { CertificationRefusedError, defaultDeps, issueCertification, verifyCertificationBundle } =
  await import("../src/services/certification.js");
import type { BundleAnchor, CertificationDeps } from "../src/services/certification.js";

const ORG = "0x1111111111111111111111111111111111111111" as Address;
const NOW = new Date("2026-10-24T12:00:00.000Z");
const ANCHOR: BundleAnchor = {
  chain_id: 84532,
  chain_name: "Base Sepolia",
  block_number: 12_345_678,
  block_hash: `0x${"f".repeat(64)}`,
  block_timestamp: 1_760_001_000,
  anchored: true,
};

function stubDeps(overrides: Partial<CertificationDeps> = {}): CertificationDeps {
  return {
    summary: async () => ({
      org: ORG,
      asset_count: 1,
      migration_counts: { total: 1, verified: 1, unverified: 0 },
      latest_audit: null,
      source: "indexer",
    }),
    assets: async () => ({
      items: [
        {
          asset_id: `0x${"a".repeat(64)}`,
          org_did: ORG,
          cbom_hash: `0x${"b".repeat(64)}`,
          metadata_uri: "ipfs://cbom-1",
          timestamp: 1_760_000_000,
          last_updated: 1_760_000_000,
          active: true,
        },
      ],
      total: 1,
      offset: 0,
      limit: 200,
    }),
    migrations: async () => ({ items: [], total: 1, offset: 0, limit: 200 }),
    attestations: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
    audit: async () => ({
      org_address: ORG,
      exists: true,
      result: "Passed",
      result_code: 1,
      timestamp: Math.floor(NOW.getTime() / 1000) - 86_400,
    }),
    revocation: async () => ({ checked: true, root: `0x${"9".repeat(64)}`, configured: true }),
    anchor: async () => ANCHOR,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.QTRUST_VC_ISSUER_KEY = "11".repeat(32);
  chain.revocationAnchor = `0x${"7".repeat(40)}`;
});

describe("verifier chain re-anchor", () => {
  it("leaves the chain alone unless the caller asks", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, stubDeps());
    const result = await verifyCertificationBundle(bundle, { now: NOW });
    expect(result.chain_anchor).toBe("skipped");
    expect(result.valid).toBe(true);
    expect(rpc.getBlock).not.toHaveBeenCalled();
  });

  it("confirms the anchored block hash and keeps the bundle valid", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, stubDeps());
    rpc.getBlock.mockResolvedValue({
      hash: ANCHOR.block_hash,
      number: BigInt(ANCHOR.block_number),
      timestamp: BigInt(ANCHOR.block_timestamp),
    });
    const result = await verifyCertificationBundle(bundle, { now: NOW, check_chain: true });
    expect(result.chain_anchor).toBe("verified");
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
    // The anchor is a block *number*, so a re-anchor must pin that exact block
    // rather than whatever the node considers latest.
    expect(rpc.getBlock).toHaveBeenCalledWith({ blockNumber: BigInt(ANCHOR.block_number) });
  });

  it("matches the hash case-insensitively", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, stubDeps());
    rpc.getBlock.mockResolvedValue({ hash: (ANCHOR.block_hash as string).toUpperCase() });
    const result = await verifyCertificationBundle(bundle, { now: NOW, check_chain: true });
    expect(result.chain_anchor).toBe("verified");
    expect(result.valid).toBe(true);
  });

  it("rejects a bundle whose anchored block no longer matches the chain", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, stubDeps());
    rpc.getBlock.mockResolvedValue({ hash: `0x${"1".repeat(64)}` });
    const result = await verifyCertificationBundle(bundle, { now: NOW, check_chain: true });
    expect(result.chain_anchor).toBe("mismatch");
    expect(result.reasons).toContain("anchored block hash does not match the chain");
    // A reworded chain check is still a failed check: reorgs must not pass.
    expect(result.valid).toBe(false);
    expect(result.checked.signature).toBe(true);
  });

  it("fails closed when the node returns no block hash", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, stubDeps());
    rpc.getBlock.mockResolvedValue({ hash: undefined });
    const result = await verifyCertificationBundle(bundle, { now: NOW, check_chain: true });
    expect(result.chain_anchor).toBe("mismatch");
    expect(result.valid).toBe(false);
  });

  it("reports an unreachable node as unavailable, not as verified", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, stubDeps());
    rpc.getBlock.mockRejectedValue(new Error("fetch failed"));
    const result = await verifyCertificationBundle(bundle, { now: NOW, check_chain: true });
    expect(result.chain_anchor).toBe("unavailable");
    expect(result.reasons).toContain("could not fetch the anchored block");
    // Requesting a chain check and not performing one is not a pass.
    expect(result.valid).toBe(false);
  });

  it("reports a bundle with no anchor without reaching for the RPC", async () => {
    const bundle = await issueCertification(
      { org: ORG, now: NOW },
      stubDeps({
        anchor: async () => ({
          chain_id: 84532,
          chain_name: "Base Sepolia",
          block_number: null,
          block_hash: null,
          block_timestamp: null,
          anchored: false,
        }),
      }),
    );
    const result = await verifyCertificationBundle(bundle, { now: NOW, check_chain: true });
    expect(result.chain_anchor).toBe("unavailable");
    expect(result.reasons).toContain("bundle carries no chain anchor");
    expect(result.valid).toBe(false);
    expect(rpc.getBlock).not.toHaveBeenCalled();
  });

  it("treats an anchor stripped of its hash as absent", async () => {
    const bundle = await issueCertification(
      { org: ORG, now: NOW },
      stubDeps({ anchor: async () => ({ ...ANCHOR, block_hash: null }) }),
    );
    const result = await verifyCertificationBundle(bundle, { now: NOW, check_chain: true });
    expect(result.chain_anchor).toBe("unavailable");
    expect(rpc.getBlock).not.toHaveBeenCalled();
  });
});

describe("live chain readers", () => {
  it("anchors to the latest block when the node reports a hash and number", async () => {
    rpc.getBlock.mockResolvedValue({
      hash: ANCHOR.block_hash,
      number: BigInt(ANCHOR.block_number),
      timestamp: BigInt(ANCHOR.block_timestamp),
    });
    expect(await defaultDeps.anchor()).toEqual({
      chain_id: expect.any(Number),
      chain_name: expect.any(String),
      block_number: ANCHOR.block_number,
      block_hash: ANCHOR.block_hash,
      block_timestamp: ANCHOR.block_timestamp,
      anchored: true,
    });
    expect(rpc.getBlock).toHaveBeenCalledWith({ blockTag: "latest" });
  });

  it.each([
    ["a node that returns no hash", { number: 1n, timestamp: 2n }],
    ["a pending block, which has no number", { hash: ANCHOR.block_hash, number: null, timestamp: 2n }],
  ])("records no anchor for %s", async (_label, block) => {
    rpc.getBlock.mockResolvedValue(block);
    const anchor = await defaultDeps.anchor();
    // `anchored` is the only signal the policy layer reads, so a partial block
    // must not be reported as a commitment.
    expect(anchor.anchored).toBe(false);
    expect(anchor.block_hash).toBeNull();
    expect(anchor.block_number).toBeNull();
  });

  it("still issues an anchorless bundle when the RPC is down", async () => {
    rpc.getBlock.mockRejectedValue(new Error("ETIMEDOUT"));
    const anchor = await defaultDeps.anchor();
    expect(anchor.anchored).toBe(false);
    expect(anchor.chain_name).toBeTruthy();
  });

  it("skips the read entirely when no anchor contract is deployed", async () => {
    chain.revocationAnchor = `0x${"0".repeat(40)}`;
    expect(await defaultDeps.revocation(ORG)).toEqual({
      checked: false,
      root: null,
      configured: false,
    });
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it("reads a published revocation root", async () => {
    const root = `0x${"9".repeat(64)}`;
    rpc.readContract.mockResolvedValue(root);
    expect(await defaultDeps.revocation(ORG)).toEqual({
      checked: true,
      root,
      configured: true,
    });
    expect(rpc.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "getRevocationRoot", args: [ORG] }),
    );
  });

  it("reports the zero root as no root, not as a root", async () => {
    rpc.readContract.mockResolvedValue(`0x${"0".repeat(64)}`);
    const state = await defaultDeps.revocation(ORG);
    // A contract default value is indistinguishable from "never published", and
    // treating it as published would satisfy a policy that demands proof.
    expect(state).toEqual({ checked: true, root: null, configured: true });
  });

  it("reads an all-zero word as empty when the provider capitalises the prefix", async () => {
    // The comparison is of the word's value, so casing carries no information —
    // a provider that formats `0x` differently must not turn a contract default
    // into a published root.
    rpc.readContract.mockResolvedValue(`0X${"0".repeat(64)}`);
    expect(await defaultDeps.revocation(ORG)).toEqual({
      checked: true,
      root: null,
      configured: true,
    });
  });

  it("keeps a failed revocation read as unchecked but configured", async () => {
    rpc.readContract.mockRejectedValue(new Error("execution reverted"));
    expect(await defaultDeps.revocation(ORG)).toEqual({
      checked: false,
      root: null,
      configured: true,
    });
  });

  it("drives the strict policy from what the chain actually says", async () => {
    rpc.readContract.mockResolvedValue(`0x${"0".repeat(64)}`);
    const error = await issueCertification(
      { org: ORG, now: NOW, policy: "strict" },
      { ...stubDeps(), revocation: defaultDeps.revocation },
    ).catch((err) => err);
    expect(error).toBeInstanceOf(CertificationRefusedError);
    expect((error as CertificationRefusedError).reasons.join(" ")).toMatch(
      /requires a published revocation root/,
    );
  });
});

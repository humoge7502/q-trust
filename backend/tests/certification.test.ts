import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import type { Address } from "viem";
import { canonicalJson, didKeyToPublicKey } from "../src/services/vc.js";
import {
  BUNDLE_SCHEMA,
  CertificationPolicyError,
  CertificationRefusedError,
  bundleDigest,
  certificationIssuerIdentity,
  evidenceLeafHash,
  getCertificationPolicy,
  issueCertification,
  merkleRoot,
  verifyCertificationBundle,
  type BundleAnchor,
  type CertificationBundle,
  type CertificationDeps,
  type RevocationState,
} from "../src/services/certification.js";

const ORG = "0x1111111111111111111111111111111111111111" as Address;
const NOW = new Date("2026-10-24T12:00:00.000Z");

const ASSET = {
  asset_id: "0x" + "a".repeat(64),
  org_did: ORG,
  cbom_hash: "0x" + "b".repeat(64),
  metadata_uri: "ipfs://cbom-1",
  timestamp: 1_760_000_000,
  last_updated: 1_760_000_000,
  active: true,
};

const MIGRATION = {
  migration_id: "0x" + "c".repeat(64),
  asset_id: ASSET.asset_id,
  org_did: ORG,
  from_algorithm: "RSA-2048",
  to_algorithm: "ML-KEM-768",
  evidence_hash: "0x" + "d".repeat(64),
  evidence_uri: "ipfs://evidence-1",
  timestamp: 1_760_000_500,
  verified: true,
};

const ATTESTATION = {
  attestation_id: "0x" + "e".repeat(64),
  vendor_did: "0x2222222222222222222222222222222222222222",
  product_id: "load-balancer",
  version: "4.2.0",
  algorithm: "ML-KEM-768",
  supported: true,
  evidence_uri: "ipfs://vendor-evidence",
  timestamp: 1_760_000_900,
  revoked: false,
};

function makeDeps(overrides: Partial<CertificationDeps> = {}): CertificationDeps {
  const anchor: BundleAnchor = {
    chain_id: 84532,
    chain_name: "Base Sepolia",
    block_number: 12_345_678,
    block_hash: "0x" + "f".repeat(64),
    block_timestamp: 1_760_001_000,
    anchored: true,
  };
  const revocation: RevocationState = {
    checked: true,
    root: "0x" + "9".repeat(64),
    configured: true,
  };
  return {
    summary: async () => ({
      org: ORG,
      asset_count: 1,
      migration_counts: { total: 1, verified: 1, unverified: 0 },
      latest_audit: {
        org_address: ORG,
        exists: true,
        result: "Passed",
        result_code: 1,
        timestamp: Math.floor(NOW.getTime() / 1000) - 86_400,
      },
      source: "indexer",
    }),
    assets: async () => ({ items: [ASSET], total: 1, offset: 0, limit: 200 }),
    migrations: async () => ({ items: [MIGRATION], total: 1, offset: 0, limit: 200 }),
    attestations: async () => ({ items: [ATTESTATION], total: 1, offset: 0, limit: 200 }),
    audit: async () => ({
      org_address: ORG,
      exists: true,
      result: "Passed",
      result_code: 1,
      timestamp: Math.floor(NOW.getTime() / 1000) - 86_400,
    }),
    revocation: async () => revocation,
    anchor: async () => anchor,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.QTRUST_VC_ISSUER_KEY = "11".repeat(32);
});

describe("certification bundle issuance", () => {
  it("issues a CERTIFIED bundle that verifies offline", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps());
    expect(bundle.schema).toBe(BUNDLE_SCHEMA);
    expect(bundle.verdict).toBe("CERTIFIED");
    expect(bundle.claims.asset_count).toBe(1);
    expect(bundle.evidence.leaf_count).toBe(4);
    expect(bundle.anchor.anchored).toBe(true);
    expect(bundle.proof.type).toBe("Ed25519Signature2020");

    const result = await verifyCertificationBundle(bundle, { now: NOW });
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.checked).toEqual({
      structure: true,
      digest: true,
      merkle: true,
      signature: true,
      validity: true,
    });
    expect(result.chain_anchor).toBe("skipped");
    expect(result.subject).toBe(ORG);
    expect(result.bundle_id).toBe(bundle.bundle_id);
  });

  it("commits a digest over the full contents", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps());
    expect(bundle.digest).toBe(bundleDigest(bundle as unknown as Record<string, unknown>));
    expect(bundle.evidence.merkle_root).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("embeds every evidence record the readers returned", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps());
    // The bundle is meant to be self-contained evidence: what the indexer and
    // registry returned must appear verbatim, not a hash of an empty object.
    expect(
      bundle.evidence.leaves.map((leaf) => ({ kind: leaf.kind, id: leaf.id, record: leaf.record })),
    ).toEqual([
      { kind: "asset", id: ASSET.asset_id, record: ASSET },
      { kind: "migration", id: MIGRATION.migration_id, record: MIGRATION },
      { kind: "attestation", id: ATTESTATION.attestation_id, record: ATTESTATION },
      {
        kind: "audit",
        id: `audit:${ORG.toLowerCase()}`,
        record: {
          org: ORG.toLowerCase(),
          result: "Passed",
          result_code: 1,
          timestamp: Math.floor(NOW.getTime() / 1000) - 86_400,
        },
      },
    ]);
    for (const leaf of bundle.evidence.leaves) {
      expect(leaf.digest, leaf.id).toBe(
        createHash("sha256").update(canonicalJson(leaf.record), "utf8").digest("hex"),
      );
    }
    expect(bundle.evidence.leaf_count).toBe(4);
    expect(bundle.evidence.merkle_root).toBe(
      merkleRoot(bundle.evidence.leaves.map(evidenceLeafHash)),
    );
  });

  it("attaches a proof that names the key that signed it", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps());
    expect(Object.keys(bundle.proof)).toEqual([
      "type",
      "created",
      "verificationMethod",
      "proofPurpose",
      "proofValue",
    ]);
    expect(bundle.proof.type).toBe("Ed25519Signature2020");
    expect(bundle.proof.created).toBe(NOW.toISOString());
    expect(bundle.proof.verificationMethod).toBe(`${bundle.issuer}#key-1`);
    // A proof without its purpose is not a Linked Data Proof a verifier can
    // classify: assertionMethod is what says "the issuer asserts this".
    expect(bundle.proof.proofPurpose).toBe("assertionMethod");
    expect(bundle.proof.proofValue).toMatch(/^[0-9a-f]{128}$/);
  });

  it("refuses to certify an org with no registered assets", async () => {
    const deps = makeDeps({
      summary: async () => ({
        org: ORG,
        asset_count: 0,
        migration_counts: { total: 0, verified: 0, unverified: 0 },
        latest_audit: null,
        source: "rpc",
      }),
      assets: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
      migrations: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
      attestations: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
      audit: async () => ({ org_address: ORG, exists: false, result: "None", result_code: 0, timestamp: 0 }),
      revocation: async () => ({ checked: false, root: null, configured: false }),
    });
    await expect(issueCertification({ org: ORG, now: NOW }, deps)).rejects.toBeInstanceOf(
      CertificationRefusedError,
    );
    await expect(issueCertification({ org: ORG, now: NOW }, deps)).rejects.toMatchObject({
      reasons: [expect.stringContaining("no registered assets")],
    });
  });

  it("refuses when the latest audit failed", async () => {
    const deps = makeDeps({
      audit: async () => ({
        org_address: ORG,
        exists: true,
        result: "Failed",
        result_code: 2,
        timestamp: Math.floor(NOW.getTime() / 1000) - 3600,
      }),
    });
    await expect(issueCertification({ org: ORG, now: NOW }, deps)).rejects.toMatchObject({
      reasons: [expect.stringContaining("audit failed")],
    });
  });

  it("requires a current audit under the regulated policy", async () => {
    const stale = Math.floor(NOW.getTime() / 1000) - 400 * 86_400;
    const deps = makeDeps({
      audit: async () => ({
        org_address: ORG,
        exists: true,
        result: "Passed",
        result_code: 1,
        timestamp: stale,
      }),
    });
    await expect(
      issueCertification({ org: ORG, policy: "regulated", now: NOW }, deps),
    ).rejects.toMatchObject({
      reasons: expect.arrayContaining([expect.stringContaining("days old")]),
    });
  });

  it("issues a CONDITIONAL bundle when an optional check is unavailable", async () => {
    const deps = makeDeps({
      audit: async () => ({ org_address: ORG, exists: false, result: "None", result_code: 0, timestamp: 0 }),
      revocation: async () => ({ checked: true, root: null, configured: true }),
    });
    const bundle = await issueCertification({ org: ORG, now: NOW }, deps);
    expect(bundle.verdict).toBe("CONDITIONAL");
    expect(bundle.caveats.join(" ")).toMatch(/no audit recorded/);
    expect(bundle.caveats.join(" ")).toMatch(/no revocation root/);
    expect((await verifyCertificationBundle(bundle, { now: NOW })).valid).toBe(true);
  });

  it("refuses under the strict policy when migrations are unverified", async () => {
    const deps = makeDeps({
      summary: async () => ({
        org: ORG,
        asset_count: 1,
        migration_counts: { total: 4, verified: 1, unverified: 3 },
        latest_audit: {
          org_address: ORG,
          exists: true,
          result: "Passed",
          result_code: 1,
          timestamp: Math.floor(NOW.getTime() / 1000) - 3600,
        },
        source: "indexer",
      }),
    });
    await expect(
      issueCertification({ org: ORG, policy: "strict", now: NOW }, deps),
    ).rejects.toMatchObject({
      reasons: [expect.stringContaining("verified migration ratio")],
    });
  });

  it("rejects unknown policies and out-of-range validity", async () => {
    await expect(
      issueCertification({ org: ORG, policy: "nope", now: NOW }, makeDeps()),
    ).rejects.toBeInstanceOf(CertificationPolicyError);
    await expect(
      issueCertification({ org: ORG, validity_days: 400, now: NOW }, makeDeps()),
    ).rejects.toBeInstanceOf(CertificationPolicyError);
    expect(getCertificationPolicy("strict").max_validity_days).toBe(90);
  });

  it("caps evidence in the bundle while keeping claim totals", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...ASSET,
      asset_id: "0x" + i.toString(16).padStart(64, "0"),
    }));
    const deps = makeDeps({
      summary: async () => ({
        org: ORG,
        asset_count: 30,
        migration_counts: { total: 0, verified: 0, unverified: 0 },
        latest_audit: null,
        source: "indexer",
      }),
      assets: async (_org, offset, limit) => ({
        items: many.slice(offset, offset + limit),
        total: many.length,
        offset,
        limit,
      }),
      migrations: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
      attestations: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
      audit: async () => ({ org_address: ORG, exists: false, result: "None", result_code: 0, timestamp: 0 }),
    });
    const bundle = await issueCertification(
      { org: ORG, now: NOW, evidence_limit: 10, policy: "default" },
      deps,
    );
    expect(bundle.claims.asset_count).toBe(30);
    expect(bundle.evidence.leaf_count).toBe(10);
  });
});

describe("certification bundle verification (fail-closed)", () => {
  let bundle: CertificationBundle;

  beforeEach(async () => {
    bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps());
  });

  it("rejects a tampered evidence record", async () => {
    const tampered = structuredClone(bundle);
    tampered.evidence.leaves[0].record.host = "attacker.example";
    const result = await verifyCertificationBundle(tampered, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.checked.digest).toBe(false);
    expect(result.checked.merkle).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/digest mismatch/);
  });

  it("rejects a tampered claim even when the signature is left untouched", async () => {
    const tampered = structuredClone(bundle);
    tampered.claims.asset_count = 999;
    const result = await verifyCertificationBundle(tampered, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.checked.signature).toBe(false);
    expect(result.checked.digest).toBe(false);
  });

  it("rejects a bad signature while the digest still matches", async () => {
    const tampered = structuredClone(bundle);
    tampered.proof.proofValue = tampered.proof.proofValue.replace(/^../, "00");
    const result = await verifyCertificationBundle(tampered, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.checked.digest).toBe(true);
    expect(result.checked.merkle).toBe(true);
    expect(result.checked.signature).toBe(false);
  });

  it("rejects reordered or dropped evidence", async () => {
    const dropped = structuredClone(bundle);
    dropped.evidence.leaves.pop();
    dropped.evidence.leaf_count -= 1;
    const result = await verifyCertificationBundle(dropped, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.checked.merkle).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/Merkle root mismatch/);
  });

  it("rejects an expired bundle and one used before its window", async () => {
    const after = new Date(Date.parse(bundle.valid_until) + 1000);
    const expired = await verifyCertificationBundle(bundle, { now: after });
    expect(expired.valid).toBe(false);
    expect(expired.expired).toBe(true);
    expect(expired.checked.validity).toBe(false);

    const before = new Date(Date.parse(bundle.valid_from) - 1000);
    const early = await verifyCertificationBundle(bundle, { now: before });
    expect(early.valid).toBe(false);
    expect(early.checked.validity).toBe(false);
  });

  it("rejects non-bundles and unsupported schemas", async () => {
    expect((await verifyCertificationBundle(null)).valid).toBe(false);
    expect((await verifyCertificationBundle({ schema: "other" })).valid).toBe(false);
    expect((await verifyCertificationBundle({ schema: BUNDLE_SCHEMA })).valid).toBe(false);
  });

  it("enforces a pinned issuer DID when one is supplied", async () => {
    const pinned = await verifyCertificationBundle(bundle, {
      now: NOW,
      trust_anchor_did: bundle.issuer,
    });
    expect(pinned.valid).toBe(true);

    // The signature is still cryptographically valid; the pin is what makes it
    // inadmissible, so `signature` must be false rather than merely reasoned.
    const substituted = await verifyCertificationBundle(bundle, {
      now: NOW,
      trust_anchor_did: "did:key:z6MkSomeoneElse",
    });
    expect(substituted.valid).toBe(false);
    expect(substituted.checked.signature).toBe(false);
    expect(substituted.reasons.join(" ")).toMatch(/pinned trust anchor/);
  });

  it("reports a chain anchor mismatch when re-anchoring is requested", async () => {
    // check_chain touches the real RPC client; with no node reachable the
    // verifier must fail closed rather than silently pass.
    const result = await verifyCertificationBundle(bundle, { now: NOW, check_chain: true });
    expect(result.valid).toBe(false);
    expect(["unavailable", "mismatch"]).toContain(result.chain_anchor);
  });
});

describe("merkle commitment", () => {
  it("is order-independent and changes on any input change", () => {
    const leaf = (id: string) => evidenceLeafHash({ kind: "asset", id, digest: "0".repeat(64) });
    const a = leaf("a");
    const b = leaf("b");
    const c = leaf("c");
    expect(merkleRoot([a, b, c])).toBe(merkleRoot([c, a, b]));
    expect(merkleRoot([a, b, c])).not.toBe(merkleRoot([a, b, "d".repeat(64)]));
  });

  it("handles empty and odd-sized trees deterministically", () => {
    const a = evidenceLeafHash({ kind: "asset", id: "a", digest: "0".repeat(64) });
    const b = evidenceLeafHash({ kind: "asset", id: "b", digest: "1".repeat(64) });
    expect(merkleRoot([])).toMatch(/^0x[0-9a-f]{64}$/);
    expect(merkleRoot([])).toBe(merkleRoot([]));
    expect(merkleRoot([a])).toMatch(/^0x[0-9a-f]{64}$/);
    expect(merkleRoot([a, b])).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("published issuer identity", () => {
  it("matches the key that actually signs bundles", async () => {
    // Verifiers pin this DID before a bundle exists, so it has to be the same
    // identity the proofs carry — a mismatch would make every pin fail.
    const identity = certificationIssuerIdentity();
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps());

    expect(identity.issuer).toBe(bundle.issuer);
    expect(identity.verification_method).toBe(bundle.proof.verificationMethod);
    expect(identity.schema).toBe(BUNDLE_SCHEMA);

    const result = await verifyCertificationBundle(bundle, {
      now: NOW,
      trust_anchor_did: identity.issuer,
    });
    expect(result.valid).toBe(true);
  });

  it("is a fingerprint of the public key and leaks no private material", () => {
    const identity = certificationIssuerIdentity();
    const publicKey = didKeyToPublicKey(identity.issuer);
    expect(publicKey).not.toBeNull();
    expect(identity.public_key_multibase).toBe(identity.issuer.slice("did:key:".length));
    expect(identity.key_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.key_fingerprint).toBe(
      createHash("sha256").update(publicKey as Uint8Array).digest("hex"),
    );
    // The seed under test; a leak here would be a key disclosure through an
    // unauthenticated endpoint.
    expect(JSON.stringify(identity)).not.toContain("11".repeat(32));
  });
});

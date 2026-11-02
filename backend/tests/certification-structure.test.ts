import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import type { Address } from "viem";
import {
  BUNDLE_SCHEMA,
  bundleDigest,
  evidenceLeafHash,
  isBytes32Hex,
  issueCertification,
  merkleRoot,
  verifyCertificationBundle,
  type BundleAnchor,
  type CertificationBundle,
  type CertificationDeps,
  type RevocationState,
  type VerifyBundleOptions,
} from "../src/services/certification.js";
import { canonicalJson, issuerKeyPair } from "../src/services/vc.js";

/**
 * Verifier tamper matrix.
 *
 * The verifier is the only thing standing between a pasted JSON blob and a
 * "CERTIFIED" answer, so each acceptance condition is attacked on its own. A
 * bundle that is valid before the edit must be invalid after it, and the report
 * must name the check that broke — a `valid: false` with the wrong reason is
 * how a verifier ends up rejecting the honest while shrugging at the forged.
 *
 * `resolveIssuerKey` is wrapped so a test can hand the verifier a key that is
 * absent or the wrong length: material a real did:key never yields, and the
 * only way to prove the verifier checks what the resolver returned rather than
 * trusting it. Every other export stays real.
 */
const keyStub = vi.hoisted(() => ({
  current: null as null | { key: Uint8Array | null } | { error: string },
}));

vi.mock("../src/services/vc.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/vc.js")>();
  return {
    ...actual,
    resolveIssuerKey: async (issuer: string, verificationMethod: string) => {
      const stub = keyStub.current;
      if (stub) {
        if ("error" in stub) throw new Error(stub.error);
        return stub.key;
      }
      return actual.resolveIssuerKey(issuer, verificationMethod);
    },
  };
});

const ORG = "0x1111111111111111111111111111111111111111" as Address;
const NOW = new Date("2026-10-24T12:00:00.000Z");

type Loose = Record<string, unknown>;

const ASSET = {
  asset_id: `0x${"a".repeat(64)}`,
  org_did: ORG,
  cbom_hash: `0x${"b".repeat(64)}`,
  metadata_uri: "ipfs://cbom-1",
  timestamp: 1_760_000_000,
  last_updated: 1_760_000_000,
  active: true,
};

const ANCHOR: BundleAnchor = {
  chain_id: 84532,
  chain_name: "Base Sepolia",
  block_number: 12_345_678,
  block_hash: `0x${"f".repeat(64)}`,
  block_timestamp: 1_760_001_000,
  anchored: true,
};

const WITH_ROOT: RevocationState = {
  checked: true,
  root: `0x${"9".repeat(64)}`,
  configured: true,
};

function makeDeps(): CertificationDeps {
  return {
    summary: async () => ({
      org: ORG,
      asset_count: 1,
      migration_counts: { total: 1, verified: 1, unverified: 0 },
      latest_audit: null,
      source: "indexer",
    }),
    assets: async () => ({ items: [ASSET], total: 1, offset: 0, limit: 200 }),
    migrations: async () => ({ items: [], total: 1, offset: 0, limit: 200 }),
    attestations: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
    audit: async () => ({
      org_address: ORG,
      exists: true,
      result: "Passed",
      result_code: 1,
      timestamp: Math.floor(NOW.getTime() / 1000) - 86_400,
    }),
    revocation: async () => WITH_ROOT,
    anchor: async () => ANCHOR,
  };
}

let bundle: CertificationBundle;

const OUR_SEED = "11".repeat(32);
const OTHER_SEED = "22".repeat(32);

beforeEach(async () => {
  keyStub.current = null;
  process.env.QTRUST_VC_ISSUER_KEY = OUR_SEED;
  bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps());
});

/**
 * The same registry snapshot certified by a different issuer key. Everything
 * about it is well-formed — only the key behind the DID differs — which is the
 * interesting case for pinning: a self-consistent forgery, not garbage.
 */
async function issuedWithOtherKey(): Promise<CertificationBundle> {
  process.env.QTRUST_VC_ISSUER_KEY = OTHER_SEED;
  try {
    return await issueCertification({ org: ORG, now: NOW }, makeDeps());
  } finally {
    process.env.QTRUST_VC_ISSUER_KEY = OUR_SEED;
  }
}

function draft(): Loose {
  return structuredClone(bundle) as unknown as Loose;
}

/** Walk a dotted path (array indices allowed) into the draft. Empty path is the root. */
function at(root: Loose, path: string): Loose {
  if (path === "") return root;
  let cursor: unknown = root;
  for (const segment of path.split(".")) cursor = (cursor as Loose)[segment];
  return cursor as Loose;
}

const DELETE = Symbol("delete");

async function tamper(edits: Array<[path: string, value: unknown]>, options: VerifyBundleOptions = {}) {
  const copy = draft();
  for (const [path, value] of edits) {
    const segments = path.split(".");
    const parent = at(copy, segments.slice(0, -1).join("."));
    const leaf = segments[segments.length - 1];
    if (value === DELETE) delete parent[leaf];
    else parent[leaf] = value;
  }
  return verifyCertificationBundle(copy, { now: NOW, ...options });
}

describe("baseline", () => {
  it("accepts the untouched bundle", async () => {
    const result = await verifyCertificationBundle(bundle, { now: NOW });
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.chain_anchor).toBe("skipped");
  });
});

describe("structure", () => {
  it.each([
    ["bundle_id", 42],
    ["issuer", 42],
    ["issued_at", 42],
    ["valid_from", 42],
    ["valid_until", 42],
    ["proof.proofValue", 1234],
  ])("rejects a non-string %s", async (path, value) => {
    const result = await tamper([[path, value]]);
    expect(result.valid).toBe(false);
    expect(result.checked.structure).toBe(false);
    expect(result.reasons).toContain("bundle is missing required fields");
  });

  it.each([
    ["subject", "did:web:example.com"],
    ["subject.org", 7],
    ["claims", []],
    ["evidence", "sha256"],
    ["evidence.leaves", {}],
    ["proof", null],
  ])("rejects a malformed %s", async (path, value) => {
    const result = await tamper([[path, value]]);
    expect(result.checked.structure).toBe(false);
    expect(result.reasons).toContain("bundle is missing required fields");
  });

  it("rejects every required field that is absent", async () => {
    for (const field of [
      "bundle_id",
      "issuer",
      "subject",
      "issued_at",
      "valid_from",
      "valid_until",
      "claims",
      "evidence",
      "proof",
    ]) {
      const result = await tamper([[field, DELETE]]);
      expect(result.checked.structure, field).toBe(false);
      expect(result.reasons).toContain("bundle is missing required fields");
    }
  });

  it("rejects the wrong schema and non-objects before reading anything else", async () => {
    for (const input of [
      null,
      undefined,
      "bundle",
      [],
      42,
      { schema: "qtrust.certification.v2" },
      { ...draft(), schema: "qtrust.certification.v2" },
    ]) {
      const result = await verifyCertificationBundle(input);
      expect(result.valid).toBe(false);
      expect(result.reasons).toContain(`not a ${BUNDLE_SCHEMA} bundle`);
      expect(result.checked).toEqual({
        structure: false,
        digest: false,
        merkle: false,
        signature: false,
        validity: false,
      });
      expect(result.chain_anchor).toBe("skipped");
      expect(result.bundle_id).toBeNull();
      expect(result.issuer).toBeNull();
      expect(result.subject).toBeNull();
      expect(result.verdict).toBeNull();
      expect(result.valid_until).toBeNull();
      expect(result.caveats).toEqual([]);
      expect(result.expired).toBe(false);
    }
  });

  it("reports an unusable verdict as absent and filters non-string caveats", async () => {
    const result = await tamper([
      ["verdict", 5],
      ["caveats", ["kept", 42, null, "also kept"]],
    ]);
    expect(result.verdict).toBeNull();
    expect(result.caveats).toEqual(["kept", "also kept"]);
    // Optional-field damage alone does not invalidate the bundle.
    expect(result.checked.structure).toBe(true);
  });

  it("drops a caveats field that is not an array", async () => {
    const result = await tamper([["caveats", "no caveats"]]);
    expect(result.caveats).toEqual([]);
  });

  it("keeps a string verdict verbatim", async () => {
    const result = await verifyCertificationBundle(bundle, { now: NOW });
    expect(result.verdict).toBe(bundle.verdict);
  });
});

describe("digest", () => {
  it("detects a content change that keeps the digest field intact", async () => {
    const result = await tamper([["claims.asset_count", 99]]);
    expect(result.valid).toBe(false);
    expect(result.checked.digest).toBe(false);
    expect(result.reasons).toContain("digest mismatch — bundle contents were modified");
  });

  it("detects a re-hashed forgery through the signature", async () => {
    const result = await tamper([
      ["claims.asset_count", 99],
      ["digest", `sha256:${"0".repeat(64)}`],
    ]);
    expect(result.checked.digest).toBe(false);
    expect(result.checked.signature).toBe(false);
  });

  it("rejects a digest that is absent or not a string", async () => {
    for (const value of [DELETE, 0, true]) {
      const result = await tamper([["digest", value]]);
      expect(result.checked.digest).toBe(false);
      expect(result.reasons).toContain("digest mismatch — bundle contents were modified");
    }
  });
});

describe("evidence commitment", () => {
  /**
   * Editing a leaf edits signed content, so an honest tamper report names three
   * things in order: the digest no longer matches, the evidence check that
   * noticed, and the signature over the bytes the attacker changed. A verifier
   * that reports more (or fewer) has either double-counted or skipped a check.
   */
  const tamperReport = (merkleReason: string) => [
    "digest mismatch — bundle contents were modified",
    merkleReason,
    "Ed25519 signature does not verify against the issuer key",
  ];

  it("rejects an evidence block that is not a sha256 Merkle commitment", async () => {
    for (const algorithm of ["sha512", "keccak256", "", null, 5]) {
      const result = await tamper([["evidence.hash_algorithm", algorithm]]);
      expect(result.checked.merkle).toBe(false);
      expect(result.reasons).toEqual(
        tamperReport("evidence block is not a sha256 Merkle commitment"),
      );
    }
  });

  it("rejects a leaf that is not a record", async () => {
    const result = await tamper([["evidence.leaves.0", "leaf"]]);
    expect(result.checked.merkle).toBe(false);
    expect(result.reasons).toEqual(tamperReport("malformed evidence leaf"));
  });

  it.each([
    ["an unknown leaf kind", "kind", "rumour"],
    ["a missing leaf kind", "kind", DELETE],
    ["a non-string leaf id", "id", 12],
    ["a missing leaf id", "id", DELETE],
    ["a non-string leaf digest", "digest", null],
    ["a missing leaf digest", "digest", DELETE],
    ["a missing leaf record", "record", DELETE],
    ["a leaf record that is an array", "record", []],
    ["a leaf record that is a string", "record", "asset"],
  ])("rejects %s and stops at the leaf", async (_label, field, value) => {
    const result = await tamper([[`evidence.leaves.0.${field}`, value]]);
    expect(result.checked.merkle).toBe(false);
    // Exactly one merkle reason: once a leaf is unreadable the root and the
    // count say nothing a verifier should have to wade through.
    expect(result.reasons).toEqual(tamperReport("malformed evidence leaf"));
  });

  it("detects a tampered record inside a leaf", async () => {
    const result = await tamper([["evidence.leaves.0.record.metadata_uri", "ipfs://attacker"]]);
    expect(result.checked.merkle).toBe(false);
    expect(result.reasons).toEqual(
      tamperReport(`evidence record tampered: asset:${ASSET.asset_id}`),
    );
  });

  it("detects a substituted record that re-hashes its own digest", async () => {
    const forged = { ...ASSET, metadata_uri: "ipfs://attacker" };
    const result = await tamper([
      ["evidence.leaves.0.record", forged],
      [
        "evidence.leaves.0.digest",
        createHash("sha256").update(canonicalJson(forged), "utf8").digest("hex"),
      ],
    ]);
    // The leaf digest now matches its record, so only the committed Merkle root
    // and the bundle digest can catch it.
    expect(result.checked.merkle).toBe(false);
    expect(result.checked.digest).toBe(false);
  });

  it("detects dropped leaves even when the count is corrected", async () => {
    const copy = draft();
    const leaves = at(copy, "evidence").leaves as unknown[];
    const count = at(copy, "evidence").leaf_count as number;
    leaves.pop();
    at(copy, "evidence").leaf_count = count - 1;
    const result = await verifyCertificationBundle(copy, { now: NOW });
    expect(result.checked.merkle).toBe(false);
    expect(result.reasons).toEqual(tamperReport("Merkle root mismatch — evidence set was altered"));
  });

  it("detects a leaf count that disagrees with the embedded leaves", async () => {
    const result = await tamper([["evidence.leaf_count", 99]]);
    expect(result.checked.merkle).toBe(false);
    expect(result.reasons).toEqual(
      tamperReport("evidence leaf count does not match the committed count"),
    );
  });

  it("detects an extended evidence set with a recomputed count", async () => {
    const copy = draft();
    const leaves = at(copy, "evidence").leaves as unknown[];
    leaves.push(structuredClone(leaves[0]));
    at(copy, "evidence").leaf_count = leaves.length;
    const result = await verifyCertificationBundle(copy, { now: NOW });
    expect(result.checked.merkle).toBe(false);
    expect(result.reasons).toEqual(tamperReport("Merkle root mismatch — evidence set was altered"));
  });

  it("survives a reordered leaf array at the root but not at the digest", async () => {
    const copy = draft();
    const evidence = at(copy, "evidence");
    const original = structuredClone(evidence.leaves) as unknown[];
    evidence.leaves = [...original].reverse();
    // Self-check: the reorder must actually change the signed bytes, otherwise
    // this test would be asserting nothing.
    expect(canonicalJson(evidence.leaves)).not.toBe(canonicalJson(original));

    const rootOfReordered = merkleRoot(
      (evidence.leaves as CertificationBundle["evidence"]["leaves"]).map(evidenceLeafHash),
    );

    const result = await verifyCertificationBundle(copy, { now: NOW });
    // The root sorts leaves, so the commitment is order independent — but the
    // leaf array is signed content, so a reorder is still a modified bundle.
    expect(rootOfReordered).toBe(evidence.merkle_root);
    expect(result.checked.merkle).toBe(true);
    expect(result.checked.digest).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("digest mismatch — bundle contents were modified");
  });
});

describe("signature", () => {
  it("rejects an unsupported proof type", async () => {
    const result = await tamper([["proof.type", "EcdsaSecp256k1Signature2019"]]);
    expect(result.checked.signature).toBe(false);
    expect(result.reasons).toContain("unsupported proof type: EcdsaSecp256k1Signature2019");
  });

  it("rejects a proof without a verification method", async () => {
    const result = await tamper([["proof.verificationMethod", DELETE]]);
    expect(result.checked.signature).toBe(false);
    expect(result.reasons).toContain("proof has no verificationMethod");
  });

  it("rejects signatures of the wrong length", async () => {
    for (const value of ["aa".repeat(63), "aa".repeat(65), "zz", ""]) {
      const result = await tamper([["proof.proofValue", value]]);
      expect(result.checked.signature).toBe(false);
      expect(result.reasons).toEqual(["invalid Ed25519 signature length"]);
    }
  });

  it("documents what an unpinned verifier accepts: any self-consistent key", async () => {
    const foreign = await issuedWithOtherKey();
    const result = await verifyCertificationBundle(foreign, { now: NOW });
    // A different issuer, a valid signature over its own content. Without a
    // pin the verifier can only say "whoever signed this holds that key" — it
    // cannot say the platform signed it. This is the hole the pin closes.
    expect(foreign.issuer).not.toBe(bundle.issuer);
    expect(result.checked.signature).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("rejects a bundle signed by a different key once the issuer is pinned", async () => {
    const foreign = await issuedWithOtherKey();
    const result = await verifyCertificationBundle(foreign, {
      now: NOW,
      trust_anchor_did: bundle.issuer,
    });
    expect(result.checked.signature).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("issuer does not match the pinned trust anchor");
  });

  it("accepts a bundle pinned to the issuer it names", async () => {
    const result = await tamper([], { trust_anchor_did: bundle.issuer });
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects an issuer DID that resolves to no usable key", async () => {
    const result = await tamper([
      ["issuer", "did:key:zNotBase58!"],
      ["proof.verificationMethod", "did:key:zNotBase58!#key-1"],
    ]);
    expect(result.checked.signature).toBe(false);
    // Exact, not an either/or: a DID whose key material cannot be decoded is
    // reported differently from a signature that fails to verify, and a
    // verifier that conflates them hides which half is broken.
    expect(result.reasons).toEqual([
      "digest mismatch — bundle contents were modified",
      "issuer DID resolved to no usable Ed25519 key",
    ]);
  });

  it.each([
    ["no key at all", null],
    ["a 31-byte key", new Uint8Array(31)],
    ["a 33-byte key", new Uint8Array(33)],
    ["an empty key", new Uint8Array(0)],
  ])("rejects a resolver that returns %s", async (_label, material) => {
    keyStub.current = { key: material as Uint8Array | null };
    try {
      const result = await tamper([]);
      expect(result.checked.signature).toBe(false);
      expect(result.reasons).toEqual(["issuer DID resolved to no usable Ed25519 key"]);
      // Everything else still passes: this is a key-shape rejection, not a
      // bundle-shaped one.
      expect(result.checked).toEqual({
        structure: true,
        digest: true,
        merkle: true,
        signature: false,
        validity: true,
      });
    } finally {
      keyStub.current = null;
    }
  });

  it("reports a resolver that throws instead of failing open", async () => {
    keyStub.current = { error: "resolver exploded" };
    try {
      const result = await tamper([]);
      expect(result.checked.signature).toBe(false);
      expect(result.reasons).toEqual(["signature verification failed: resolver exploded"]);
    } finally {
      keyStub.current = null;
    }
  });

  it("rejects a well-formed signature that is not the issuer's", async () => {
    // 64 bytes of the right shape and the wrong bytes: the length check passes
    // and only the curve can tell, so the report must name the failed verify.
    const result = await tamper([["proof.proofValue", "aa".repeat(64)]]);
    expect(result.checked.signature).toBe(false);
    expect(result.checked.digest).toBe(true);
    expect(result.checked.merkle).toBe(true);
    expect(result.reasons).toEqual([
      "Ed25519 signature does not verify against the issuer key",
    ]);
  });

  it("refuses a bundle whose verification method does not belong to the issuer", async () => {
    const result = await tamper([
      ["proof.verificationMethod", "did:key:z6MkSomeoneElse#key-1"],
    ]);
    expect(result.checked.signature).toBe(false);
    // `proof` travels outside the digest, so this is a one-reason rejection:
    // the content is intact and only the key locator is wrong.
    expect(result.checked.digest).toBe(true);
    expect(result.reasons).toHaveLength(1);
  });
});

describe("validity window", () => {
  it("rejects timestamps that are not parseable", async () => {
    for (const field of ["valid_from", "valid_until"]) {
      const result = await tamper([[field, "yesterday"]]);
      expect(result.checked.validity).toBe(false);
      expect(result.reasons).toContain("validity window is not a pair of ISO timestamps");
    }
  });

  it("accepts the exact boundaries and rejects one second outside", async () => {
    const from = new Date(Date.parse(bundle.valid_from));
    const until = new Date(Date.parse(bundle.valid_until));

    expect((await verifyCertificationBundle(bundle, { now: from })).valid).toBe(true);
    expect((await verifyCertificationBundle(bundle, { now: until })).valid).toBe(true);

    const early = await verifyCertificationBundle(bundle, { now: new Date(from.getTime() - 1000) });
    expect(early.valid).toBe(false);
    expect(early.reasons).toContain("bundle is not valid yet");
    expect(early.checked.validity).toBe(false);
    expect(early.expired).toBe(false);

    const late = await verifyCertificationBundle(bundle, { now: new Date(until.getTime() + 1000) });
    expect(late.valid).toBe(false);
    expect(late.expired).toBe(true);
    expect(late.reasons).toContain(`bundle expired at ${bundle.valid_until}`);
  });

  it("keeps reporting expiry as a failure when every other check passes", async () => {
    const late = await verifyCertificationBundle(bundle, {
      now: new Date(Date.parse(bundle.valid_until) + 60_000),
    });
    expect(late.checked).toEqual({
      structure: true,
      digest: true,
      merkle: true,
      signature: true,
      validity: false,
    });
    expect(late.reasons).toEqual([`bundle expired at ${bundle.valid_until}`]);
    expect(late.valid).toBe(false);
  });

  it("defaults to verifying against the current clock", async () => {
    // A bundle issued six years ago whose window closed a month later: only a
    // verifier reading the real clock can call it expired.
    const stale = new Date("2020-01-01T00:00:00.000Z");
    const deps = makeDeps();
    deps.audit = async () => ({
      org_address: ORG,
      exists: true,
      result: "Passed",
      result_code: 1,
      timestamp: Math.floor(stale.getTime() / 1000) - 86_400,
    });
    const old = await issueCertification({ org: ORG, now: stale }, deps);
    expect(old.valid_until).toBe("2020-01-31T00:00:00.000Z");

    const result = await verifyCertificationBundle(old);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.checked.digest).toBe(true);
    expect(result.checked.signature).toBe(true);
    expect(result.checked.validity).toBe(false);
    expect(result.reasons).toContain(`bundle expired at ${old.valid_until}`);
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Same bundle, evaluated at the instant it was issued, is valid — proving
    // the failure above came from the clock and not from the bundle.
    expect((await verifyCertificationBundle(old, { now: stale })).valid).toBe(true);
  });
});

/**
 * Sign a draft with the issuance key without recomputing its digest, and re-seal
 * a draft whose committed content changed. Both are needed to break exactly one
 * check at a time: a bundle that fails only the digest test is a different
 * object from one that fails only the Merkle test, and `valid` must be false for
 * each of them — not merely false for the bundles that happen to fail several.
 */
function signOver(edited: Loose): CertificationBundle {
  const { privateKey } = issuerKeyPair();
  const payload: Loose = { ...edited };
  delete payload.proof;
  const signature = ed25519.sign(Buffer.from(canonicalJson(payload), "utf8"), privateKey);
  return {
    ...(edited as unknown as CertificationBundle),
    proof: {
      ...(edited.proof as CertificationBundle["proof"]),
      proofValue: Buffer.from(signature).toString("hex"),
    },
  };
}

function reseal(edited: Loose): CertificationBundle {
  return signOver({ ...edited, digest: bundleDigest(edited) });
}

describe("acceptance needs every check, not most of them", () => {
  const ALL_OK = {
    structure: true,
    digest: true,
    merkle: true,
    signature: true,
    validity: true,
  };

  it("refuses on a digest that no longer describes the content it carries", async () => {
    // The self-consistent forgery: content untouched, signature recomputed over
    // it, only the committed digest replaced. Every other check passes.
    const forged = signOver({ ...draft(), digest: `sha256:${"0".repeat(64)}` });
    expect(forged.digest).not.toBe(bundle.digest);
    const result = await verifyCertificationBundle(forged, { now: NOW });
    expect(result.checked).toEqual({ ...ALL_OK, digest: false });
    expect(result.reasons).toEqual(["digest mismatch — bundle contents were modified"]);
    expect(result.valid).toBe(false);
  });

  it("refuses on a Merkle root the embedded leaves do not produce", async () => {
    const copy = draft();
    at(copy, "evidence").merkle_root = `0x${"1".repeat(64)}`;
    const forged = reseal(copy);
    // Self-check: the re-seal must have repaired the digest and the signature,
    // so the Merkle root is the only thing left that disagrees.
    expect(forged.digest).toBe(bundleDigest(forged as unknown as Loose));
    const result = await verifyCertificationBundle(forged, { now: NOW });
    expect(result.checked).toEqual({ ...ALL_OK, merkle: false });
    expect(result.reasons).toEqual(["Merkle root mismatch — evidence set was altered"]);
    expect(result.valid).toBe(false);
  });

  it("refuses a stale signature even when the digest was re-hashed to match", async () => {
    // The forger's shortcut: edit the claim, recompute the digest, leave the
    // proof alone. The bundle is internally consistent apart from the signature,
    // so only the curve can catch it.
    const copy = draft();
    at(copy, "claims").asset_count = 4242;
    copy.digest = bundleDigest(copy);
    expect(copy.digest).not.toBe(bundle.digest);
    const result = await verifyCertificationBundle(copy, { now: NOW });
    expect(result.checked).toEqual({ ...ALL_OK, signature: false });
    expect(result.reasons).toEqual([
      "Ed25519 signature does not verify against the issuer key",
    ]);
    expect(result.valid).toBe(false);
  });

  it("refuses a bundle whose only fault is that it was read too early", async () => {
    const early = await verifyCertificationBundle(bundle, {
      now: new Date(Date.parse(bundle.valid_from) - 1000),
    });
    expect(early.checked).toEqual({ ...ALL_OK, validity: false });
    expect(early.reasons).toEqual(["bundle is not valid yet"]);
    expect(early.valid).toBe(false);
  });

  it("refuses a fully signed bundle when the anchor it was asked to check is missing", async () => {
    // `anchor` is optional in the format, so this is a bundle with four true
    // checks, a valid signature and no chain proof — the online verifier must
    // not let it through.
    const copy = draft();
    delete copy.anchor;
    const forged = reseal(copy);
    const result = await verifyCertificationBundle(forged, { now: NOW, check_chain: true });
    expect(result.checked).toEqual(ALL_OK);
    expect(result.chain_anchor).toBe("unavailable");
    expect(result.reasons).toEqual(["bundle carries no chain anchor"]);
    expect(result.valid).toBe(false);
  });
});

describe("isBytes32Hex", () => {
  it.each([
    ["the zero word", `0x${"0".repeat(64)}`],
    ["a lower-case word", `0x${"a".repeat(64)}`],
    ["an upper-case word", `0x${"F".repeat(64)}`],
    ["a mixed-case word", `0x${"0123456789abcdef".repeat(4)}`],
  ])("accepts %s", (_label, value) => {
    expect(isBytes32Hex(value)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["a bare prefix", "0x"],
    ["no prefix", "a".repeat(64)],
    ["one nibble short", `0x${"a".repeat(63)}`],
    ["one nibble long", `0x${"a".repeat(65)}`],
    ["a non-hex character", `0x${"g".repeat(64)}`],
    ["trailing text", `0x${"a".repeat(64)}ff`],
    ["leading text", `x0x${"a".repeat(64)}`],
    ["two words joined", `0x${"a".repeat(64)}0x${"b".repeat(64)}`],
  ])("rejects %s", (_label, value) => {
    expect(isBytes32Hex(value)).toBe(false);
  });
});

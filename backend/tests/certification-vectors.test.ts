import { describe, it, expect } from "vitest";
import {
  bundleDigest,
  evidenceLeafHash,
  merkleRoot,
} from "../src/services/certification.js";

/**
 * Golden commitment vectors.
 *
 * Every value below was produced by an *independent* implementation of the
 * documented algorithm (Python `hashlib` + `json.dumps(sort_keys=True)`, the
 * same construction the SDK verifies against), not by this code. They exist
 * because property-style assertions alone are weak: "the root is order
 * independent" is still true when the odd-level duplication rule is broken, and
 * a root that is merely 64 hex characters tells you nothing about which pairing
 * produced it. A verifier that computes a different root is a verifier that
 * rejects every honest bundle, so the exact bytes are the contract.
 */
const LEAF = {
  kind: "asset" as const,
  id: `0x${"a".repeat(64)}`,
  digest: `0x${"b".repeat(64)}`,
};
// evidenceLeafHash returns bare hex (no 0x); merkleRoot adds the prefix.
const LEAF_HASH =
  "1d44c145f9f680a3a9d6c2a4690b31b655de26e1dd70247ed08fe2e12c3bdb8f";

// sha256("qtrust:mutation-vector:<n>") for n = 0..4.
const LEAVES = [
  "a2e182410270105372e6cd19950d36bcdb5d6371ac37a4a419c4e73f8785d790",
  "d76529f8fc2894e5cabe551ce15ba03a1412068217199c19692530e7b875e9a7",
  "9f877fc275f927554b159af6612530d2c53728a1b34385f2c0f7096cf42dd4e6",
  "d657ee7fb6751e10d3c165a49a113770a081f88437c415cc2bc5b61ebbf7e6ce",
  "b5221cbfb3eab22a50880cc01d92d68159d726f5c466e0223af922c6f5bbceca",
];

const ROOTS = {
  0: "0xd3caf0057fd18f7847e1e9eef7d2d2bf4b9cb3b51d0b5583df6b1e2c69feca2f",
  1: "0xa2e182410270105372e6cd19950d36bcdb5d6371ac37a4a419c4e73f8785d790",
  2: "0x14a22836151f01084e4c79e76847f0dbe3f3a9b7896021e2a8103d8185ee1174",
  3: "0x86273a8f9680606186ea73d7f4e0ccd73f12a713441ba1758901ecddda86320a",
  4: "0xa21204c24a7c9da9475a296e69123cf65eeba99b86271282de9b0e4811f4d755",
  5: "0x279f1d952d8656f3aae82d45204b6b8dd872c09028515425ce712ab75e3caab9",
} as const;

describe("evidence leaf hash golden vector", () => {
  it("hashes the canonical {kind,id,digest} projection", () => {
    expect(evidenceLeafHash(LEAF)).toBe(LEAF_HASH);
    // Any extra field must be ignored, and any missing one must change it.
    expect(evidenceLeafHash({ ...LEAF, ignored: "x" } as never)).toBe(LEAF_HASH);
    expect(evidenceLeafHash({ ...LEAF, kind: "audit" })).not.toBe(LEAF_HASH);
    expect(evidenceLeafHash({ ...LEAF, id: LEAF.digest })).not.toBe(LEAF_HASH);
    expect(evidenceLeafHash({ ...LEAF, digest: LEAF.id })).not.toBe(LEAF_HASH);
  });
});

describe("merkle root golden vectors", () => {
  it.each([0, 1, 2, 3, 4, 5])("matches the independent construction for %d leaf/leaves", (count) => {
    expect(merkleRoot(LEAVES.slice(0, count))).toBe(ROOTS[count as keyof typeof ROOTS]);
  });

  it("is insensitive to input order but sensitive to content", () => {
    const four = LEAVES.slice(0, 4);
    expect(merkleRoot([...four].reverse())).toBe(ROOTS[4]);
    expect(merkleRoot([four[1], four[3], four[0], four[2]])).toBe(ROOTS[4]);
    // Replacing one leaf changes the root; duplicating one changes it too.
    expect(merkleRoot([four[0], four[0], four[2], four[3]])).not.toBe(ROOTS[4]);
    expect(merkleRoot([...four, four[0]])).not.toBe(ROOTS[4]);
  });

  it("does not treat an odd level as a pass-through", () => {
    // root(3) pairs leaf 2 with itself; root(2) is the other candidate a
    // broken duplication rule would produce.
    expect(merkleRoot(LEAVES.slice(0, 3))).not.toBe(merkleRoot(LEAVES.slice(0, 2)));
    expect(merkleRoot(LEAVES.slice(0, 5))).not.toBe(merkleRoot(LEAVES.slice(0, 4)));
  });

  it("returns the committed empty root, not a zero hash", () => {
    expect(merkleRoot([])).toBe(ROOTS[0]);
    expect(merkleRoot([])).not.toBe(`0x${"0".repeat(64)}`);
  });
});

describe("bundle digest golden vector", () => {
  it("hashes canonical JSON with sorted keys and no separators", () => {
    const body = {
      schema: "qtrust.certification.v1",
      n: 3,
      evidence: { leaf_count: 2, leaves: [LEAF] },
    };
    // Key order in the input must not matter.
    expect(bundleDigest(body)).toBe(
      "sha256:5c3428ff83c32b214260e83476c173a8ac13e5eb8822ef20070355a231326032",
    );
    expect(bundleDigest({ ...body, digest: "sha256:deadbeef", proof: { proofValue: "aa" } })).toBe(
      bundleDigest(body),
    );
    expect(bundleDigest({ ...body, n: 4 })).not.toBe(bundleDigest(body));
  });
});

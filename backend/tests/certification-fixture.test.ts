/**
 * Cross-language contract: the committed fixture is issued by the TypeScript
 * service and verified byte-for-byte by the Python SDK (`sdk/tests/test_bundle.py`).
 *
 * These tests verify the same fixture from the TypeScript side and pin its
 * identity, so a change to canonicalisation, the digest recipe, the Merkle
 * construction or the signature payload breaks one of the two suites instead of
 * silently producing bundles Python can no longer verify.
 *
 * `npm run certify:fixture` regenerates the file deterministically; CI diffs it
 * so a stale fixture cannot paper over a canonicalisation change.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUNDLE_SCHEMA,
  bundleDigest,
  verifyCertificationBundle,
  type CertificationBundle,
} from "../src/services/certification.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../sdk/tests/fixtures/certification_bundle.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as CertificationBundle;
const AFTER_ISSUANCE = new Date("2026-10-24T13:00:00.000Z");

describe("committed certification fixture (TS -> Python contract)", () => {
  it("is a v1 bundle with the pinned identity and subject", () => {
    expect(fixture.schema).toBe(BUNDLE_SCHEMA);
    expect(fixture.bundle_id).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(fixture.issuer).toMatch(/^did:key:z/);
    expect(fixture.subject.org).toBe("0x1111111111111111111111111111111111111111");
    expect(fixture.verdict).toBe("CERTIFIED");
    expect(fixture.evidence.leaf_count).toBe(5);
    expect(fixture.evidence.leaves).toHaveLength(5);
  });

  it("verifies offline and its stored digest matches the recomputation", async () => {
    const result = await verifyCertificationBundle(fixture, { now: AFTER_ISSUANCE });
    expect(result.reasons).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.chain_anchor).toBe("skipped");
    expect(result.checked).toEqual({
      structure: true,
      digest: true,
      merkle: true,
      signature: true,
      validity: true,
    });
    expect(bundleDigest(fixture)).toBe(fixture.digest);
  });

  it("rejects a mutated evidence record", async () => {
    const tampered = structuredClone(fixture);
    (tampered.evidence.leaves[0].record as Record<string, unknown>).metadata_uri = "ipfs://swapped";
    const result = await verifyCertificationBundle(tampered, { now: AFTER_ISSUANCE });
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("digest mismatch"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("tampered"))).toBe(true);
  });

  it("rejects a dropped evidence leaf", async () => {
    const tampered = structuredClone(fixture);
    tampered.evidence.leaves.pop();
    const result = await verifyCertificationBundle(tampered, { now: AFTER_ISSUANCE });
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("leaf count"))).toBe(true);
  });

  it("rejects a rewritten Merkle root", async () => {
    const tampered = structuredClone(fixture);
    tampered.evidence.merkle_root = "0x" + "0".repeat(64);
    const result = await verifyCertificationBundle(tampered, { now: AFTER_ISSUANCE });
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("Merkle root mismatch"))).toBe(true);
  });

  it("rejects the bundle after its validity window", async () => {
    const result = await verifyCertificationBundle(fixture, {
      now: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.reasons.some((r) => r.includes("expired"))).toBe(true);
  });
});

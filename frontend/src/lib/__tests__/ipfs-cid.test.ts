import { describe, expect, it } from "vitest";
import { isValidIpfsCid } from "../api";

/**
 * Regression tests for the SSRF hardening of fetchIpfsJson (threat model
 * TM-FE-01): metadata_uri is attacker-influenceable on-chain, and the fetch
 * runs server-side. Only bare IPFS CIDs may reach the gateway URL.
 */
describe("isValidIpfsCid", () => {
  it("accepts a bare CIDv0", () => {
    expect(isValidIpfsCid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toBe(true);
  });

  it("accepts an ipfs:// prefixed CIDv0", () => {
    expect(isValidIpfsCid("ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toBe(true);
  });

  it("accepts a CIDv1 in base32", () => {
    expect(
      isValidIpfsCid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"),
    ).toBe(true);
  });

  it("rejects an absolute http URL (internal SSRF target)", () => {
    expect(isValidIpfsCid("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("rejects an internal hostname", () => {
    expect(isValidIpfsCid("http://planner:8000/health")).toBe(false);
  });

  it("rejects a javascript URL", () => {
    expect(isValidIpfsCid("javascript:alert(1)")).toBe(false);
  });

  it("rejects a path that escapes the gateway", () => {
    expect(isValidIpfsCid("../../latest/meta-data/")).toBe(false);
  });

  it("rejects an empty and malformed input", () => {
    expect(isValidIpfsCid("")).toBe(false);
    expect(isValidIpfsCid("ipfs://")).toBe(false);
    expect(isValidIpfsCid("QmShort")).toBe(false);
  });
});

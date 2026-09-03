import { describe, it, expect } from "vitest";
import { allContractsConfigured, isZeroAddress, parseAssetId, toBytes32 } from "../src/config.js";

describe("contract address configuration", () => {
  it("treats shorthand and full zero addresses as unset", () => {
    expect(isZeroAddress("0x0")).toBe(true);
    expect(isZeroAddress("0x" + "0".repeat(40))).toBe(true);
    expect(isZeroAddress("0x" + "1".repeat(40))).toBe(false);
  });

  it("does not consider template zero addresses configured", () => {
    expect(allContractsConfigured()).toBe(false);
  });
});

describe("parseAssetId", () => {
  it("accepts valid 0x-prefixed 66-char hex", () => {
    const valid = "0x" + "ab".repeat(32);
    expect(parseAssetId(valid)).toBe(valid);
  });

  it("rejects non-hex prefix", () => {
    expect(() => parseAssetId("1234" + "ab".repeat(31))).toThrow("0x-prefixed 64-character hexadecimal");
  });

  it("rejects wrong length", () => {
    expect(() => parseAssetId("0x" + "ab".repeat(16))).toThrow("0x-prefixed 64-character hexadecimal");
  });
});

describe("toBytes32", () => {
  it("pads short hex to bytes32", () => {
    const result = toBytes32("0x1234");
    expect(result).toBe("0x" + "00".repeat(30) + "1234");
    expect(result.length).toBe(66);
  });

  it("rejects long hex instead of silently truncating it", () => {
    expect(() => toBytes32("0x" + "ab".repeat(33))).toThrow(/at most 32 bytes/);
  });

  it("rejects non-hex input", () => {
    expect(() => toBytes32("1234")).toThrow(/0x-prefixed hexadecimal/);
    expect(() => toBytes32("0xgg")).toThrow(/0x-prefixed hexadecimal/);
  });
});

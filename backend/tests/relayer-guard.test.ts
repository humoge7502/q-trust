import { describe, it, expect } from "vitest";
import {
  RelayerGuard,
  relayerFinancialConfigFromEnv,
  receiptCostWei,
  gweiToWei,
} from "../src/services/relayer-guard.js";

const ADDR = "0x0000000000000000000000000000000000000001" as const;

function eth(n: number): bigint {
  return BigInt(Math.round(n * 1e9)) * 10n ** 9n;
}

describe("OPS-1: relayer financial guardrails", () => {
  describe("config parsing", () => {
    it("parses all three thresholds from env", () => {
      const cfg = relayerFinancialConfigFromEnv({
        QTRUST_RELAYER_MIN_BALANCE_ETH: "0.05",
        QTRUST_RELAYER_DAILY_SPEND_CAP_ETH: "0.5",
        QTRUST_RELAYER_MAX_BASE_FEE_GWEI: "100",
      } as NodeJS.ProcessEnv);
      expect(cfg).toEqual({ minBalanceEth: 0.05, dailySpendCapEth: 0.5, maxBaseFeeGwei: 100 });
    });

    it("disables guards when env vars are unset", () => {
      const cfg = relayerFinancialConfigFromEnv({} as NodeJS.ProcessEnv);
      expect(cfg).toEqual({ minBalanceEth: null, dailySpendCapEth: null, maxBaseFeeGwei: null });
    });

    it("ignores invalid (non-positive / non-numeric) values", () => {
      const cfg = relayerFinancialConfigFromEnv({
        QTRUST_RELAYER_MIN_BALANCE_ETH: "-1",
        QTRUST_RELAYER_DAILY_SPEND_CAP_ETH: "abc",
        QTRUST_RELAYER_MAX_BASE_FEE_GWEI: "0",
      } as NodeJS.ProcessEnv);
      expect(cfg).toEqual({ minBalanceEth: null, dailySpendCapEth: null, maxBaseFeeGwei: null });
    });
  });

  describe("base fee ceiling", () => {
    it("refuses to broadcast when base fee exceeds the cap", async () => {
      const guard = new RelayerGuard({ minBalanceEth: null, dailySpendCapEth: null, maxBaseFeeGwei: 50 });
      await expect(
        guard.assertCanBroadcast({
          relayerAddress: ADDR,
          getBalance: async () => eth(1),
          getBaseFeeGwei: async () => 80,
        }),
      ).rejects.toThrow(/base fee .* exceeds cap/i);
    });

    it("allows broadcast at or below the cap", async () => {
      const guard = new RelayerGuard({ minBalanceEth: null, dailySpendCapEth: null, maxBaseFeeGwei: 100 });
      await expect(
        guard.assertCanBroadcast({
          relayerAddress: ADDR,
          getBalance: async () => eth(1),
          getBaseFeeGwei: async () => 100,
        }),
      ).resolves.toBeUndefined();
    });

    it("skips the fee guard on chains without base fee", async () => {
      const guard = new RelayerGuard({ minBalanceEth: null, dailySpendCapEth: null, maxBaseFeeGwei: 1 });
      await expect(
        guard.assertCanBroadcast({
          relayerAddress: ADDR,
          getBalance: async () => eth(1),
          getBaseFeeGwei: async () => null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("minimum balance circuit breaker", () => {
    it("refuses broadcast below the minimum balance", async () => {
      const guard = new RelayerGuard({ minBalanceEth: 0.01, dailySpendCapEth: null, maxBaseFeeGwei: null });
      await expect(
        guard.assertCanBroadcast({
          relayerAddress: ADDR,
          getBalance: async () => eth(0.005),
          getBaseFeeGwei: async () => null,
        }),
      ).rejects.toThrow(/below the .* minimum/i);
    });

    it("allows broadcast above the minimum balance", async () => {
      const guard = new RelayerGuard({ minBalanceEth: 0.01, dailySpendCapEth: null, maxBaseFeeGwei: null });
      await expect(
        guard.assertCanBroadcast({
          relayerAddress: ADDR,
          getBalance: async () => eth(0.02),
          getBaseFeeGwei: async () => null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("daily spend cap", () => {
    it("refuses broadcast once the trailing-24h spend reaches the cap", async () => {
      const guard = new RelayerGuard({ minBalanceEth: null, dailySpendCapEth: 0.1, maxBaseFeeGwei: null });
      guard.recordSpend(eth(0.06), 2, Date.now() - 1_000);
      // Under cap: allowed.
      await expect(
        guard.assertCanBroadcast({
          relayerAddress: ADDR,
          getBalance: async () => eth(1),
          getBaseFeeGwei: async () => null,
        }),
      ).resolves.toBeUndefined();
      // Push over cap.
      guard.recordSpend(eth(0.05), 2, Date.now());
      await expect(
        guard.assertCanBroadcast({
          relayerAddress: ADDR,
          getBalance: async () => eth(1),
          getBaseFeeGwei: async () => null,
        }),
      ).rejects.toThrow(/daily gas spend .* cap/i);
    });

    it("rolls the window: spend older than 24h no longer counts", async () => {
      const guard = new RelayerGuard({ minBalanceEth: null, dailySpendCapEth: 0.1, maxBaseFeeGwei: null });
      guard.recordSpend(eth(0.2), 2, Date.now() - 25 * 60 * 60 * 1000);
      await expect(
        guard.assertCanBroadcast({
          relayerAddress: ADDR,
          getBalance: async () => eth(1),
          getBaseFeeGwei: async () => null,
        }),
      ).resolves.toBeUndefined();
      expect(guard.spendLast24h()).toBe(0);
    });
  });

  describe("helpers", () => {
    it("computes receipt cost as gasUsed * effectiveGasPrice", () => {
      expect(receiptCostWei({ gasUsed: 21_000n, effectiveGasPrice: gweiToWei(2) })).toBe(42_000_000_000_000n);
    });

    it("treats a missing effectiveGasPrice as zero cost", () => {
      expect(receiptCostWei({ gasUsed: 21_000n })).toBe(0n);
    });
  });
});

/**
 * Relayer financial guardrails (audit OPS-1).
 *
 * A drained or griefed relayer silently halts every attestation; a gas-price
 * spike can burn the relay budget in minutes. These guardrails make the
 * failure loud instead of silent:
 *
 *  1. Minimum-balance circuit breaker — broadcast is refused when the
 *     relayer's native balance falls below QTRUST_RELAYER_MIN_BALANCE_ETH.
 *  2. Daily gas spend cap — after QTRUST_RELAYER_DAILY_SPEND_CAP_ETH of gas
 *     is spent in the trailing 24 h, broadcast is refused until the window
 *     rolls over. Per-day caps are approximate: spend accrues from receipts
 *     that report gasUsed * effectiveGasPrice.
 *  3. EIP-1559 fee ceiling — broadcast is refused when baseFee exceeds
 *     QTRUST_RELAYER_MAX_BASE_FEE_GWEI, instead of bidding into a spike.
 *
 * All thresholds are optional; when unset the corresponding guard is
 * disabled so local anvil development is unaffected by default.
 */

import type { Address } from "viem";
import { formatEther } from "viem";

export interface RelayerFinancialConfig {
  /** Minimum relayer balance in ETH below which broadcasting stops. */
  minBalanceEth: number | null;
  /** Maximum gas spend allowed per rolling 24 h window, in ETH. */
  dailySpendCapEth: number | null;
  /** Maximum acceptable base fee in Gwei; higher means refuse to bid. */
  maxBaseFeeGwei: number | null;
}

export interface RelayerFinancialSnapshot {
  address: Address | null;
  balanceEth: number | null;
  spendLast24hEth: number;
  spendWindowResetsInMs: number;
  config: RelayerFinancialConfig;
}

type SpendEntry = { gasWei: bigint; baseFeePerGasGwei: number; timestamp: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const GWEI = 10n ** 9n;
const ETH = 10n ** 18n;

function num(env: string | undefined): number | null {
  if (!env || !env.trim()) return null;
  const v = Number(env);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function relayerFinancialConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RelayerFinancialConfig {
  return {
    minBalanceEth: num(env.QTRUST_RELAYER_MIN_BALANCE_ETH),
    dailySpendCapEth: num(env.QTRUST_RELAYER_DAILY_SPEND_CAP_ETH),
    maxBaseFeeGwei: num(env.QTRUST_RELAYER_MAX_BASE_FEE_GWEI),
  };
}

/** Tracks relayer spend and enforces the configured guardrails. */
export class RelayerGuard {
  private readonly spend: SpendEntry[] = [];
  private readonly config: RelayerFinancialConfig;

  constructor(config: RelayerFinancialConfig) {
    this.config = config;
  }

  /** Record gas actually spent for a mined transaction. */
  recordSpend(gasUsedWei: bigint, baseFeePerGasGwei: number, timestamp = Date.now()): void {
    this.prune(timestamp);
    this.spend.push({ gasWei: gasUsedWei, baseFeePerGasGwei, timestamp });
  }

  /** Gas spent (ETH) over the trailing 24 h. */
  spendLast24h(timestamp = Date.now()): number {
    this.prune(timestamp);
    return this.spend.reduce((acc, e) => acc + Number(e.gasWei) / Number(ETH), 0);
  }

  /**
   * Gate a broadcast. Throws with a descriptive error when a configured
   * guardrail is violated. `getBalance` and `getBaseFee` are injected for
   * testability.
   */
  async assertCanBroadcast(input: {
    relayerAddress: Address | null;
    getBalance: (addr: Address) => Promise<bigint>;
    getBaseFeeGwei: () => Promise<number | null>;
  }): Promise<void> {
    const { relayerAddress, getBalance, getBaseFeeGwei } = input;

    if (this.config.maxBaseFeeGwei !== null) {
      const baseFee = await getBaseFeeGwei();
      if (baseFee !== null && baseFee > this.config.maxBaseFeeGwei) {
        throw new Error(
          `Relayer guard: base fee ${baseFee.toFixed(2)} Gwei exceeds cap ` +
            `${this.config.maxBaseFeeGwei} Gwei — refusing to bid into a fee spike`,
        );
      }
    }

    if (this.config.minBalanceEth !== null && relayerAddress) {
      const balance = await getBalance(relayerAddress);
      const balanceEth = Number(balance) / Number(ETH);
      if (balanceEth < this.config.minBalanceEth) {
        throw new Error(
          `Relayer guard: balance ${balanceEth.toFixed(6)} ETH is below the ` +
            `${this.config.minBalanceEth} ETH minimum — fund ${relayerAddress}`,
        );
      }
    }

    if (this.config.dailySpendCapEth !== null) {
      const spent = this.spendLast24h();
      if (spent >= this.config.dailySpendCapEth) {
        throw new Error(
          `Relayer guard: daily gas spend ${spent.toFixed(6)} ETH reached the ` +
            `${this.config.dailySpendCapEth} ETH cap — broadcasting paused until the window rolls over`,
        );
      }
    }
  }

  snapshot(relayerAddress: Address | null): RelayerFinancialSnapshot {
    const now = Date.now();
    return {
      address: relayerAddress,
      balanceEth: null, // populated by the caller with live chain state
      spendLast24hEth: this.spendLast24h(now),
      spendWindowResetsInMs:
        this.spend.length > 0 ? Math.max(0, this.spend[0].timestamp + DAY_MS - now) : 0,
      config: this.config,
    };
  }

  private prune(now: number): void {
    while (this.spend.length > 0 && now - this.spend[0].timestamp > DAY_MS) {
      this.spend.shift();
    }
  }
}

/** Estimate the gas cost (wei) of a receipt. */
export function receiptCostWei(receipt: {
  gasUsed: bigint | number | string;
  effectiveGasPrice?: bigint | number | string;
}): bigint {
  // viem receipts carry bigint values, but mocks / RPC variants can surface
  // numbers or hex-strings — coerce explicitly so BigInt math never mixes.
  const gasUsed = BigInt(receipt.gasUsed ?? 0);
  const price = receipt.effectiveGasPrice === undefined ? 0n : BigInt(receipt.effectiveGasPrice);
  return gasUsed * price;
}

/** Format a wei amount as a human-readable ETH string. */
export function weiToEthString(wei: bigint): string {
  return formatEther(wei);
}

/** Gwei (number) to wei (bigint). */
export function gweiToWei(gwei: number): bigint {
  return BigInt(Math.round(gwei)) * GWEI;
}

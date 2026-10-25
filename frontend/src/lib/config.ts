/**
 * viem client configuration for Base / Base Sepolia.
 *
 * Read-only: publicClient (view calls only).
 * Signing/connection: wagmi + RainbowKit (see components/providers.tsx).
 */
import { createPublicClient, http, type Address, type Chain } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC ??
  process.env.QTRUST_BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";

/** The subset of env that decides which chain the app targets. */
export type ChainEnv = {
  NEXT_PUBLIC_QTRUST_USE_MAINNET?: string;
  QTRUST_USE_MAINNET?: string;
  NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC?: string;
  QTRUST_BASE_SEPOLIA_RPC?: string;
};

/**
 * Pure chain derivation — no module state, no `process.env` reads.
 *
 * Exposed so tests can assert the derivation directly instead of re-importing
 * the module after mutating a global `process.env` (which raced across
 * concurrent test files and produced an intermittent failure). `CHAIN` below
 * is just `deriveChain(process.env)`.
 */
export function deriveChain(env: ChainEnv): Chain {
  const rpc =
    env.NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC ??
    env.QTRUST_BASE_SEPOLIA_RPC ??
    "https://sepolia.base.org";
  const useMainnet =
    env.NEXT_PUBLIC_QTRUST_USE_MAINNET === "true" || env.QTRUST_USE_MAINNET === "true";
  return useMainnet
    ? {
        id: 8453,
        name: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpc] } },
        blockExplorers: { default: { name: "Basescan", url: "https://basescan.org" } },
      }
    : baseSepolia;
}

export const CHAIN: Chain = deriveChain({
  NEXT_PUBLIC_QTRUST_USE_MAINNET: process.env.NEXT_PUBLIC_QTRUST_USE_MAINNET,
  QTRUST_USE_MAINNET: process.env.QTRUST_USE_MAINNET,
  NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC: process.env.NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC,
  QTRUST_BASE_SEPOLIA_RPC: process.env.QTRUST_BASE_SEPOLIA_RPC,
});

/** Read-only viem client — for view calls and event logs. */
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL, { timeout: 30_000 }),
});

/** Contract addresses, sourced from environment.
 *
 * Client components only see NEXT_PUBLIC_* vars (Next.js inlines them into
 * the browser bundle); server-side env names are accepted as a fallback so
 * API routes / SSR still work without duplication (audit Critical #3).
 *
 * The `"0x0"` default is an explicit "NOT DEPLOYED / NOT CONFIGURED" sentinel —
 * NOT a real address. `deploy-contracts.ps1` writes the real proxy addresses
 * into `frontend/.env.local` at deploy time. Components must treat a `0x0`
 * address as "on-chain features disabled" (e.g. `attestation-form.tsx` refuses
 * to sign against an unconfigured contract).
 */
export const CONTRACTS = {
  assetRegistry: (
    process.env.NEXT_PUBLIC_QTRUST_ASSET_REGISTRY_ADDRESS ??
    process.env.QTRUST_ASSET_REGISTRY_ADDRESS ??
    process.env.QTRUST_REGISTRY_ADDRESS ??
    "0x0"
  ) as Address,
  vendorRegistry: (
    process.env.NEXT_PUBLIC_QTRUST_VENDOR_REGISTRY_ADDRESS ??
    process.env.QTRUST_VENDOR_REGISTRY_ADDRESS ??
    "0x0"
  ) as Address,
  migrationRegistry: (
    process.env.NEXT_PUBLIC_QTRUST_MIGRATION_REGISTRY_ADDRESS ??
    process.env.QTRUST_MIGRATION_REGISTRY_ADDRESS ??
    "0x0"
  ) as Address,
  auditRegistry: (
    process.env.NEXT_PUBLIC_QTRUST_AUDIT_REGISTRY_ADDRESS ??
    process.env.QTRUST_AUDIT_REGISTRY_ADDRESS ??
    "0x0"
  ) as Address,
} as const;

/** Resolve a 0x-prefixed hex asset ID into a bytes32 for ABI calls. */
export function parseAssetId(id: string): `0x${string}` {
  // Audit H-7: enforce full hex charset — this value gets interpolated into
  // copy-pastable shell/CLI snippets on /v/[id], so a poisoned ID like
  // "0xdead...'); import os; os.system(...)" must be rejected here.
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
    throw new Error(
      `Asset ID must be 0x-prefixed 64-char hex, got: ${id.slice(0, 24)}…`
    );
  }
  return id as `0x${string}`;
}

/** Pad a short 0x-prefixed hex string to bytes32 without truncation. */
export function toBytes32(hash: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]*$/.test(hash)) {
    throw new Error("Hash must be a 0x-prefixed hexadecimal string");
  }
  const hex = hash.slice(2);
  if (hex.length > 64) {
    throw new Error("Hash must be at most 32 bytes (64 hex characters)");
  }
  return `0x${hex.padStart(64, "0")}` as `0x${string}`;
}
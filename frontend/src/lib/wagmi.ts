/**
 * wagmi + RainbowKit wallet configuration.
 *
 * Chain: the single network selected in lib/config.ts (Base Sepolia by
 * default, Base when QTRUST_USE_MAINNET is set). The contracts are deployed
 * on one chain at a time, so wallets on any other network are asked to switch.
 */
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { base, baseSepolia } from "wagmi/chains";
import { CHAIN } from "./config";

/**
 * WalletConnect project ID. RainbowKit requires a non-empty string; a
 * placeholder keeps dev builds working, but real wallet connections need a
 * valid project ID from https://cloud.walletconnect.com.
 *
 * Build-time guard (audit F-2): in production the env var must be set to a
 * real project ID — "demo" or missing is a deployment error and the build
 * must fail fast.
 *
 * FRESH CLONES: `next build` evaluates this module while prerendering static
 * pages, so the guard below fires even for local non-deployment builds. Copy
 * `frontend/.env.example` to `frontend/.env.local` (the placeholder value is
 * fine for dev; real wallet connections need a project ID from
 * https://cloud.walletconnect.com) — or pass any non-'demo' value as
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID on the build command.
 */
const RAW_WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// WalletConnect's public "demo" project ID works with aggressive rate limits.
// It is acceptable for throwaway demos when the deployment explicitly opts in
// with NEXT_PUBLIC_QTRUST_ALLOW_DEMO_WALLETCONNECT=1 (e.g. a hosted preview
// before the operator creates a real project at https://cloud.walletconnect.com).
const ALLOW_DEMO_WALLETCONNECT =
  process.env.NEXT_PUBLIC_QTRUST_ALLOW_DEMO_WALLETCONNECT === "1";

// Explicit validation: undefined or "demo" is never valid in production,
// unless the build explicitly opted in to the demo project ID above.
if (!RAW_WALLETCONNECT_PROJECT_ID || RAW_WALLETCONNECT_PROJECT_ID === "demo") {
  const isDemoOptIn = ALLOW_DEMO_WALLETCONNECT && RAW_WALLETCONNECT_PROJECT_ID === "demo";
  const msg =
    "[Q-Trust] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set or is 'demo' — wallet connections will be rate-limited. " +
    "Set a real project ID from https://cloud.walletconnect.com for production. " +
    "For a local (non-deployment) build, copy frontend/.env.example to " +
    "frontend/.env.local.";
  if (process.env.NODE_ENV === "production" && !isDemoOptIn) {
    throw new Error(msg);
  } else if (process.env.NODE_ENV === "production" && isDemoOptIn) {
    console.warn(msg);
  } else {
    console.warn(msg);
  }
}

const WALLETCONNECT_PROJECT_ID = RAW_WALLETCONNECT_PROJECT_ID ?? "demo";

if (!WALLETCONNECT_PROJECT_ID || typeof WALLETCONNECT_PROJECT_ID !== "string") {
  throw new Error("[Q-Trust] WALLETCONNECT_PROJECT_ID resolved to empty — wagmi config cannot initialize.");
}

/**
 * Is this a project ID WalletConnect will actually accept?
 *
 * The public "demo" ID is rate limited and, as of the 2026-10 check,
 * `api.web3modal.org/appkit/v1/config?projectId=demo` answers 403 — the QR
 * flow simply cannot start. Advertising a connector that is guaranteed to
 * fail is worse than not showing it: visitors pick it, see an error and
 * conclude the wallet support is broken. So the WalletConnect-based wallets
 * (WalletConnect itself and Rainbow, which relays over WalletConnect) are only
 * listed when a real project ID from https://cloud.walletconnect.com is set.
 *
 * Everything listed otherwise works with no third-party account:
 *   - injectedWallet: any EIP-1193 extension (Rabby, Brave, Frame, ...)
 *   - metaMaskWallet: MetaMask extension / MetaMask SDK
 *   - coinbaseWallet: Coinbase Wallet extension and mobile deep link
 */
const HAS_REAL_WALLETCONNECT =
  Boolean(RAW_WALLETCONNECT_PROJECT_ID) && RAW_WALLETCONNECT_PROJECT_ID !== "demo";

/**
 * Explicit wallet list.
 *
 * RainbowKit's default list now includes the Base Account connector, which
 * pulls `@base-org/account` -> `@coinbase/cdp-sdk` and its optional `@x402/*`
 * scheme packages. Those dynamic imports fail to resolve under Turbopack
 * (Vercel build error), so we pin a well-known set instead.
 */
const WALLETS = [
  {
    groupName: "Recommended",
    // `injectedWallet` is the generic EIP-1193 path. Keep it first so users
    // with a browser extension that is not one of the branded SDK wallets can
    // connect without WalletConnect or the MetaMask SDK transport.
    wallets: HAS_REAL_WALLETCONNECT
      ? [
          injectedWallet,
          metaMaskWallet,
          coinbaseWallet,
          walletConnectWallet,
          rainbowWallet,
        ]
      : [injectedWallet, metaMaskWallet, coinbaseWallet],
  },
];

// The deployment's contracts live on exactly one chain (CHAIN). Advertising
// both Base networks makes the other one look supported: a wallet on Base
// mainnet then connects without a wrong-network prompt and the app silently
// reads a registry that has no code. Keep only the active chain so wagmi and
// RainbowKit ask the wallet to switch when it is anywhere else.
const ACTIVE_CHAIN = CHAIN.id === base.id ? base : baseSepolia;

export const wagmiConfig = getDefaultConfig({
  appName: "Q-Trust",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [ACTIVE_CHAIN],
  ssr: true,
  wallets: WALLETS,
});

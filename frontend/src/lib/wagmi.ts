/**
 * wagmi + RainbowKit wallet configuration.
 *
 * Chains: Base (mainnet) and Base Sepolia — matching the deployments in
 * lib/config.ts. The expected chain for contract interactions is derived
 * from QTRUST_USE_MAINNET there (Base Sepolia default, mainnet when set).
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
 * Explicit wallet list.
 *
 * RainbowKit's default list now includes the Base Account connector, which
 * pulls `@base-org/account` -> `@coinbase/cdp-sdk` and its optional `@x402/*`
 * scheme packages. Those dynamic imports fail to resolve under Turbopack
 * (Vercel build error), so we pin a well-known set instead: MetaMask, Coinbase
 * Wallet, WalletConnect and Rainbow. Users can still connect Base Account or
 * any WalletConnect-compatible wallet through those connectors.
 */
const WALLETS = [
  {
    groupName: "Recommended",
    // `injectedWallet` is the generic EIP-1193 path. Keep it first so users
    // with a browser extension that is not one of the branded SDK wallets can
    // connect without WalletConnect or the MetaMask SDK transport.
    wallets: [
      injectedWallet,
      metaMaskWallet,
      coinbaseWallet,
      walletConnectWallet,
      rainbowWallet,
    ],
  },
];

export const wagmiConfig = getDefaultConfig({
  appName: "Q-Trust",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [base, baseSepolia],
  ssr: true,
  wallets: WALLETS,
});

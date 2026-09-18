"use client";

import { useSyncExternalStore } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const emptySubscribe = (): (() => void) => () => {};

/**
 * Returns false during server render and hydration, true after mount.
 * Implemented as a stable external-store read so wagmi/RainbowKit (and derived
 * role lookups) only run on the client without the set-state-in-effect anti-
 * pattern that cascading renders away.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot
    () => false, // server snapshot
  );
}

interface WalletGateProps {
  /** Which page is gated — the gate itself should not explain the whole product. */
  description: string;
}

/**
 * Auth gate for the wallet-scoped routes.
 *
 * The `h1` text is asserted by the `dashboard gates unauthenticated visitors`
 * e2e spec, so it is load-bearing, not decoration.
 */
export function WalletGate({ description }: WalletGateProps) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-5 py-16">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
          Connect your wallet
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-6 flex justify-center [&>div]:w-auto">
          <ConnectButton />
        </div>
      </div>
    </div>
  );
}

export function GateLoading() {
  return (
    <div
      className="flex min-h-[70vh] items-center justify-center px-5 py-16"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-border border-t-qtrust-600"
          aria-hidden="true"
        />
        <span className="text-sm text-muted-foreground">Checking wallet…</span>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";

type TxState =
  | "idle"
  | "awaiting-wallet"
  | "rejected"
  | "pending-chain"
  | "confirmed"
  | "reverted";

interface TxStatusProps {
  state: TxState;
  txHash?: `0x${string}`;
  explorerBase?: string;
  error?: string;
  assetId?: string;
  onRetry?: () => void;
}

const COPY: Record<TxState, { title: string; desc: string }> = {
  idle: { title: "Ready to submit", desc: "Click to register — you will confirm in your wallet." },
  "awaiting-wallet": { title: "Confirm in your wallet", desc: "Approve the signature request in your wallet to continue." },
  rejected: { title: "Request rejected — nothing was sent", desc: "You rejected the wallet request. Your funds are safe — try again when ready." },
  "pending-chain": { title: "Waiting for Base confirmation…", desc: "Your transaction was submitted. This usually takes a few seconds." },
  confirmed: { title: "Attestation anchored", desc: "Verified on-chain. Anyone can verify without trusting Q-Trust." },
  reverted: { title: "Reverted", desc: "Transaction was reverted on-chain. Check the explorer for the reason — retry is safe." },
};

/**
 * State → semantic tone. Previously a raw `bg-*` ternary chain
 * (`bg-emerald-500` / `bg-amber-500` / `bg-sky-500` / `bg-slate-300`) that
 * shared no vocabulary with the status chips used elsewhere in the app.
 *
 * `rejected` is `warning`, not `danger`: the user cancelled deliberately and
 * nothing was sent, so presenting it in the failure colour misleads.
 */
const TONE: Record<TxState, StatusTone> = {
  idle: "neutral",
  "awaiting-wallet": "info",
  rejected: "warning",
  "pending-chain": "info",
  confirmed: "success",
  reverted: "danger",
};

export function TxStatus({ state, txHash, explorerBase, error, assetId, onRetry }: TxStatusProps) {
  const c = COPY[state];
  const explorerLink = txHash && explorerBase ? `${explorerBase}/tx/${txHash}` : null;

  return (
    <div
      key={state}
      role="status"
      aria-live="polite"
      className="tx-bridge rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <StatusPill tone={TONE[state]} className="mt-0.5">
          {c.title}
        </StatusPill>
      </div>
      <p className="mt-3 text-micro leading-5 text-muted-foreground">{c.desc}</p>

      {error ? (
        <p className="mt-2 rounded-lg border border-danger-border bg-danger-surface px-2 py-1 font-mono text-micro text-danger">
          {error}
        </p>
      ) : null}

      {txHash ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-micro">
          <span className="font-mono text-muted-foreground">
            {txHash.slice(0, 10)}…{txHash.slice(-8)}
          </span>
          {explorerLink ? (
            <Link
              href={explorerLink}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-qtrust-600 hover:text-qtrust-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
            >
              View on Basescan
            </Link>
          ) : null}
        </p>
      ) : null}

      {state === "confirmed" && assetId ? (
        <p className="mt-2 text-micro text-muted-foreground">
          Asset{" "}
          <code className="rounded bg-neutral-surface px-1 py-0.5 font-mono">{assetId}</code> is
          now verifiable at{" "}
          <Link
            href={`/v/${assetId}`}
            className="font-medium text-qtrust-600 hover:text-qtrust-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
          >
            /v/{assetId}
          </Link>
          .
        </p>
      ) : null}

      {(state === "rejected" || state === "reverted") && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg bg-qtrust-600 px-3 py-1.5 text-micro font-semibold text-white transition hover:bg-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 focus-visible:ring-offset-2"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

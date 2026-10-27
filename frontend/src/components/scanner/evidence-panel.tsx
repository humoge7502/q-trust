"use client";

/**
 * Scanner dashboard — Evidence tab (05 · proof).
 *
 * Extracted verbatim from scanner-dashboard.tsx (TD-01 decomposition): the
 * evidence record card (integrity hash, ledger metadata, verify button) and
 * the empty state. State arrives from useScannerState via the dashboard shell.
 * No behaviour change.
 */
import * as Tabs from "@radix-ui/react-tabs";
import { XCircleIcon, ShieldCheckIcon } from "@/app/icons";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { OperatorAccessInline } from "@/components/operator-access";
import { Panel, Spinner } from "./shared-ui";
import { safeName } from "./shared";
import type { ScannerState } from "./use-scanner-state";

export function EvidencePanel({ state }: { state: ScannerState }) {
  const {
    scanResult,
    evidenceLedger,
    evidenceVerify,
    evidenceLoading,
    evidenceError,
    verifyLoading,
    operatorEndpoint,
    createEvidence,
    verifyLedger,
  } = state;

  return (
    <Tabs.Content value="evidence" className="mt-5 focus-visible:outline-none">
      <Panel
        index="05 / proof"
        title="Evidence Record"
        copy="POST /v1/evidence/create then /v1/evidence/verify. Records are created per request — the backend does not persist them."
        aside={
          <Button
            onClick={() => void createEvidence()}
            disabled={evidenceLoading || !scanResult}
            size="sm"
            className="rounded-lg bg-qtrust-600 px-4 text-white hover:bg-qtrust-700"
          >
            {evidenceLoading && <Spinner />}
            {!scanResult ? "Run a scan first" : evidenceLoading ? "Creating…" : "Create evidence record"}
          </Button>
        }
      >
        {evidenceError && <p className="text-xs text-danger">{evidenceError}</p>}
        {operatorEndpoint === "/v1/evidence/create" && (
          <OperatorAccessInline
            endpoint={operatorEndpoint}
            onSaved={() => void createEvidence()}
          />
        )}

        {evidenceLedger && (
          <div className="rounded-xl border border-border bg-[#fbfbfa] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-label uppercase tracking-[0.2em] text-muted-foreground">
                  Integrity hash
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-slate-950">
                    {evidenceLedger.integrityHash.slice(0, 16)}…
                  </span>
                  {evidenceVerify?.valid ? (
                    <StatusPill tone="success" icon={<ShieldCheckIcon className="h-3 w-3" />}>
                      verified
                    </StatusPill>
                  ) : evidenceVerify && !evidenceVerify.valid ? (
                    <StatusPill tone="danger" icon={<XCircleIcon className="h-3 w-3" />}>
                      mismatch
                    </StatusPill>
                  ) : (
                    <StatusPill tone="neutral">unverified</StatusPill>
                  )}
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-micro text-muted-foreground sm:grid-cols-2">
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Scan ID</dt>
                    <dd className="truncate font-mono text-foreground">
                      {safeName(evidenceLedger.data.scanTarget)}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Findings</dt>
                    <dd className="font-mono text-foreground tabular-nums">
                      {evidenceLedger.data.findingsCount}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Created</dt>
                    <dd className="text-foreground">
                      {new Date(evidenceLedger.data.timestamp).toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Version</dt>
                    <dd className="font-mono text-foreground">
                      v{evidenceLedger.version}, index #{evidenceLedger.chainIndex}
                    </dd>
                  </div>
                </dl>
                {evidenceVerify && !evidenceVerify.valid && (
                  <p className="mt-2 text-micro text-danger">
                    Expected {evidenceVerify.expectedHash.slice(0, 16)}… but got{" "}
                    {evidenceVerify.providedHash.slice(0, 16)}…
                  </p>
                )}
              </div>
              <div className="shrink-0">
                <button
                  onClick={() => void verifyLedger()}
                  disabled={verifyLoading || Boolean(evidenceVerify?.valid)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-success hover:text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 disabled:opacity-50"
                >
                  {verifyLoading ? <Spinner /> : null}
                  {evidenceVerify?.valid ? "Verified" : verifyLoading ? "Verifying…" : "Verify"}
                </button>
              </div>
            </div>
          </div>
        )}

        {!evidenceLedger && !evidenceError && (
          <div className="rounded-xl border border-dashed border-slate-300 px-5 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No evidence record yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-micro leading-5 text-muted-foreground">
              An evidence record hashes the latest scan result into an append-only
              ledger entry, so the findings can be checked later without being
              republished. Run a scan, then create the record.
            </p>
          </div>
        )}
      </Panel>
    </Tabs.Content>
  );
}

"use client";

/**
 * Scanner dashboard — Risk Scores tab (02 · exposure).
 *
 * Extracted verbatim from scanner-dashboard.tsx (TD-01 decomposition): the
 * scored-findings table (desktop) and card list (mobile), plus the per-level
 * mix summary computed locally from `riskScores`. State arrives from
 * useScannerState via the dashboard shell. No behaviour change.
 */
import * as Tabs from "@radix-ui/react-tabs";
import { XCircleIcon, ShieldCheckIcon } from "@/app/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Panel, Spinner } from "./shared-ui";
import { basename, severityTone } from "./shared";
import type { ScannerState } from "./use-scanner-state";

export function RiskPanel({ state }: { state: ScannerState }) {
  const {
    scanResult,
    riskScores,
    riskLoading,
    riskError,
    fetchRiskScores,
  } = state;

  const riskMix = (() => {
    const counts = new Map<string, number>();
    for (const score of riskScores) {
      counts.set(score.riskLevel, (counts.get(score.riskLevel) ?? 0) + 1);
    }
    return (["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"] as const)
      .map((level) => ({ level, count: counts.get(level) ?? 0 }))
      .filter((entry) => entry.count > 0);
  })();

  return (
    <Tabs.Content value="risk" className="mt-5 focus-visible:outline-none">
      <Panel
        index="02 / exposure"
        title="Quantum Risk Scores"
        copy="POST /v1/risk/score — classifies every finding and scores the exposure 0–100."
        aside={
          scanResult ? (
            <Button
              onClick={() => void fetchRiskScores()}
              disabled={riskLoading}
              size="sm"
              className="rounded-lg bg-qtrust-600 px-4 text-white hover:bg-qtrust-700"
            >
              {riskLoading && <Spinner />}
              {riskLoading ? "Calculating…" : "Calculate risk scores"}
            </Button>
          ) : null
        }
      >
        {!scanResult ? (
          <p className="text-sm text-muted-foreground">
            Run a scan first to generate risk scores.
          </p>
        ) : (
          <>
            {riskError && <p className="text-xs text-danger">{riskError}</p>}

            {riskLoading && (
              <div aria-busy="true" aria-label="Calculating risk scores" className="mt-4 space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            )}

            {riskScores.length > 0 && (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-mono text-label uppercase tracking-[0.18em] text-muted-foreground">
                    {riskScores.length} scored
                  </span>
                  <span className="h-3 w-px bg-slate-200" aria-hidden="true" />
                  {riskMix.map((entry) => (
                    <StatusPill key={entry.level} tone={severityTone(entry.level)}>
                      {entry.count} {entry.level.toLowerCase()}
                    </StatusPill>
                  ))}
                </div>

                <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">Quantum risk scores</caption>
                    <thead>
                      <tr className="border-b border-border bg-[#fbfbfa] text-label uppercase tracking-[0.14em] text-muted-foreground">
                        <th scope="col" className="px-4 py-2.5 font-semibold">File</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Line</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Algorithm</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Quantum vulnerable</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Classification</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Risk level</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Score</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riskScores.map((r, i) => {
                        const broken =
                          r.algorithmClassification === "BROKEN" ||
                          r.algorithmClassification === "WEAKENED";
                        return (
                          <tr
                            key={i}
                            className="border-b border-slate-100 transition-colors last:border-0 hover:bg-[#fbfbfa]"
                          >
                            <td
                              className="max-w-[160px] truncate px-4 py-2.5 font-mono text-foreground"
                              title={r.file}
                            >
                              {basename(r.file)}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-muted-foreground tabular-nums">
                              {r.line ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 font-medium text-foreground">{r.algorithm}</td>
                            <td className="px-4 py-2.5">
                              {broken ? (
                                <span className="inline-flex items-center gap-1 text-danger">
                                  <XCircleIcon className="h-3.5 w-3.5" aria-hidden="true" /> Yes
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-success">
                                  <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" /> No
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-micro text-muted-foreground">
                              {r.algorithmClassification}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusPill tone={severityTone(r.riskLevel)}>{r.riskLevel}</StatusPill>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-foreground tabular-nums">
                              {r.riskScore.toFixed(0)}
                            </td>
                            <td className="max-w-[200px] truncate px-4 py-2.5 text-muted-foreground">
                              {r.message}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="space-y-2 md:hidden" role="list" aria-label="Risk scores">
                  {riskScores.map((r, i) => {
                    const broken =
                      r.algorithmClassification === "BROKEN" ||
                      r.algorithmClassification === "WEAKENED";
                    return (
                      <div
                        key={i}
                        className="rounded-xl border border-border bg-white p-3"
                        role="listitem"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs text-foreground">
                            {r.file}:{r.line ?? "—"}
                          </span>
                          <StatusPill tone={severityTone(r.riskLevel)}>{r.riskLevel}</StatusPill>
                        </div>
                        <div className="mt-1 text-xs font-medium text-foreground">
                          {r.algorithm} · {r.algorithmClassification}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          {broken ? (
                            <span className="inline-flex items-center gap-1 text-danger">
                              <XCircleIcon className="h-3 w-3" aria-hidden="true" /> Vulnerable
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-success">
                              <ShieldCheckIcon className="h-3 w-3" aria-hidden="true" /> Safe
                            </span>
                          )}
                          <span className="font-mono text-muted-foreground tabular-nums">
                            score {r.riskScore.toFixed(0)}
                          </span>
                        </div>
                        {r.message ? (
                          <div className="mt-1 truncate text-xs text-muted-foreground">{r.message}</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </Panel>
    </Tabs.Content>
  );
}

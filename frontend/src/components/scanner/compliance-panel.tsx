"use client";

/**
 * Scanner dashboard — Compliance tab (03 · policy).
 *
 * Extracted verbatim from scanner-dashboard.tsx (TD-01 decomposition): the
 * framework selector, score ring, per-finding verdict table (desktop) and card
 * list (mobile). State arrives from useScannerState via the dashboard shell.
 * No behaviour change.
 */
import * as Tabs from "@radix-ui/react-tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Panel, Spinner } from "./shared-ui";
import { COMPLIANCE_FRAMEWORKS, complianceTone } from "./shared";
import type { ScannerState } from "./use-scanner-state";

export function CompliancePanel({ state }: { state: ScannerState }) {
  const {
    scanResult,
    complianceFramework,
    setComplianceFramework,
    complianceReport,
    complianceLoading,
    complianceError,
    fetchCompliance,
  } = state;

  return (
    <Tabs.Content value="compliance" className="mt-5 focus-visible:outline-none">
      <Panel
        index="03 / policy"
        title="Compliance Assessment"
        copy="POST /v1/compliance/evaluate — one verdict and one reason per finding, under the framework you pick."
        aside={
          scanResult ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-micro font-medium text-muted-foreground">
                Framework
                <select
                  value={complianceFramework}
                  onChange={(e) => setComplianceFramework(e.target.value)}
                  className="mt-1 block rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-foreground focus-visible:border-qtrust-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600/20"
                >
                  {COMPLIANCE_FRAMEWORKS.map((fw) => (
                    <option key={fw.value} value={fw.value}>
                      {fw.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                onClick={() => void fetchCompliance()}
                disabled={complianceLoading}
                size="sm"
                className="rounded-lg bg-qtrust-600 px-4 text-white hover:bg-qtrust-700"
              >
                {complianceLoading && <Spinner />}
                {complianceLoading ? "Evaluating…" : "Evaluate"}
              </Button>
            </div>
          ) : null
        }
      >
        {!scanResult ? (
          <p className="text-sm text-muted-foreground">Run a scan first to evaluate compliance.</p>
        ) : (
          <>
            {complianceError && <p className="text-xs text-danger">{complianceError}</p>}
            {complianceLoading && (
              <div aria-busy="true" aria-label="Evaluating compliance" className="mt-4 space-y-3">
                <Skeleton className="h-5 w-52" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}

            {complianceReport && (
              <div>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
                  <div className="relative h-28 w-28 shrink-0">
                    <svg className="h-28 w-28 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                      <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#e2e8f0" strokeWidth="2.5" />
                      <circle
                        cx="18"
                        cy="18"
                        r="15.9155"
                        fill="none"
                        stroke={
                          complianceReport.scorePercent >= 80
                            ? "#15803d"
                            : complianceReport.scorePercent >= 50
                              ? "#a16207"
                              : "#b91c1c"
                        }
                        strokeWidth="2.5"
                        strokeDasharray={`${complianceReport.scorePercent} ${100 - complianceReport.scorePercent}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="font-mono text-2xl font-semibold text-slate-950 tabular-nums">
                        {complianceReport.scorePercent}%
                      </span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-label uppercase tracking-[0.2em] text-muted-foreground">
                      {complianceReport.framework} verdict
                    </p>
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-mono text-xl font-semibold text-success tabular-nums">
                          {complianceReport.compliant}
                        </span>
                        <span className="text-muted-foreground">compliant</span>
                      </span>
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-mono text-xl font-semibold text-danger tabular-nums">
                          {complianceReport.nonCompliant}
                        </span>
                        <span className="text-muted-foreground">non-compliant</span>
                      </span>
                    </div>
                    <p className="mt-2 text-micro leading-5 text-muted-foreground">
                      {complianceReport.total} findings evaluated. Percentage derived
                      client-side from the server&rsquo;s counts.
                    </p>
                  </div>
                </div>

                <div className="mt-5 hidden overflow-x-auto rounded-xl border border-border md:block">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">Compliance findings</caption>
                    <thead>
                      <tr className="border-b border-border bg-[#fbfbfa] text-label uppercase tracking-[0.14em] text-muted-foreground">
                        <th scope="col" className="px-4 py-2.5 font-semibold">File</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Algorithm</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {complianceReport.results.map((r, i) => (
                        <tr
                          key={i}
                          className="border-b border-slate-100 transition-colors last:border-0 hover:bg-[#fbfbfa]"
                        >
                          <td className="max-w-[180px] truncate px-4 py-2.5 font-mono text-foreground">
                            {r.file}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-foreground">{r.algorithm}</td>
                          <td className="px-4 py-2.5">
                            <StatusPill
                              tone={complianceTone(r.compliance?.compliant ? "pass" : "fail")}
                            >
                              {r.compliance?.compliant ? "pass" : "fail"}
                            </StatusPill>
                          </td>
                          <td className="max-w-[320px] px-4 py-2.5 text-muted-foreground">
                            {r.compliance?.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 space-y-2 md:hidden" role="list" aria-label="Compliance findings">
                  {complianceReport.results.map((r, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-border bg-white p-3"
                      role="listitem"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs text-foreground">{r.file}</span>
                        <StatusPill
                          tone={complianceTone(r.compliance?.compliant ? "pass" : "fail")}
                        >
                          {r.compliance?.compliant ? "pass" : "fail"}
                        </StatusPill>
                      </div>
                      <div className="mt-1 text-xs font-medium text-foreground">{r.algorithm}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{r.compliance?.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
    </Tabs.Content>
  );
}

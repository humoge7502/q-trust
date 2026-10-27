"use client";

/**
 * Scanner dashboard — Roadmap tab (04 · sequence).
 *
 * Extracted verbatim from scanner-dashboard.tsx (TD-01 decomposition): the
 * daily-rate input, the summary grid (effort / cost / completion), the phase
 * list, and the "Why this order?" outcome panel beside the roadmap it
 * explains. State arrives from useScannerState via the dashboard shell.
 * No behaviour change.
 */
import * as Tabs from "@radix-ui/react-tabs";
import { ClockIcon } from "@/app/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { OperatorAccessInline } from "@/components/operator-access";
import { MigrationRace } from "@/components/migration-race";
import { Panel, Spinner } from "./shared-ui";
import { severityTone } from "./shared";
import type { ScannerState } from "./use-scanner-state";

export function RoadmapPanel({ state }: { state: ScannerState }) {
  const {
    scanResult,
    roadmapDailyRate,
    setRoadmapDailyRate,
    roadmap,
    roadmapLoading,
    roadmapError,
    operatorEndpoint,
    fetchRoadmap,
  } = state;

  return (
    <Tabs.Content value="roadmap" className="mt-5 focus-visible:outline-none">
      <Panel
        index="04 / sequence"
        title="Migration Roadmap"
        copy="POST /v1/roadmap/generate — phases, effort, cost and a completion date."
        aside={
          scanResult ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-micro font-medium text-muted-foreground">
                Daily rate ($, optional)
                <input
                  type="number"
                  min="1"
                  value={roadmapDailyRate}
                  onChange={(e) => setRoadmapDailyRate(e.target.value)}
                  placeholder="1500"
                  className="mt-1 block w-32 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-foreground placeholder:text-slate-400 focus-visible:border-qtrust-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600/20"
                />
              </label>
              <Button
                onClick={() => void fetchRoadmap()}
                disabled={roadmapLoading}
                size="sm"
                className="rounded-lg bg-qtrust-600 px-4 text-white hover:bg-qtrust-700"
              >
                {roadmapLoading && <Spinner />}
                {roadmapLoading ? "Planning…" : "Generate roadmap"}
              </Button>
            </div>
          ) : null
        }
      >
        {!scanResult ? (
          <p className="text-sm text-muted-foreground">
            Run a scan first to generate a migration roadmap.
          </p>
        ) : (
          <>
            {roadmapError && <p className="text-xs text-danger">{roadmapError}</p>}
            {roadmapLoading && (
              <div aria-busy="true" aria-label="Generating roadmap" className="mt-4 space-y-3">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}
            {operatorEndpoint === "/v1/roadmap/generate" && (
              <OperatorAccessInline
                endpoint={operatorEndpoint}
                onSaved={() => void fetchRoadmap()}
              />
            )}

            {roadmap && (
              <div>
                <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-slate-200 sm:grid-cols-3">
                  <div className="bg-[#fbfbfa] p-5">
                    <p className="text-label font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Total effort
                    </p>
                    <p className="mt-2 font-mono text-3xl font-semibold leading-none text-slate-950 tabular-nums">
                      {roadmap.summary.totalDays}{" "}
                      <span className="text-base font-normal text-muted-foreground">days</span>
                    </p>
                  </div>
                  <div className="bg-[#fbfbfa] p-5">
                    <p className="text-label font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Estimated cost
                    </p>
                    <p className="mt-2 font-mono text-3xl font-semibold leading-none text-slate-950 tabular-nums">
                      ${roadmap.summary.totalCost.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-[#fbfbfa] p-5">
                    <p className="text-label font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Est. completion
                    </p>
                    <p className="mt-2 flex items-center gap-2 font-mono text-lg font-semibold text-slate-950">
                      <ClockIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      {new Date(roadmap.summary.completionDate).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <ol className="mt-6 space-y-3">
                  {roadmap.phases.map((phase) => (
                    <li
                      key={phase.phase}
                      className="relative rounded-xl border border-border bg-white p-4 pl-14 transition-colors hover:border-slate-300"
                    >
                      <div
                        className="absolute left-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 font-mono text-micro font-semibold text-cyan-300 tabular-nums"
                        aria-hidden="true"
                      >
                        {phase.phase}
                      </div>
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-950">{phase.title}</h3>
                          <StatusPill tone={severityTone(phase.priority)} className="mt-1.5">
                            {phase.priority}
                          </StatusPill>
                        </div>
                        <span className="inline-flex items-center gap-1 font-mono text-micro text-muted-foreground tabular-nums">
                          <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {phase.estimatedDays}d
                        </span>
                      </div>

                      {phase.findings.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1">
                          {phase.findings.slice(0, 8).map((f, i) => (
                            <span
                              key={i}
                              className="rounded bg-neutral-surface px-1.5 py-0.5 font-mono text-label text-muted-foreground"
                            >
                              {f.file}
                            </span>
                          ))}
                          {phase.findings.length > 8 && (
                            <span className="self-center text-label text-muted-foreground">
                              +{phase.findings.length - 8} more
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </Panel>

      {/*
        Why ordering matters: the signature outcome visualization beside the
        roadmap it explains. Every number is emitted by the qrd-sim/1.0
        simulator on a real scanned estate (E-09); the dark slab keeps the
        race's own tone context inside the light app layer.
      */}
      <div className="mt-4">
        <Panel
          index="04 · exposure"
          title="Why this order?"
          copy="While the programme runs, every un-migrated asset keeps accumulating quantum risk. Ordering changes the total."
        >
          <div className="mt-4 rounded-2xl bg-slate-950 p-5 text-white sm:p-7">
            <MigrationRace />
          </div>
        </Panel>
      </div>
    </Tabs.Content>
  );
}

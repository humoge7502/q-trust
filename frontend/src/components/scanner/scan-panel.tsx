"use client";

/**
 * Scanner dashboard — Scan tab (01 · inventory).
 *
 * Extracted verbatim from scanner-dashboard.tsx (TD-01 decomposition): the
 * target bar, sample presets, coverage toggles, results summary, the findings
 * table (desktop) and card list (mobile), and the CBOM / SARIF / JSON exports,
 * plus the scan-local sub-components (SeveritySummary, AlgorithmMix,
 * CoverageToggle). State arrives from useScannerState via the dashboard shell.
 * No behaviour change.
 */
import * as Tabs from "@radix-ui/react-tabs";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { OperatorAccessInline } from "@/components/operator-access";
import { Panel, Spinner } from "./shared-ui";
import {
  basename,
  SAMPLE_TARGETS,
  severityTone,
  type ScanFinding,
  type ScanSummary,
} from "./shared";
import type { ScannerState } from "./use-scanner-state";

/** Severity bands, in escalating order — the order the rail stacks them. */
const SEVERITY_BANDS = [
  { key: "critical", label: "Critical", swatch: "bg-risk-critical", fill: "#b91c1c" },
  { key: "high", label: "High", swatch: "bg-risk-high", fill: "#c2410c" },
  { key: "medium", label: "Medium", swatch: "bg-risk-medium", fill: "#a16207" },
  { key: "low", label: "Low", swatch: "bg-risk-low", fill: "#15803d" },
  { key: "info", label: "Info", swatch: "bg-risk-none", fill: "#64748b" },
] as const;

/**
 * Result headline: one large number, then the severity mix as a single stacked
 * bar with a legend.
 *
 * Replaces a row of five equally-weighted pills, which gave "1 critical" and
 * "13 info" the same visual mass. The stacked bar makes the shape of the estate
 * legible at a glance; the legend keeps the exact counts available.
 */
function SeveritySummary({ summary }: { summary: ScanSummary }) {
  const total = summary.totalFindings;
  const bands = SEVERITY_BANDS.map((band) => ({ ...band, count: summary[band.key] }));
  const ariaMix = bands
    .filter((band) => band.count > 0)
    .map((band) => `${band.count} ${band.label.toLowerCase()}`)
    .join(", ");

  return (
    <div className="rounded-xl border border-border bg-[#fbfbfa] p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div>
          <p className="text-label font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Findings
          </p>
          <p className="mt-1.5 text-5xl font-semibold leading-none tracking-[-0.06em] text-slate-950 tabular-nums">
            {total}
          </p>
          <p className="mt-2.5 text-micro text-muted-foreground">
            {summary.algorithmsDetected.length} distinct algorithm
            {summary.algorithmsDetected.length === 1 ? "" : "s"} detected
          </p>
        </div>

        <div className="min-w-[15rem] flex-1">
          {total > 0 ? (
            <>
              <div
                className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
                role="img"
                aria-label={`Severity mix: ${ariaMix}`}
              >
                {bands
                  .filter((band) => band.count > 0)
                  .map((band) => (
                    <span
                      key={band.key}
                      style={{
                        width: `${(band.count / total) * 100}%`,
                        backgroundColor: band.fill,
                      }}
                    />
                  ))}
              </div>
              <ul className="mt-3.5 grid grid-cols-2 gap-x-5 gap-y-1.5 sm:grid-cols-3">
                {bands.map((band) => (
                  <li key={band.key} className="flex items-center gap-2 text-micro">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${band.swatch}`}
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">{band.label}</span>
                    <span className="ml-auto font-mono font-semibold text-foreground tabular-nums">
                      {band.count}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-micro leading-6 text-muted-foreground">
              No quantum-vulnerable algorithms were detected in this target.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Algorithm distribution.
 *
 * Deliberately not a `<table>`: `scripts/full-audit.mjs` counts
 * `table tbody tr` on the Scan tab and expects exactly the 20 finding rows, so
 * a second table here would break a real assertion. Bars also read better —
 * the question is "which algorithm dominates", not "what is the exact count of
 * the fourth row".
 */
function AlgorithmMix({ findings }: { findings: ScanFinding[] }) {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    if (!finding.algorithm) continue;
    counts.set(finding.algorithm, (counts.get(finding.algorithm) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (rows.length === 0) return null;
  const max = rows[0][1];

  return (
    <div className="mt-4 rounded-xl border border-border p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold tracking-[-0.02em] text-slate-950">
          Algorithm mix
        </h3>
        <p className="font-mono text-label uppercase tracking-[0.18em] text-muted-foreground">
          by occurrence
        </p>
      </div>
      <ul className="mt-4 space-y-2.5">
        {rows.map(([algorithm, count]) => (
          <li key={algorithm} className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3">
            <span className="truncate font-mono text-micro text-foreground" title={algorithm}>
              {algorithm}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-neutral-surface">
              <span
                className="block h-full rounded-full bg-qtrust-600"
                style={{ width: `${Math.max((count / max) * 100, 4)}%` }}
              />
            </span>
            <span className="text-right font-mono text-micro font-semibold text-foreground tabular-nums">
              {count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Severity → the left rail colour on a finding row. */
const SEVERITY_RAIL: Record<string, string> = {
  critical: "border-l-risk-critical",
  high: "border-l-risk-high",
  medium: "border-l-risk-medium",
  low: "border-l-risk-low",
  info: "border-l-slate-300",
};

/**
 * Coverage toggle.
 *
 * A real `<input type="checkbox">` kept in the DOM (visually hidden) so the
 * control still announces as a checkbox, still responds to Space, and still
 * reports its state to assistive technology — the pill is only the rendering.
 */
function CoverageToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-micro font-medium transition focus-within:ring-2 focus-within:ring-qtrust-600 focus-within:ring-offset-1 ${
        checked
          ? "border-qtrust-600 bg-qtrust-50 text-qtrust-700"
          : "border-border bg-white text-muted-foreground hover:border-slate-400"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ${
          checked ? "border-qtrust-600 bg-qtrust-600" : "border-slate-300 bg-white"
        }`}
        aria-hidden="true"
      >
        {checked ? (
          <svg
            viewBox="0 0 24 24"
            className="h-2.5 w-2.5"
            fill="none"
            stroke="#ffffff"
            aria-hidden="true"
            focusable="false"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 13 4 4L19 7" />
          </svg>
        ) : null}
      </span>
      {label}
    </label>
  );
}

export function ScanPanel({ state }: { state: ScannerState }) {
  const {
    target,
    setTarget,
    scanSource,
    setScanSource,
    scanManifest,
    setScanManifest,
    scanLoading,
    scanResult,
    scanError,
    repoInput,
    setRepoInput,
    repoLoading,
    repoError,
    operatorEndpoint,
    runScan,
    runRepoScan,
    exportLoading,
    exportCbom,
    exportSarif,
    exportJson,
  } = state;

  return (
    <Tabs.Content value="scan" className="mt-5 focus-visible:outline-none">
      <Panel
        index="01 / inventory"
        title="Cryptographic Asset Scan"
        copy="POST /v1/scan/full — parses source files and dependency manifests into CBOM findings."
      >
        {/* Console-style target bar. A directory path is a command argument,
            so it is presented as one instead of as a boxed form field with a
            label above it. */}
        <div className="rounded-xl bg-slate-950 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pl-2 font-mono text-sm leading-none text-cyan-300" aria-hidden="true">
              ❯
            </span>
            <label htmlFor="scan-target" className="sr-only">
              Target directory
            </label>
            <input
              id="scan-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runScan()}
              placeholder="/workspace/projects/backend/src"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-2 font-mono text-sm text-white placeholder:text-slate-400 focus:outline-none"
            />
            <Button
              onClick={() => void runScan()}
              disabled={scanLoading || !target.trim()}
              className="h-9 shrink-0 rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-200 focus-visible:ring-cyan-200 focus-visible:ring-offset-slate-950"
            >
              {scanLoading && <Spinner />}
              {scanLoading ? "Scanning…" : "Run scan"}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-label font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Try
          </span>
          {SAMPLE_TARGETS.map((sample) => {
            const active = target === sample.path;
            return (
              <button
                key={sample.path}
                type="button"
                onClick={() => setTarget(sample.path)}
                aria-pressed={active}
                className={`rounded-full border px-2.5 py-1 font-mono text-micro transition ${
                  active
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-border bg-white text-muted-foreground hover:border-slate-400 hover:text-slate-950"
                }`}
              >
                {sample.label}
              </button>
            );
          })}
        </div>

        <fieldset className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2">
          <legend className="sr-only">Scan coverage</legend>
          <CoverageToggle checked={scanSource} onChange={setScanSource} label="Source code" />
          <CoverageToggle
            checked={scanManifest}
            onChange={setScanManifest}
            label="Dependency manifests"
          />
        </fieldset>

        {/* Public-repository ingestion: the same detectors, run server-side on a
            GitHub archive, so a visitor can scan a real codebase without a
            checkout on the operator machine. */}
        <div className="mt-5 rounded-xl border border-border bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold tracking-[-0.02em] text-slate-950">
              Scan a public repository
            </h3>
            <p className="text-micro text-muted-foreground">
              No checkout required · GitHub archives up to 3 MB
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="repo-target" className="sr-only">
              GitHub repository
            </label>
            <input
              id="repo-target"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runRepoScan()}
              placeholder="owner/repo or https://github.com/owner/repo"
              spellCheck={false}
              autoComplete="off"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-white px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-qtrust-600 focus:outline-none focus:ring-2 focus:ring-qtrust-600/20"
            />
            <Button
              variant="outline"
              onClick={() => void runRepoScan()}
              disabled={repoLoading || !repoInput.trim()}
              className="h-9 shrink-0 rounded-lg px-4 text-sm font-semibold"
            >
              {repoLoading && <Spinner />}
              {repoLoading ? "Fetching…" : "Scan repo"}
            </Button>
          </div>
          {repoError && <p className="mt-2 text-xs text-danger">{repoError}</p>}
          {operatorEndpoint === "/v1/scan/repo" && (
            <OperatorAccessInline endpoint={operatorEndpoint} onSaved={() => void runRepoScan()} />
          )}
        </div>

        {scanError && <p className="mt-3 text-xs text-danger">{scanError}</p>}
        {operatorEndpoint === "/v1/scan/full" && (
          <OperatorAccessInline endpoint={operatorEndpoint} onSaved={() => void runScan()} />
        )}

        {scanResult && (
          <div className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-sm font-semibold tracking-[-0.02em] text-slate-950">
                Results
              </h3>
              <p className="font-mono text-label uppercase tracking-[0.16em] text-muted-foreground">
                {scanResult.origin === "repo"
                  ? `GitHub · ${scanResult.filesScanned ?? "—"} files scanned`
                  : "summary computed client-side"}
              </p>
            </div>

            <div className="mt-3">
              <SeveritySummary summary={scanResult.summary} />
            </div>

            <AlgorithmMix findings={scanResult.findings} />

            {/* Findings table — the only table on this surface: the audit
                counts `table tbody tr` here and expects the finding rows. */}
            <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border md:block">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Scan findings</caption>
                <thead>
                  <tr className="border-b border-border bg-[#fbfbfa] text-label uppercase tracking-[0.14em] text-muted-foreground">
                    <th scope="col" className="px-4 py-2.5 font-semibold">File</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Line</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Algorithm</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Severity</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult.findings.map((f, i) => (
                    <tr
                      key={i}
                      className="border-b border-slate-100 transition-colors last:border-0 hover:bg-[#fbfbfa]"
                    >
                      <td
                        className="max-w-[220px] truncate px-4 py-2.5 font-mono text-foreground"
                        title={f.file}
                      >
                        {basename(f.file) || "-"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground tabular-nums">
                        {f.line ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{f.algorithm}</td>
                      <td className="px-4 py-2.5">
                        <StatusPill tone={severityTone(f.severity ?? "")}>
                          {f.severity ?? "unknown"}
                        </StatusPill>
                      </td>
                      <td className="max-w-[240px] truncate px-4 py-2.5 text-muted-foreground">
                        {f.message}
                      </td>
                    </tr>
                  ))}
                  {scanResult.findings.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No findings — no quantum-vulnerable algorithms detected.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile card fallback for findings */}
            <div className="mt-4 space-y-2 md:hidden" role="list" aria-label="Scan findings">
              {scanResult.findings.map((f, i) => (
                <div
                  key={i}
                  className={`rounded-xl border border-border border-l-2 bg-white p-3 ${
                    SEVERITY_RAIL[(f.severity ?? "").toLowerCase()] ?? "border-l-slate-300"
                  }`}
                  role="listitem"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate font-mono text-xs font-medium text-foreground">
                      {f.file}:{f.line ?? "—"}
                    </span>
                    <StatusPill tone={severityTone(f.severity ?? "")} className="shrink-0">
                      {f.severity ?? "unknown"}
                    </StatusPill>
                  </div>
                  <div className="mt-1 text-xs font-medium text-foreground">{f.algorithm}</div>
                  {f.message ? (
                    <div className="mt-1 text-xs text-muted-foreground">{f.message}</div>
                  ) : null}
                </div>
              ))}
              {scanResult.findings.length === 0 && (
                <div className="rounded-xl border border-border bg-white p-6 text-center text-sm text-muted-foreground">
                  No findings — no quantum-vulnerable algorithms detected.
                </div>
              )}
            </div>

            {/* Exports */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <span className="mr-1 text-label font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Export
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void exportCbom()}
                disabled={exportLoading === "cbom"}
              >
                {exportLoading === "cbom" ? <Spinner /> : null}
                CycloneDX CBOM
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void exportSarif()}
                disabled={exportLoading === "sarif"}
              >
                {exportLoading === "sarif" ? <Spinner /> : null}
                SARIF 2.1
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportJson()}
                disabled={exportLoading === "json"}
              >
                {exportLoading === "json" ? <Spinner /> : null}
                Raw JSON
              </Button>
              <span className="text-micro text-muted-foreground">
                CBOM and SARIF are generated client-side from the returned findings.
              </span>
            </div>
          </div>
        )}
      </Panel>
    </Tabs.Content>
  );
}

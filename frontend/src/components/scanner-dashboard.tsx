"use client";

/**
 * Scanner dashboard — scan targets for PQC vulnerabilities, view risk scores,
 * compliance status, migration roadmap, and evidence records.
 *
 * Endpoints used are the ones that actually exist on the backend:
 *   POST /v1/scan/full            POST /v1/risk/score
 *   POST /v1/compliance/evaluate  POST /v1/roadmap/generate
 *   POST /v1/evidence/create      POST /v1/evidence/verify
 * Panels marked "(client-side)" are computed locally from fetched data.
 *
 * Since TD-01 the per-tab bodies live in `./scanner/`: one module per tab
 * (scan-panel, risk-panel, compliance-panel, roadmap-panel, evidence-panel),
 * the shared state hook (use-scanner-state) and the shared types/helpers/
 * presentational pieces (shared, shared-ui). This file stays the composition
 * shell: tab state, the rail, the contextual strip, the result badges and the
 * three thin lab tabs (06–08).
 */
import * as Tabs from "@radix-ui/react-tabs";
import SideChannelPanel from "@/components/side-channel-panel";
import { PlanningPanel } from "@/components/planning-panel";
import QuantumThreatPanel from "@/components/quantum-threat-panel";
import AnomalyPanel from "@/components/anomaly-panel";
import RLPlanViewer from "@/components/rl-plan-viewer";
import { OperatorAccessPanel } from "@/components/operator-access";
import { TABS, type TabId } from "./scanner/shared";
import { SurfaceEyebrow } from "./scanner/shared-ui";
import { ScanPanel } from "./scanner/scan-panel";
import { RiskPanel } from "./scanner/risk-panel";
import { CompliancePanel } from "./scanner/compliance-panel";
import { RoadmapPanel } from "./scanner/roadmap-panel";
import { EvidencePanel } from "./scanner/evidence-panel";
import { useScannerState } from "./scanner/use-scanner-state";

export function ScannerDashboard() {
  const state = useScannerState();

  /* ---- Render ---- */

  const activeTab = TABS.find((entry) => entry.id === state.tab) ?? TABS[0];

  /**
   * Per-tab result badges. A badge only appears when something actually exists
   * behind the tab, so it always answers "is there anything in there?" — never
   * a decorative zero. Rendered as a `::after` from `data-badge` so the tab's
   * text content (and therefore its accessible name) stays exactly the label.
   */
  const badges: Partial<Record<TabId, string>> = {};
  if (state.scanResult) badges.scan = String(state.scanResult.summary.totalFindings);
  if (state.riskScores.length > 0) badges.risk = String(state.riskScores.length);
  if (state.complianceReport) badges.compliance = `${state.complianceReport.scorePercent}%`;
  if (state.roadmap) badges.roadmap = String(state.roadmap.phases.length);
  if (state.evidenceVerify?.valid) badges.evidence = "✓";

  return (
    <Tabs.Root value={state.tab} onValueChange={(value) => state.setTab(value as TabId)}>
      {/* Surface bar: states up front that nothing here needs credentials, and
          keeps the operator key reachable without making it the first thing a
          visitor reads. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="flex items-center gap-2 text-micro text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          Public surface
          <span aria-hidden="true">·</span>
          <span>no key, no wallet, no account</span>
        </p>
        <OperatorAccessPanel variant="strip" />
      </div>

      {/* Segmented rail.
          Desktop: a wrapping flex row. Eight labelled tabs do not fit 375px in
          one row, and the original single-row rail was silently clipped by the
          document's `overflow-x: clip` — no scrollbar, no affordance, trailing
          tabs unreachable. On phones it becomes a two-column grid instead, which
          is tidier than a ragged wrap and keeps every tab visible and tappable. */}
      <Tabs.List
        aria-label="Scanner surfaces"
        className="mt-4 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex sm:flex-wrap sm:items-center"
      >
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const badge = badges[entry.id];
          return (
            <Tabs.Trigger
              key={entry.id}
              value={entry.id}
              data-badge={badge || undefined}
              className="qtab group inline-flex items-center justify-start gap-2 rounded-xl px-2.5 py-2 text-xs font-medium text-muted-foreground transition duration-150 ease-out hover:bg-neutral-surface hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 focus-visible:ring-offset-1 data-[state=active]:bg-slate-950 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:hover:bg-slate-950 sm:px-3 sm:text-[13px]"
            >
              <Icon
                className="h-3.5 w-3.5 shrink-0 opacity-60 transition-opacity group-data-[state=active]:opacity-100"
                aria-hidden="true"
              />
              {entry.label}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>

      {/* Contextual strip — what the active surface is for, and what state it is
          already holding. This is the difference between eight labels and a
          product: the rail says where you are, this says what you will find. */}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 border-t border-border pt-3">
        <p className="max-w-2xl text-micro leading-5 text-muted-foreground">
          <span className="mr-2 font-mono text-label uppercase tracking-[0.2em] text-muted-foreground">
            {activeTab.step}
          </span>
          {activeTab.purpose}
        </p>
        <p className="font-mono text-label uppercase tracking-[0.14em] text-muted-foreground">
          {state.scanResult
            ? `${state.scanResult.summary.totalFindings} findings · ${state.scanResult.summary.algorithmsDetected.length} algorithms`
            : "no scan yet"}
        </p>
      </div>

      {/* ==================== 01 · SCAN ==================== */}
      <ScanPanel state={state} />

      {/* ==================== 02 · RISK SCORES ==================== */}
      <RiskPanel state={state} />

      {/* ==================== 03 · COMPLIANCE ==================== */}
      <CompliancePanel state={state} />

      {/* ==================== 04 · ROADMAP ==================== */}
      <RoadmapPanel state={state} />

      {/* ==================== 05 · EVIDENCE ==================== */}
      <EvidencePanel state={state} />

      {/* ==================== 06 · SIDE CHANNEL ==================== */}
      <Tabs.Content value="sidechannel" className="mt-5 focus-visible:outline-none">
        <SurfaceEyebrow index="06 / leakage" />
        <div className="mt-3 max-w-xl">
          <SideChannelPanel />
        </div>
      </Tabs.Content>

      {/* ==================== 07 · AI PLANNER ==================== */}
      <Tabs.Content value="planner" className="mt-5 focus-visible:outline-none">
        <SurfaceEyebrow index="07 / ordering" />
        <div className="mt-3 max-w-3xl">
          <PlanningPanel />
        </div>
      </Tabs.Content>

      {/* ==================== 08 · AI & GPU LAB ==================== */}
      <Tabs.Content value="lab" className="mt-5 focus-visible:outline-none">
        <SurfaceEyebrow index="08 / lab" />
        <div className="mt-3 space-y-4">
          <QuantumThreatPanel />
          <AnomalyPanel />
          <RLPlanViewer />
        </div>
      </Tabs.Content>
    </Tabs.Root>
  );
}

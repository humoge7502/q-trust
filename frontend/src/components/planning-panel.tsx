"use client";

/**
 * AI migration planning panel.
 *
 * Paste a CBOM JSON (produced by `crypto-inspector scan`) or fetch one from a
 * registered asset's metadata URI, optionally set a migration deadline, and
 * get the GNN-ranked migration order + a deadline feasibility schedule.
 */
import { useMemo, useState } from "react";
import { ApiError, fetchMigrationPlan, OperatorKeyRequiredError } from "@/lib/api";
import { OperatorAccessInline } from "@/components/operator-access";
import { PanelTitle } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { ErrorState } from "@/components/ui/state";

const SAMPLE_CBOM = JSON.stringify(
  {
    schema_version: "1.0",
    assets: [
      { asset_id: "asset-0001", algorithm: "RSA-2048", key_size: 2048, criticality: "Critical", pqc_ready: false },
      { asset_id: "asset-0002", algorithm: "ECC-P256", key_size: 256, criticality: "High", pqc_ready: false },
      { asset_id: "asset-0003", algorithm: "AES-256", key_size: 256, criticality: "Medium", pqc_ready: true },
      { asset_id: "asset-0004", algorithm: "SHA-256", key_size: 0, criticality: "Low", pqc_ready: true },
    ],
  },
  null,
  2,
);

interface PlanResult {
  planner_mode?: string;
  migration_order: Array<{
    rank: number;
    asset_id: string;
    algorithm: string;
    criticality: string;
    pqc_ready: boolean;
    risk_score: number;
    migrate_days: number;
  }>;
  schedule?: {
    feasible: boolean;
    days_available: number;
    total_effort_days: number;
    suggested_daily_rate: number | null;
    windows: Array<{ asset_id: string; start: string; end: string }>;
  } | null;
  total_assets: number;
}

/**
 * 4xx means the CBOM itself was refused, so the server's `detail` is worth
 * showing verbatim. Everything else (5xx, network) is retry-safe and gets
 * friendly copy instead of an exception string.
 */
function describeFailure(err: unknown): { kind: "invalid" | "unavailable"; detail: string } {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
    return { kind: "invalid", detail: err.detail || "The planner rejected this request." };
  }
  return {
    kind: "unavailable",
    detail:
      "The planner is temporarily unavailable. Nothing was changed — retrying is safe.",
  };
}

export function PlanningPanel() {
  // Prefilled so the first click produces a plan instead of a JSON error on an
  // empty textarea. "Load sample CBOM" stays as the reset.
  const [cbomText, setCbomText] = useState(SAMPLE_CBOM);
  const [deadline, setDeadline] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [error, setError] = useState<{ kind: "invalid" | "unavailable"; detail: string } | null>(
    null,
  );
  const [operatorEndpoint, setOperatorEndpoint] = useState<string | null>(null);

  const cbom = useMemo(() => {
    if (!cbomText.trim()) return null;
    try {
      return JSON.parse(cbomText) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [cbomText]);

  async function run() {
    if (!cbom) {
      setState("error");
      setError({ kind: "invalid", detail: "That CBOM is not valid JSON. Fix the syntax and try again." });
      return;
    }
    setError(null);
    setOperatorEndpoint(null);
    setState("loading");
    try {
      const result = await fetchMigrationPlan({ cbom, deadline: deadline || undefined });
      setPlan(result);
      setState("done");
    } catch (err) {
      if (err instanceof OperatorKeyRequiredError) {
        // Planning is open compute in the shipped policy, but a stricter
        // deployment can still gate it — collect the caller's own key.
        setOperatorEndpoint(err.endpoint);
        setState("idle");
        return;
      }
      setError(describeFailure(err));
      setState("error");
    }
  }

  return (
    <div
      className="mt-4 rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="planning-panel"
    >
      <PanelTitle>AI migration planner</PanelTitle>
      <p className="mt-1.5 text-micro leading-6 text-muted-foreground">
        Paste a CBOM JSON (from <code className="rounded bg-neutral-surface px-1">crypto-inspector scan</code>)
        and optionally a deadline. The GNN ranks assets by migration priority and estimates feasibility.
      </p>

      <div className="mt-4 flex gap-3">
        <textarea
          aria-label="CBOM JSON"
          value={cbomText}
          onChange={(e) => setCbomText(e.target.value)}
          placeholder='{"assets": [{"asset_id": "…", "algorithm": "RSA-2048", "key_size": 2048, "criticality": "Critical"}]}'
          rows={6}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-micro text-foreground transition focus:border-qtrust-600 focus:outline-none focus:ring-2 focus:ring-qtrust-600/25"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setCbomText(SAMPLE_CBOM)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-micro font-medium text-neutral transition hover:border-qtrust-500 hover:text-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
        >
          Load sample CBOM
        </button>
        <label className="flex items-center gap-2 text-micro font-medium text-neutral">
          Deadline
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-micro text-foreground transition focus:border-qtrust-600 focus:outline-none focus:ring-2 focus:ring-qtrust-600/25"
          />
        </label>
        <button
          onClick={() => void run()}
          disabled={state === "loading"}
          className="ml-auto rounded-lg bg-qtrust-600 px-4 py-2 text-micro font-semibold text-white transition hover:bg-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          {state === "loading" ? "Planning…" : "Generate plan"}
        </button>
      </div>

      {state === "error" && error ? (
        <div className="mt-3" data-testid="plan-error" data-error-kind={error.kind}>
          <ErrorState
            title={
              error.kind === "unavailable"
                ? "The planner is temporarily unavailable"
                : "This CBOM was not accepted"
            }
            description={error.detail}
            // Retrying an unchanged invalid request just fails again; retry is
            // only offered when the failure is transient.
            onRetry={error.kind === "unavailable" ? () => void run() : undefined}
          />
        </div>
      ) : null}

      {operatorEndpoint ? (
        <OperatorAccessInline endpoint={operatorEndpoint} onSaved={() => void run()} />
      ) : null}

      {state === "done" && plan ? (
        <PlanView plan={plan} />
      ) : state === "loading" ? (
        <div className="mt-4 animate-pulse space-y-2" aria-hidden="true">
          <div className="h-4 w-1/3 rounded bg-neutral-surface" />
          <div className="h-8 w-full rounded bg-neutral-surface" />
          <div className="h-8 w-full rounded bg-neutral-surface" />
        </div>
      ) : null}
    </div>
  );
}

function PlanView({ plan }: { plan: PlanResult }) {
  const sched = plan.schedule;
  return (
    <div
      className="mt-4"
      data-testid="plan-result"
      data-planner-mode={plan.planner_mode ?? "unknown"}
      data-plan-rows={plan.migration_order.length}
    >
      {sched ? (
        <div
          data-testid="plan-summary"
          data-feasible={sched.feasible}
          className={`mb-3 rounded-lg border px-4 py-3 text-micro font-medium ${
            sched.feasible
              ? "border-success-border bg-success-surface text-success"
              : "border-danger-border bg-danger-surface text-danger"
          }`}
        >
          {sched.feasible
            ? `✓ Feasible: ${sched.total_effort_days.toFixed(1)} days of effort fits in ${sched.days_available} days`
            : `✗ Not feasible in time: ${sched.total_effort_days.toFixed(1)} days of effort vs ${sched.days_available} days available`}
          {sched.suggested_daily_rate
            ? ` — suggested rate: ${sched.suggested_daily_rate} assets/day.`
            : ""}
        </div>
      ) : null}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Migration plan — ranked assets</caption>
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="py-2 pr-2 font-medium">Rank</th>
              <th scope="col" className="py-2 pr-2 font-medium">Asset</th>
              <th scope="col" className="py-2 pr-2 font-medium">Algorithm</th>
              <th scope="col" className="py-2 pr-2 font-medium">Criticality</th>
              <th scope="col" className="py-2 pr-2 font-medium">Effort</th>
              {sched ? <th scope="col" className="py-2 pr-2 font-medium">Window</th> : null}
            </tr>
          </thead>
          <tbody>
            {plan.migration_order.map((a) => {
              const window = sched?.windows.find((w) => w.asset_id === a.asset_id);
              return (
                <tr
                  key={a.asset_id}
                  className="border-b border-border"
                  data-testid="plan-row"
                  data-asset-id={a.asset_id}
                >
                  {/* `text-muted-foreground`, not `text-slate-400`: slate-400 on
                      white measures 2.64:1 and fails WCAG AA outright. */}
                  <td className="py-2 pr-2 font-mono text-muted-foreground">#{a.rank}</td>
                  <td className="py-2 pr-2 font-mono text-foreground">{a.asset_id}</td>
                  <td className="py-2 pr-2 text-neutral">{a.algorithm}</td>
                  <td className="py-2 pr-2">
                    {a.pqc_ready ? (
                      <StatusPill tone="success">PQC-ready</StatusPill>
                    ) : (
                      <span className="text-neutral">{a.criticality}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-neutral">{a.migrate_days}d</td>
                  {window ? (
                    <td className="py-2 pr-2 font-mono text-micro text-muted-foreground">
                      {window.start.slice(0, 10)} → {window.end.slice(0, 10)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile card fallback */}
      <div className="space-y-3 md:hidden" role="list" aria-label="Migration plan">
        {plan.migration_order.map((a) => {
          const window = sched?.windows.find((w) => w.asset_id === a.asset_id);
          return (
            <div
              key={a.asset_id}
              className="rounded-lg border border-border bg-muted p-3"
              role="listitem"
              data-testid="plan-card"
              data-asset-id={a.asset_id}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-micro font-medium text-muted-foreground">#{a.rank} · {a.asset_id}</span>
                <span className="text-micro text-neutral">{a.migrate_days}d</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-micro">
                <span className="rounded bg-card px-2 py-1 font-medium text-foreground ring-1 ring-border">{a.algorithm}</span>
                {a.pqc_ready ? (
                  <StatusPill tone="success">PQC-ready</StatusPill>
                ) : (
                  <span className="rounded-full bg-card px-2 py-0.5 text-neutral ring-1 ring-border">{a.criticality}</span>
                )}
              </div>
              {window ? (
                <div className="mt-2 font-mono text-micro text-muted-foreground">
                  {window.start.slice(0, 10)} → {window.end.slice(0, 10)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
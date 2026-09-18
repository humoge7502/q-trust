"use client";

import { useState } from "react";
import { apiPostJson, OperatorKeyRequiredError } from "@/lib/api";
import { OperatorAccessInline } from "@/components/operator-access";
import { StatusPill } from "@/components/ui/status-pill";
import { ErrorState } from "@/components/ui/state";

interface MigrationStep {
  asset_id?: number | string;
  algorithm?: string;
  location?: string;
  priority?: number;
  [key: string]: unknown;
}

interface RLPlanResponse {
  method: string;
  migration_order: MigrationStep[];
  [key: string]: unknown;
}

const DEMO_CBOM = JSON.stringify(
  {
    assets: [
      { id: 0, algorithm: "RSA-2048", key_size: 2048, criticality: "critical" },
      { id: 1, algorithm: "RSA-4096", key_size: 4096, criticality: "medium" },
      { id: 2, algorithm: "ECC-P256", key_size: 256, criticality: "high" },
      { id: 3, algorithm: "Ed25519", key_size: 256, criticality: "low" },
      { id: 4, algorithm: "RSA-2048", key_size: 2048, criticality: "high" },
    ],
    dependencies: [[0, 2]],
  },
  null,
  2,
);

export default function RLPlanViewer() {
  const [cbomText, setCbomText] = useState<string>(DEMO_CBOM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operatorEndpoint, setOperatorEndpoint] = useState<string | null>(null);
  const [result, setResult] = useState<RLPlanResponse | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setOperatorEndpoint(null);
    setResult(null);
    try {
      let cbom: unknown;
      try {
        cbom = JSON.parse(cbomText);
      } catch {
        throw new Error("CBOM is not valid JSON");
      }
      try {
        setResult(await apiPostJson<RLPlanResponse>("/v1/gpu/rl/plan", { cbom }));
      } catch (e) {
        if (e instanceof OperatorKeyRequiredError) throw e;
        if (e instanceof Error && e.message.startsWith("API 503")) {
          throw new Error(
            "RL planner microservice unreachable. Start it with `docker compose up planner`.",
          );
        }
        throw e;
      }
    } catch (e) {
      if (e instanceof OperatorKeyRequiredError) {
        setOperatorEndpoint(e.endpoint);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">
          RL Migration Planner
        </h3>
        <StatusPill tone="accent">Policy network</StatusPill>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        A reinforcement-learning agent trained on simulated migrations orders
        your assets: dependencies first, critical assets early, downtime
        minimized.
      </p>

      <textarea
        value={cbomText}
        onChange={(e) => setCbomText(e.target.value)}
        rows={6}
        aria-label="CBOM JSON for planning"
        className="mb-3 w-full rounded-md border border-border bg-muted p-2 font-mono text-micro text-foreground transition focus:border-qtrust-600 focus:outline-none focus:ring-2 focus:ring-qtrust-600/25"
      />

      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="w-full rounded-md bg-qtrust-600 px-4 py-2 text-micro font-semibold text-white transition hover:bg-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {loading ? "Planning..." : "Generate migration plan"}
      </button>

      {error && (
        <div className="mt-3">
          <ErrorState description={error} />
        </div>
      )}

      {operatorEndpoint && (
        <OperatorAccessInline endpoint={operatorEndpoint} onSaved={() => void run()} />
      )}

      {result && (
        <div className="mt-4 rounded-md border border-border p-3">
          <p className="mb-2 flex items-center gap-2 text-micro text-muted-foreground">
            <span>Method:</span>
            <StatusPill tone={result.method === "rl_policy" ? "info" : "warning"}>
              {result.method}
            </StatusPill>
            <span>· {result.migration_order.length} steps</span>
          </p>
          <ol className="space-y-1.5">
            {result.migration_order.map((step, i) => (
              <li key={i} className="flex items-center gap-2 text-micro">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-qtrust-50 font-mono text-label text-qtrust-700">
                  {i + 1}
                </span>
                <span className="font-mono text-micro text-foreground">
                  {String(step.algorithm ?? step.asset_id ?? "?")}
                </span>
                {"location" in step && step.location ? (
                  <span className="truncate text-micro text-muted-foreground">
                    {String(step.location)}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { apiPostJson, OperatorKeyRequiredError } from "@/lib/api";
import { useApiOperation } from "@/hooks/use-api-operation";
import { OperatorAccessInline } from "@/components/operator-access";
import { StatusPill } from "@/components/ui/status-pill";
import { ErrorState } from "@/components/ui/state";

interface AnomalousAsset {
  asset_index: number;
  location: string;
  algorithm: string;
  reconstruction_error: number;
}

interface AnomalyResponse {
  anomaly_score: number;
  is_anomalous: boolean;
  threshold: number;
  asset_count: number;
  top_anomalous_assets: AnomalousAsset[];
  evidence_hash: string;
  timestamp: string;
}

const DEMO_CBOM = JSON.stringify(
  {
    assets: [
      {
        algorithm: "RSA-1024",
        key_size: 1024,
        criticality: "critical",
        expired: true,
        vendor: null,
        self_signed: true,
        days_until_expiry: 0,
        location: "legacy-gateway.example.com",
      },
      {
        algorithm: "RSA-2048",
        key_size: 2048,
        criticality: "high",
        expired: false,
        vendor: "DigiCert",
        self_signed: false,
        days_until_expiry: 200,
        location: "api.example.com",
      },
      {
        algorithm: "ML-KEM-768",
        key_size: 3168,
        criticality: "low",
        expired: false,
        vendor: null,
        self_signed: false,
        days_until_expiry: 365,
        location: "pilot.example.com",
      },
    ],
  },
  null,
  2,
);

export default function AnomalyPanel() {
  const [cbomText, setCbomText] = useState<string>(DEMO_CBOM);
  // F-13: the scoring call's loading / error / operator-key prompt / result
  // cycle is owned by the shared hook instead of four hand-rolled states.
  const anomalyOp = useApiOperation<AnomalyResponse>();
  const { loading, error, operatorEndpoint, data: result } = anomalyOp;

  const run = () => {
    // A fresh scoring run drops the previous verdict up front, as before.
    anomalyOp.clear();
    return anomalyOp.run(async () => {
      let cbom: unknown;
      try {
        cbom = JSON.parse(cbomText);
      } catch {
        throw new Error("CBOM is not valid JSON");
      }
      try {
        return await apiPostJson<AnomalyResponse>("/v1/gpu/anomaly/score", { cbom });
      } catch (e) {
        // Re-throw the operator error untouched so the hook routes it to the
        // operator prompt instead of the error text.
        if (e instanceof OperatorKeyRequiredError) throw e;
        if (e instanceof Error && e.message.startsWith("API 409")) {
          throw new Error(
            "Detector not trained yet. Train it via `make -f Makefile.gpu anomaly-train` and set QTRUST_ANOMALY_MODEL.",
          );
        }
        throw e;
      }
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">
          CBOM Anomaly Detection
        </h3>
        <StatusPill tone="accent">VAE</StatusPill>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Scores a CBOM against a variational autoencoder trained on normal
        cryptographic inventories — flags weak keys, drift, and unusual
        certificate patterns.
      </p>

      <textarea
        value={cbomText}
        onChange={(e) => setCbomText(e.target.value)}
        rows={6}
        aria-label="CBOM JSON"
        className="mb-3 w-full rounded-md border border-border bg-muted p-2 font-mono text-micro text-foreground transition focus:border-qtrust-600 focus:outline-none focus:ring-2 focus:ring-qtrust-600/25"
      />

      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="w-full rounded-md bg-qtrust-600 px-4 py-2 text-micro font-semibold text-white transition hover:bg-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {loading ? "Scoring..." : "Score CBOM"}
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
        <div
          className={`mt-4 rounded-md border p-3 ${
            result.is_anomalous
              ? "border-danger-border bg-danger-surface"
              : "border-success-border bg-success-surface"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusPill tone={result.is_anomalous ? "danger" : "success"}>
              {result.is_anomalous ? "ANOMALY DETECTED" : "Normal"}
            </StatusPill>
            <span className="font-mono text-micro text-muted-foreground">
              score {result.anomaly_score.toFixed(3)} / thr{" "}
              {result.threshold.toFixed(3)}
            </span>
          </div>
          <p className="mt-2 text-micro text-muted-foreground">
            {result.asset_count} assets · evidence{" "}
            <span className="font-mono">{result.evidence_hash.slice(0, 14)}…</span>
          </p>
          {result.top_anomalous_assets.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.top_anomalous_assets.slice(0, 3).map((a) => (
                <li key={a.asset_index} className="text-micro">
                  <span className="font-mono text-foreground">
                    {a.location || `#${a.asset_index}`}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {a.algorithm} (err {a.reconstruction_error.toFixed(3)})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

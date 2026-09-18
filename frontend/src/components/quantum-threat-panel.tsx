"use client";

import { useState } from "react";
import { apiGetJson, OperatorKeyRequiredError } from "@/lib/api";
import { OperatorAccessInline } from "@/components/operator-access";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { ErrorState } from "@/components/ui/state";

interface QuantumEstimate {
  rsa_key_size: number;
  logical_qubits_needed: number;
  physical_qubits_needed: number;
  estimated_breakable_year: number | null;
  based_on: string;
}

const KEY_SIZES = [1024, 2048, 3072, 4096] as const;

/**
 * Urgency band as a semantic tone rather than a raw colour.
 *
 * This previously returned `text-red-600` / `text-orange-600` / `text-amber-600`
 * / `text-green-600`. `orange` is not part of the product's palette at all,
 * and the rest duplicated (without matching) the risk and state tokens used
 * elsewhere — the same "high risk" state rendered in three different colours
 * depending on which panel you looked at.
 */
function urgency(year: number | null): { label: string; tone: StatusTone } {
  if (year === null) return { label: "Not before 2033", tone: "success" };
  const yearsAway = year - 2026;
  if (yearsAway <= 2) return { label: "CRITICAL", tone: "danger" };
  if (yearsAway <= 5) return { label: "HIGH", tone: "danger" };
  if (yearsAway <= 8) return { label: "MEDIUM", tone: "warning" };
  return { label: "LOW", tone: "success" };
}

export default function QuantumThreatPanel() {
  const [bits, setBits] = useState<number>(2048);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operatorEndpoint, setOperatorEndpoint] = useState<string | null>(null);
  const [result, setResult] = useState<QuantumEstimate | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setOperatorEndpoint(null);
    setResult(null);
    try {
      setResult(
        await apiGetJson<QuantumEstimate>(`/v1/gpu/quantum/estimate/${bits}`),
      );
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

  const u = urgency(result?.estimated_breakable_year ?? null);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">
          Quantum Threat Estimate
        </h3>
        <StatusPill tone="accent">Shor-backed</StatusPill>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Estimates the quantum resources required to break an RSA key of the
        given size, based on published hardware roadmaps.
      </p>

      <div className="mb-4 flex gap-2">
        {KEY_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => setBits(size)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm ${
              bits === size
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {size}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="w-full rounded-md bg-qtrust-600 px-4 py-2 text-micro font-semibold text-white transition hover:bg-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {loading ? "Estimating..." : `Estimate RSA-${bits} threat`}
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
        <dl className="mt-4 space-y-2 rounded-md border border-border p-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Migration urgency</dt>
            <dd className="flex items-center gap-2">
              <StatusPill tone={u.tone}>{u.label}</StatusPill>
              {result.estimated_breakable_year !== null && (
                <span className="font-mono text-micro text-muted-foreground">
                  ~{result.estimated_breakable_year}
                </span>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Logical qubits</dt>
            <dd className="font-mono">
              {result.logical_qubits_needed.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Physical qubits</dt>
            <dd className="font-mono">
              {result.physical_qubits_needed.toLocaleString()}
            </dd>
          </div>
          <div className="pt-1 text-micro text-muted-foreground">
            Basis: {result.based_on}
          </div>
        </dl>
      )}
    </div>
  );
}

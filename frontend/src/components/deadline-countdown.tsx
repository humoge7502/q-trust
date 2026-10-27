"use client";

import { useEffect, useState } from "react";

/**
 * Regulatory deadline countdown — the differentiating "time pressure" view
 * that the PQC market executes poorly (competitive research, 2026-10).
 *
 * Live day counters to the four canonical transition dates, computed in the
 * visitor's browser (hydration-safe: labels render server-side, numbers fill
 * in after mount). NIST IR 8547 was finalized on 2026-10-27 — the 2030/2035
 * dates below are official NIST guidance, cited as such.
 */

const DEADLINES = [
  {
    date: "2027-01-01",
    label: "CNSA 2.0 acquisitions",
    copy: "New national-security-system acquisitions must be CNSA 2.0-capable.",
    source: "NSA CNSA 2.0",
  },
  {
    date: "2030-01-01",
    label: "Deprecation begins",
    copy: "NIST IR 8547 (final, 2026-10-27) deprecates quantum-vulnerable algorithms; CNSA 2.0 classical exclusivity starts.",
    source: "NIST IR 8547 (final) · NSA",
  },
  {
    date: "2033-01-01",
    label: "NSS classical cutoff",
    copy: "Operating systems, browsers, servers, and cloud must be post-quantum across national security systems.",
    source: "NSA CNSA 2.0",
  },
  {
    date: "2035-01-01",
    label: "Disallowed",
    copy: "NIST IR 8547 (final, 2026-10-27) disallows quantum-vulnerable cryptography entirely.",
    source: "NIST IR 8547 (final)",
  },
] as const;

function daysUntil(dateIso: string, now: Date): number {
  const target = new Date(`${dateIso}T00:00:00Z`).getTime();
  return Math.ceil((target - now.getTime()) / 86_400_000);
}

export function DeadlineCountdown() {
  const [days, setDays] = useState<number[] | null>(null);

  useEffect(() => {
    // Deferred by a macrotask so hydration renders the placeholder first
    // (server has no clock) and the swap never races React's commit phase.
    const id = setTimeout(() => {
      const now = new Date();
      setDays(DEADLINES.map((d) => daysUntil(d.date, now)));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const soonest = days ? Math.min(...days) : null;

  return (
    <div className="mt-10">
      <div
        className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="deadline-countdown"
      >
        {DEADLINES.map((d, i) => {
          const value = days ? days[i] : null;
          const tone =
            value === null
              ? "text-slate-500"
              : value < 800
                ? "text-red-300"
                : value < 2200
                  ? "text-amber-300"
                  : "text-cyan-300";
          return (
            <div key={d.date} className="bg-slate-950 p-5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  {d.label}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {d.date.slice(0, 4)}
                </span>
              </div>
              <div
                className={`mt-3 text-3xl font-semibold tabular-nums tracking-tight ${tone}`}
              >
                {value === null ? "––––" : value.toLocaleString("en-US")}
                {value !== null && (
                  <span className="ml-1.5 text-xs font-normal text-slate-500">
                    days
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-400">{d.copy}</p>
              <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {d.source}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {soonest !== null
          ? `${soonest.toLocaleString("en-US")} days until the first binding date. Counters are computed live in your browser.`
          : "Counters are computed live in your browser."}{" "}
        IR 8547 was finalized on 2026-10-27 — the 2030/2035 dates are now
        official NIST guidance. The window, not the day, is the point.
      </p>
    </div>
  );
}

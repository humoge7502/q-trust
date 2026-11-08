"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CHAIN } from "@/lib/config";
import { API_BASE_URL } from "@/lib/api";
import { TESTS_AND_AUDITS } from "@/lib/public-stats";
import { CountUp } from "@/components/ui/count-up.client";
import { BeakerIcon, ChartBarIcon, ClockIcon, CpuChipIcon, ShieldCheckIcon } from "@/app/icons";

interface HealthPayload {
  status: string;
  chain_id: number;
  relayer: string;
}

/* The health check runs after hydration on the public landing page — it must
   not compete with LCP work on every visit. It is deferred to browser idle
   time and memoized per session with a 60s TTL, so repeat views within a
   session never touch the backend at all. */
const HEALTH_CACHE_KEY = "qtrust.health";
const HEALTH_CACHE_TTL_MS = 60_000;

function readCachedHealth(): HealthPayload | null {
  try {
    const raw = sessionStorage.getItem(HEALTH_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { at: number; health: HealthPayload };
    if (Date.now() - cached.at > HEALTH_CACHE_TTL_MS) return null;
    return cached.health;
  } catch {
    // Private-mode or blocked storage: no cache, just fetch as before.
    return null;
  }
}

function writeCachedHealth(health: HealthPayload): void {
  try {
    sessionStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify({ at: Date.now(), health }));
  } catch {
    // Storage unavailable — the fetch result is still shown for this view.
  }
}

/* Dark band tokens: the night family with a single quantum accent (the old
   cyan/violet one-off is folded in). Status is encoded by a dot + text, so
   colour is never the only cue. */
export function StatsTicker() {
  return <div className="overflow-hidden border-y border-night-edge bg-night-raised px-5 py-3 text-center text-label font-semibold uppercase tracking-[0.22em] text-night-ink-soft">{CHAIN.name} · ID {CHAIN.id} <span className="mx-3 text-quantum">●</span> Public verification layer · Hash-only on-chain</div>;
}

export function PublicStatsClient() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = () => {
      if (cancelled) return;
      const cached = readCachedHealth();
      if (cached) {
        setHealth(cached);
        return;
      }
      fetch(`${API_BASE_URL.replace(/\/$/, "")}/health`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`${response.status}`);
          const payload = (await response.json()) as HealthPayload;
          if (!cancelled) {
            writeCachedHealth(payload);
            setHealth(payload);
          }
        })
        .catch((reason) => { if (!cancelled && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    };

    // Defer past hydration/LCP: idle callback when available, else a timeout.
    let idleId: number;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(run, { timeout: 2500 });
    } else {
      timeoutId = setTimeout(run, 1500);
    }
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      else if (idleId !== undefined) window.cancelIdleCallback(idleId);
      controller.abort();
    };
  }, []);

  const isLive = health?.status === "ok" || health?.status === "healthy";
  // Claims are the canonical public-stats constants; "Registry contracts" and
  // "Verification" live in ProofSection — repeating them here would state the
  // same claim twice on one page. This band owns the live-system signals.
  const stats = [
    { label: "Tests and audits", value: <CountUp to={TESTS_AND_AUDITS} />, sub: "Contract, inspector, SDK, and backend coverage", icon: BeakerIcon },
    { label: "Network", value: CHAIN.name, sub: `Chain ID ${CHAIN.id} · ${isLive ? "API live" : error ? "API offline" : "checking"}`, icon: CpuChipIcon },
  ];

  return (
    <section className="border-y border-night-edge bg-night text-night-ink" aria-labelledby="stats-heading">
      <StatsTicker />
      <div className="mx-auto max-w-[88rem] px-5 py-12 sm:px-8 sm:py-16 lg:px-12">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="stats-heading" className="font-mono text-micro font-bold uppercase tracking-[0.28em] text-quantum">The system, in public</h2><p className="mt-3 text-sm text-night-ink-soft">Signals that make the protocol inspectable before it is trusted.</p></div><span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${isLive ? "border-quantum-soft text-quantum" : "border-night-edge text-night-ink-soft"}`}><span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-quantum" : "bg-night-ink-faint"}`} aria-hidden="true" /> {isLive ? "API live" : error ? "API unavailable" : "Checking API…"}<ClockIcon className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></span></div>
        <dl className="mt-10 grid border-y border-night-edge sm:grid-cols-2">
          {stats.map((stat, index) => <div key={stat.label} className={`py-7 sm:px-6 lg:py-8 ${index % 2 === 1 ? "border-t border-night-edge sm:border-l sm:border-t-0" : ""}`}><dt className="flex items-center gap-2 text-label font-semibold uppercase tracking-[0.2em] text-night-ink-soft"><stat.icon className="h-3.5 w-3.5 text-night-ink-soft" aria-hidden="true" /> {stat.label}</dt><dd className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-night-ink tabular-nums">{stat.value}</dd><dd className="mt-2 max-w-[14rem] text-xs leading-5 text-night-ink-soft">{stat.sub}</dd></div>)}
        </dl>
        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-xs text-night-ink-soft"><Link href="/scanner" className="inline-flex items-center gap-2 transition hover:text-night-ink"><ChartBarIcon className="h-3.5 w-3.5 text-quantum" aria-hidden="true" /> Run a scan</Link><Link href="/v" className="inline-flex items-center gap-2 transition hover:text-night-ink"><ShieldCheckIcon className="h-3.5 w-3.5 text-quantum" aria-hidden="true" /> Verify an asset</Link><span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-quantum" aria-hidden="true" /> Same-origin API proxy</span></div>
      </div>
    </section>
  );
}

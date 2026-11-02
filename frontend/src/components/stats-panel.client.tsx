"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CHAIN } from "@/lib/config";
import { API_BASE_URL } from "@/lib/api";
import { useMounted } from "@/components/wallet-gate";
import { BeakerIcon, ChartBarIcon, ClockIcon, CpuChipIcon, DocumentCheckIcon, ShieldCheckIcon } from "@/app/icons";

function useCountUp(target: number, duration = 1100, enabled = true): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }
    const start = performance.now();
    startRef.current = start;
    const tick = (now: number) => {
      const elapsed = now - (startRef.current ?? now);
      const progress = Math.min(elapsed / duration, 1);
      setValue(Math.round((1 - Math.pow(1 - progress, 3)) * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration, enabled]);

  return value;
}

/* Dark band tokens: the night family with a single quantum accent (the old
   cyan/violet one-off is folded in). Status is encoded by a dot + text, so
   colour is never the only cue. */
export function StatsTicker() {
  return <div className="overflow-hidden border-y border-night-edge bg-night-raised px-5 py-3 text-center text-label font-semibold uppercase tracking-[0.22em] text-night-ink-soft">{CHAIN.name} · ID {CHAIN.id} <span className="mx-3 text-quantum">●</span> Public verification layer · Hash-only on-chain</div>;
}

export function PublicStatsClient() {
  const [health, setHealth] = useState<{ status: string; chain_id: number; relayer: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${API_BASE_URL.replace(/\/$/, "")}/health`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        setHealth((await response.json()) as { status: string; chain_id: number; relayer: string });
      })
      .catch((reason) => { if (!ctrl.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => ctrl.abort();
  }, []);

  const registries = useCountUp(11, 900, mounted);
  const tests = useCountUp(364, 1400, mounted);
  const isLive = health?.status === "ok" || health?.status === "healthy";
  const stats = [
    { label: "Registry contracts", value: mounted ? String(registries) : "11", sub: "Shared state for assets, vendors, migration, and audits", icon: DocumentCheckIcon },
    { label: "Tests and audits", value: mounted ? String(tests) : "364", sub: "Contract, inspector, SDK, and backend coverage", icon: BeakerIcon },
    { label: "Network", value: CHAIN.name, sub: `Chain ID ${CHAIN.id} · ${isLive ? "API live" : error ? "API offline" : "checking"}`, icon: CpuChipIcon },
    { label: "Verification", value: "Open", sub: "No wallet needed to inspect public attestations", icon: ShieldCheckIcon },
  ];

  return (
    <section className="border-y border-night-edge bg-night text-night-ink" aria-labelledby="stats-heading">
      <StatsTicker />
      <div className="mx-auto max-w-[88rem] px-5 py-12 sm:px-8 sm:py-16 lg:px-12">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="stats-heading" className="font-mono text-micro font-bold uppercase tracking-[0.28em] text-quantum">The system, in public</h2><p className="mt-3 text-sm text-night-ink-soft">Signals that make the protocol inspectable before it is trusted.</p></div><span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${isLive ? "border-quantum-soft text-quantum" : "border-night-edge text-night-ink-soft"}`}><span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-quantum" : "bg-night-ink-faint"}`} aria-hidden="true" /> {isLive ? "API live" : error ? "API unavailable" : "Checking API…"}<ClockIcon className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></span></div>
        <dl className="mt-10 grid border-y border-night-edge sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => <div key={stat.label} className={`py-7 sm:px-6 lg:py-8 ${index % 2 === 1 ? "border-t border-night-edge sm:border-l sm:border-t-0 lg:border-t-0" : ""} ${index > 1 ? "lg:border-l" : ""}`}><dt className="flex items-center gap-2 text-label font-semibold uppercase tracking-[0.2em] text-night-ink-soft"><stat.icon className="h-3.5 w-3.5 text-night-ink-soft" aria-hidden="true" /> {stat.label}</dt><dd className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-night-ink tabular-nums">{stat.value}</dd><dd className="mt-2 max-w-[14rem] text-xs leading-5 text-night-ink-soft">{stat.sub}</dd></div>)}
        </dl>
        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-xs text-night-ink-soft"><Link href="/scanner" className="inline-flex items-center gap-2 transition hover:text-night-ink"><ChartBarIcon className="h-3.5 w-3.5 text-quantum" aria-hidden="true" /> Run a scan</Link><Link href="/v" className="inline-flex items-center gap-2 transition hover:text-night-ink"><ShieldCheckIcon className="h-3.5 w-3.5 text-quantum" aria-hidden="true" /> Verify an asset</Link><span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-quantum" aria-hidden="true" /> Same-origin API proxy</span></div>
      </div>
    </section>
  );
}

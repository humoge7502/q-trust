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

export function StatsTicker() {
  return <div className="overflow-hidden border-y border-white/10 bg-white/[0.03] py-3 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">{CHAIN.name} · ID {CHAIN.id} <span className="mx-3 text-cyan-300">●</span> Public verification layer · Hash-only on-chain</div>;
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
    <section className="border-y border-white/10 bg-slate-950 text-white" aria-labelledby="stats-heading">
      <StatsTicker />
      <div className="mx-auto max-w-[88rem] px-5 py-12 sm:px-8 sm:py-16 lg:px-12">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="stats-heading" className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300">The system, in public</h2><p className="mt-3 text-sm text-slate-400">Signals that make the protocol inspectable before it is trusted.</p></div><span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${isLive ? "border-emerald-300/20 text-emerald-300" : "border-white/15 text-slate-400"}`}><span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-300" : "bg-slate-500"}`} aria-hidden="true" /> {isLive ? "API live" : error ? "API unavailable" : "Checking API…"}<ClockIcon className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></span></div>
        <dl className="mt-10 grid border-y border-white/15 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => <div key={stat.label} className={`py-7 sm:px-6 lg:py-8 ${index % 2 === 1 ? "border-t border-white/15 sm:border-l sm:border-t-0 lg:border-t-0" : ""} ${index > 1 ? "lg:border-l" : ""}`}><dt className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500"><stat.icon className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> {stat.label}</dt><dd className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white tabular-nums">{stat.value}</dd><dd className="mt-2 max-w-[14rem] text-xs leading-5 text-slate-500">{stat.sub}</dd></div>)}
        </dl>
        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-xs text-slate-500"><Link href="/scanner" className="inline-flex items-center gap-2 transition hover:text-white"><ChartBarIcon className="h-3.5 w-3.5 text-violet-300" aria-hidden="true" /> Run a scan</Link><Link href="/v" className="inline-flex items-center gap-2 transition hover:text-white"><ShieldCheckIcon className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Verify an asset</Link><span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" /> Same-origin API proxy</span></div>
      </div>
    </section>
  );
}

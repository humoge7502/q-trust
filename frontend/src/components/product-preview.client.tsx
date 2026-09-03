"use client";

import { useState } from "react";
import { ChartBarIcon, CheckBadgeIcon, CpuChipIcon, ShieldCheckIcon } from "@/app/icons";

type ViewId = "inventory" | "risk" | "attestation";

const views: Array<{ id: ViewId; label: string; eyebrow: string; title: string; copy: string }> = [
  { id: "inventory", label: "Inventory", eyebrow: "01 / Discover", title: "Every algorithm, mapped.", copy: "See the cryptographic estate as a living system instead of a one-time spreadsheet." },
  { id: "risk", label: "Risk engine", eyebrow: "02 / Prioritize", title: "Every exposure, ranked.", copy: "Turn algorithm, location, reachability, and sensitivity into a migration order your team can act on." },
  { id: "attestation", label: "Attestation", eyebrow: "03 / Prove", title: "Every milestone, signed.", copy: "Make progress portable with evidence that can be verified by customers, vendors, and auditors." },
];

const rows = [
  { name: "api-gateway / tls", algo: "RSA-2048", score: "87", status: "Migrate", tone: "risk" },
  { name: "payments / signing", algo: "ECDSA P-256", score: "74", status: "Prioritize", tone: "warn" },
  { name: "mobile / key exchange", algo: "ML-KEM-768", score: "12", status: "Ready", tone: "good" },
];

export function ProductPreview() {
  const [active, setActive] = useState<ViewId>("inventory");
  const current = views.find((view) => view.id === active) ?? views[0];

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.14)]">
      <div className="flex flex-col border-b border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" /><span className="text-xs font-semibold text-slate-700">Q-Trust workspace</span><span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500">Preview</span></div>
        <div className="mt-3 flex gap-1 rounded-lg bg-slate-200/70 p-1 sm:mt-0" role="tablist" aria-label="Product preview views">
          {views.map((view) => <button key={view.id} type="button" role="tab" aria-selected={active === view.id} onClick={() => setActive(view.id)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${active === view.id ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{view.label}</button>)}
        </div>
      </div>

      <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
        <div className="border-b border-slate-200 p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-700">{current.eyebrow}</div>
          <h3 className="mt-5 text-3xl font-semibold leading-[0.95] tracking-[-0.055em] text-slate-950 sm:text-4xl">{current.title}</h3>
          <p className="mt-5 text-sm leading-6 text-slate-600">{current.copy}</p>
          <div className="mt-9 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-cyan-300"><ShieldCheckIcon className="h-5 w-5" aria-hidden="true" /></span><div><div className="text-xs font-semibold text-slate-900">One source of truth</div><div className="mt-1 text-[11px] text-slate-500">Updated from your latest scan</div></div></div>
        </div>

        <div className="bg-[#0c1424] p-5 text-white sm:p-7 lg:p-10">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-slate-500"><span>Organization / acme-finance</span><span className="text-emerald-300">● synced 2m ago</span></div>
          {active === "inventory" ? <InventoryView /> : active === "risk" ? <RiskView /> : <AttestationView />}
        </div>
      </div>
    </div>
  );
}

function InventoryView() {
  return <div className="mt-8"><div className="grid grid-cols-3 gap-2 sm:gap-3">{[{ label: "Assets", value: "284" }, { label: "At risk", value: "39" }, { label: "PQC ready", value: "68%" }].map((item) => <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.05] p-3 sm:p-4"><div className="text-[10px] text-slate-500">{item.label}</div><div className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{item.value}</div></div>)}</div><div className="mt-8 space-y-3">{rows.map((row) => <div key={row.name} className="flex items-center gap-3 border-b border-white/10 pb-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10"><CpuChipIcon className="h-4 w-4 text-cyan-300" aria-hidden="true" /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-white">{row.name}</div><div className="mt-1 text-[10px] text-slate-500">{row.algo}</div></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${row.tone === "risk" ? "bg-rose-300/10 text-rose-200" : row.tone === "warn" ? "bg-amber-300/10 text-amber-200" : "bg-emerald-300/10 text-emerald-200"}`}>{row.status}</span></div>)}</div></div>;
}

function RiskView() {
  return <div className="mt-8"><div className="flex items-end justify-between"><div><div className="text-5xl font-semibold tracking-[-0.06em] text-white">39</div><div className="mt-1 text-xs text-slate-500">assets need attention</div></div><div className="text-right"><div className="text-sm font-semibold text-rose-200">High exposure</div><div className="mt-1 text-[10px] text-slate-500">risk model v3.2</div></div></div><div className="mt-8 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[68%] rounded-full bg-gradient-to-r from-rose-300 via-violet-300 to-cyan-300" /></div><div className="mt-3 flex justify-between text-[10px] text-slate-500"><span>Legacy crypto</span><span>Migration ready</span></div><div className="mt-8 grid grid-cols-3 gap-3">{[{ label: "Critical", value: "08", tone: "text-rose-200" }, { label: "High", value: "17", tone: "text-amber-200" }, { label: "Medium", value: "14", tone: "text-violet-200" }].map((item) => <div key={item.label} className="border-l border-white/15 pl-3"><div className={`text-2xl font-semibold ${item.tone}`}>{item.value}</div><div className="mt-1 text-[10px] text-slate-500">{item.label}</div></div>)}</div></div>;
}

function AttestationView() {
  return <div className="mt-8"><div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-emerald-200"><CheckBadgeIcon className="h-4 w-4" aria-hidden="true" /> Attestation verified</div><div className="mt-3 break-all font-mono text-[10px] leading-5 text-emerald-100/70">0x7b52d7b29272207cab6c061ee4e58141…</div></div><div className="mt-5 space-y-3">{[{ label: "Evidence hash", value: "SHA-256 / anchored" }, { label: "Network", value: "Base Sepolia" }, { label: "Last migration", value: "2 days ago" }].map((item) => <div key={item.label} className="flex items-center justify-between border-b border-white/10 pb-3 text-xs"><span className="text-slate-500">{item.label}</span><span className="font-medium text-slate-200">{item.value}</span></div>)}</div><div className="mt-7 flex items-center gap-2 text-[11px] font-semibold text-cyan-300"><ChartBarIcon className="h-4 w-4" aria-hidden="true" /> Publicly verifiable record</div></div>;
}

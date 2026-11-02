"use client";

/**
 * Marketing-side product mock: the Q-Trust workspace rendered as a static
 * three-view preview (inventory / risk / attestation) with interactive tabs.
 *
 * Styling contract (Stage 7b): the light chrome sits on the app-layer canvas
 * tokens (`bg-canvas-raised`, `border-border`, `text-foreground`); the dark
 * data pane is the night family (`bg-night`, `border-night-edge`,
 * `text-night-ink*`) with the single `quantum` accent. Status chips use the
 * measured light state triplets (the `StatusPill` vocabulary) so the same
 * state is the same colour everywhere; on the dark pane they read as inverted
 * badges. No raw palette utilities.
 */

import { useState } from "react";
import { ChartBarIcon, CheckBadgeIcon, CpuChipIcon, ShieldCheckIcon } from "@/app/icons";

type ViewId = "inventory" | "risk" | "attestation";

const views: Array<{ id: ViewId; label: string; eyebrow: string; title: string; copy: string }> = [
  { id: "inventory", label: "Inventory", eyebrow: "01 / Discover", title: "Every algorithm, mapped.", copy: "See the cryptographic estate as a living system instead of a one-time spreadsheet." },
  { id: "risk", label: "Risk engine", eyebrow: "02 / Prioritize", title: "Every exposure, ranked.", copy: "Turn algorithm, location, reachability, and sensitivity into a migration order your team can act on." },
  { id: "attestation", label: "Attestation", eyebrow: "03 / Prove", title: "Every milestone, signed.", copy: "Make progress portable with evidence that can be verified by customers, vendors, and auditors." },
];

const rows = [
  { name: "api-gateway / tls", algo: "RSA-2048", score: "87", status: "Migrate", tone: "bg-danger-surface text-danger" },
  { name: "payments / signing", algo: "ECDSA P-256", score: "74", status: "Prioritize", tone: "bg-warning-surface text-warning" },
  { name: "mobile / key exchange", algo: "ML-KEM-768", score: "12", status: "Ready", tone: "bg-success-surface text-success" },
];

export function ProductPreview() {
  const [active, setActive] = useState<ViewId>("inventory");
  const current = views.find((view) => view.id === active) ?? views[0];

  return (
    <div data-ui className="relative overflow-hidden rounded-[1.75rem] border border-border bg-canvas-raised shadow-[0_25px_80px_rgba(15,23,42,0.14)]">
      <div className="flex flex-col border-b border-border bg-canvas px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" /><span className="text-xs font-semibold text-muted-foreground">Q-Trust workspace</span><span className="rounded-full bg-muted px-2 py-0.5 text-label font-medium text-muted-foreground">Preview · sample data</span></div>
        <div className="mt-3 flex gap-1 rounded-lg bg-muted p-1 sm:mt-0" role="tablist" aria-label="Product preview views">
          {views.map((view) => <button key={view.id} type="button" role="tab" aria-selected={active === view.id} onClick={() => setActive(view.id)} className={`rounded-md px-3 py-1.5 text-micro font-semibold transition ${active === view.id ? "bg-canvas-raised text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{view.label}</button>)}
        </div>
      </div>

      <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
        <div className="border-b border-border p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
          <div className="text-label font-bold uppercase tracking-[0.24em] text-qtrust-600">{current.eyebrow}</div>
          <h3 className="mt-5 font-display text-3xl font-semibold leading-[0.95] tracking-[-0.055em] text-foreground sm:text-4xl">{current.title}</h3>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">{current.copy}</p>
          <div className="mt-9 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-night text-quantum"><ShieldCheckIcon className="h-5 w-5" aria-hidden="true" /></span><div><div className="text-xs font-semibold text-foreground">One source of truth</div><div className="mt-1 text-micro text-muted-foreground">Updated from your latest scan</div></div></div>
        </div>

        <div className="bg-night p-5 text-night-ink sm:p-7 lg:p-10">
          <div className="flex items-center justify-between text-label uppercase tracking-[0.2em] text-night-ink-soft"><span>Organization / acme-finance</span><span className="text-quantum">● synced 2m ago</span></div>
          {active === "inventory" ? <InventoryView /> : active === "risk" ? <RiskView /> : <AttestationView />}
        </div>
      </div>
    </div>
  );
}

function InventoryView() {
  return <div className="mt-8"><div className="grid grid-cols-3 gap-2 sm:gap-3">{[{ label: "Assets", value: "284" }, { label: "At risk", value: "39" }, { label: "PQC ready", value: "68%" }].map((item) => <div key={item.label} className="rounded-xl border border-night-edge bg-night-raised p-3 sm:p-4"><div className="text-label text-night-ink-soft">{item.label}</div><div className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{item.value}</div></div>)}</div><div className="mt-8 space-y-3">{rows.map((row) => <div key={row.name} className="flex items-center gap-3 border-b border-night-edge pb-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-night-raised"><CpuChipIcon className="h-4 w-4 text-quantum" aria-hidden="true" /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-night-ink">{row.name}</div><div className="mt-1 text-label text-night-ink-soft">{row.algo}</div></div><span className={`rounded-full px-2 py-1 text-label font-semibold ${row.tone}`}>{row.status}</span></div>)}</div></div>;
}

function RiskView() {
  return <div className="mt-8"><div className="flex items-end justify-between"><div><div className="text-5xl font-semibold tracking-[-0.06em] text-night-ink">39</div><div className="mt-1 text-xs text-night-ink-soft">assets need attention</div></div><div className="text-right"><div className="text-sm font-semibold text-night-ink-soft">High exposure</div><div className="mt-1 text-label text-night-ink-soft">risk model v3.2</div></div></div><div className="mt-8 h-3 overflow-hidden rounded-full bg-night-raised"><div className="h-full w-[68%] rounded-full bg-gradient-to-r from-quantum-soft to-quantum" /></div><div className="mt-3 flex justify-between text-label text-night-ink-soft"><span>Legacy crypto</span><span>Migration ready</span></div><div className="mt-8 grid grid-cols-3 gap-3">{[{ label: "Critical", value: "08" }, { label: "High", value: "17" }, { label: "Medium", value: "14" }].map((item) => <div key={item.label} className="border-l border-night-edge pl-3"><div className="text-2xl font-semibold text-night-ink">{item.value}</div><div className="mt-1 text-label text-night-ink-soft">{item.label}</div></div>)}</div></div>;
}

function AttestationView() {
  return <div className="mt-8"><div className="rounded-xl border border-success-border bg-success-surface p-4"><div className="flex items-center gap-2 text-xs font-semibold text-success"><CheckBadgeIcon className="h-4 w-4" aria-hidden="true" /> Attestation verified</div><div className="mt-3 break-all font-mono text-label leading-5 text-success/80">0x7b52d7b29272207cab6c061ee4e58141…</div></div><div className="mt-5 space-y-3">{[{ label: "Evidence hash", value: "SHA-256 / anchored" }, { label: "Network", value: "Base Sepolia" }, { label: "Last migration", value: "2 days ago" }].map((item) => <div key={item.label} className="flex items-center justify-between border-b border-night-edge pb-3 text-xs"><span className="text-night-ink-soft">{item.label}</span><span className="font-medium text-night-ink-soft">{item.value}</span></div>)}</div><div className="mt-7 flex items-center gap-2 text-micro font-semibold text-quantum"><ChartBarIcon className="h-4 w-4" aria-hidden="true" /> Publicly verifiable record</div></div>;
}

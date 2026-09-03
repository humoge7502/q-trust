import Link from "next/link";
import { API_DOCS_URL } from "@/lib/api";
import { CHAIN } from "@/lib/config";
import {
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  BeakerIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  CpuChipIcon,
  DocumentCheckIcon,
  ShieldCheckIcon,
} from "@/app/icons";
import { ProductPreview } from "@/components/product-preview.client";
import { Reveal, ScrollProgress } from "@/components/scroll-effects.client";
import { SiteHeader } from "@/components/site-header.client";
import { VerifyBox } from "@/components/verify-box.client";
import { PublicStatsClient } from "@/components/stats-panel.client";

const explorerUrl = CHAIN.blockExplorers?.default?.url ?? "https://sepolia.basescan.org";

function SkipLink() {
  return <a href="#main-content" className="skip-link sr-only z-[100] rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline-none focus:ring-2 focus:ring-white">Skip to content</a>;
}

function Hero() {
  return (
    <section className="qtrust-hero relative overflow-hidden border-b border-white/10" aria-labelledby="hero-heading">
      <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="hero-orb hero-orb-one pointer-events-none absolute -left-40 top-0 h-[38rem] w-[38rem] rounded-full" aria-hidden="true" />
      <div className="hero-orb hero-orb-two pointer-events-none absolute -right-48 top-24 h-[30rem] w-[30rem] rounded-full" aria-hidden="true" />
      <div className="relative mx-auto max-w-[88rem] px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:px-12 lg:pb-28 lg:pt-28">
        <div className="grid items-end gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(25rem,0.75fr)] lg:gap-20">
          <div className="hero-enter">
            <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300"><span className="h-px w-10 bg-cyan-300" aria-hidden="true" /> Q-Trust protocol / 02.0</div>
            <h1 id="hero-heading" className="mt-8 max-w-5xl text-[clamp(3.5rem,8.6vw,8.8rem)] font-semibold leading-[0.86] tracking-[-0.075em] text-white">Make trust<br /><span className="text-cyan-300">verifiable.</span></h1>
            <p className="mt-9 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">The cryptographic migration layer for teams that need evidence, not promises. Discover vulnerable algorithms, prioritize the move to PQC, and anchor every milestone on-chain.</p>
            <div className="mt-9 flex flex-wrap items-center gap-3"><Link href="/dashboard" className="group inline-flex items-center gap-3 rounded-full bg-cyan-300 px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950">Start a migration <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" /></Link><Link href="#why" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200">See how it works</Link></div>
            <div className="mt-12 flex flex-wrap items-center gap-x-7 gap-y-3 text-xs text-slate-400"><span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" /> Base L2 ready</span><span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" /> Hash-only on-chain</span><span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-violet-400" aria-hidden="true" /> Open verification</span></div>
          </div>
          <div className="hero-enter hero-enter-delay lg:pb-3"><VerifyBox /><div className="mt-4 flex items-center justify-between px-1 text-[11px] uppercase tracking-[0.16em] text-slate-500"><span>Live verification surface</span><span>{CHAIN.name} / {CHAIN.id}</span></div></div>
        </div>
        <div className="mt-20 grid gap-4 border-t border-white/15 pt-5 text-xs text-slate-400 sm:grid-cols-3 lg:mt-24"><div><span className="text-slate-600">01</span><span className="ml-4">Scan the estate</span></div><div><span className="text-slate-600">02</span><span className="ml-4">Score the exposure</span></div><div><span className="text-slate-600">03</span><span className="ml-4">Attest the progress</span></div></div>
      </div>
    </section>
  );
}

function SignalStrip() {
  const signals = ["NIST FIPS 203 / 204 / 205", "CycloneDX CBOM", "EIP-712 gasless", "Base L2", "ML-KEM / ML-DSA / SLH-DSA", "Public verification"];
  return <div className="overflow-hidden border-b border-white/10 bg-slate-900 py-4" aria-label="Q-Trust capabilities"><div className="signal-track flex min-w-max items-center gap-8 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">{[...signals, ...signals].map((signal, index) => <span key={`${signal}-${index}`} className="inline-flex items-center gap-8"><span className="text-cyan-300">✳</span>{signal}</span>)}</div></div>;
}

function WhySection() {
  const reasons = [
    { number: "01", title: "Inventory the invisible", copy: "Find cryptography wherever it hides: source code, packages, binaries, network endpoints, and configuration.", icon: BeakerIcon },
    { number: "02", title: "Make risk actionable", copy: "Move beyond a scary report. Rank assets by algorithm, reachability, sensitivity, and migration impact.", icon: ChartBarIcon },
    { number: "03", title: "Carry proof forward", copy: "Give security, vendors, procurement, and auditors the same record without exposing the underlying evidence.", icon: ShieldCheckIcon },
  ];
  return (
    <section id="why" className="bg-[#f4f5f2] text-slate-950" aria-labelledby="why-heading">
      <div className="mx-auto max-w-[88rem] px-5 py-20 sm:px-8 sm:py-28 lg:px-12 lg:py-36">
        <div className="grid gap-14 lg:grid-cols-[0.62fr_1.38fr] lg:gap-24">
          <Reveal><div className="lg:sticky lg:top-28"><p className="text-[11px] font-bold uppercase tracking-[0.28em] text-slate-500">Why Q-Trust</p><h2 id="why-heading" className="mt-6 max-w-md text-4xl font-semibold leading-[0.93] tracking-[-0.06em] sm:text-6xl">The hard part isn’t quantum. It’s coordination.</h2><p className="mt-7 max-w-md text-sm leading-7 text-slate-600">A migration program is only as credible as the chain of evidence behind it. Q-Trust makes every handoff observable, comparable, and independently checkable.</p><Link href="/scanner" className="mt-9 inline-flex items-center gap-2 text-sm font-semibold underline decoration-slate-300 underline-offset-8 transition hover:decoration-slate-950">See the scanner <ArrowRightIcon className="h-4 w-4" aria-hidden="true" /></Link></div></Reveal>
          <div className="grid gap-3 sm:grid-cols-3">{reasons.map((reason, index) => <Reveal key={reason.number} delay={index * 100}><article className="group flex min-h-[23rem] flex-col justify-between border-t border-slate-300 pt-5 transition hover:border-slate-950"><div><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-400">{reason.number}</span><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-950 shadow-sm transition group-hover:-translate-y-1 group-hover:bg-slate-950 group-hover:text-cyan-300"><reason.icon className="h-5 w-5" aria-hidden="true" /></span></div><h3 className="mt-16 text-2xl font-semibold tracking-[-0.045em]">{reason.title}</h3><p className="mt-4 text-sm leading-6 text-slate-600">{reason.copy}</p></div><div><div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 transition group-hover:text-slate-950">Outcome / visible by design</div><span className="block h-px w-10 bg-slate-300 transition-all duration-500 group-hover:w-full group-hover:bg-slate-950" aria-hidden="true" /></div></article></Reveal>)}</div>
        </div>
      </div>
    </section>
  );
}

function ProductSection() {
  return <section id="product" className="bg-[#f4f5f2] px-5 pb-20 sm:px-8 sm:pb-28 lg:px-12 lg:pb-36" aria-labelledby="product-heading"><div className="mx-auto max-w-[88rem]"><Reveal><div className="mb-10 flex flex-col justify-between gap-5 border-t border-slate-300 pt-6 sm:flex-row sm:items-end"><div><p className="text-[11px] font-bold uppercase tracking-[0.28em] text-slate-500">Inside the workspace</p><h2 id="product-heading" className="mt-5 max-w-xl text-4xl font-semibold leading-[0.94] tracking-[-0.06em] sm:text-6xl">One system for the whole migration.</h2></div><p className="max-w-sm text-sm leading-6 text-slate-600">Explore the same surface your security team, engineering team, and auditors use to move from discovery to proof.</p></div></Reveal><Reveal delay={100}><ProductPreview /></Reveal></div></section>;
}

function WorkflowSection() {
  const steps = [
    { number: "01", label: "Scan", title: "See what you actually run.", copy: "Collect a cryptographic inventory from code, dependencies, endpoints, binaries, and configs. Export CycloneDX or SARIF for the tools you already use.", meta: "12+ source languages / 10+ manifest formats", icon: BeakerIcon },
    { number: "02", label: "Plan", title: "Turn exposure into a sequence.", copy: "Score the estate against migration policy, compliance frameworks, and business context. Get an ordered plan instead of another undifferentiated list.", meta: "NIST / CNSA / GNN-ranked", icon: CpuChipIcon },
    { number: "03", label: "Attest", title: "Make progress portable.", copy: "Anchor evidence hashes, migration steps, and vendor claims to Base. Anyone with the asset ID can independently verify the record.", meta: "EIP-712 / UUPS / hash-only", icon: ShieldCheckIcon },
  ];
  return <section id="workflow" className="bg-slate-950 text-white" aria-labelledby="workflow-heading"><div className="mx-auto max-w-[88rem] px-5 py-20 sm:px-8 sm:py-28 lg:px-12 lg:py-36"><Reveal><div className="max-w-2xl"><p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300">The operating loop</p><h2 id="workflow-heading" className="mt-6 text-4xl font-semibold leading-[0.93] tracking-[-0.06em] sm:text-6xl">Less theatre.<br /><span className="text-slate-500">More traceability.</span></h2></div></Reveal><div className="relative mt-16"><div className="absolute left-[1.05rem] top-8 hidden h-[calc(100%-4rem)] w-px bg-gradient-to-b from-cyan-300 via-violet-300 to-emerald-300 opacity-50 lg:block" aria-hidden="true" />{steps.map((step, index) => <Reveal key={step.number} delay={index * 100}><article className="relative grid gap-7 border-t border-white/15 py-9 lg:grid-cols-[7rem_1fr_0.9fr] lg:gap-10 lg:py-12"><div className="flex items-start gap-5 lg:block"><div className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border border-cyan-300/50 bg-slate-950 text-[10px] font-bold text-cyan-300">{step.number}</div><div className="mt-1 hidden text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600 lg:block">{step.label}</div></div><div><div className="flex items-center gap-3"><step.icon className="h-5 w-5 text-cyan-300" aria-hidden="true" /><h3 className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{step.title}</h3></div><p className="mt-4 max-w-xl text-sm leading-7 text-slate-400">{step.copy}</p></div><div className="flex items-end justify-between gap-5 border-l border-white/10 pl-5 lg:flex-col lg:justify-center"><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{step.meta}</div><span className="text-xs font-semibold text-cyan-300">0{index + 1} / 03</span></div></article></Reveal>)}</div></div></section>;
}

function ProofSection() {
  return <section className="bg-cyan-300 text-slate-950" aria-labelledby="proof-heading"><div className="mx-auto max-w-[88rem] px-5 py-20 sm:px-8 sm:py-28 lg:px-12 lg:py-36"><div className="grid gap-12 lg:grid-cols-[1fr_0.8fr] lg:items-end"><Reveal><div><p className="text-[11px] font-bold uppercase tracking-[0.28em] text-slate-700">Proof, by design</p><h2 id="proof-heading" className="mt-6 max-w-3xl text-5xl font-semibold leading-[0.88] tracking-[-0.07em] sm:text-7xl">A migration record that can leave the room.</h2></div></Reveal><Reveal delay={100}><p className="max-w-md text-sm leading-7 text-slate-700">Full evidence stays private or on IPFS. Q-Trust anchors only the minimum required to establish integrity: hashes, timestamps, identities, and references.</p></Reveal></div><Reveal delay={150}><div className="mt-16 grid border-y border-slate-950/20 sm:grid-cols-3">{[{ label: "Registry contracts", value: "11", copy: "Shared state for assets, vendors, migrations, and audits." }, { label: "Scanner coverage", value: "12+", copy: "Source languages plus manifests, binaries, network, and config." }, { label: "Verification mode", value: "Open", copy: "No wallet or platform account needed to inspect a record." }].map((item, index) => <div key={item.label} className={`py-8 sm:px-6 lg:py-10 ${index > 0 ? "border-t border-slate-950/20 sm:border-l sm:border-t-0" : ""}`}><div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-600">{item.label}</div><div className="mt-5 text-5xl font-semibold tracking-[-0.06em]">{item.value}</div><p className="mt-4 max-w-xs text-sm leading-6 text-slate-700">{item.copy}</p></div>)}</div></Reveal><Reveal delay={200}><div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4 text-xs font-semibold text-slate-700"><span className="inline-flex items-center gap-2"><CheckBadgeIcon className="h-4 w-4" aria-hidden="true" /> EIP-712 gasless attestations</span><span className="inline-flex items-center gap-2"><CheckBadgeIcon className="h-4 w-4" aria-hidden="true" /> UUPS + timelock governance</span><span className="inline-flex items-center gap-2"><CheckBadgeIcon className="h-4 w-4" aria-hidden="true" /> CycloneDX + SARIF exports</span></div></Reveal></div></section>;
}

function ClosingSection() {
  return <section className="bg-[#f4f5f2] text-slate-950" aria-labelledby="closing-heading"><div className="mx-auto max-w-[88rem] px-5 py-24 sm:px-8 sm:py-36 lg:px-12"><Reveal><div className="flex flex-col justify-between gap-10 border-t border-slate-300 pt-7 lg:flex-row lg:items-end"><div><p className="text-[11px] font-bold uppercase tracking-[0.28em] text-slate-500">Ready when you are</p><h2 id="closing-heading" className="mt-6 max-w-4xl text-5xl font-semibold leading-[0.88] tracking-[-0.07em] sm:text-8xl">Start with what<br /><span className="text-cyan-700">you can prove.</span></h2></div><div className="flex flex-wrap gap-3 lg:pb-2"><Link href="/dashboard" className="group inline-flex items-center gap-3 rounded-full bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950">Launch Q-Trust <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" /></Link><Link href="/scanner" className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-6 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950">Run a scan</Link></div></div></Reveal></div></section>;
}

function Footer() {
  return <footer className="bg-slate-950 text-slate-400"><div className="mx-auto flex max-w-[88rem] flex-col gap-7 px-5 py-8 text-xs sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300 text-[11px] font-bold tracking-widest text-slate-950">QT</span><span className="font-semibold text-white">Q-Trust</span><span className="text-slate-600">/</span><span>PQC migration assurance on Base L2</span></div><nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3"><Link href="/scanner" className="transition hover:text-white">Scanner</Link><Link href="/dashboard" className="transition hover:text-white">Dashboard</Link><Link href="/vendors" className="transition hover:text-white">Vendors</Link><Link href="/v" className="transition hover:text-white">Verify</Link><a href={`${API_DOCS_URL.replace(/\/$/, "")}/docs`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition hover:text-white">API <ArrowTopRightOnSquareIcon className="h-3 w-3" aria-hidden="true" /></a><a href={explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition hover:text-white">Explorer <ArrowTopRightOnSquareIcon className="h-3 w-3" aria-hidden="true" /></a></nav></div></footer>;
}

export default function HomePage() {
  return <div className="min-h-screen bg-slate-950 text-white antialiased"><SkipLink /><ScrollProgress /><SiteHeader /><main id="main-content"><Hero /><SignalStrip /><WhySection /><ProductSection /><WorkflowSection /><ProofSection /><PublicStatsClient /><ClosingSection /></main><Footer /></div>;
}

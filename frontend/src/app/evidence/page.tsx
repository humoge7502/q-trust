import type { Metadata } from "next";
import Link from "next/link";

import { DeadlineCountdown } from "@/components/deadline-countdown";
import { Reveal, ScrollProgress } from "@/components/scroll-effects.client";
import { ArrowRightIcon, BeakerIcon, DocumentCheckIcon, ShieldCheckIcon } from "@/app/icons";

export const metadata: Metadata = {
  title: "Evidence for the PQC mandate — OMB M-26-15 mapped to Q-Trust — Q-Trust",
  description:
    "OMB M-26-15 requires federal agencies to maintain cryptographic inventories and submit phased migration plans with evidence. Q-Trust produces exactly that: CBOM inventories, outcome-ordered plans, and publicly verifiable on-chain attestations.",
};

/**
 * The regulatory-wedge page (Persuade mode, PRODUCT.md).
 *
 * Every requirement statement is a paraphrase of the published guidance —
 * no invented quotes, no invented numbers (DESIGN.md craft floor, rule 7).
 * Planning claims carry their simulation framing (E-09); evidence claims
 * point at the public verification surface.
 */

const REQUIREMENTS = [
  {
    icon: BeakerIcon,
    requirement: "Maintain a cryptographic inventory",
    copy: "Agencies must know every algorithm, key, and certificate they run — and keep that inventory current.",
    answer: "The inspector produces a CycloneDX 1.7 CBOM from TLS, SSH, source, manifests, and binaries — one command, no account, and a GitHub Action for continuous inventory in CI.",
    proof: "pip install qtrust-inspector · cbom-action · CycloneDX + SARIF exports",
  },
  {
    icon: DocumentCheckIcon,
    requirement: "Prioritize the highest-risk assets",
    copy: "Scarce migration capacity goes to the assets whose exposure is largest and whose data lives longest.",
    answer: "The risk engine scores every asset against NIST and CNSA 2.0 timelines; the outcome-based planner orders the queue by measured quantum-risk-days, not by guesswork.",
    proof: "42-estate leave-one-out: the learned ordering reaches the simulation optimum (ratio 1.0000 vs 1.0473 for the priority formula, Wilcoxon p = 1.7×10⁻⁸ — experiment E-09, simulation-grounded)",
  },
  {
    icon: ShieldCheckIcon,
    requirement: "Submit phased migration plans with evidence",
    copy: "A plan on letterhead is a claim. The memo's deliverable is a plan you can substantiate.",
    answer: "Every scan, migration step, and vendor claim is hash-anchored on Base L2 with EIP-712 signatures and Merkle-proof revocation — verifiable by your auditor with no wallet and no platform account.",
    proof: "11 UUPS registries · 7-day timelock governance · public verification at /v",
  },
];

export default function EvidencePage() {
  return (
    <div className="bg-slate-950 text-white">
      <ScrollProgress />
      <main>
        {/* Hero — the first screen answers what this is (craft floor, rule 6) */}
        <section className="qtrust-hero relative overflow-hidden border-b border-white/10" aria-labelledby="evidence-heading">
          <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative mx-auto max-w-[88rem] px-5 pb-16 pt-16 sm:px-8 sm:pt-24 lg:px-12 lg:pb-24 lg:pt-28">
            <div className="hero-enter max-w-4xl">
              <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">
                <span className="h-px w-10 bg-cyan-300" aria-hidden="true" />
                OMB M-26-15 · June 2026 · Evidence, not assurances
              </div>
              <h1
                id="evidence-heading"
                className="mt-8 text-[clamp(2.75rem,7.4vw,7rem)] font-semibold leading-[0.9] tracking-[-0.07em] text-white [overflow-wrap:anywhere]"
              >
                The mandate asks<br />
                <span className="text-cyan-300">for evidence.</span>
              </h1>
              <p className="mt-9 max-w-2xl text-lg leading-8 text-slate-300">
                Federal guidance now requires agencies to inventory their
                cryptography, prioritize the riskiest assets, and submit phased
                migration plans with evidence. Q-Trust produces all three —
                and the evidence is verifiable by anyone.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/scanner"
                  className="group inline-flex items-center gap-3 rounded-full bg-cyan-300 px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  Start an inventory
                  <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
                <Link
                  href="/v"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                >
                  See a verified record
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Requirement mapping — the substance */}
        <section id="requirements" className="bg-[#f4f5f2] px-5 py-20 text-slate-950 sm:px-8 sm:py-28 lg:px-12 lg:py-36" aria-labelledby="requirements-heading">
          <div className="mx-auto max-w-[88rem]">
            <Reveal>
              <div className="max-w-2xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
                  Three requirements, three deliverables
                </p>
                <h2 id="requirements-heading" className="mt-6 text-4xl font-semibold leading-[0.94] tracking-[-0.06em] sm:text-6xl">
                  What the guidance asks for.
                </h2>
              </div>
            </Reveal>
            <div className="mt-14 grid gap-3 lg:grid-cols-3">
              {REQUIREMENTS.map((item, index) => (
                <Reveal key={item.requirement} delay={index * 100}>
                  <article className="group flex min-h-[30rem] flex-col justify-between border-t border-slate-300 pt-5">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-white text-slate-950">
                          <item.icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                      </div>
                      <h3 className="mt-14 text-2xl font-semibold leading-tight tracking-[-0.045em]">
                        {item.requirement}
                      </h3>
                      <p className="mt-4 text-sm leading-6 text-slate-700">{item.copy}</p>
                    </div>
                    <div>
                      <p className="text-sm leading-7 text-slate-700">{item.answer}</p>
                      <p className="mt-4 border-t border-border pt-3 font-mono text-[11px] leading-5 text-muted-foreground">
                        {item.proof}
                      </p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
            <Reveal delay={120}>
              <p className="mt-10 max-w-3xl text-xs leading-6 text-muted-foreground">
                Requirements paraphrased from Executive Order and OMB M-26-15,
                “Execution of the Migration to Post-Quantum Cryptography”
                (June 2026), and NIST IR 8547 (initial public draft). Deadlines
                below are the published targets; the IR remains a draft and
                moves when finalized.
              </p>
            </Reveal>
          </div>
        </section>

        {/* The evidence chain + countdown — dark close */}
        <section className="bg-slate-950 px-5 py-20 sm:px-8 sm:py-28 lg:px-12 lg:py-36" aria-labelledby="chain-heading">
          <div className="mx-auto max-w-[88rem]">
            <Reveal>
              <div className="max-w-2xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300">
                  The evidence chain
                </p>
                <h2 id="chain-heading" className="mt-6 text-4xl font-semibold leading-[0.93] tracking-[-0.06em] sm:text-6xl">
                  Hash in. Proof out.
                </h2>
              </div>
            </Reveal>
            <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { step: "Scan", copy: "The inspector hashes the CBOM — raw evidence stays private." },
                { step: "Anchor", copy: "The hash, not the data, is signed EIP-712 and written to Base L2." },
                { step: "Attest", copy: "Migrations and vendor claims become on-chain records under timelock governance." },
                { step: "Verify", copy: "Any auditor checks the record at /v — no wallet, no account, no trust in us." },
              ].map((s, i) => (
                <Reveal key={s.step} delay={i * 80}>
                  <div className="h-full bg-slate-950 p-5">
                    <div className="font-mono text-label text-cyan-300">0{i + 1}</div>
                    <h3 className="mt-3 text-lg font-semibold tracking-[-0.03em]">{s.step}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{s.copy}</p>
                  </div>
                </Reveal>
              ))}
            </div>
            <Reveal delay={140}>
              <DeadlineCountdown />
            </Reveal>
            <Reveal delay={180}>
              <div className="mt-14 flex flex-wrap gap-3">
                <Link
                  href="/scanner"
                  className="group inline-flex items-center gap-3 rounded-full bg-cyan-300 px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                >
                  Produce your first deliverable
                  <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
    </div>
  );
}

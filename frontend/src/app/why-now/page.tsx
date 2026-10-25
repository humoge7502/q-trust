import type { Metadata } from "next";
import Link from "next/link";
import { Reveal, ScrollProgress } from "@/components/scroll-effects.client";
import { DeadlineCountdown } from "@/components/deadline-countdown";
import { VideoFrame } from "@/components/ui/video-frame";
import {
  ArrowRightIcon,
  BeakerIcon,
  CpuChipIcon,
  ShieldCheckIcon,
} from "@/app/icons";

export const metadata: Metadata = {
  title: "Why now: the quantum threat, honestly explained",
  description:
    "Harvest-now-decrypt-later, the NIST PQC standards, and the real deadline. Why the hard part of post-quantum migration isn't the math — it's the coordination.",
  alternates: { canonical: "/why-now" },
};

const TIMELINE = [
  {
    year: "2016",
    title: "The threat model is named",
    copy: "NIST frames “harvest now, decrypt later”: adversaries can steal encrypted data today and wait for a cryptographically relevant quantum computer (CRQC) to break it.",
  },
  {
    year: "2022",
    title: "Shor’s algorithm, restated",
    copy: "A CRQC running Shor’s algorithm would break RSA and elliptic-curve cryptography — the key establishment and signatures most of the internet still relies on.",
  },
  {
    year: "2024",
    title: "Standards land",
    copy: "NIST publishes FIPS 203 (ML-KEM), 204 (ML-DSA), and 205 (SLH-DSA) — the first standardized post-quantum algorithms.",
  },
  {
    year: "2024–2026",
    title: "Inventories become mandates",
    copy: "OMB M-23-08 required agencies to inventory cryptographic assets; OMB M-26-15 (June 2026) goes further — phased migration plans with evidence. The discovery-and-proof step most organizations have not done is now the deliverable.",
  },
  {
    year: "2030→",
    title: "The real deadline",
    copy: "CNSA 2.0 and national programs target the highest-priority systems first (2030–2035). The window to find and replace hidden keys is now, not at the deadline.",
  },
];

const STEPS = [
  {
    icon: BeakerIcon,
    title: "Find the cryptography",
    copy: "It hides in source, dependencies, binaries, network endpoints, and config — not just in a TLS certificate. You cannot migrate what you cannot see.",
  },
  {
    icon: CpuChipIcon,
    title: "Decide what matters",
    copy: "Not every RSA key is critical. Rank by algorithm, reachability, sensitivity, and migration impact so effort goes where exposure actually is.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Prove the move",
    copy: "Anchor evidence on-chain so the record survives the next audit, the next vendor, and the next reorganization — independently verifiable, no wallet required.",
  },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">
      {children}
    </p>
  );
}

export default function WhyNowPage() {
  return (
    <div className="bg-slate-950 text-white">
      <ScrollProgress />
      <main>
        {/* Hero */}
        <section
          className="relative overflow-hidden border-b border-white/10"
          aria-labelledby="why-heading"
        >
          <div
            className="hero-grid pointer-events-none absolute inset-0"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-[88rem] px-5 pb-16 pt-16 sm:px-8 sm:pt-24 lg:px-12 lg:pb-24 lg:pt-28">
            <Eyebrow>The quantum threat, honestly</Eyebrow>
            <h1
              id="why-heading"
              className="mt-6 max-w-4xl text-[clamp(2.6rem,6vw,5.6rem)] font-semibold leading-[0.9] tracking-[-0.06em] text-white"
            >
              Why now — and what <span className="text-cyan-300">actually breaks.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              The math is solved. The standards exist. The open problem is
              coordination: finding cryptography you forgot you shipped, deciding
              what to move first, and proving it happened. Here is the threat in
              plain terms — and why a spreadsheet will not close it.
            </p>
          </div>
        </section>

        {/* Explainer video */}
        <section className="bg-slate-950" aria-labelledby="explain-heading">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
            <Reveal>
              <div className="mb-8 flex flex-col justify-between gap-4 border-t border-white/15 pt-6 sm:flex-row sm:items-end">
                <h2
                  id="explain-heading"
                  className="max-w-xl text-3xl font-semibold tracking-[-0.05em] sm:text-4xl"
                >
                  Two minutes on what a quantum computer can — and cannot — do.
                </h2>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <VideoFrame
                src="/media/qtrust-explainer.mp4"
                title="The post-quantum threat, explained"
                className="aspect-video"
              >
                A short, non-technical explainer on harvest-now-decrypt-later and
                the migration window.
              </VideoFrame>
            </Reveal>
          </div>
        </section>

        {/* Harvest now, decrypt later */}
        <section
          className="border-t border-white/10 bg-[#f4f5f2] text-slate-950"
          aria-labelledby="harvest-heading"
        >
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
            <Reveal>
              <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
                    The core idea
                  </p>
                  <h2
                    id="harvest-heading"
                    className="mt-5 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl"
                  >
                    Harvest now, decrypt later.
                  </h2>
                </div>
                <div className="space-y-5 text-sm leading-7 text-slate-700">
                  <p>
                    Your most sensitive data — health records, state secrets,
                    intellectual property, and long-lived financial agreements —
                    is encrypted today with algorithms a quantum computer would
                    break. An adversary does not need a quantum computer to start.
                    They only need to copy the ciphertext and wait.
                  </p>
                  <p>
                    That means the exposure clock started before the threat was
                    real. Any data encrypted now that must stay secret for a
                    decade is already at risk, regardless of when a CRQC arrives.
                  </p>
                  <p className="rounded-xl border border-slate-300 bg-white p-5 text-slate-800">
                    The defense is not “wait for the deadline.” It is to find the
                    vulnerable cryptography, replace it with standardized
                    post-quantum algorithms, and keep evidence that you did.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Timeline */}
        <section className="bg-slate-950 text-white" aria-labelledby="timeline-heading">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
            <Reveal>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">
                The window
              </p>
              <h2
                id="timeline-heading"
                className="mt-5 max-w-2xl text-3xl font-semibold tracking-[-0.05em] sm:text-4xl"
              >
                It is not “someday.” It is a schedule.
              </h2>
            </Reveal>
            <Reveal delay={80}>
              <DeadlineCountdown />
            </Reveal>
            <div className="relative mt-14">
              <div
                className="absolute left-[1.05rem] top-8 hidden h-[calc(100%-4rem)] w-px bg-gradient-to-b from-cyan-300 via-violet-300 to-emerald-300 opacity-50 lg:block"
                aria-hidden="true"
              />
              <div className="space-y-3 lg:space-y-0">
                {TIMELINE.map((item, index) => (
                  <Reveal key={item.year} delay={index * 80}>
                    <article className="relative grid gap-5 border-t border-white/15 py-7 lg:grid-cols-[7rem_1fr] lg:gap-10 lg:py-9">
                      <div className="flex items-start gap-4 lg:block">
                        <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border border-cyan-300/50 bg-slate-950 text-[10px] font-bold text-cyan-300">
                          {index + 1}
                        </span>
                        <span className="mt-1 font-mono text-sm font-semibold text-cyan-300 lg:block">
                          {item.year}
                        </span>
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold tracking-[-0.03em] sm:text-2xl">
                          {item.title}
                        </h3>
                        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
                          {item.copy}
                        </p>
                      </div>
                    </article>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* What PQC protects + the coordination problem */}
        <section
          className="border-t border-white/10 bg-[#f4f5f2] text-slate-950"
          aria-labelledby="steps-heading"
        >
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
            <Reveal>
              <div className="mb-10 max-w-2xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
                  What actually has to happen
                </p>
                <h2
                  id="steps-heading"
                  className="mt-5 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl"
                >
                  The hard part was never the math.
                </h2>
              </div>
            </Reveal>
            <div className="grid gap-3 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <Reveal key={step.title} delay={index * 100}>
                  <article className="flex min-h-[22rem] flex-col justify-between border-t border-slate-300 pt-5">
                    <div>
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-white text-slate-950">
                        <step.icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <h3 className="mt-6 text-2xl font-semibold tracking-[-0.045em]">
                        {step.title}
                      </h3>
                      <p className="mt-4 text-sm leading-6 text-muted-foreground">
                        {step.copy}
                      </p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-slate-950 text-white" aria-labelledby="why-cta-heading">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12">
            <Reveal>
              <div className="flex flex-col justify-between gap-8 border-t border-white/15 pt-8 lg:flex-row lg:items-end">
                <h2
                  id="why-cta-heading"
                  className="max-w-3xl text-3xl font-semibold leading-[0.95] tracking-[-0.05em] sm:text-5xl"
                >
                  Start with what <span className="text-cyan-300">you can prove.</span>
                </h2>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/scanner"
                    className="group inline-flex items-center gap-3 rounded-full bg-cyan-300 px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                  >
                    Run a scan <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </Link>
                  <Link
                    href="/research"
                    className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/5"
                  >
                    Read our honest self-audit
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
    </div>
  );
}

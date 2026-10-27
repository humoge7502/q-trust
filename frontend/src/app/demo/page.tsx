import type { Metadata } from "next";
import Link from "next/link";
import { Reveal, ScrollProgress } from "@/components/scroll-effects.client";
import { VideoFrame } from "@/components/ui/video-frame";
import { ArrowRightIcon } from "@/app/icons";

export const metadata: Metadata = {
  title: "Product demo",
  description:
    "Watch Q-Trust scan a cryptographic estate, score quantum risk, assess compliance, and anchor evidence on-chain. A full narrated walkthrough plus a feature-by-feature tour.",
  alternates: { canonical: "/demo" },
};

const TOUR = [
  {
    src: "/media/02-scan.mp4",
    title: "Scan the estate",
    copy: "Collect a cryptographic inventory from source, dependencies, binaries, endpoints, and configs.",
  },
  {
    src: "/media/03-risk.mp4",
    title: "Quantum risk scores",
    copy: "Rank assets by algorithm, reachability, sensitivity, and migration impact — not just a scary list.",
  },
  {
    src: "/media/04-compliance.mp4",
    title: "Compliance assessment",
    copy: "Evaluate the estate against NIST SP 800-131A and CNSA 2.0, with a reason for every control.",
  },
  {
    src: "/media/05-roadmap.mp4",
    title: "Migration roadmap",
    copy: "Turn exposure into an ordered, business-aware sequence instead of another backlog.",
  },
  {
    src: "/media/01-verify.mp4",
    title: "Verify on-chain",
    copy: "Anchor evidence hashes to Base and let anyone verify the record — no wallet, no account.",
  },
  {
    src: "/media/06-wallet.mp4",
    title: "Org dashboard",
    copy: "One workspace for security, engineering, and auditors to move from discovery to proof.",
  },
  {
    src: "/media/07-vendors.mp4",
    title: "Vendor portal",
    copy: "Vendors publish product PQC support and back the claim with on-chain attestations.",
  },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">
      {children}
    </p>
  );
}

export default function DemoPage() {
  return (
    <div className="bg-slate-950 text-white">
      <ScrollProgress />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-white/10" aria-labelledby="demo-heading">
          <div
            className="hero-grid pointer-events-none absolute inset-0"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-[88rem] px-5 pb-16 pt-16 sm:px-8 sm:pt-24 lg:px-12 lg:pb-24 lg:pt-28">
            <Eyebrow>Product demo</Eyebrow>
            <h1
              id="demo-heading"
              className="mt-6 max-w-4xl text-[clamp(2.6rem,6vw,5.6rem)] font-semibold leading-[0.9] tracking-[-0.06em] text-white"
            >
              See Q-Trust run, <span className="text-cyan-300">end to end.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              A three-minute narrated walkthrough of the full loop — discovery,
              scoring, compliance, roadmap, and on-chain proof — followed by a
              feature-by-feature tour. No sign-up required to watch.
            </p>
          </div>
        </section>

        {/* Full walkthrough */}
        <section className="bg-slate-950" aria-labelledby="walkthrough-heading">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
            <Reveal>
              <div className="mb-8 flex flex-col justify-between gap-4 border-t border-white/15 pt-6 sm:flex-row sm:items-end">
                <div>
                  <Eyebrow>The full loop</Eyebrow>
                  <h2
                    id="walkthrough-heading"
                    className="mt-5 max-w-xl text-3xl font-semibold tracking-[-0.05em] sm:text-4xl"
                  >
                    From an invisible crypto estate to a verifiable record.
                  </h2>
                </div>
                <p className="max-w-sm text-sm leading-6 text-slate-400">
                  The same surface your security team, engineering, and auditors
                  use — shown in one continuous session.
                </p>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <VideoFrame
                src="/media/qtrust-demo.mp4"
                title="Q-Trust full product walkthrough"
                className="aspect-video"
              >
                Full narrated walkthrough — discovery → scoring → compliance →
                roadmap → on-chain attestation.
              </VideoFrame>
            </Reveal>
          </div>
        </section>

        {/* Feature tour */}
        <section className="border-t border-white/10 bg-[#f4f5f2] text-slate-950" aria-labelledby="tour-heading">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
            <Reveal>
              <div className="mb-10 max-w-2xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
                  Feature tour
                </p>
                <h2
                  id="tour-heading"
                  className="mt-5 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl"
                >
                  One system for the whole migration.
                </h2>
              </div>
            </Reveal>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {TOUR.map((clip, index) => (
                <Reveal key={clip.src} delay={index * 60}>
                  <article className="flex h-full flex-col">
                    <VideoFrame
                      src={clip.src}
                      title={clip.title}
                      className="aspect-video"
                    >
                      {clip.title}
                    </VideoFrame>
                    <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em]">
                      {clip.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {clip.copy}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-slate-950 text-white" aria-labelledby="demo-cta-heading">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12">
            <Reveal>
              <div className="flex flex-col justify-between gap-8 border-t border-white/15 pt-8 lg:flex-row lg:items-end">
                <h2
                  id="demo-cta-heading"
                  className="max-w-3xl text-3xl font-semibold leading-[0.95] tracking-[-0.05em] sm:text-5xl"
                >
                  Watch it once. <span className="text-slate-400">Then run it on your own estate.</span>
                </h2>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/scanner"
                    className="group inline-flex items-center gap-3 rounded-full bg-cyan-300 px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                  >
                    Run a scan <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </Link>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/5"
                  >
                    Launch app
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

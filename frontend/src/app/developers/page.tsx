import type { Metadata } from "next";
import Link from "next/link";
import { Reveal, ScrollProgress } from "@/components/scroll-effects.client";
import { CodeBlock } from "@/components/ui/code-block";
import { ArrowRightIcon, ArrowTopRightOnSquareIcon } from "@/app/icons";
import { API_DOCS_URL } from "@/lib/api";

export const metadata: Metadata = {
  title: "Developer quickstart",
  description:
    "A copyable quickstart for the Q-Trust public API: verify attestations, read asset records, and anchor your own migration evidence. Plus a concrete scenario walkthrough.",
  alternates: { canonical: "/developers" },
};

const API_BASE = "https://qtrust-backend.vercel.app/api";
const EXAMPLE_ASSET = "0x125fad1d7f435ea1dfeb014bdcbbbe0636fe7043b1e4e4ac90975768e3d1a349";
const EXAMPLE_ORG = "0xE610569aE0352DC3262419bb051a86145f52875c";

const QUICKSTART = `# 1. Is the service healthy? (no key required)
curl ${API_BASE}/v1/health

# 2. Read a public attestation record (no key required)
curl ${API_BASE}/v1/assets/${EXAMPLE_ASSET}

# 3. Verify an asset's on-chain status (no key required)
curl ${API_BASE}/v1/assets/${EXAMPLE_ASSET}/verify

# 4. Pull an organization's migration summary (no key required)
curl ${API_BASE}/v1/orgs/${EXAMPLE_ORG}/summary

# 5. Write operations (scan, attest, issue credentials) require an API key:
#    export QTRUST_API_KEY=...   # request one via the API docs
curl -H "authorization: Bearer $QTRUST_API_KEY" \\
  ${API_BASE}/v1/write/assets -d '{"cbomHash":"0x…","orgDid":"did:qtrust:…"}'`;

const SCENARIO_STEPS = [
  {
    title: "The discovery",
    copy: "A regional bank’s crypto inventory flags RSA-2048 inside a payments binary that shipped three years ago — invisible to the certificate inventory, present in a dependency nobody owns anymore.",
  },
  {
    title: "The ranking",
    copy: "Q-Trust scores it CRITICAL: a reachable, externally-facing key protecting transaction approvals, not a dormant internal cert. The team fixes the one thing that matters first.",
  },
  {
    title: "The migration",
    copy: "They roll ML-KEM-768 for key establishment and re-issue the signing path with ML-DSA, tracking each step as a migration on the asset record.",
  },
  {
    title: "The proof",
    copy: "Each milestone anchors an evidence hash on Base. A year later, an auditor — and a regulator — verifies the record with no wallet and no account, and sees exactly when and how the risk was closed.",
  },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">
      {children}
    </p>
  );
}

export default function DevelopersPage() {
  return (
    <div className="bg-slate-950 text-white">
      <ScrollProgress />
      <main>
        <section
          className="relative overflow-hidden border-b border-white/10"
          aria-labelledby="dev-heading"
        >
          <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative mx-auto max-w-[88rem] px-5 pb-16 pt-16 sm:px-8 sm:pt-24 lg:px-12 lg:pb-24 lg:pt-28">
            <Eyebrow>For developers</Eyebrow>
            <h1
              id="dev-heading"
              className="mt-6 max-w-4xl text-[clamp(2.6rem,6vw,5.6rem)] font-semibold leading-[0.9] tracking-[-0.06em] text-white"
            >
              Build on a <span className="text-cyan-300">verifiable</span> migration layer.
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              Q-Trust exposes a public API for the parts that should be open —
              verifying attestations and reading asset records — and a keyed API
              for the parts that write to the chain. Start with a curl.
            </p>
          </div>
        </section>

        <section className="bg-slate-950" aria-labelledby="quickstart-heading">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
            <Reveal>
              <h2
                id="quickstart-heading"
                className="mb-8 max-w-2xl text-2xl font-semibold tracking-[-0.04em] sm:text-3xl"
              >
                Quickstart
              </h2>
            </Reveal>
            <Reveal delay={80}>
              <CodeBlock
                label="Verify an attestation in five commands"
                className="overflow-x-auto rounded-xl border border-white/10 bg-slate-900 p-5 font-mono text-xs leading-6 text-slate-100"
              >
                <code>{QUICKSTART}</code>
              </CodeBlock>
            </Reveal>
            <p className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-400">
              <span>
                Read endpoints are public. Write endpoints require an API key.
              </span>
              <a
                href={`${API_DOCS_URL.replace(/\/$/, "")}/docs`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-cyan-300 transition hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                Full API reference
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </p>
          </div>
        </section>

        <section
          className="border-t border-white/10 bg-[#f4f5f2] text-slate-950"
          aria-labelledby="scenario-heading"
        >
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
            <Reveal>
              <div className="mb-10 max-w-2xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
                  One scenario
                </p>
                <h2
                  id="scenario-heading"
                  className="mt-5 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl"
                >
                  A bank, a payments binary, and a key nobody owned.
                </h2>
              </div>
            </Reveal>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {SCENARIO_STEPS.map((step, index) => (
                <Reveal key={step.title} delay={index * 80}>
                  <article className="flex h-full flex-col justify-between border-t border-slate-300 pt-5">
                    <div>
                      <span className="font-mono text-xs font-semibold text-muted-foreground">
                        0{index + 1}
                      </span>
                      <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em]">
                        {step.title}
                      </h3>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {step.copy}
                      </p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-slate-950 text-white" aria-labelledby="dev-cta-heading">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12">
            <Reveal>
              <div className="flex flex-col justify-between gap-8 border-t border-white/15 pt-8 lg:flex-row lg:items-end">
                <h2
                  id="dev-cta-heading"
                  className="max-w-3xl text-3xl font-semibold leading-[0.95] tracking-[-0.05em] sm:text-5xl"
                >
                  Verify it. <span className="text-cyan-300">Then build on it.</span>
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
                    Our honest self-audit
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

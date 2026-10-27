import type { Metadata } from "next";
import Link from "next/link";
import { ScrollProgress } from "@/components/scroll-effects.client";
import {
  ArrowRightIcon,
  CheckIcon,
  PlusIcon,
  ShieldCheckIcon,
} from "@/app/icons";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Q-Trust pricing: the scanner is free and MIT-licensed. Paid assurance — validity reports, annual validity-gated certification, and OEM licensing — is offered to design partners at published target prices.",
  alternates: { canonical: "/pricing" },
};

const SALES_EMAIL = "humoge7502.security@gmail.com";
const mailto = (subject: string) =>
  `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}`;

type Tier = {
  number: string;
  name: string;
  audience: string;
  price: string;
  basis: string;
  detail: string;
  features: string[];
  cta: { label: string; href: string };
  secondary: { label: string; href: string };
  featured?: boolean;
  note: string;
};

const TIERS: Tier[] = [
  {
    number: "01",
    name: "Open",
    audience: "For engineers",
    price: "Free",
    basis: "Self-hosted · MIT",
    detail: "No account, no seat count, no time limit.",
    features: [
      "Scanner across source, manifests, binaries, endpoints, and config",
      "CycloneDX CBOM and SARIF export",
      "Community migration planner",
      "Public record verification — no wallet, no account",
      "Offline certification-bundle verification",
    ],
    cta: { label: "Run the scanner", href: "/scanner" },
    secondary: { label: "Read the quickstart", href: "/developers" },
    note: "Runs on your machine. The trust path stays open.",
  },
  {
    number: "02",
    name: "Validity Report",
    audience: "For security leads",
    price: "$15k–40k",
    basis: "Per engagement · one estate",
    detail: "Fixed scope, agreed in writing before work starts.",
    features: [
      "Ceiling analysis: can your current readiness score discriminate at all?",
      "Eight-mode construct-validity checklist applied to your estate",
      "A labelling plan that reaches a target confidence with fewer expert labels",
      "Signed JSON findings plus a written report",
      "A readout with the people who have to defend the number",
    ],
    cta: {
      label: "Request a design-partner report",
      href: mailto("Q-Trust design partnership — validity report"),
    },
    secondary: { label: "Read the method", href: "/research" },
    note: "Design partners: discounted, in exchange for feedback and blinded labels.",
  },
  {
    number: "03",
    name: "Certification",
    audience: "For regulated teams",
    price: "$60k–250k",
    basis: "Per year · scaled by estate size",
    detail: "Annual, renewable, and sized to the estate under assurance.",
    features: [
      "Validity-gated issuance — refuses rather than signs an unsupported claim",
      "Signed bundle: sha256 Merkle root and Ed25519 issuer signature",
      "On-chain anchor on Base with revocation anyone can check",
      "Auditor verification offline — no wallet, no account, no Q-Trust server",
      "Annual renewal over a record that cannot be recreated elsewhere",
    ],
    cta: {
      label: "Discuss certification",
      href: mailto("Q-Trust design partnership — certification"),
    },
    secondary: { label: "Verify a sample bundle", href: "/certify" },
    featured: true,
    note: "Design partners only. No paying certification customer yet.",
  },
];

const FREE_INCLUDES = [
  {
    number: "01",
    title: "The scanner",
    copy: "Source, manifests, binaries, endpoints, and config. CycloneDX CBOM and SARIF out, for the tools you already run.",
  },
  {
    number: "02",
    title: "Any public record",
    copy: "Paste an asset ID at /v. It is checked against Base Sepolia and shown with its evidence. No wallet. No account.",
  },
  {
    number: "03",
    title: "Any signed bundle",
    copy: "Paste a certification bundle at /certify. Digest, Merkle root, issuer signature, and validity window, in your browser.",
  },
  {
    number: "04",
    title: "The open verifier",
    copy: "The same verification logic ships in the TypeScript SDK and the Python package, so records can be checked inside your own pipeline.",
  },
];

const PRINCIPLES = [
  {
    number: "01",
    title: "Priced against a failed audit",
    copy: "A contractor losing award eligibility on a $50M vehicle is the reference loss — not the price of a software seat. The certificate is priced against what it prevents.",
  },
  {
    number: "02",
    title: "Cost of goods is expertise",
    copy: "In our October model, expert labelling is roughly 12% of the certificate price at the largest estate. Compute is negligible. The scheduler is the margin lever.",
  },
  {
    number: "03",
    title: "Renewal is the model",
    copy: "Certification is annual and the on-chain history is not portable. Switching means abandoning a record others have verified — so renewal matters more than the first sale.",
  },
];

const FAQ = [
  {
    q: "Why is there no per-seat price?",
    a: "Assurance is a property of an estate, not of a login. Charging per analyst would put the price where the value is not.",
  },
  {
    q: "Are these prices validated?",
    a: "No. They are published targets from our October 2026 model. No organisation pays for Q-Trust today. The first design partners are priced individually and at a discount, and this page will change when someone signs.",
  },
  {
    q: "What does a validity report actually tell me?",
    a: "Whether the readiness score you already have can tell a good migration order from a bad one, and if it cannot, how many expert labels it would take to make it able to. That is a ceiling analysis plus a labelling plan, delivered as signed JSON and a written report.",
  },
  {
    q: "What is validity-gated issuance?",
    a: "The API refuses with HTTP 409 rather than signing a claim its evidence cannot support. A certificate that can say no is worth more than one that can only say yes.",
  },
  {
    q: "Do we have to put evidence on chain?",
    a: "Only hashes and references. Evidence stays private or on IPFS. The record is checkable by anyone; the evidence is not disclosed to everyone.",
  },
  {
    q: "Can we start without a budget conversation?",
    a: "Yes. The scanner is MIT-licensed, record verification needs no account, and a bundle can be checked offline. Start there and get in touch when you need the assurance layer around it.",
  },
];

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p
      className={`text-[11px] font-semibold uppercase tracking-[0.28em] ${
        dark ? "text-cyan-300" : "text-muted-foreground"
      }`}
    >
      {children}
    </p>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  const dark = Boolean(tier.featured);
  return (
    <article
      className={`flex h-full flex-col border-b border-slate-300 p-6 sm:p-8 lg:border-b-0 ${
        dark
          ? "border-slate-800 bg-slate-950 text-white"
          : "bg-white/40 text-slate-950 lg:border-r lg:border-slate-300"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${
            dark ? "text-slate-400" : "text-muted-foreground"
          }`}
        >
          {tier.number} / 03
        </span>
        {dark ? (
          <span className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
            Flagship
          </span>
        ) : null}
      </div>

      <h3 className="mt-8 text-2xl font-semibold tracking-[-0.04em]">{tier.name}</h3>
      <p className={`mt-2 text-xs font-medium ${dark ? "text-slate-400" : "text-slate-600"}`}>
        {tier.audience}
      </p>

      <div className="mt-8">
        <div className="text-[clamp(2.1rem,3.6vw,3.25rem)] font-semibold leading-none tracking-[-0.06em]">
          {tier.price}
        </div>
        <div
          className={`mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] ${
            dark ? "text-cyan-300" : "text-muted-foreground"
          }`}
        >
          {tier.basis}
        </div>
        <p className={`mt-4 text-sm leading-6 ${dark ? "text-slate-300" : "text-slate-700"}`}>
          {tier.detail}
        </p>
      </div>

      <ul
        className={`mt-8 space-y-3 border-t pt-7 text-sm leading-6 ${
          dark ? "border-white/15 text-slate-300" : "border-slate-300 text-slate-700"
        }`}
      >
        {tier.features.map((feature) => (
          <li key={feature} className="flex gap-3">
            <CheckIcon
              className={`mt-1 h-3.5 w-3.5 shrink-0 ${
                dark ? "text-cyan-300" : "text-qtrust-700"
              }`}
              aria-hidden="true"
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-9">
        <Link
          href={tier.cta.href}
          className={`group inline-flex w-full items-center justify-between gap-3 rounded-full px-5 py-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
            dark
              ? "bg-cyan-300 text-slate-950 hover:bg-cyan-200 focus-visible:ring-cyan-300 focus-visible:ring-offset-slate-950"
              : "bg-slate-950 text-white hover:bg-slate-800 focus-visible:ring-slate-950 focus-visible:ring-offset-canvas"
          }`}
        >
          {tier.cta.label}
          <ArrowRightIcon
            className="h-4 w-4 transition-transform group-hover:translate-x-1"
            aria-hidden="true"
          />
        </Link>
        <Link
          href={tier.secondary.href}
          className={`mt-4 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-4 transition focus-visible:outline-none focus-visible:ring-2 ${
            dark
              ? "text-slate-300 decoration-slate-600 hover:text-white focus-visible:ring-cyan-300"
              : "text-slate-700 decoration-slate-300 hover:text-slate-950 focus-visible:ring-slate-950"
          }`}
        >
          {tier.secondary.label}
        </Link>
        <p
          className={`mt-5 text-[11px] leading-5 ${
            dark ? "text-slate-400" : "text-muted-foreground"
          }`}
        >
          {tier.note}
        </p>
      </div>
    </article>
  );
}

export default function PricingPage() {
  return (
    <div className="bg-canvas text-slate-950">
      <ScrollProgress />
      <main>
        <section aria-labelledby="pricing-heading" className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.045)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_70%_70%_at_30%_0%,black,transparent)]"
          />
          <div className="relative mx-auto max-w-[88rem] px-5 pb-14 pt-16 sm:px-8 sm:pb-20 sm:pt-24 lg:px-12 lg:pt-28">
            <div className="flex items-center gap-3">
              <span className="h-px w-10 bg-slate-950" aria-hidden="true" />
              <Eyebrow>Plans · October 2026</Eyebrow>
            </div>
            <h1
              id="pricing-heading"
              className="mt-8 max-w-5xl text-[clamp(2.6rem,7vw,7rem)] font-semibold leading-[0.88] tracking-[-0.07em]"
            >
              Buy the proof,{" "}
              <br />
              <span className="text-cyan-700">not another dashboard.</span>
            </h1>
            <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)] lg:items-end lg:gap-20">
              <p className="max-w-2xl text-base leading-7 text-slate-700 sm:text-lg sm:leading-8">
                Discovery is commoditising. The layer above it is not: an independent
                analysis of whether a readiness score can discriminate at all, and a
                certificate a counterparty can verify without trusting you — or us.
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-700 lg:justify-end">
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-qtrust-600" aria-hidden="true" />
                  Free tier: MIT
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-qtrust-600" aria-hidden="true" />
                  Paid tiers: design partners
                </span>
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Pricing status" className="border-y border-slate-300 bg-white/60">
          <div className="mx-auto flex max-w-[88rem] flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:gap-8 sm:px-8 lg:px-12">
            <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-950">
              Status
            </span>
            <p className="max-w-4xl text-xs leading-6 text-slate-700">
              <strong className="font-semibold text-slate-950">
                No organisation pays for Q-Trust yet.
              </strong>{" "}
              The figures below are published targets from our October 2026 model,
              not validated market prices. We would rather label a target honestly
              than dress it up as traction. Design partners receive a discount in
              exchange for feedback and blinded labels — the corpus that makes the
              ceiling analysis credible for their sector.{" "}
              <Link
                href="#faq"
                className="font-semibold text-slate-950 underline decoration-slate-400 underline-offset-4 transition hover:decoration-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
              >
                Read the terms
              </Link>
              .
            </p>
          </div>
        </section>

        <section aria-labelledby="tiers-heading" className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 sm:py-20 lg:px-12 lg:py-24">
          <div>
            <div className="mb-10 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div>
                <Eyebrow>The schedule</Eyebrow>
                <h2
                  id="tiers-heading"
                  className="mt-5 max-w-xl text-4xl font-semibold leading-[0.94] tracking-[-0.06em] sm:text-5xl"
                >
                  Three ways to buy assurance.
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-slate-700">
                Prices in USD. Scope is agreed in writing before work starts. The
                free tier is not a trial — it is the product, permanently.
              </p>
            </div>
          </div>

          <div>
            <div className="grid border-t border-slate-950 lg:grid-cols-3 lg:border-b">
              {TIERS.map((tier) => (
                <TierCard key={tier.name} tier={tier} />
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="oem-heading" className="mx-auto max-w-[88rem] px-5 pb-16 sm:px-8 sm:pb-20 lg:px-12 lg:pb-24">
          <div>
            <div className="grid gap-8 border-y border-slate-300 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] lg:items-center lg:gap-16">
              <div>
                <Eyebrow>OEM + licensing</Eyebrow>
                <h2
                  id="oem-heading"
                  className="mt-5 max-w-2xl text-3xl font-semibold leading-[0.98] tracking-[-0.05em] sm:text-4xl"
                >
                  Selling readiness? Licence the validity layer.
                </h2>
                <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-700">
                  Scanner and readiness vendors can embed the validity gate and the
                  tie-aware labelling scheduler instead of rebuilding the research.
                  On designed estates of 100+ assets, the scheduler reaches a target
                  confidence with 24–42% fewer expert labels — the measured result,
                  not a projection.
                </p>
              </div>
              <div className="lg:border-l lg:border-slate-300 lg:pl-10">
                <div className="text-3xl font-semibold tracking-[-0.05em]">from $250k</div>
                <div className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Per year · plus per-certificate royalty
                </div>
                <a
                  href={mailto("Q-Trust — OEM licence discussion")}
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  Discuss a licence <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                </a>
                <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
                  Exploratory. No OEM agreement is signed.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="free-heading" className="bg-slate-950 text-white">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
            <div>
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] lg:items-end lg:gap-20">
                <div>
                  <Eyebrow dark>The open layer</Eyebrow>
                  <h2
                    id="free-heading"
                    className="mt-6 max-w-3xl text-4xl font-semibold leading-[0.92] tracking-[-0.06em] sm:text-6xl"
                  >
                    We do not charge{" "}
                    <br />
                    <span className="text-slate-400">for the trust path.</span>
                  </h2>
                </div>
                <p className="max-w-md text-sm leading-7 text-slate-400">
                  Verification is free on purpose. A record only one party can check
                  is not a record — it is a press release. The paid layer is analysis
                  and an engagement, never access to the check itself.
                </p>
              </div>
            </div>

            <div className="mt-14 grid border-t border-white/15 sm:grid-cols-2 lg:grid-cols-4">
              {FREE_INCLUDES.map((item, index) => (
                <div key={item.number} className="h-full">
                  <div
                    className={`flex h-full flex-col border-b border-white/15 py-7 sm:px-6 lg:border-b-0 lg:py-8 ${
                      index > 0 ? "lg:border-l lg:border-white/15" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        {item.number}
                      </span>
                      <ShieldCheckIcon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                    </div>
                    <h3 className="mt-8 text-lg font-semibold tracking-[-0.03em]">{item.title}</h3>
                    <p className="mt-3 text-xs leading-6 text-slate-400">{item.copy}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs font-semibold">
              <Link
                href="/v"
                className="inline-flex items-center gap-1 text-cyan-300 underline underline-offset-4 transition hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                Verify a record <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <Link
                href="/certify"
                className="inline-flex items-center gap-1 text-cyan-300 underline underline-offset-4 transition hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                Verify a bundle <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <Link
                href="/scanner"
                className="inline-flex items-center gap-1 text-slate-300 underline decoration-slate-600 underline-offset-4 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                Run the scanner <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <Link
                href="/developers"
                className="inline-flex items-center gap-1 text-slate-300 underline decoration-slate-600 underline-offset-4 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                Build with the verifier <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="principles-heading" className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
          <div>
            <div className="flex flex-col justify-between gap-5 border-t border-slate-300 pt-6 lg:flex-row lg:items-end">
              <div>
                <Eyebrow>How we price</Eyebrow>
                <h2
                  id="principles-heading"
                  className="mt-5 max-w-2xl text-4xl font-semibold leading-[0.94] tracking-[-0.06em] sm:text-5xl"
                >
                  Three decisions behind the numbers.
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-slate-700">
                If a number on this page is wrong, the reasoning behind it should
                still be legible. These are the three choices that set it.
              </p>
            </div>
          </div>
          <div className="mt-12 grid gap-3 sm:grid-cols-3">
            {PRINCIPLES.map((principle, index) => (
              <div key={principle.number} className="h-full">
                <article className="flex h-full min-h-[17rem] flex-col justify-between border-t border-slate-300 pt-5">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {principle.number}
                      </span>
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Pricing rule
                      </span>
                    </div>
                    <h3 className="mt-12 text-xl font-semibold tracking-[-0.035em]">
                      {principle.title}
                    </h3>
                    <p className="mt-4 text-sm leading-6 text-slate-700">{principle.copy}</p>
                  </div>
                  <span className="mt-8 block h-px w-full bg-slate-300" aria-hidden="true" />
                </article>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-heading" className="border-t border-slate-300 bg-white/50">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)] lg:gap-20">
              <div>
                <div className="lg:sticky lg:top-28">
                  <Eyebrow>Questions</Eyebrow>
                  <h2
                    id="faq-heading"
                    className="mt-5 text-4xl font-semibold leading-[0.94] tracking-[-0.06em] sm:text-5xl"
                  >
                    The terms, plainly.
                  </h2>
                  <p className="mt-6 max-w-sm text-sm leading-7 text-slate-700">
                    Anything not answered here is worth asking directly. We would
                    rather have the awkward conversation before a contract than
                    after one.
                  </p>
                  <a
                    href={mailto("Q-Trust — pricing question")}
                    className="mt-8 inline-flex items-center gap-2 text-sm font-semibold underline decoration-slate-300 underline-offset-8 transition hover:decoration-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
                  >
                    Email a question <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                  </a>
                </div>
              </div>
              <div className="border-t border-slate-300">
                {FAQ.map((item) => (
                  <details key={item.q} className="group border-b border-slate-300">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 [&::-webkit-details-marker]:hidden">
                      <span className="text-base font-semibold tracking-[-0.02em] sm:text-lg">
                        {item.q}
                      </span>
                      <PlusIcon
                        className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-45"
                        aria-hidden="true"
                      />
                    </summary>
                    <p className="max-w-2xl pb-6 pr-10 text-sm leading-7 text-slate-700">
                      {item.a}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="closing-heading" className="mx-auto max-w-[88rem] px-5 py-20 sm:px-8 sm:py-28 lg:px-12 lg:py-32">
          <div>
            <div className="flex flex-col justify-between gap-10 border-t border-slate-950 pt-7 lg:flex-row lg:items-end">
              <div>
                <Eyebrow>Start where you are</Eyebrow>
                <h2
                  id="closing-heading"
                  className="mt-6 max-w-4xl text-[clamp(2.5rem,6vw,6rem)] font-semibold leading-[0.9] tracking-[-0.07em]"
                >
                  Run the free scan.{" "}
                  <br />
                  <span className="text-cyan-700">Buy the proof when you need it.</span>
                </h2>
                <p className="mt-7 max-w-xl text-sm leading-7 text-slate-700">
                  If you only need to know what you run, the open tier is enough. If
                  someone outside your organisation has to believe the result, that
                  is the part we do.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 lg:pb-2">
                <Link
                  href="/scanner"
                  className="group inline-flex items-center gap-3 rounded-full bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  Run the scanner
                  <ArrowRightIcon
                    className="h-4 w-4 transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </Link>
                <a
                  href={mailto("Q-Trust design partnership")}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-6 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  Talk about a design partnership
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

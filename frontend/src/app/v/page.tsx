/**
 * Public verification entry point.
 *
 * This route is the destination of the "Verify" item in the primary navigation
 * on every page. Previously it had no form — it instructed visitors to paste an
 * asset ID into the browser address bar and otherwise just linked home, so the
 * most prominently advertised capability in the product was, in practice, a
 * dead end. It now performs the lookup itself.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@/app/icons";
import { JsonLd } from "@/components/json-ld";
import { CodeBlock } from "@/components/ui/code-block";
import { VerifyForm } from "@/components/verify-form.client";

export const metadata: Metadata = {
  title: "Verify an attestation",
  description:
    "Independently verify a Q-Trust attestation by asset ID. No wallet, no account: check on-chain status, organization, CBOM hash and timestamp directly against Base.",
  alternates: { canonical: "/v" },
};

const EXPLAINER = [
  {
    label: "What it is",
    body: "A 32-byte on-chain identifier assigned when an asset's cryptographic inventory is first recorded. It is the only value needed to look up a record.",
  },
  {
    label: "Where to find it",
    body: "Your migration report, the Q-Trust dashboard, or the link a vendor sends you. It always looks like 0x followed by 64 hexadecimal characters.",
  },
  {
    label: "What you get back",
    body: "Verification status, the attesting organization, the CBOM hash, the anchor timestamp and the provenance chain from source to migration.",
  },
];

export default function VerifyIndexPage() {
  return (
    <main className="flex-1 bg-canvas text-slate-900">
      <JsonLd />
      <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24 lg:px-12">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-600">
          Public verification
        </p>
        <h1 className="mt-6 max-w-2xl text-4xl font-semibold leading-[0.95] tracking-[-0.055em] text-slate-950 sm:text-5xl">
          Check the record yourself.
        </h1>
        <p className="mt-5 max-w-xl text-sm leading-7 text-slate-600">
          Q-Trust&apos;s claim is that a migration can be independently
          inspected. This is where that claim is tested — paste an asset ID and
          read the on-chain record without trusting this interface or anyone
          operating it.
        </p>

        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <VerifyForm />
        </div>

        <dl className="mt-10 grid border-t border-slate-300 sm:grid-cols-3">
          {EXPLAINER.map((item, index) => (
            <div
              key={item.label}
              className={`py-6 sm:px-6 first:sm:pl-0 last:sm:pr-0 ${
                index > 0 ? "border-t border-slate-200 sm:border-l sm:border-t-0" : ""
              }`}
            >
              <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
                {item.label}
              </dt>
              <dd className="mt-3 text-xs leading-6 text-slate-600">{item.body}</dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="cli-heading" className="mt-12 border-t border-slate-300 pt-8">
          <h2 id="cli-heading" className="text-lg font-semibold tracking-[-0.02em] text-slate-950">
            Prefer to verify outside the browser?
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600">
            The SDK resolves the same record straight from the chain, with no
            dependency on this deployment:
          </p>
          <CodeBlock
            label="Independent verification command"
            className="mt-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100"
          >
            <code>crypto-inspector verify 0x&lt;asset-id&gt;</code>
          </CodeBlock>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm font-semibold">
            <Link
              href="/scanner"
              className="inline-flex items-center gap-2 text-slate-900 underline decoration-slate-300 underline-offset-8 transition hover:decoration-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
            >
              Start your own scan
              <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/#workflow"
              className="inline-flex items-center gap-2 text-slate-600 underline decoration-slate-300 underline-offset-8 transition hover:text-slate-900 hover:decoration-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
            >
              How the protocol works
              <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { CHAIN } from "@/lib/config";
import { ScannerDashboard } from "@/components/scanner-dashboard";

export const metadata: Metadata = {
  // No "Q-Trust" here: the root layout's `title.template` appends `· Q-Trust`
  // to every child segment, so including it produced "… · Q-Trust · Q-Trust".
  title: "PQC Migration Scanner",
  alternates: { canonical: "/scanner" },
  description:
    "Comprehensive cryptographic asset scanning for post-quantum migration readiness. Detect vulnerable algorithms, assess risk, and plan your migration roadmap.",
};

/**
 * The scanner's operating loop, shown in the header.
 *
 * These are the three things the surface below actually does — not marketing
 * steps. Keeping them adjacent to the tool (rather than only on the landing
 * page) means a visitor who arrives from a deep link still gets the mental
 * model before they see eight tabs.
 */
const LOOP = [
  { step: "01", label: "Inventory", copy: "Source, manifests, TLS" },
  { step: "02", label: "Score", copy: "Risk, policy, effort" },
  { step: "03", label: "Attest", copy: "Hash-anchored evidence" },
] as const;

export default function ScannerPage() {
  return (
    <main className="flex-1 bg-canvas text-foreground">
      {/* ---------------------------------------------------------------- */}
      {/* Editorial header — same type system as the landing page so the     */}
      {/* product surface reads as one product rather than a bolted-on form. */}
      {/* ---------------------------------------------------------------- */}
      <header className="relative overflow-hidden bg-slate-950 text-white">
        <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div
          className="hero-orb hero-orb-one pointer-events-none absolute -left-40 -top-32 h-[30rem] w-[30rem] rounded-full"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-[86rem] px-5 pb-9 pt-8 sm:px-8 sm:pb-14 sm:pt-14 lg:px-12">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">
              <span className="h-px w-10 bg-cyan-300" aria-hidden="true" />
              Q-Trust scanner
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">
              {CHAIN.name} / {CHAIN.id}
            </p>
          </div>

          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] lg:items-end lg:gap-14">
            <div>
              <h1 className="max-w-3xl text-[clamp(2.05rem,5.4vw,4.6rem)] font-semibold leading-[0.9] tracking-[-0.06em] text-white [overflow-wrap:anywhere]">
                Scan the estate.
                <br />
                <span className="text-cyan-300">Prove the migration.</span>
              </h1>
              <p className="mt-5 max-w-xl text-sm leading-6 text-slate-300 sm:mt-6 sm:text-base sm:leading-7">
                One workspace from inventory to attested remediation: find
                quantum-vulnerable cryptography, rank the exposure, test it against
                policy, sequence the work, and anchor the record on-chain.
              </p>
            </div>

            <div className="lg:pb-1">
              {/* The loop is the mental model, but on a phone it pushed the tool
                  below the fold — the rail's contextual strip already names each
                  surface, so it is desktop-only. */}
              <ol className="hidden grid-cols-3 gap-3 border-t border-white/15 pt-4 sm:grid">
                {LOOP.map((item) => (
                  <li key={item.step}>
                    <p className="font-mono text-[10px] tracking-[0.16em] text-slate-500">
                      {item.step}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-white">{item.label}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-slate-400">{item.copy}</p>
                  </li>
                ))}
              </ol>
              <p className="text-[11px] leading-5 text-slate-400 sm:mt-5">
                Web scans run against server-mounted demo directories and are open to
                every visitor — no account, no wallet, no key. For live TLS host scans
                of your own network, use the{" "}
                <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[10px] text-slate-200">
                  crypto-inspector
                </code>{" "}
                CLI (quick start in the README).
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[86rem] px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
        <ScannerDashboard />
      </div>
    </main>
  );
}

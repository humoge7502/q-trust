import type { Metadata } from "next";
import Link from "next/link";
import { Reveal, ScrollProgress } from "@/components/scroll-effects.client";
import { ScrollX } from "@/components/ui/scroll-x";
import { ArrowRightIcon, CheckIcon } from "@/app/icons";

export const metadata: Metadata = {
  // The root layout appends " · Q-Trust". Repeating the brand here produced
  // "… — Q-Trust · Q-Trust" in the tab and in search results.
  title: "The alternatives, compared",
  description:
    "A spreadsheet tracks. A scanner finds. Q-Trust makes the migration verifiable across teams, vendors, and years. An honest comparison of the options.",
  alternates: { canonical: "/compare" },
};

type Row = { capability: string; cells: string[] };

// Columns: Q-Trust, Spreadsheet, Point scanner, One-time audit.
const COLUMNS = ["Capability", "Q-Trust", "Spreadsheet", "Point scanner", "One-time audit"];
const ROWS: Row[] = [
  {
    capability: "Finds crypto in code, dependencies, binaries, endpoints, and config",
    cells: ["12+ languages + manifests", "Manual, partial", "Often code-only", "Snapshot only"],
  },
  {
    capability: "Ranks risk by exposure — not just the algorithm name",
    cells: ["GNN-ranked by impact", "No", "Rarely", "No"],
  },
  {
    capability: "Scores compliance (NIST 800-131A, CNSA 2.0) with a reason per control",
    cells: ["Yes, per control", "No", "No", "Static only"],
  },
  {
    capability: "Anchors evidence on-chain, independently verifiable",
    cells: ["EIP-712 · Base L2", "No", "No", "No"],
  },
  {
    capability: "Open verification — no wallet, no account required",
    cells: ["Yes", "n/a", "No", "No"],
  },
  {
    capability: "Vendor PQC-support attestations",
    cells: ["Yes", "No", "No", "No"],
  },
  {
    capability: "Auditable across reorgs and years",
    cells: ["Hash-only record", "Fragile", "No", "Stale at handoff"],
  },
];

export default function ComparePage() {
  return (
    <div className="bg-slate-950 text-white">
      <ScrollProgress />
      <main>
        <section
          className="relative overflow-hidden border-b border-white/10"
          aria-labelledby="compare-heading"
        >
          <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative mx-auto max-w-[88rem] px-5 pb-16 pt-16 sm:px-8 sm:pt-24 lg:px-12 lg:pb-24 lg:pt-28">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">
              The alternatives, honestly
            </p>
            <h1
              id="compare-heading"
              className="mt-6 max-w-4xl text-[clamp(2.4rem,5.6vw,5.2rem)] font-semibold leading-[0.92] tracking-[-0.06em] text-white"
            >
              The difference between a report and a <span className="text-cyan-300">record.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              Plenty of tools will tell you what cryptography you run. Almost none
              make the migration provable to the people who have to trust it — your
              auditors, your vendors, your future selves. That is the gap Q-Trust
              closes.
            </p>
          </div>
        </section>

        <section className="bg-slate-950" aria-labelledby="matrix-heading">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
            <Reveal>
              <h2
                id="matrix-heading"
                className="mb-8 max-w-2xl text-2xl font-semibold tracking-[-0.04em] sm:text-3xl"
              >
                What each option actually covers
              </h2>
            </Reveal>
            <Reveal delay={80}>
              <ScrollX label="Comparison of migration approaches (scroll horizontally on small screens)">
                <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
                  <caption className="sr-only">
                    Comparison of Q-Trust against a spreadsheet, a point scanner,
                    and a one-time audit across seven capabilities.
                  </caption>
                  <thead>
                    <tr className="border-b border-white/20">
                      {COLUMNS.map((col, i) => (
                        <th
                          key={col}
                          scope="col"
                          className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                            i === 1
                              ? "text-cyan-300"
                              : "text-slate-400"
                          } ${i === 0 ? "text-left" : "text-center"}`}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row, r) => (
                      <tr key={row.capability} className="border-b border-white/10 align-top">
                        <th
                          scope="row"
                          className="px-4 py-4 text-left font-medium text-slate-200"
                        >
                          {row.capability}
                        </th>
                        {row.cells.map((cell, i) => (
                          <td
                            key={i}
                            className={`px-4 py-4 text-center ${
                              i === 0
                                ? "font-medium text-cyan-200"
                                : "text-slate-400"
                            }`}
                          >
                            {i === 0 ? (
                              <span className="inline-flex items-center justify-center gap-1.5">
                                <CheckIcon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                                {cell}
                              </span>
                            ) : (
                              cell
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollX>
            </Reveal>
            <p className="mt-6 max-w-3xl text-xs leading-6 text-slate-400">
              Q-Trust is the only option here that keeps the evidence portable: an
              attestation anchored on-chain can be checked by anyone, with no
              wallet and no platform account, long after the original team has
              moved on.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-slate-950 text-white" aria-labelledby="compare-cta-heading">
          <div className="mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12">
            <Reveal>
              <div className="flex flex-col justify-between gap-8 border-t border-white/15 pt-8 lg:flex-row lg:items-end">
                <h2
                  id="compare-cta-heading"
                  className="max-w-3xl text-3xl font-semibold leading-[0.95] tracking-[-0.05em] sm:text-5xl"
                >
                  See the gap <span className="text-cyan-300">for yourself.</span>
                </h2>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/scanner"
                    className="group inline-flex items-center gap-3 rounded-full bg-cyan-300 px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                  >
                    Run a scan <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </Link>
                  <Link
                    href="/why-now"
                    className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/5"
                  >
                    Why the threat is now
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

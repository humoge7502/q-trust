/**
 * 404 for `/v/<asset-id>`.
 *
 * Scoped to the segment rather than the global not-found so it can keep the
 * visitor inside the verification task: the ID was well-formed (the route only
 * reaches this boundary after the lookup ran) but this registry has no record
 * for it. The global page answered that with the site's generic "no such page"
 * copy and no way to try a record that does exist, which is a dead end on the
 * one flow whose whole promise is independent checking.
 *
 * The status code is still 404 — `notFound()` raises this boundary — so a
 * crawler or script sees the same semantics as before.
 */
import Link from "next/link";
import { ArrowRightIcon } from "@/app/icons";
import demoRecords from "@/lib/demo-records.json";

const SEEDED = demoRecords.records.find((record) => record.assetId)?.assetId;

const EXITS = [
  ...(SEEDED
    ? [{ label: "Try the seeded example", href: `/v/${SEEDED}`, copy: "A record that exists on Base Sepolia — the same lookup, with a result." }]
    : []),
  { label: "Enter a different asset ID", href: "/v", copy: "Paste the 0x + 64 hex identifier from a report or vendor link." },
  { label: "Verify a certification bundle", href: "/certify", copy: "Check a signed, offline-verifiable snapshot instead of a single asset." },
];

export default function AssetNotFound() {
  return (
    <main className="flex-1 bg-canvas text-foreground">
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          No record · 404
        </p>
        <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[0.9] tracking-[-0.06em] text-slate-950 sm:text-7xl">
          The chain has no record for this ID.
        </h1>
        <p className="mt-6 max-w-xl text-sm leading-7 text-muted-foreground">
          The identifier is in the right format, but the registry returned
          nothing for it. Either the asset was never registered on{" "}
          <span className="font-medium text-foreground">this network</span>, or
          the ID belongs to a different deployment. This says nothing about the
          validity of any other record.
        </p>

        <nav aria-label="Suggested destinations" className="mt-14 border-t border-slate-300">
          {EXITS.map((exit) => (
            <Link
              key={exit.label}
              href={exit.href}
              className="group flex items-center justify-between gap-6 border-b border-border py-6 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
            >
              <span>
                <span className="block text-lg font-semibold tracking-[-0.02em] text-slate-950 transition group-hover:text-qtrust-700">
                  {exit.label}
                </span>
                <span className="mt-1 block text-xs leading-6 text-muted-foreground">{exit.copy}</span>
              </span>
              <ArrowRightIcon
                className="h-5 w-5 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-slate-950 motion-reduce:group-hover:translate-x-0"
                aria-hidden="true"
              />
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}

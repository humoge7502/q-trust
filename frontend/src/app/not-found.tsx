/**
 * 404. Rendered inside the root shell, so the header and footer (and therefore
 * a way out) are already present — this only owns the message.
 *
 * The page names the likely real destinations instead of offering a single
 * "back to home": a mistyped `/v/<asset-id>` is the common case, and sending
 * that visitor to the top-level marketing page loses the intent they arrived
 * with.
 */
import Link from "next/link";
import { ArrowRightIcon } from "@/app/icons";

const EXITS = [
  { label: "Verify an attestation", href: "/v", copy: "Look up an asset ID and read the on-chain record." },
  { label: "Run a scan", href: "/scanner", copy: "Inventory a cryptography estate and score its exposure." },
  { label: "Org dashboard", href: "/dashboard", copy: "Migration progress, audits and registered assets." },
];

export default function NotFound() {
  return (
    <main className="flex-1 bg-canvas text-slate-900">
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-600">
          Error 404
        </p>
        <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[0.9] tracking-[-0.06em] text-slate-950 sm:text-7xl">
          No record at this address.
        </h1>
        <p className="mt-6 max-w-xl text-sm leading-7 text-slate-600">
          The page does not exist or has moved. If you were looking up an asset
          ID, check the value — it must be 0x followed by 64 hexadecimal
          characters.
        </p>

        <nav aria-label="Suggested destinations" className="mt-14 border-t border-slate-300">
          {EXITS.map((exit) => (
            <Link
              key={exit.href}
              href={exit.href}
              className="group flex items-center justify-between gap-6 border-b border-slate-200 py-6 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
            >
              <span>
                <span className="block text-lg font-semibold tracking-[-0.02em] text-slate-950 transition group-hover:text-qtrust-700">
                  {exit.label}
                </span>
                <span className="mt-1 block text-xs leading-6 text-slate-600">{exit.copy}</span>
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

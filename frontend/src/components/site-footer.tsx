/**
 * Site footer — rendered by the root layout, so it appears on every route.
 *
 * Kept deliberately narrow: brand + tagline, three short link columns, and a
 * status/meta bar. A footer that mirrors the whole sitemap is noise; the
 * columns here are the destinations a visitor actually needs from the bottom
 * of a page (the product surfaces, the docs, and the independent-verification
 * paths that make the trust claim checkable).
 */
import Link from "next/link";
import { API_DOCS_URL } from "@/lib/api";
import { CHAIN } from "@/lib/config";
import { ArrowTopRightOnSquareIcon, ShieldCheckIcon } from "@/app/icons";

const explorerUrl =
  CHAIN.blockExplorers?.default?.url ?? "https://sepolia.basescan.org";
const docsBase = API_DOCS_URL.replace(/\/$/, "");

const columns = [
  {
    label: "Product",
    links: [
      { label: "Scanner", href: "/scanner" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Vendor portal", href: "/vendors" },
      { label: "Verify", href: "/v" },
    ],
  },
  {
    label: "Resources",
    links: [
      { label: "API reference", href: `${docsBase}/docs`, external: true },
      { label: "Block explorer", href: explorerUrl, external: true },
    ],
  },
  {
    label: "Protocol",
    links: [
      { label: "Why Q-Trust", href: "/#why" },
      { label: "The operating loop", href: "/#workflow" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-slate-950 text-slate-400">
      <div className="mx-auto max-w-[88rem] px-5 py-14 sm:px-8 lg:px-12 lg:py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_repeat(3,minmax(0,0.7fr))] lg:gap-10">
          <div className="max-w-sm">
            <Link
              href="/"
              className="group inline-flex items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300 text-[11px] font-bold tracking-widest text-slate-950 transition group-hover:bg-cyan-200"
                aria-hidden="true"
              >
                QT
              </span>
              <span className="text-sm font-semibold text-white">Q-Trust</span>
            </Link>
            <p className="mt-5 text-xs leading-6">
              Post-quantum migration assurance on {CHAIN.name}. Scan the estate,
              rank the exposure, and anchor evidence so the record can be
              checked by anyone — without a wallet or an account.
            </p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[11px]">
              <ShieldCheckIcon className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
              Hash-only on-chain · evidence stays private
            </p>
          </div>

          {columns.map((column) => (
            <nav key={column.label} aria-label={column.label} className="text-xs">
              <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                {column.label}
              </h2>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                      >
                        {link.label}
                        <ArrowTopRightOnSquareIcon className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-6 text-[11px] sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} Q-Trust contributors · MIT licensed
          </p>
          <p className="font-mono uppercase tracking-[0.16em] text-slate-400">
            {CHAIN.name} · chain id {CHAIN.id}
          </p>
        </div>
      </div>
    </footer>
  );
}

"use client";

/**
 * Shared presentational pieces for the scanner dashboard panels.
 *
 * Extracted verbatim from scanner-dashboard.tsx (TD-01 decomposition): the
 * panel shell every tab renders inside, the loading spinner, and the numbered
 * surface eyebrow for the tabs whose child panels carry their own card. Pure
 * rendering — no state, no fetches. No behaviour change.
 */
import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/*  Presentational shell                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One panel shape for every surface below the rail.
 *
 * The old markup repeated `rounded-xl border border-border bg-card p-6 shadow-sm`
 * eight times with a mono eyebrow and a paragraph of endpoint documentation, so
 * every tab looked like the same grey form and the endpoint prose competed with
 * the actual content. Here the header is a separate band with a numbered step, a
 * real heading, and the endpoint note demoted to a single muted line.
 */
export function Panel({
  index,
  title,
  copy,
  aside,
  children,
}: {
  index: string;
  title: string;
  copy: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 border-b border-border bg-[#fbfbfa] px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="font-mono text-label uppercase tracking-[0.22em] text-muted-foreground">
            {index}
          </p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-[-0.03em] text-slate-950">
            {title}
          </h2>
          <p className="mt-1.5 max-w-xl text-micro leading-5 text-muted-foreground">{copy}</p>
        </div>
        {aside ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{aside}</div>
        ) : null}
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

export function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-current" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/**
 * Numbered eyebrow for the tabs whose child panels already carry their own
 * card and heading. Adding a second heading here would duplicate the title;
 * the step number keeps them in the same numbered system as the rest.
 */
export function SurfaceEyebrow({ index }: { index: string }) {
  return (
    <p className="font-mono text-label uppercase tracking-[0.22em] text-muted-foreground">{index}</p>
  );
}

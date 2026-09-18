/**
 * Route-level loading state (App Router `loading.tsx`), used for every route
 * that does not provide a more specific one.
 *
 * Replaces a centred spinner that dropped the visitor onto an empty coloured
 * field. A skeleton that mirrors the actual content box communicates what is
 * coming and keeps the visual frame stable; `role="status"` with a polite live
 * region announces progress to assistive technology without stealing focus.
 *
 * The layout is intentionally generic (header block + card stack) because it
 * has to stand in for routes of very different shapes. `v/[id]/loading.tsx`
 * provides the accurate skeleton where the shape is known.
 */
export default function Loading() {
  return (
    <main className="flex-1 bg-canvas text-slate-900">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
        <div role="status" aria-live="polite" className="sr-only">
          Loading Q-Trust…
        </div>

        <div aria-hidden="true" className="animate-pulse">
          <div className="h-3 w-32 rounded bg-slate-200" />
          <div className="mt-6 h-10 w-3/5 max-w-md rounded bg-slate-200" />
          <div className="mt-5 h-4 w-full max-w-xl rounded bg-slate-200" />
          <div className="mt-2 h-4 w-4/5 max-w-lg rounded bg-slate-200" />

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="h-3 w-20 rounded bg-slate-200" />
                <div className="mt-4 h-7 w-24 rounded bg-slate-200" />
                <div className="mt-3 h-3 w-full rounded bg-slate-100" />
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="h-4 w-40 rounded bg-slate-200" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-3 w-full rounded bg-slate-100" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

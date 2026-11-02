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
 *
 * The blocks are the shared `Skeleton` primitive (same pulse, same surface
 * token) rather than hand-rolled `animate-pulse` divs, so loading states stay
 * consistent everywhere and retune in one place.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="flex-1 bg-canvas text-foreground">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
        <div role="status" aria-live="polite" className="sr-only">
          Loading Q-Trust…
        </div>

        <div aria-hidden="true">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-6 h-10 w-3/5 max-w-md" />
          <Skeleton className="mt-5 h-4 w-full max-w-xl" />
          <Skeleton className="mt-2 h-4 w-4/5 max-w-lg" />

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-border bg-canvas-raised p-5 shadow-sm">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-4 h-7 w-24" />
                <Skeleton className="mt-3 h-3 w-full bg-muted" />
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-border bg-canvas-raised p-6 shadow-sm">
            <Skeleton className="h-4 w-40" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-3 w-full bg-muted" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

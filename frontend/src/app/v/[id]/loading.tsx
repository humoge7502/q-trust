/**
 * Accurate skeleton for `/v/<asset-id>`: mirrors the record page's real shape
 * (title row + status badge, details grid, provenance card) so the frame does
 * not jump when data arrives. Blocks use the shared `Skeleton` primitive.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function VerificationLoading() {
  return (
    <main className="flex-1 bg-canvas text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <section className="rounded-xl border border-border bg-canvas-raised p-6 shadow-sm">
          <Skeleton className="mb-4 h-5 w-32" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20 bg-muted" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        </section>
        <div className="mt-6 rounded-xl border border-border bg-canvas-raised p-6 shadow-sm">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-64 rounded-lg bg-muted" />
        </div>
      </div>
    </main>
  );
}

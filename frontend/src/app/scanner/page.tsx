import type { Metadata } from "next";
import { ScannerDashboard } from "@/components/scanner-dashboard";

export const metadata: Metadata = {
  // No "Q-Trust" here: the root layout's `title.template` appends `· Q-Trust`
  // to every child segment, so including it produced "… · Q-Trust · Q-Trust".
  title: "PQC Migration Scanner",
  alternates: { canonical: "/scanner" },
  description:
    "Comprehensive cryptographic asset scanning for post-quantum migration readiness. Detect vulnerable algorithms, assess risk, and plan your migration roadmap.",
};

export default function ScannerPage() {
  return (
    <main className="flex-1 bg-canvas text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            PQC Migration Scanner
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Comprehensive cryptographic asset scanning: detect vulnerable algorithms,
            assess quantum risk, evaluate compliance, and plan your migration roadmap.
          </p>
          <p className="mt-3 max-w-3xl rounded-lg border border-border bg-card px-3 py-2 text-micro leading-5 text-muted-foreground">
            Web scans run against server-mounted directories (operator access
            required). For live TLS host scans, use the{" "}
            <code className="rounded bg-neutral-surface px-1 py-0.5 font-mono">crypto-inspector</code>{" "}
            CLI — see the quick start in the README.
          </p>
        </div>
        <ScannerDashboard />
      </div>
    </main>
  );
}

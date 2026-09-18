/**
 * Org dashboard — migration progress, latest audit result, asset list.
 * Uses the connected wallet (wagmi/RainbowKit) for the org address.
 * Role-aware: shows onboarding wizard for new orgs, dashboard for existing ones.
 *
 * Visual layer: composed from the shared app primitives (`Panel`,
 * `SectionHeading`, `StatusPill`, `EmptyState`) rather than hand-rolled slate
 * markup, so this page and the vendor portal finally share a surface
 * vocabulary. See `components/ui/panel.tsx` for the hierarchy rules.
 */
"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useUserRole } from "@/hooks/use-user-role";
import { GateLoading, WalletGate, useMounted } from "@/components/wallet-gate";
import { ShieldCheckIcon, XCircleIcon, ClockIcon, ArrowRightIcon } from "@/app/icons";
import { fetchOrgMigrations, fetchOrgAssets, fetchAssetVerification } from "@/lib/api";
import { OperatorAccessPanel } from "@/components/operator-access";
import {
  Panel,
  PanelBody,
  PanelTitle,
  SectionHeading,
} from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/state";

const PlanningPanel = dynamic(
  () => import("@/components/planning-panel").then((m) => m.PlanningPanel),
  {
    ssr: false,
    loading: () => <PanelSkeleton rows={3} />,
  },
);

const SideChannelPanel = dynamic(() => import("@/components/side-channel-panel"), { ssr: false });
const QuantumThreatPanel = dynamic(() => import("@/components/quantum-threat-panel"), { ssr: false });
const AnomalyPanel = dynamic(() => import("@/components/anomaly-panel"), { ssr: false });
const RLPlanViewer = dynamic(() => import("@/components/rl-plan-viewer"), { ssr: false });

/** Placeholder matching the panel chrome, so the frame does not jump on load. */
function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mt-3 animate-pulse space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-4 w-full rounded bg-neutral-surface" />
      ))}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Panel>
      <PanelBody>
        <PanelTitle>{label}</PanelTitle>
        <p className="mt-2 font-display text-2xl font-semibold tabular-nums tracking-[-0.03em] text-foreground">
          {value}
        </p>
        {sub ? <p className="mt-1 text-micro text-muted-foreground">{sub}</p> : null}
      </PanelBody>
    </Panel>
  );
}

function AuditStatus({ code, exists }: { code: number | null; exists: boolean }) {
  if (!exists) {
    return (
      <StatusPill tone="neutral" icon={<ClockIcon className="h-3.5 w-3.5" />}>
        No audit yet
      </StatusPill>
    );
  }
  if (code === 1) {
    return (
      <StatusPill tone="success" icon={<ShieldCheckIcon className="h-3.5 w-3.5" />}>
        Passed
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="danger" icon={<XCircleIcon className="h-3.5 w-3.5" />}>
      Failed
    </StatusPill>
  );
}

/** Centred message page used for the wallet/role gates. */
function CenteredNote({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md px-5 py-24 text-center sm:px-8">
      <h1 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
        {title}
      </h1>
      {children}
    </div>
  );
}

function DashboardInner() {
  const { address, isConnecting, isReconnecting } = useAccount();
  const org = address ?? null;
  const loading = isConnecting || isReconnecting;
  const { isOrg, isLoading: roleLoading } = useUserRole();

  const orgQuery = useQuery({
    queryKey: ["org", org],
    queryFn: async () => {
      const [migrations, assets] = await Promise.all([
        fetchOrgMigrations(org!),
        fetchOrgAssets(org!),
      ]);
      return { migrations, assets };
    },
    enabled: Boolean(org),
    staleTime: 30_000,
  });

  if (loading || roleLoading) {
    return <GateLoading />;
  }

  if (!org) {
    return (
      <CenteredNote title="Org dashboard">
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Connect a wallet to view your migration progress and audit status.
        </p>
        <div className="mt-6 flex justify-center [&>div]:w-auto">
          <ConnectButton />
        </div>
      </CenteredNote>
    );
  }

  // Role-aware routing: show onboarding for new orgs, dashboard for existing ones
  if (!isOrg) {
    return (
      <CenteredNote title="Welcome to Q-Trust">
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your wallet is connected, but you haven&rsquo;t registered any assets yet.
        </p>
        <div className="mt-6 space-y-3">
          <Link
            href="/scanner"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-qtrust-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 focus-visible:ring-offset-2"
          >
            Run your first scan
            <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
          </Link>
          <p className="text-micro text-muted-foreground">
            Or visit the{" "}
            <Link
              href="/vendors"
              className="font-medium text-qtrust-600 underline decoration-qtrust-600/30 underline-offset-4 transition hover:decoration-qtrust-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
            >
              vendor portal
            </Link>{" "}
            if you&rsquo;re a vendor.
          </p>
        </div>
      </CenteredNote>
    );
  }

  const p = orgQuery.data?.migrations?.progress;
  const latest = orgQuery.data?.migrations?.latest_audit;
  const assets = orgQuery.data?.assets ?? [];

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14 lg:px-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-[-0.035em] text-foreground">
            Org dashboard
          </h1>
          <p className="mt-2 break-all font-mono text-micro text-muted-foreground">{org}</p>
        </div>
        <AuditStatus code={latest?.result_code ?? null} exists={latest?.exists ?? false} />
      </header>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total migrations" value={String(p?.total_migrations ?? 0)} />
        <Stat label="Verified" value={String(p?.verified_migrations ?? 0)} sub="on-chain verified" />
        <Stat label="Pending" value={String(p?.unverified_migrations ?? 0)} />
      </div>

      {latest?.exists ? (
        <p className="mt-4 text-micro text-muted-foreground">
          Latest audit: <span className="font-medium text-foreground">{latest.result}</span> (code{" "}
          {latest.result_code}) at {new Date(latest.timestamp * 1000).toLocaleString()}
        </p>
      ) : null}

      <div className="mt-10">
        <OperatorAccessPanel />
      </div>

      <SectionHeading className="mt-12">Migration plan</SectionHeading>
      <PlanningPanel />

      <SectionHeading className="mt-12">
        Registered assets ({assets.length})
      </SectionHeading>
      <Panel className="mt-3 overflow-hidden">
        {assets.length === 0 ? (
          <EmptyState
            title="No assets registered yet"
            description={
              <>
                Register a cryptographic inventory with{" "}
                <code className="rounded bg-neutral-surface px-1 py-0.5 font-mono text-micro">
                  crypto-inspector register-cbom
                </code>
                , or run a scan to produce one.
              </>
            }
            action={
              <Link
                href="/scanner"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-micro font-semibold text-foreground transition hover:border-qtrust-500 hover:text-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
              >
                Run a scan
                <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {assets.map((a) => (
              <li
                key={a.asset_id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-micro text-foreground">{a.asset_id}</div>
                  <div className="mt-1 truncate text-micro text-muted-foreground">{a.metadata_uri}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusPill tone={a.active ? "success" : "neutral"}>
                    {a.active ? "active" : "inactive"}
                  </StatusPill>
                  <Link
                    href={`/v/${a.asset_id}`}
                    className="text-micro font-medium text-qtrust-600 transition hover:text-qtrust-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
                  >
                    Verify
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {assets.length > 0 ? (
        <>
          <SectionHeading className="mt-12">Sample verification flow</SectionHeading>
          <p className="mt-2 text-micro text-muted-foreground">
            Reads the on-chain record directly — no wallet, no account.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {assets.slice(0, 3).map((a) => (
              <VerifyButton key={a.asset_id} assetId={a.asset_id} />
            ))}
          </div>
        </>
      ) : null}

      <SectionHeading className="mt-12">GPU-accelerated analysis</SectionHeading>
      <p className="mt-2 max-w-3xl text-micro leading-6 text-muted-foreground">
        Side-channel verification of PQC binaries, Shor-based quantum threat estimates, VAE
        anomaly scoring and the RL migration planner. Requires{" "}
        <code className="rounded bg-neutral-surface px-1 py-0.5 font-mono">QTRUST_GPU_ENABLED=true</code>{" "}
        on the API.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <SideChannelPanel />
        <QuantumThreatPanel />
        <AnomalyPanel />
        <RLPlanViewer />
      </div>
    </div>
  );
}

function VerifyButton({ assetId }: { assetId: string }) {
  // `enabled: false` keeps this on-demand, but the result has to go back through
  // the query cache — previously the click refetched and discarded the response,
  // so the label was stuck on "Verify on-chain" and the control did nothing.
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["verify", assetId],
    queryFn: () => fetchAssetVerification(assetId),
    enabled: false,
    retry: false,
  });

  const label = isFetching
    ? "Verifying…"
    : isError
      ? "Verification failed — retry"
      : data
        ? data.active
          ? "Verified ✓ active"
          : "Verified ✗ inactive"
        : "Verify on-chain";

  return (
    <button
      type="button"
      onClick={() => void refetch()}
      disabled={isFetching}
      aria-busy={isFetching}
      className={`rounded-lg border px-4 py-2 text-micro font-medium shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 ${
        isError
          ? "border-danger-border bg-danger-surface text-danger"
          : "border-border bg-card text-foreground hover:border-qtrust-500 hover:text-qtrust-700"
      }`}
    >
      {label}
    </button>
  );
}

export default function DashboardPage() {
  const mounted = useMounted();
  const { address, isConnecting, isReconnecting } = useAccount();
  const { isLoading: roleLoading } = useUserRole();

  if (!mounted || isConnecting || isReconnecting || roleLoading) {
    return (
      <main className="flex-1 bg-canvas text-foreground">
        <GateLoading />
      </main>
    );
  }

  // P1 fix: gate only on wallet connection. Gating on role === "none" blocked
  // every connected-but-new wallet at the WalletGate ("connect a wallet")
  // even though the wallet WAS connected — making DashboardInner's onboarding
  // ("run your first scan" / vendor link) unreachable. Role remains a UI hint
  // inside DashboardInner, matching the /vendors pattern.
  if (!address) {
    return (
      <main className="flex-1 bg-canvas text-foreground">
        <WalletGate description="Connect a wallet to view your organization's migration progress, audit status, and registered assets." />
      </main>
    );
  }

  return (
    <main className="flex-1 bg-canvas text-foreground">
      <DashboardInner />
    </main>
  );
}

/**
 * Vendor portal — attestations for a vendor address, product support lookup.
 * Role-aware: shows onboarding for new vendors, portal for existing ones.
 *
 * Composed from the shared app primitives (`Panel`, `SectionHeading`,
 * `StatusPill`, `EmptyState`) so it matches the org dashboard rather than
 * re-deriving its own card and chip markup.
 */
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useUserRole } from "@/hooks/use-user-role";
import { GateLoading, WalletGate, useMounted } from "@/components/wallet-gate";
import { AttestationForm } from "@/components/attestation-form";
import { OperatorAccessPanel } from "@/components/operator-access";
import { ShieldCheckIcon, XCircleIcon, ArrowRightIcon } from "@/app/icons";
import { fetchVendorAttestations, checkProductSupport, type VendorAttestationInfo } from "@/lib/api";
import { sanitizeUri } from "@/lib/sanitize-uri";
import { Panel, PanelBody, PanelTitle, SectionHeading } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/state";

function AttestationRow({ att }: { att: VendorAttestationInfo }) {
  const safeHref = sanitizeUri(att.evidence_uri);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
      <div className="min-w-0">
        <div className="truncate font-mono text-micro text-foreground">{att.attestation_id}</div>
        <div className="mt-1 text-micro text-muted-foreground">
          {att.product_id} · v{att.version} · {att.algorithm}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {att.revoked ? (
          <StatusPill tone="danger" icon={<XCircleIcon className="h-3.5 w-3.5" />}>
            revoked
          </StatusPill>
        ) : att.supported ? (
          <StatusPill tone="success" icon={<ShieldCheckIcon className="h-3.5 w-3.5" />}>
            supported
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">unsupported</StatusPill>
        )}
        {safeHref ? (
          <a
            href={safeHref}
            target="_blank"
            rel="noreferrer"
            className="text-micro font-medium text-qtrust-600 transition hover:text-qtrust-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
          >
            evidence
          </a>
        ) : (
          <span className="text-micro text-muted-foreground" title="evidence URI failed scheme validation">
            evidence unavailable
          </span>
        )}
      </div>
    </li>
  );
}

/** Labelled text field used by the product-support lookup. */
function QueryField({
  label,
  value,
  onChange,
  width,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  width: string;
}) {
  return (
    <label className="block">
      <PanelTitle as="h3" className="mb-1.5 block">
        {label}
      </PanelTitle>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`block rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition focus:border-qtrust-600 focus:outline-none focus:ring-2 focus:ring-qtrust-600/25 ${width}`}
      />
    </label>
  );
}

function VendorsInner() {
  const { address, isConnecting, isReconnecting } = useAccount();
  const vendor = address ?? null;
  const loading = isConnecting || isReconnecting;
  const { isVendor, isLoading: roleLoading } = useUserRole();

  const [productId, setProductId] = useState("DigiCert-TLS");
  const [version, setVersion] = useState("5.2.1");
  const [algorithm, setAlgorithm] = useState("ML-DSA-44");

  const attestations = useQuery({
    queryKey: ["vendor-attestations", vendor],
    queryFn: () => fetchVendorAttestations(vendor!),
    enabled: Boolean(vendor),
  });

  const support = useQuery({
    queryKey: ["product-support", productId, version, algorithm],
    queryFn: () => checkProductSupport(productId, version, algorithm),
    enabled: Boolean(productId && version && algorithm),
  });

  if (loading || roleLoading) {
    return <GateLoading />;
  }

  // Role-aware routing: show onboarding for non-vendors
  if (vendor && !isVendor) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center sm:px-8">
        <h1 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
          Welcome to Q-Trust Vendor Portal
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your wallet is connected, but you&rsquo;re not registered as a vendor yet.
        </p>
        <div className="mt-6 space-y-3">
          <Link
            href="/scanner"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-qtrust-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 focus-visible:ring-offset-2"
          >
            Inventory your products
            <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
          </Link>
          <p className="text-micro text-muted-foreground">
            Or visit the{" "}
            <Link
              href="/dashboard"
              className="font-medium text-qtrust-600 underline decoration-qtrust-600/30 underline-offset-4 transition hover:decoration-qtrust-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
            >
              org dashboard
            </Link>{" "}
            if you&rsquo;re an organization.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14 lg:px-12">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-[-0.035em] text-foreground">
          Vendor portal
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Attestations issued by a vendor and product support lookups.
        </p>
      </header>

      {!loading && !vendor ? (
        <div className="mt-6 [&>div]:w-auto">
          <ConnectButton />
        </div>
      ) : null}

      {vendor ? (
        <>
          <SectionHeading className="mt-12">
            Attestations ({attestations.data?.attestations.length ?? 0})
          </SectionHeading>
          <Panel className="mt-3 overflow-hidden">
            {attestations.isLoading ? (
              <div className="animate-pulse space-y-3 p-5" aria-hidden="true">
                <div className="h-4 w-2/3 rounded bg-neutral-surface" />
                <div className="h-4 w-1/2 rounded bg-neutral-surface" />
              </div>
            ) : attestations.data?.attestations.length ? (
              <ul className="divide-y divide-border">
                {attestations.data.attestations.map((a) => (
                  <AttestationRow key={a.attestation_id} att={a} />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No attestations issued yet"
                description={
                  <>
                    Publish a product attestation with the form below, or from CI with{" "}
                    <code className="rounded bg-neutral-surface px-1 py-0.5 font-mono text-micro">
                      crypto-inspector attest-product
                    </code>
                    .
                  </>
                }
              />
            )}
          </Panel>

          <div className="mt-4">
            <OperatorAccessPanel />
          </div>

          <AttestationForm vendor={vendor} />

          <SectionHeading className="mt-12">Product support check</SectionHeading>
          <p className="mt-2 text-micro leading-6 text-muted-foreground">
            Ask whether a specific product version supports a post-quantum algorithm.
          </p>
          <Panel className="mt-3">
            <PanelBody>
              <div className="flex flex-wrap items-end gap-4">
                <QueryField label="Product ID" value={productId} onChange={setProductId} width="w-48" />
                <QueryField label="Version" value={version} onChange={setVersion} width="w-28" />
                <QueryField label="Algorithm" value={algorithm} onChange={setAlgorithm} width="w-40" />

                <div className="sm:ml-auto">
                  {support.isLoading ? (
                    <StatusPill tone="neutral">Checking…</StatusPill>
                  ) : support.data?.supported ? (
                    <StatusPill tone="success" icon={<ShieldCheckIcon className="h-4 w-4" />}>
                      Supported
                    </StatusPill>
                  ) : (
                    <StatusPill tone="neutral" icon={<XCircleIcon className="h-4 w-4" />}>
                      Not supported
                    </StatusPill>
                  )}
                </div>
              </div>
            </PanelBody>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

export default function VendorsPage() {
  const mounted = useMounted();
  const { address, isConnecting, isReconnecting } = useAccount();
  const { role, isLoading: roleLoading } = useUserRole();

  if (!mounted || isConnecting || isReconnecting || roleLoading) {
    return (
      <main className="flex-1 bg-canvas text-foreground">
        <GateLoading />
      </main>
    );
  }

  if (!address || role === "none") {
    return (
      <main className="flex-1 bg-canvas text-foreground">
        <WalletGate description="Connect a wallet to view your attestations and check product PQC support as a vendor." />
      </main>
    );
  }

  return (
    <main className="flex-1 bg-canvas text-foreground">
      <VendorsInner />
    </main>
  );
}

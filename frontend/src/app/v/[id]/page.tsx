/**
 * Public verification page — renders an attestation by its on-chain asset ID.
 *
 * Server component (async). Fetches from the Q-Trust backend at request time
 * (force-dynamic — a verification result must never be served stale).
 * Shows:
 *   - Status badge (VALID/REVOKED)
 *   - Organization DID
 *   - Timestamp
 *   - CBOM hash
 *   - Provenance graph (Code -> Scanner -> CBOM -> Asset -> Migration),
 *     rendered client-side via next/dynamic so its bundle stays off the
 *   - Metadata from IPFS (if available)
 *   - "Verify independently" CLI command at the bottom
 */
import { notFound } from "next/navigation";
import { ArrowTopRightOnSquareIcon, ShieldCheckIcon, XCircleIcon, ClockIcon } from "@/app/icons";
import { ProvenanceGraph } from "@/components/provenance-graph";
import { CodeBlock } from "@/components/ui/code-block";

import { fetchAsset, fetchAssetVerification, fetchIpfsJson, type AssetInfo, type AssetVerification } from "@/lib/api";
import { parseAssetId } from "@/lib/config";
import { BadgeEmbed } from "@/components/badge-embed";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function VerificationPage({ params }: Props) {
  const { id } = await params;

  let asset: AssetInfo;
  let verification: AssetVerification;
  let ipfsMetadata: Record<string, unknown> | null = null;

  try {
    asset = await fetchAsset(id);
    verification = await fetchAssetVerification(id);
  } catch (err) {
    // A missing record is an ordinary 404. Anything else — backend down,
    // upstream 5xx, timeout — is an availability problem, and rethrowing it
    // produced a blank 500 on the one page whose entire purpose is to let a
    // third party check a claim. "The record could not be reached" has to be
    // stated as such; failing silently or generically undermines the trust the
    // page exists to establish.
    if (err instanceof Error && err.message.includes("404")) {
      notFound();
    }
    return <VerificationUnavailable assetId={id} />;
  }

  // Fetch IPFS metadata in parallel (non-blocking — page renders without it).
  if (asset.metadata_uri) {
    try {
      ipfsMetadata = await fetchIpfsJson(asset.metadata_uri);
    } catch {
      // ignore — page still renders
    }
  }

  const status = verification.active ? "VALID" : "REVOKED";
  const timestamp = new Date(asset.timestamp * 1000).toISOString();

  // Audit H-7: asset.asset_id is server-controlled but must never be trusted
  // blindly — it is interpolated into copy-pastable shell/Python snippets
  // below. Only render the CLI block when the ID strictly matches
  // 0x + 64 hex chars (parseAssetId enforces this).
  let safeAssetId: string | null = null;
  try {
    safeAssetId = parseAssetId(asset.asset_id);
  } catch {
    safeAssetId = null;
  }

  return (
    <main className="flex-1 bg-canvas text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header — the unified app-layer treatment: mono eyebrow, display
            title, muted lede, with the status badge as the header action. */}
        <header className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-micro font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Public verification
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold leading-[0.95] tracking-[-0.04em] text-foreground sm:text-4xl">
              Q-Trust Attestation
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Public verification of cryptographic asset provenance on {verification.chain_name}
            </p>
          </div>
          <StatusBadge status={status} />
        </header>

        {/* Asset ID + key facts */}
        <section className="rounded-xl border border-border bg-canvas-raised p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Asset details</h2>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <Field label="Asset ID" value={asset.asset_id} mono />
            <Field label="Status" value={status} />
            <Field label="Organization DID" value={asset.org_did} mono />
            <Field label="Chain" value={`${verification.chain_name} (id ${verification.chain_id})`} />
            <Field
              label="Registered at"
              value={timestamp}
              icon={<ClockIcon className="h-4 w-4 text-muted-foreground" />}
            />
            <Field label="Last updated" value={new Date(asset.last_updated * 1000).toISOString()} />
            <Field label="CBOM hash" value={asset.cbom_hash} mono colSpan2 />
            <Field label="Metadata URI" value={asset.metadata_uri} mono colSpan2 />
          </dl>
        </section>

        {/* Provenance graph */}
        <section className="mt-6 rounded-xl border border-border bg-canvas-raised p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Provenance graph
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            The chain of trust from source code scan to on-chain attestation.
          </p>
          <ProvenanceGraph asset={asset} verification={verification} />
        </section>

        {/* IPFS metadata */}
        {ipfsMetadata && (
          <section className="mt-6 rounded-xl border border-border bg-canvas-raised p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              IPFS metadata
            </h2>
            <CodeBlock
              label="IPFS metadata JSON"
              className="max-h-96 overflow-auto rounded-lg bg-night p-4 text-xs text-night-ink"
            >
              <code>{JSON.stringify(ipfsMetadata, null, 2)}</code>
            </CodeBlock>
          </section>
        )}

        {/* Verify independently */}
        <section className="mt-6 rounded-xl border border-border bg-canvas-raised p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Verify independently</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Anyone can verify this attestation without trusting Q-Trust. Run the CLI:
          </p>
          {safeAssetId ? (
            <CodeBlock
              label="Independent verification commands"
              className="overflow-auto rounded-lg bg-night p-4 text-xs text-night-ink"
            >
              <code>{`# Install the Q-Trust SDK
pip install qtrust-sdk

# Verify on-chain
python -c "from qtrust import QTrustClient; print(QTrustClient().verify_asset('${safeAssetId}'))"

# Or use the scanner CLI
crypto-inspector verify ${safeAssetId}`}</code>
            </CodeBlock>
          ) : (
            <p className="rounded-lg bg-warning-surface p-4 text-xs text-warning ring-1 ring-inset ring-warning-border">
              The asset ID for this record is not in the expected format, so the
              copy-paste verification commands are hidden. Copy the Asset ID from
              the table above and pass it to <code>crypto-inspector verify</code> manually.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            The CLI calls the AssetRegistry contract directly on {verification.chain_name} —
            no central server involved.
          </p>
        </section>

        {/* Shareable badge */}
        <BadgeEmbed
          assetId={safeAssetId ?? id}
          badgePath={`/api/badge/${encodeURIComponent(safeAssetId ?? id)}`}
        />

        <footer className="mt-8 flex flex-col gap-2 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span>
            Verified at {new Date(verification.verified_at * 1000).toISOString()}
          </span>
          <a
            href={`${verification.chain_id === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org"}/address/${verification.org_did}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            View on Basescan
            <ArrowTopRightOnSquareIcon className="h-3 w-3" />
          </a>
        </footer>
      </div>
    </main>
  );
}

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------

/**
 * Shown when the record itself cannot be fetched. Deliberately distinct from
 * both the 404 page ("no such record") and a crash ("something went wrong"):
 * this is "unknown", and conflating it with either would misrepresent what the
 * chain says.
 */
function VerificationUnavailable({ assetId }: { assetId: string }) {
  // Audit H-7 (unreachable branch): the raw route param reaches this component
  // unvalidated, and like the main flow above it is interpolated into a
  // copy-pastable CLI snippet. Gate it through the same parseAssetId check;
  // when it fails, render a literal placeholder instead of the raw param.
  let safeAssetId: string;
  try {
    safeAssetId = parseAssetId(assetId);
  } catch {
    safeAssetId = "<asset-id>";
  }
  return (
    <main className="flex-1 bg-canvas text-foreground">
      <div className="mx-auto max-w-2xl px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <p className="font-mono text-micro font-semibold uppercase tracking-[0.16em] text-risk-medium">
          Record unreachable
        </p>
        <h1 className="mt-6 font-display text-3xl font-semibold leading-[0.95] tracking-[-0.04em] text-foreground sm:text-4xl">
          We could not read this attestation.
        </h1>
        <p className="mt-5 text-sm leading-7 text-muted-foreground">
          The verification service is not responding. This is an availability
          failure on our side — it says nothing about whether the record is
          valid, so please do not read it as one.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-canvas-raised p-5 shadow-sm">
          <p className="font-mono text-label font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Asset ID
          </p>
          <p className="mt-2 break-all font-mono text-xs text-foreground">{assetId}</p>
        </div>

        <p className="mt-8 text-sm leading-7 text-muted-foreground">
          Retry in a moment, or verify the same record without this deployment:
        </p>
        <CodeBlock
          label="Independent verification command"
          className="mt-4 overflow-x-auto rounded-xl border border-night-edge bg-night p-4 font-mono text-xs leading-6 text-night-ink"
        >
          <code>crypto-inspector verify {safeAssetId}</code>
        </CodeBlock>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: "VALID" | "REVOKED" }) {
  if (status === "VALID") {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 self-start rounded-full bg-success-surface px-3 py-1.5 text-sm font-medium text-success ring-1 ring-inset ring-success-border sm:self-center">
        <ShieldCheckIcon className="h-4 w-4" />
        VALID
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit items-center gap-1.5 self-start rounded-full bg-danger-surface px-3 py-1.5 text-sm font-medium text-danger ring-1 ring-inset ring-danger-border sm:self-center">
      <XCircleIcon className="h-4 w-4" />
      REVOKED
    </span>
  );
}

function Field({
  label,
  value,
  mono = false,
  colSpan2 = false,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  colSpan2?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className={colSpan2 ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-1 flex items-center gap-2 text-foreground ${mono ? "font-mono text-xs break-all" : ""}`}>
        {icon}
        <span className="break-all">{value}</span>
      </dd>
    </div>
  );
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return {
    // The brand is omitted deliberately — the root layout's `title.template`
    // appends `· Q-Trust`, so writing it here produced a doubled suffix.
    title: `Asset ${id.slice(0, 10)}…`,
    description: `Public verification of Q-Trust attestation ${id.slice(0, 10)}… on Base.`,
    // One page per attestation ID: unbounded, low-value URLs. Kept out of the
    // index for the same reason `sitemap.ts` does not enumerate them.
    robots: { index: false, follow: true },
  };
}

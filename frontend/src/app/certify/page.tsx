import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@/app/icons";
import {
  CertificationVerifier,
  type CertificationPolicySummary,
  type PlatformIssuerIdentity,
} from "@/components/certification-verifier.client";
import { SectionHeading } from "@/components/ui/panel";
import { apiGetJson } from "@/lib/api";

export const metadata: Metadata = {
  title: "Verify a certification bundle",
  description:
    "Check a Q-Trust certification bundle offline: canonical digest, evidence Merkle root, Ed25519 issuer signature and validity window — then optionally re-anchor it to Base.",
  alternates: { canonical: "/certify" },
};

// Admission policies are read at request time. A build-time fetch would bake a
// failed lookup into the page whenever the backend was not running during the
// build, and a stale policy list is worse than an omitted one.
export const dynamic = "force-dynamic";

interface PoliciesResponse {
  policies: CertificationPolicySummary[];
  schema: string;
}

const WHAT_IS_CHECKED = [
  "The bundle hashes to the digest the issuer signed — change one byte of evidence and the digest check fails.",
  "Every evidence record hashes to its Merkle leaf, and the leaves rebuild the published root — a record cannot be swapped or silently dropped.",
  "The Ed25519 proof verifies against the issuer key named inside the bundle.",
  "The validity window contains the current instant; expired bundles fail closed.",
];

const WHAT_IS_NOT_PROVEN =
  "No offline check proves who signed. A bundle self-consistently signed by any key " +
  "passes — which is why the pinned issuer DID exists. Pin the issuer you expect, or " +
  "this deployment's key, before treating a verdict as an admission decision.";

export default async function CertifyPage() {
  let policies: CertificationPolicySummary[] = [];
  let platformIssuer: PlatformIssuerIdentity | null = null;
  try {
    const body = await apiGetJson<PoliciesResponse>("/v1/certify/policies", {
      cache: "no-store",
      // The list is a convenience; a slow/unreachable backend must not hold the
      // page open. Verification itself is unaffected.
      signal: AbortSignal.timeout(3_000),
    });
    if (Array.isArray(body?.policies)) policies = body.policies;
  } catch {
    // The verifier itself does not depend on this list; render without it.
  }

  try {
    const identity = await apiGetJson<PlatformIssuerIdentity>("/v1/certify/issuer", {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    // Public key material only, and only used to prefill a pin the visitor can
    // ignore — so validate the shape rather than trusting the type parameter.
    if (
      typeof identity?.issuer === "string" &&
      identity.issuer.startsWith("did:") &&
      typeof identity.key_fingerprint === "string"
    ) {
      platformIssuer = identity;
    }
  } catch {
    // No pin suggestion; the field still accepts a DID typed in by hand.
  }

  return (
    <main className="flex-1 bg-canvas text-foreground">
      {/* Page header — the unified app-layer treatment: mono eyebrow, display
          title, muted lede, hairline rule. Same pattern as /scanner and /v. */}
      <header className="border-b border-border bg-canvas">
        <div className="mx-auto max-w-[86rem] px-5 pb-10 pt-8 sm:px-8 sm:pb-12 sm:pt-12 lg:px-12">
          <p className="flex items-center gap-3 font-mono text-micro font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            <span className="h-px w-10 bg-qtrust-600" aria-hidden="true" />
            Q-Trust certification
          </p>
          <h1 className="mt-5 max-w-3xl font-display text-3xl font-semibold leading-[0.95] tracking-[-0.04em] text-foreground sm:text-4xl">
            Verify a certification bundle.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            A certification bundle is a signed snapshot of an organisation&apos;s
            assurance state: the evidence that existed at a block, committed to a
            Merkle root, under a policy verdict and a validity window. The checks
            below run with no account and no network access.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Looking for an on-chain attestation instead?{" "}
            <Link
              href="/v"
              className="inline-flex items-center gap-1 font-medium text-qtrust-600 underline decoration-qtrust-600/40 underline-offset-4 transition hover:decoration-qtrust-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
            >
              Verify by asset ID
              <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[86rem] px-5 py-10 sm:px-8 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
          <div>
            <SectionHeading as="h2" id="verifier-heading" className="mb-3">
              Check a bundle
            </SectionHeading>
            <CertificationVerifier platformIssuer={platformIssuer} />
          </div>

          <aside className="space-y-8">
            <section aria-labelledby="what-is-checked">
              <SectionHeading id="what-is-checked">What the checks prove</SectionHeading>
              <ul className="mt-3 space-y-3">
                {WHAT_IS_CHECKED.map((item) => (
                  <li
                    key={item}
                    className="border-l-2 border-qtrust-600/30 pl-3 text-micro leading-5 text-muted-foreground"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="not-proven">
              <SectionHeading id="not-proven">What they do not prove</SectionHeading>
              <p className="mt-3 border-l-2 border-warning-border pl-3 text-micro leading-5 text-muted-foreground">
                {WHAT_IS_NOT_PROVEN}
              </p>
            </section>

            <section aria-labelledby="policies-heading">
              <SectionHeading id="policies-heading">Admission policies</SectionHeading>
              {policies.length > 0 ? (
                <dl className="mt-3 space-y-4">
                  {policies.map((policy) => (
                    <div key={policy.id}>
                      <dt className="font-mono text-micro font-semibold text-foreground">
                        {policy.id}
                      </dt>
                      <dd className="mt-1 text-micro leading-5 text-muted-foreground">
                        {policy.description} Maximum validity {policy.max_validity_days} days.
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-micro leading-5 text-muted-foreground">
                  The policy list is not reachable right now. It does not affect
                  verification: the policy a bundle was issued under travels
                  inside the bundle.
                </p>
              )}
            </section>

            <section aria-labelledby="cli-heading">
              <SectionHeading id="cli-heading">Verify without this page</SectionHeading>
              <p className="mt-3 text-micro leading-5 text-muted-foreground">
                The bundle is verifiable by anyone with the schema and the issuer
                key — the Python SDK ships that verifier, and the signature does
                not depend on Q-Trust infrastructure staying online.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-xl border border-night-edge bg-night p-3 font-mono text-micro leading-5 text-night-ink-soft">
                <code>{`from qtrust import verify_bundle_file

result = verify_bundle_file("bundle.json")
assert result.valid`}</code>
              </pre>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

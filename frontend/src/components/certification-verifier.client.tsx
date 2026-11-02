"use client";

/**
 * Browser-side verification of a certification bundle.
 *
 * The backend's `/v1/certify/verify` re-checks the bundle from scratch —
 * canonical digest, per-record hashes, Merkle root, Ed25519 signature and
 * validity window — with no network access unless the caller asks for a chain
 * re-anchor. This component is only the input and the report; it deliberately
 * does not re-implement any check, so the browser cannot disagree with the
 * API about what "valid" means.
 *
 * The textarea is the primary control because bundles are usually pasted from
 * a terminal or a vendor email; the file picker is a convenience for saved
 * `.json`. Both paths converge on the same `verify` call.
 */
import { useId, useState } from "react";
import { CheckIcon, ShieldCheckIcon, XCircleIcon } from "@/app/icons";
import { apiPostJson } from "@/lib/api";
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelFooter,
  PanelHeader,
  PanelHeading,
  PanelTitle,
  PanelDescription,
} from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";

export interface CertificationPolicySummary {
  id: string;
  version: string;
  description: string;
  max_validity_days: number;
}

/** Public identity of the key this deployment signs bundles with. */
export interface PlatformIssuerIdentity {
  issuer: string;
  verification_method: string;
  key_fingerprint: string;
}

interface VerificationChecklist {
  structure: boolean;
  digest: boolean;
  merkle: boolean;
  signature: boolean;
  validity: boolean;
}

type ChainAnchor = "verified" | "mismatch" | "unavailable" | "skipped";

interface BundleVerification {
  valid: boolean;
  bundle_id: string | null;
  issuer: string | null;
  subject: string | null;
  verdict: string | null;
  reasons: string[];
  caveats: string[];
  valid_until: string | null;
  expired: boolean;
  checked: VerificationChecklist;
  chain_anchor: ChainAnchor;
  timestamp: string;
}

const CHECKS: Array<{ key: keyof VerificationChecklist; label: string; detail: string }> = [
  {
    key: "structure",
    label: "Schema and canonical shape",
    detail: "Every required field is present and typed as the schema declares.",
  },
  {
    key: "digest",
    label: "Bundle digest",
    detail: "The canonical JSON hashes to the digest the issuer published.",
  },
  {
    key: "merkle",
    label: "Evidence Merkle root",
    detail: "Each evidence record hashes to its leaf, and the leaves rebuild the root.",
  },
  {
    key: "signature",
    label: "Ed25519 issuer signature",
    detail: "The proof verifies against the issuer key the bundle names.",
  },
  {
    key: "validity",
    label: "Validity window",
    detail: "The bundle is valid now: not before valid_from and not after valid_until.",
  },
];

const ANCHOR_COPY: Record<ChainAnchor, { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  verified: { label: "Anchored block hash matches the chain", tone: "success" },
  mismatch: { label: "Anchored block hash does not match", tone: "danger" },
  unavailable: { label: "Chain re-anchor could not be completed", tone: "warning" },
  skipped: { label: "Not requested — offline verification only", tone: "neutral" },
};

function parseBundle(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid JSON";
    throw new Error(`Bundle is not valid JSON: ${message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Bundle must be a JSON object, not an array or scalar.");
  }
  return parsed as Record<string, unknown>;
}

export function CertificationVerifier({
  platformIssuer,
}: {
  platformIssuer?: PlatformIssuerIdentity | null;
} = {}) {
  const inputId = useId();
  const fileId = useId();
  const chainId = useId();
  const pinId = useId();
  const platformIssuerId = useId();
  const errorId = useId();
  const [text, setText] = useState("");
  const [checkChain, setCheckChain] = useState(false);
  const [pinnedIssuer, setPinnedIssuer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BundleVerification | null>(null);

  async function verify() {
    setError(null);
    setResult(null);
    let bundle: Record<string, unknown>;
    try {
      bundle = parseBundle(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bundle could not be read.");
      return;
    }

    setPending(true);
    try {
      const pin = pinnedIssuer.trim();
      const payload = await apiPostJson<BundleVerification>("/v1/certify/verify", {
        bundle,
        check_chain: checkChain,
        ...(pin ? { trust_anchor_did: pin } : {}),
      });
      if (typeof payload?.valid !== "boolean" || typeof payload.checked !== "object") {
        throw new Error("The verifier returned an unexpected response.");
      }
      setResult(payload);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Verification failed — the API could not be reached.",
      );
    } finally {
      setPending(false);
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      setText(await file.text());
    } catch {
      setError("That file could not be read. Paste the bundle text instead.");
    }
  }

  const anchor = result ? ANCHOR_COPY[result.chain_anchor] ?? ANCHOR_COPY.skipped : null;

  return (
    <div className="space-y-6">
      <Panel aria-labelledby={`${inputId}-heading`}>
        <PanelHeader>
          <PanelHeading>
            <PanelTitle id={`${inputId}-heading`}>Certification bundle</PanelTitle>
            <PanelDescription>
              Paste the JSON a verifier issued, or load a saved bundle. Nothing
              leaves this deployment.
            </PanelDescription>
          </PanelHeading>
          {text ? (
            <PanelActions>
              <button
                type="button"
                onClick={() => {
                  setText("");
                  setError(null);
                  setResult(null);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-micro font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
              >
                Clear
              </button>
            </PanelActions>
          ) : null}
        </PanelHeader>

        <PanelBody>
          <label
            htmlFor={`${inputId}-bundle`}
            className="block text-sm font-medium text-foreground"
          >
            Bundle JSON
          </label>
          <textarea
            id={`${inputId}-bundle`}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError(null);
            }}
            rows={12}
            spellCheck={false}
            placeholder={'{ "schema": "qtrust.certification.v1", ... }'}
            aria-describedby={error ? `${errorId} ${inputId}-help` : `${inputId}-help`}
            aria-invalid={error ? true : undefined}
            className="mt-2 w-full resize-y rounded-xl border border-border bg-card px-3 py-3 font-mono text-micro leading-5 text-foreground placeholder:text-muted-foreground transition focus:border-qtrust-600 focus:outline-none focus:ring-2 focus:ring-qtrust-600/25 aria-[invalid=true]:border-danger"
          />
          <p id={`${inputId}-help`} className="mt-2 text-micro leading-5 text-muted-foreground">
            The bundle is self-contained: evidence records, Merkle root and
            signature travel with it. Verification runs offline unless you
            request a chain re-anchor below.
          </p>

          <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-3">
              <div>
                <label
                  htmlFor={fileId}
                  className="block text-micro font-medium text-foreground"
                >
                  Load from a file
                </label>
                <input
                  id={fileId}
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    void loadFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                  className="mt-1 block w-full text-micro text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-micro file:font-medium file:text-foreground hover:file:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
                />
              </div>

              <div className="flex items-start gap-2">
                <input
                  id={chainId}
                  type="checkbox"
                  checked={checkChain}
                  onChange={(event) => setCheckChain(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-qtrust-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
                />
                <label htmlFor={chainId} className="text-micro leading-5 text-foreground">
                  Re-anchor to the chain
                  <span className="block text-muted-foreground">
                    Fetches the anchored block and compares its hash. Requires RPC
                    access; offline verification does not need it.
                  </span>
                </label>
              </div>

              <div>
                <label htmlFor={pinId} className="block text-micro font-medium text-foreground">
                  Pinned issuer DID{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id={pinId}
                  type="text"
                  value={pinnedIssuer}
                  onChange={(event) => setPinnedIssuer(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="did:key:z6Mk…"
                  aria-describedby={
                    pinnedIssuer.trim() === platformIssuer?.issuer
                      ? platformIssuerId
                      : undefined
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-micro text-foreground placeholder:text-muted-foreground transition focus:border-qtrust-600 focus:outline-none focus:ring-2 focus:ring-qtrust-600/25"
                />
                <p className="mt-1 text-micro leading-5 text-muted-foreground">
                  Without a pin, a bundle signed by any self-consistent key is
                  valid. Pin the issuer you expect before using a bundle for an
                  admission decision.
                </p>

                {platformIssuer ? (
                  <div className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <p className="text-micro leading-5 text-muted-foreground">
                      This deployment signs bundles with{" "}
                      <span className="font-mono text-foreground">
                        {platformIssuer.issuer}
                      </span>{" "}
                      (key fingerprint{" "}
                      <span className="font-mono text-foreground">
                        {platformIssuer.key_fingerprint.slice(0, 16)}
                      </span>
                      ).
                    </p>
                    {pinnedIssuer.trim() === platformIssuer.issuer ? (
                      <p
                        id={platformIssuerId}
                        className="mt-1 text-micro font-medium text-success"
                      >
                        Pinned to this deployment — a bundle signed by any other
                        key is rejected before its signature is even read.
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPinnedIssuer(platformIssuer.issuer)}
                        className="mt-1 rounded-lg border border-border bg-card px-2.5 py-1 text-micro font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
                      >
                        Use as pinned issuer
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void verify()}
              disabled={pending || text.trim().length === 0}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <ShieldCheckIcon className="h-4 w-4" aria-hidden="true" />
              {pending ? "Verifying…" : "Verify bundle"}
            </button>
          </div>

          {error ? (
            <p
              id={errorId}
              role="alert"
              className="mt-4 rounded-lg border border-danger-border bg-danger-surface px-3 py-2 text-micro text-danger"
            >
              {error}
            </p>
          ) : null}
        </PanelBody>

        <PanelFooter>
          <p>
            Offline checks prove internal consistency and that the named issuer
            signed this content. They do not prove the issuer was authorised for
            the subject, nor that the evidence still matches the chain — enable
            re-anchoring for the latter.
          </p>
        </PanelFooter>
      </Panel>

      <div aria-live="polite" aria-atomic="false">
        {result ? (
          <Panel aria-labelledby={`${inputId}-result`}>
            <PanelHeader>
              <PanelHeading>
                <PanelTitle id={`${inputId}-result`}>Verification result</PanelTitle>
                <PanelDescription>
                  {result.valid
                    ? "Every mandatory check passed."
                    : "At least one mandatory check failed. Reasons are listed below."}
                </PanelDescription>
              </PanelHeading>
              <PanelActions>
                <StatusPill tone={result.valid ? "success" : "danger"}>
                  {result.valid ? "Valid" : "Not valid"}
                </StatusPill>
              </PanelActions>
            </PanelHeader>

            <PanelBody className="space-y-6">
              <dl className="grid grid-cols-1 gap-4 text-micro sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Bundle ID</dt>
                  <dd className="mt-1 break-all font-mono text-foreground">
                    {result.bundle_id ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Issuer</dt>
                  <dd className="mt-1 break-all font-mono text-foreground">
                    {result.issuer ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Subject</dt>
                  <dd className="mt-1 break-all font-mono text-foreground">
                    {result.subject ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Policy verdict</dt>
                  <dd className="mt-1 text-foreground">{result.verdict ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Valid until</dt>
                  <dd className="mt-1 text-foreground">
                    {result.valid_until ? (
                      <time dateTime={result.valid_until}>{result.valid_until}</time>
                    ) : (
                      "—"
                    )}
                    {result.expired ? (
                      <span className="ml-2 font-medium text-danger">Expired</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Chain anchor</dt>
                  <dd className="mt-1">
                    {anchor ? (
                      <StatusPill tone={anchor.tone}>{anchor.label}</StatusPill>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>

              <div>
                <h4 className="font-mono text-label font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Checks
                </h4>
                <ul className="mt-3 space-y-3">
                  {CHECKS.map((check) => {
                    const passed = result.checked[check.key];
                    return (
                      <li key={check.key} className="flex items-start gap-3">
                        <span
                          className={
                            passed
                              ? "mt-0.5 shrink-0 text-success"
                              : "mt-0.5 shrink-0 text-danger"
                          }
                          aria-hidden="true"
                        >
                          {passed ? (
                            <CheckIcon className="h-4 w-4" />
                          ) : (
                            <XCircleIcon className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="text-micro font-medium text-foreground">
                            {check.label}
                            <span className="sr-only">
                              {passed ? ": passed" : ": failed"}
                            </span>
                            <span
                              className={
                                passed
                                  ? "ml-2 font-normal text-success"
                                  : "ml-2 font-normal text-danger"
                              }
                            >
                              {passed ? "Passed" : "Failed"}
                            </span>
                          </p>
                          <p className="text-micro leading-5 text-muted-foreground">
                            {check.detail}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {result.reasons.length > 0 ? (
                <div role={result.valid ? undefined : "alert"}>
                  <h4 className="font-mono text-label font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {result.valid ? "Notes from the verifier" : "Why this failed"}
                  </h4>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-micro leading-5 text-foreground">
                    {result.reasons.map((reason, index) => (
                      <li key={`${index}-${reason}`}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.caveats.length > 0 ? (
                <div>
                  <h4 className="font-mono text-label font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Caveats the issuer declared
                  </h4>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-micro leading-5 text-foreground">
                    {result.caveats.map((caveat, index) => (
                      <li key={`${index}-${caveat}`}>{caveat}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="border-t border-border pt-4 text-micro text-muted-foreground">
                Verified at{" "}
                <time dateTime={result.timestamp}>{result.timestamp}</time>. This
                result is not a signature; it is what the verifier computed for
                the bundle above.
              </p>
            </PanelBody>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

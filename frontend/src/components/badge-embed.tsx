"use client";

/**
 * Shareable verification badge — live preview plus copyable Markdown / HTML
 * embed snippets for an attestation.
 *
 * The badge itself is served by `/api/badge/[id]` and reflects the asset's
 * current on-chain status, so the snippet a user copies today keeps reading
 * the same way tomorrow. This component only renders the preview and the
 * copy controls; it never fetches — the `<img>` does that directly from the
 * same origin.
 *
 * Two URL forms, deliberately:
 *   - The preview `<img>` uses the same-origin relative `badgePath`, so it is
 *     allowed by `img-src 'self'` in every environment (local dev, preview and
 *     production) instead of being blocked by a stricter production CSP.
 *   - The copyable snippets use the canonical absolute `SITE_URL` origin, so a
 *     snippet pasted into a README on another host still resolves.
 */
import { useMemo, useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { CheckIcon, CopyIcon } from "@/app/icons";
import { SITE_URL } from "@/lib/site";

type Format = "markdown" | "html";

export function BadgeEmbed({
  assetId,
  badgePath,
}: {
  assetId: string;
  /** Same-origin path to the badge, e.g. "/api/badge/0x…". */
  badgePath: string;
}) {
  const [format, setFormat] = useState<Format>("markdown");
  const [copied, setCopied] = useState(false);

  const absoluteBadgeUrl = `${SITE_URL}${badgePath}`;
  const verifyUrl = `${SITE_URL}/v/${assetId}`;

  const snippet = useMemo(
    () =>
      format === "markdown"
        ? `![Q-Trust attestation](${absoluteBadgeUrl})`
        : `<a href="${verifyUrl}" target="_blank" rel="noopener noreferrer">\n  <img src="${absoluteBadgeUrl}" alt="Q-Trust attestation" />\n</a>`,
    [format, absoluteBadgeUrl, verifyUrl],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked (insecure context, permissions). The snippet
      // stays selectable in the block, so nothing is lost.
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-800">Share this proof</h2>
        <p className="text-sm text-muted-foreground">
          Embed a live badge that reflects this attestation&rsquo;s current on-chain status — it
          updates itself, no re-paste required.
        </p>
      </div>

      {/* Live preview */}
      <div className="mt-5 flex items-center justify-center rounded-lg bg-slate-950 p-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={badgePath}
          alt="Q-Trust attestation status badge"
          width={150}
          height={28}
          className="h-7 w-auto"
        />
      </div>

      {/* Format toggle */}
      <div
        role="group"
        aria-label="Embed format"
        className="mt-5 inline-flex rounded-full border border-border bg-slate-50 p-1"
      >
        {(["markdown", "html"] as const).map((f) => {
          const active = format === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              onClick={() => setFormat(f)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 ${
                active
                  ? "bg-slate-950 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "markdown" ? "Markdown" : "HTML"}
            </button>
          );
        })}
      </div>

      {/* Snippet + copy */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <CodeBlock
          label="Embed snippet"
          className="flex-1 overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-6 text-slate-100"
        >
          <code>{snippet}</code>
        </CodeBlock>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied to clipboard" : "Copy embed snippet"}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 sm:w-32"
        >
          {copied ? (
            <>
              <CheckIcon className="h-4 w-4" />
              Copied
            </>
          ) : (
            <>
              <CopyIcon className="h-4 w-4" />
              Copy
            </>
          )}
        </button>
      </div>
    </section>
  );
}

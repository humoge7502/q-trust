/**
 * Live verification badge — returns an SVG that reflects the current
 * on-chain status of an attestation asset, suitable for embedding in READMEs,
 * docs, or any external site via `![…](https://q-trust-nu.vercel.app/api/badge/<id>)`.
 *
 * The badge is generated server-side from the same backend read the `/v/[id]`
 * page uses, so it always reflects live state rather than a snapshot. It never
 * throws: a missing record renders as NOT FOUND and an unreachable backend as
 * UNREACHABLE, because a broken embed is worse than an honest one — the whole
 * point of the page is to let a third party trust a claim without trusting us.
 *
 * Cross-origin embedding is allowed (Access-Control-Allow-Origin: *) and the
 * response is cached briefly (60 s) so a popular README does not hammer the
 * backend on every page load.
 */
import { ApiError, fetchAssetVerification } from "@/lib/api";
import { parseAssetId } from "@/lib/config";

export const dynamic = "force-dynamic";

type BadgeState =
  | { kind: "verified"; message: string }
  | { kind: "revoked"; message: string }
  | { kind: "notfound"; message: string }
  | { kind: "unreachable"; message: string }
  | { kind: "invalid"; message: string };

// Darker shades so the white status label keeps ≥4.5:1 contrast (WCAG AA) on
// every state — the page's own palette is measured the same way.
const STATUS_COLOR: Record<BadgeState["kind"], string> = {
  verified: "#047857", // emerald-700
  revoked: "#b91c1c", // red-700
  notfound: "#475569", // slate-600
  unreachable: "#b45309", // amber-700
  invalid: "#64748b", // slate-500
};

/** Approximate monospace glyph advance (px) at the 11px badge font. */
const GLYPH = 7;

/**
 * Audit (post-merge adversarial pass) hardening: the message is interpolated
 * into both an attribute (`aria-label`) and two text nodes (`<title>`,
 * `<text>`) of a CORS-enabled (`*`) SVG, so nothing unescaped may reach those
 * positions. `&` is replaced first, or the replacements themselves would be
 * re-escaped; `"` is included because the value lands inside a double-quoted
 * attribute. Every message is a hardcoded literal today, so output is
 * byte-identical for all current inputs — this guards the day one isn't.
 */
function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildBadge(state: BadgeState): string {
  const message = escapeSvgText(state.message.toUpperCase());
  const leftWidth = 70; // "Q-Trust" segment
  const rightWidth = Math.max(58, message.length * GLYPH + 20);
  const width = leftWidth + rightWidth;
  const color = STATUS_COLOR[state.kind];

  // Right segment: square left edge (the seam), rounded right corners.
  const r = 6;
  const rightPath =
    `M ${leftWidth} 0 ` +
    `L ${width - r} 0 ` +
    `Q ${width} 0 ${width} ${r} ` +
    `L ${width} ${28 - r} ` +
    `Q ${width} 28 ${width - r} 28 ` +
    `L ${leftWidth} 28 Z`;

  const rightTextX = leftWidth + rightWidth / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28" role="img" aria-label="Q-Trust attestation: ${message}">
  <title>Q-Trust attestation: ${message}</title>
  <rect width="${width}" height="28" rx="6" fill="#0f172a"/>
  <path d="${rightPath}" fill="${color}"/>
  <text x="11" y="18" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11" font-weight="700" fill="#67e8f9">Q-Trust</text>
  <text x="${rightTextX}" y="18" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11" font-weight="700" fill="#f8fafc">${message}</text>
</svg>`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let state: BadgeState;
  try {
    // Validates format; throws for anything that is not 0x + 64 hex.
    const assetId = parseAssetId(id);
    try {
      const verification = await fetchAssetVerification(assetId);
      if (!verification.exists) {
        state = { kind: "notfound", message: "not found" };
      } else {
        state = verification.active
          ? { kind: "verified", message: "verified" }
          : { kind: "revoked", message: "revoked" };
      }
    } catch (err) {
      // Branch on the typed error status when we have one: `ApiError.message`
      // embeds the upstream detail verbatim, so a 500 whose body happens to
      // mention "404" (a proxy log line, a cache hint) used to be classified
      // as NOT_FOUND. Message matching remains only as the fallback for
      // errors that carry no status at all (plain transport failures).
      const status = err instanceof ApiError ? err.status : undefined;
      if (status === 404) {
        state = { kind: "notfound", message: "not found" };
      } else if (status !== undefined) {
        state = { kind: "unreachable", message: "unreachable" };
      } else {
        const msg = err instanceof Error ? err.message : "";
        state = msg.includes("404")
          ? { kind: "notfound", message: "not found" }
          : { kind: "unreachable", message: "unreachable" };
      }
    }
  } catch {
    state = { kind: "invalid", message: "invalid id" };
  }

  const svg = buildBadge(state);

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

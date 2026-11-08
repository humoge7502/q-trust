import { NextResponse } from "next/server";
import {
  OPERATOR_KEY_HEADER,
  OPERATOR_KEY_REQUIRED_CODE,
  OPERATOR_SESSION_HEADER,
  isValidOperatorKeyShape,
  matchRouteRule,
  type RouteClass,
} from "@/lib/api-route-policy";

/**
 * Same-origin API proxy — S-1 fix (audit E-2), extended for operator access.
 *
 * ## Background
 *
 * The proxy previously injected the server-side admin API key into every
 * `/v1/*` request with no session, wallet, or allowlist check: anyone who could
 * reach the dashboard could reach relay, webhooks, scans, evidence-create and
 * all GPU routes anonymously (and the backend saw the trusted key, collapsing
 * its per-IP limits to the proxy IP).
 *
 * The S-1 fix made the policy default-deny, which was correct — but it also
 * silently broke the UI: the scanner dashboard, GPU panels, planner panel and
 * vendor attestation form all call privileged endpoints, and the UI had no
 * notion that the proxy would refuse them. Those controls returned 403 in every
 * deployment using this proxy.
 *
 * ## Authorization model
 *
 * The policy now lives in `@/lib/api-route-policy` and has three classes:
 *
 *   - `public-read` / `public-compute` — forwarded with the server-side key
 *     (when configured). Unchanged from the S-1 fix.
 *   - `operator` — privileged surface (filesystem scanning, on-disk evidence
 *     writes, relayer submissions, GPU jobs, planner + webhook mutations, and
 *     the operator session endpoints themselves). The proxy NEVER attaches the
 *     server-side admin key here. The caller must present its OWN credential:
 *       - `x-qtrust-session` — a short-lived session token minted by
 *         `POST /v1/auth/session` (preferred when present); or
 *       - `x-qtrust-api-key` — the caller's raw key, the fallback when the
 *         session service was unavailable.
 *     Session preferred over raw key when both arrive, so a caller that
 *     exchanged its key cannot be downgraded to replaying the static one. The
 *     presented credential — whichever it was — is forwarded as the backend's
 *     `x-api-key`, because the backend's `requireApiKey` accepts either a
 *     static key or a session token in that single upstream header; the
 *     browser-only distinction never reaches the backend as a separate name.
 *     Neither caller header is ever forwarded under its own name, and the
 *     server key is never attached to these routes. Anonymous callers get 403
 *     with `code: "operator_key_required"` (unchanged, so the UI's inline
 *     operator prompt keeps working).
 *
 * Properties this preserves from S-1:
 *   - No anonymous reach to privileged routes; no admin key ever reaches them.
 *   - Per-caller rate limiting works, because the backend now sees the caller's
 *     credential rather than the proxy's shared key.
 *
 * Local development: when no server-side key is configured AND the process is
 * not production, operator routes are forwarded without a key, mirroring the
 * backend's own dev-open behaviour in `middleware/auth.ts`. This keeps the
 * documented local demo flow working.
 */

const DEFAULT_BACKEND_URL = "http://localhost:3001";

function backendUrl(): string {
  return (process.env.QTRUST_BACKEND_URL ?? process.env.NEXT_PUBLIC_QTRUST_API_URL ?? DEFAULT_BACKEND_URL).replace(/\/$/, "");
}

/** The server-side admin key, or undefined when the deployment has none. */
function serverApiKey(): string | undefined {
  const single = process.env.QTRUST_API_KEY?.trim();
  if (single) return single;
  const first = process.env.QTRUST_API_KEYS?.split(",")[0]?.trim();
  return first || undefined;
}

/** Dev-open escape hatch, matching the backend's dev semantics exactly. */
function operatorRoutesOpenInDev(): boolean {
  return process.env.NODE_ENV !== "production" && !serverApiKey();
}

function forwardedHeaders(
  request: Request,
  routeClass: RouteClass,
  callerCredential: string | null,
): Headers {
  const headers = new Headers();
  headers.set("accept", "application/json");

  if (routeClass === "operator") {
    // Never fall back to the server key here: that is exactly the S-1 bug.
    // `callerCredential` is whatever the caller presented — a session token or
    // a raw key — both of which the backend's `requireApiKey` accepts as
    // `x-api-key`.
    if (callerCredential) headers.set("x-api-key", callerCredential);
  } else {
    const apiKey = serverApiKey();
    if (apiKey) headers.set("x-api-key", apiKey);
  }

  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

function jsonError(error: string, status: number, code?: string): NextResponse {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  const pathName = `/${path.join("/")}`;

  // Audit (post-merge adversarial pass): Next percent-decodes catch-all
  // segments before they reach this handler, so `/api/v1/stats/%2e%2e/admin`
  // arrives here with a literal `..` segment. The policy match below runs on
  // the raw, un-normalized join — the poisoned path inherits the public-read
  // `/v1/stats` rule — while undici normalizes dot segments before the backend
  // sees the URL, landing the request on `/v1/admin`. Reject dot segments
  // outright, before any policy decision is made.
  if (path.some((segment) => segment === "." || segment === "..")) {
    return jsonError("API path is not available through this proxy", 400);
  }

  // Only the versioned API surface (and bare health) is proxied at all.
  if (!pathName.startsWith("/v1/") && pathName !== "/health") {
    return jsonError("API path is not available through this proxy", 404);
  }

  const method = request.method.toUpperCase();

  // Default-deny: a path (or method) that no policy rule allows is rejected
  // here — before any request is forwarded with the server-side admin key.
  const rule = matchRouteRule(pathName);
  if (rule === null || !rule.methods.has(method)) {
    return jsonError(
      "This endpoint is not exposed through the dashboard proxy. Use the API with your own key.",
      403,
    );
  }

  let callerCredential: string | null = null;
  if (rule.routeClass === "operator") {
    // Two caller credential channels, session preferred: after
    // POST /v1/auth/session the browser must never resend the raw key, so the
    // session token wins when both arrive (a present-but-stale token is the
    // backend's verdict, not ours — it answers 401 and the UI re-prompts).
    // Whichever was presented is forwarded upstream as `x-api-key`; neither
    // caller header passes through under its own name.
    const sessionToken = request.headers.get(OPERATOR_SESSION_HEADER)?.trim() ?? "";
    const rawKey = request.headers.get(OPERATOR_KEY_HEADER)?.trim() ?? "";
    const presented = sessionToken || rawKey;
    if (presented) {
      // Same shape validation for both channels — the session token is just a
      // bearer credential of the same size class as a key, and the check is
      // defence in depth against header injection downstream.
      if (!isValidOperatorKeyShape(presented)) {
        return jsonError("Malformed operator API key or session token", 400);
      }
      callerCredential = presented;
    } else if (!operatorRoutesOpenInDev()) {
      return jsonError(
        "This endpoint requires operator access. Add your Q-Trust API key in the operator panel, or call the API directly with your own key.",
        403,
        OPERATOR_KEY_REQUIRED_CODE,
      );
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers: forwardedHeaders(request, rule.routeClass, callerCredential),
    redirect: "manual",
    signal: AbortSignal.timeout(65_000),
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  try {
    const response = await fetch(`${backendUrl()}${pathName}${new URL(request.url).search}`, init);
    const responseHeaders = new Headers();
    const responseType = response.headers.get("content-type");
    if (responseType) responseHeaders.set("content-type", responseType);
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return jsonError("Backend API unavailable", 503);
  }
}

export const GET = proxy;
export const POST = proxy;
export const OPTIONS = proxy;

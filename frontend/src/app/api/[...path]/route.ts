import { NextResponse } from "next/server";

/**
 * Same-origin API proxy — S-1 fix (audit E-2).
 *
 * Previously this proxy injected the server-side admin API key into every
 * /v1/* request with no session, wallet, or allowlist check: anyone who could
 * reach the dashboard could reach relay, webhooks, scans, evidence-create and
 * all GPU routes anonymously (and the backend saw the trusted key, collapsing
 * its per-IP limits to the proxy IP).
 *
 * New model: DEFAULT-DENY. Only explicit public routes are proxied:
 *   - GET reads (dashboards, verification pages, stats, org views)
 *   - stateless compute POSTs (risk/compliance/evaluate — no backend state)
 * Everything else (relay, write, scan, evidence-create, webhooks, GPU) is
 * rejected at the proxy with 403 and never reaches the backend with the
 * admin key. A server-to-server caller that legitimately needs the write
 * surface must use its own API key against the backend directly.
 */

const DEFAULT_BACKEND_URL = "http://localhost:3001";

function backendUrl(): string {
  return (process.env.QTRUST_BACKEND_URL ?? process.env.NEXT_PUBLIC_QTRUST_API_URL ?? DEFAULT_BACKEND_URL).replace(/\/$/, "");
}

/**
 * Route policy map — every entry is (path prefix or exact path) -> policy.
 * `public-read` proxies GET requests only. `public-compute` additionally
 * proxies POST (stateless scoring endpoints). Any path not matched (or a
 * method not permitted by the matched policy) is denied.
 *
 * The map is checked against the path AFTER `/v1`; parameter segments are
 * matched by prefix up to the parameter boundary. Keep this list identical
 * in intent to the backend's auth matrix — a test asserts its coverage.
 */
const ROUTE_POLICY: ReadonlyArray<{ prefix: string; methods: ReadonlySet<string> }> = [
  // Bare health check (backend root, outside /v1)
  { prefix: "/health", methods: new Set(["GET"]) },
  // Public reads (dashboards + public verification pages)
  { prefix: "/v1/assets/", methods: new Set(["GET"]) },            // :id, :id/verify
  { prefix: "/v1/stats", methods: new Set(["GET"]) },
  { prefix: "/v1/health", methods: new Set(["GET"]) },
  { prefix: "/v1/plans/", methods: new Set(["GET"]) },             // :did
  { prefix: "/v1/orgs/", methods: new Set(["GET"]) },              // :did/summary|assets|migrations|audit
  { prefix: "/v1/vendors/", methods: new Set(["GET"]) },           // :did/attestations
  { prefix: "/v1/schemas/", methods: new Set(["GET"]) },           // :schemaId
  { prefix: "/v1/policies/", methods: new Set(["GET"]) },          // :policyId/versions/:version
  { prefix: "/v1/revocation/", methods: new Set(["GET"]) },        // :issuer
  { prefix: "/v1/trust-anchors/", methods: new Set(["GET"]) },     // :issuer
  { prefix: "/v1/products/", methods: new Set(["GET"]) },          // :id/support
  { prefix: "/v1/migrations/", methods: new Set(["GET"]) },        // :id
  { prefix: "/v1/relay/nonce/", methods: new Set(["GET"]) },       // :did (read-only nonce fetch)
  { prefix: "/v1/relay/cbom-nonce/", methods: new Set(["GET"]) },
  { prefix: "/v1/relay/audit-nonce/", methods: new Set(["GET"]) },
  { prefix: "/v1/webhooks/subscribers", methods: new Set(["GET"]) },
  // Stateless compute POSTs — no backend writes, safe to expose to the UI
  { prefix: "/v1/evaluate", methods: new Set(["POST"]) },
  { prefix: "/v1/risk/score", methods: new Set(["POST"]) },
  { prefix: "/v1/risk/summary", methods: new Set(["POST"]) },
  { prefix: "/v1/compliance/evaluate", methods: new Set(["POST"]) },
  { prefix: "/v1/compliance/full-report", methods: new Set(["POST"]) },
  { prefix: "/v1/credentials/verify", methods: new Set(["POST"]) },
  { prefix: "/v1/evidence/verify", methods: new Set(["POST"]) },
];

/** Longest-prefix match; longest wins so `/v1/assets/:id/verify` and siblings stay precise. */
function matchPolicy(pathName: string): ReadonlySet<string> | null {
  let best: ReadonlySet<string> | null = null;
  let bestLen = -1;
  for (const rule of ROUTE_POLICY) {
    if (pathName === rule.prefix || pathName.startsWith(rule.prefix)) {
      if (rule.prefix.length > bestLen) {
        best = rule.methods;
        bestLen = rule.prefix.length;
      }
    }
  }
  return best;
}

function backendHeaders(): Headers {
  const headers = new Headers();
  headers.set("accept", "application/json");
  const apiKey = process.env.QTRUST_API_KEY ?? process.env.QTRUST_API_KEYS?.split(",")[0]?.trim();
  if (apiKey) headers.set("x-api-key", apiKey);
  return headers;
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  const pathName = `/${path.join("/")}`;

  // Only the versioned API surface (and bare health) is proxied at all.
  if (!pathName.startsWith("/v1/") && pathName !== "/health") {
    return NextResponse.json({ error: "API path is not available through this proxy" }, { status: 404 });
  }

  // S-1: default-deny authorization. A path (or method) not in the policy map
  // is rejected here — before any request is forwarded with the admin key.
  const allowedMethods = matchPolicy(pathName);
  const method = request.method.toUpperCase();
  if (allowedMethods === null || !allowedMethods.has(method)) {
    return NextResponse.json(
      { error: "This endpoint is not exposed through the dashboard proxy. Use the API with your own key." },
      { status: 403 },
    );
  }

  const headers = backendHeaders();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const init: RequestInit = {
    method: request.method,
    headers,
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
    return NextResponse.json({ error: "Backend API unavailable" }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const OPTIONS = proxy;

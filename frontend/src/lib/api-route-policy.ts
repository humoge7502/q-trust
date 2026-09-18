/**
 * Route authorization policy for the same-origin API proxy (`app/api/[...path]`).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Before this module the policy lived inline in the proxy route, and the UI
 * had no way to know what the proxy would expose. The result was a real defect:
 * the shipped scanner dashboard, the GPU panels, the planner panel and the
 * vendor attestation form all called endpoints the proxy denied by default, so
 * those controls returned 403 in every deployment that used the documented
 * same-origin proxy — while the UI unit tests stubbed `fetch` and never saw it.
 *
 * The policy is now a single exported source of truth consumed by BOTH:
 *   1. the proxy route handler, which enforces it, and
 *   2. the UI (`lib/api.ts` + `components/operator-access.tsx`), which uses it
 *      to render honest states ("operator access required") instead of offering
 *      controls that cannot work.
 *
 * `route.test.ts` asserts the enforcement side; `api-route-policy.test.ts`
 * asserts that every endpoint the UI references is classified here, so the two
 * halves cannot drift apart again.
 *
 * AUTHORIZATION CLASSES
 * ---------------------
 *  - `public-read`     GET-only, safe to expose to anonymous browsers. The
 *                      proxy attaches the server-side key when configured.
 *  - `public-compute`  Stateless POSTs (scoring, evaluation, verification).
 *                      No backend writes, no filesystem access.
 *  - `operator`        Privileged surface: filesystem scanning, on-disk
 *                      evidence writes, relayer submissions, GPU jobs, planner
 *                      and webhook mutations. The proxy NEVER attaches the
 *                      server-side admin key to these routes. A caller must
 *                      present its own key via `x-qtrust-api-key`, which the
 *                      proxy forwards as `x-api-key`. Anonymous callers get 403.
 */

export type RouteClass = "public-read" | "public-compute" | "operator";

export interface RouteRule {
  /** Exact path or segment prefix (a rule ending in "/" is a segment prefix). */
  readonly prefix: string;
  readonly methods: ReadonlySet<string>;
  readonly routeClass: RouteClass;
}

/**
 * Header the browser uses to present its own operator key to the proxy.
 *
 * Distinct from the backend's `x-api-key` on purpose: the proxy always controls
 * what actually reaches the backend, so a caller can never impersonate the
 * server-side admin key by sending `x-api-key` directly.
 */
export const OPERATOR_KEY_HEADER = "x-qtrust-api-key";

/** Error code returned by the proxy when an operator route is hit anonymously. */
export const OPERATOR_KEY_REQUIRED_CODE = "operator_key_required";

/** Longest accepted operator key; longer values are rejected outright. */
export const MAX_OPERATOR_KEY_LENGTH = 512;

const GET: ReadonlySet<string> = new Set(["GET"]);
const POST: ReadonlySet<string> = new Set(["POST"]);
const GET_POST: ReadonlySet<string> = new Set(["GET", "POST"]);

/**
 * Every entry is (exact path or segment prefix) -> authorization class.
 * Checked against the path AFTER `/api`; parameter segments are matched by
 * prefix up to the parameter boundary. Longest matching prefix wins.
 *
 * Keep this list identical in intent to the backend's auth matrix — a test
 * asserts the proxy covers every route the UI actually calls.
 */
export const ROUTE_POLICY: readonly RouteRule[] = [
  // ---- Bare backend health check (outside /v1) ----
  { prefix: "/health", methods: GET, routeClass: "public-read" },

  // ---- Public reads (dashboards + public verification pages) ----
  { prefix: "/v1/assets/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/stats", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/health", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/orgs/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/vendors/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/schemas/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/policies/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/revocation/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/trust-anchors/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/products/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/migrations/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/relay/nonce/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/relay/cbom-nonce/", methods: GET, routeClass: "public-read" },
  { prefix: "/v1/relay/audit-nonce/", methods: GET, routeClass: "public-read" },

  // ---- Stateless compute (no writes, no filesystem) ----
  { prefix: "/v1/evaluate", methods: POST, routeClass: "public-compute" },
  { prefix: "/v1/risk/score", methods: POST, routeClass: "public-compute" },
  { prefix: "/v1/risk/summary", methods: POST, routeClass: "public-compute" },
  { prefix: "/v1/compliance/evaluate", methods: POST, routeClass: "public-compute" },
  { prefix: "/v1/compliance/full-report", methods: POST, routeClass: "public-compute" },
  { prefix: "/v1/credentials/verify", methods: POST, routeClass: "public-compute" },
  { prefix: "/v1/evidence/verify", methods: POST, routeClass: "public-compute" },

  // ---- Operator surface: requires the caller's own API key ----
  { prefix: "/v1/scan/", methods: POST, routeClass: "operator" },
  { prefix: "/v1/evidence/create", methods: POST, routeClass: "operator" },
  { prefix: "/v1/roadmap/generate", methods: POST, routeClass: "operator" },
  { prefix: "/v1/plans", methods: POST, routeClass: "operator" },
  { prefix: "/v1/gpu/", methods: GET_POST, routeClass: "operator" },
  { prefix: "/v1/relay/", methods: POST, routeClass: "operator" },
  { prefix: "/v1/write/", methods: POST, routeClass: "operator" },
  { prefix: "/v1/webhooks/", methods: POST, routeClass: "operator" },
  { prefix: "/v1/credentials/issue", methods: POST, routeClass: "operator" },
];

/**
 * Longest-prefix match. Longest wins so `/v1/relay/nonce/:did` (public read)
 * stays reachable despite the broader `/v1/relay/` operator rule.
 * NOTE: GET /v1/plans/:did was retired (R1 — the planner is stateless and
 * never implemented it), so there is intentionally no public-read rule for it.
 */
export function matchRouteRule(pathName: string): RouteRule | null {
  let best: RouteRule | null = null;
  for (const rule of ROUTE_POLICY) {
    // Prefixes represent route segments, not arbitrary strings. Without the
    // boundary check, `/v1/stats-private` would inherit `/v1/stats` access.
    const matches = rule.prefix.endsWith("/")
      ? pathName.startsWith(rule.prefix)
      : pathName === rule.prefix || pathName.startsWith(`${rule.prefix}/`);
    if (matches && (best === null || rule.prefix.length > best.prefix.length)) {
      best = rule;
    }
  }
  return best;
}

/** Authorization class for a path+method, or null when the path is not exposed. */
export function classifyEndpoint(pathName: string, method: string): RouteClass | null {
  const rule = matchRouteRule(pathName);
  if (!rule) return null;
  if (!rule.methods.has(method.toUpperCase())) return null;
  return rule.routeClass;
}

/**
 * True when the endpoint exists but the caller must present its own operator
 * key. UI controls use this to show an "operator access required" state rather
 * than a button that always fails.
 */
export function endpointRequiresOperatorKey(pathName: string, method: string): boolean {
  return classifyEndpoint(pathName, method) === "operator";
}

/** Basic shape validation for a caller-supplied key (defence in depth). */
export function isValidOperatorKeyShape(key: string): boolean {
  if (key.length === 0 || key.length > MAX_OPERATOR_KEY_LENGTH) return false;
  // Reject control characters so a key cannot inject headers downstream.
  return !/[\u0000-\u001f\u007f]/.test(key);
}

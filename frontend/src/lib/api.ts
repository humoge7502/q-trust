/**
 * Backend API client used by the frontend.
 *
 * Browser requests go through the same-origin Next.js proxy. The proxy forwards
 * to the Fastify backend using server-only configuration.
 */
import {
  OPERATOR_KEY_HEADER,
  OPERATOR_KEY_REQUIRED_CODE,
  classifyEndpoint,
} from "@/lib/api-route-policy";
import { getOperatorKey } from "@/lib/operator-key";

// Browser API calls use the same-origin Next.js proxy. For public routes the
// proxy attaches the server-only QTRUST_API_KEY; for operator routes it forwards
// the caller's own key instead (see lib/api-route-policy.ts).
export const API_BASE_URL = "/api";

/**
 * Thrown when an endpoint requires the caller's own operator key and none —
 * or an invalid one — was presented. Callers should render an operator-access
 * prompt rather than a generic error.
 */
export class OperatorKeyRequiredError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string, message?: string) {
    super(
      message ??
        `Operator access required for ${endpoint}. Add your Q-Trust API key to continue.`,
    );
    this.name = "OperatorKeyRequiredError";
    this.endpoint = endpoint;
  }
}

/** Headers carrying the caller's operator key, when one is stored. */
export function operatorHeaders(): Record<string, string> {
  const key = getOperatorKey();
  return key ? { [OPERATOR_KEY_HEADER]: key } : {};
}

/** True when this path+method is on the privileged (operator) surface. */
export function endpointNeedsOperatorKey(path: string, method: string): boolean {
  return classifyEndpoint(path, method) === "operator";
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; detail?: string };
    return body.detail ?? body.error ?? "";
  } catch {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }
}

/**
 * Shared response handling: turns the proxy's operator-key rejection into a
 * typed error so UI can react, and keeps other failures as plain Errors.
 */
async function handleResponse<T>(response: Response, path: string): Promise<T> {
  if (response.ok) return (await response.json()) as T;

  if (response.status === 403) {
    let code: string | undefined;
    try {
      code = ((await response.clone().json()) as { code?: string }).code;
    } catch {
      code = undefined;
    }
    if (code === OPERATOR_KEY_REQUIRED_CODE) {
      throw new OperatorKeyRequiredError(`${path}`);
    }
  }

  const detail = await readErrorMessage(response);
  throw new Error(`API ${response.status}: ${detail || "request failed"}`);
}


const DEFAULT_BACKEND_ORIGIN = "http://localhost:3001";

/**
 * Backend origin for server-side calls. Mirrors `backendUrl()` in
 * `app/api/[...path]/route.ts` so a server-rendered request and a proxied
 * browser request reach the same upstream.
 */
function backendOrigin(): string {
  return (
    process.env.QTRUST_BACKEND_URL ??
    process.env.NEXT_PUBLIC_QTRUST_API_URL ??
    DEFAULT_BACKEND_ORIGIN
  ).replace(/\/$/, "");
}

/** Server-side admin key — same resolution order as the proxy route. */
function serverApiKey(): string | undefined {
  const single = process.env.QTRUST_API_KEY?.trim();
  if (single) return single;
  return process.env.QTRUST_API_KEYS?.split(",")[0]?.trim() || undefined;
}

/**
 * Build the URL and auth headers for a backend path, per runtime.
 *
 * There are two callers of this module and they need different things:
 *
 *   - Browser: the same-origin `/api` proxy. The server-only key never reaches
 *     the client bundle and the CSP's `connect-src 'self'` stays sufficient.
 *
 *   - Server (RSC / SSR): the backend origin directly. `API_BASE_URL` is
 *     relative (`/api`), and Node's `fetch` cannot parse a relative URL — it
 *     throws `TypeError: Failed to parse URL`. Because this module is imported
 *     by server components (`/v/[id]` is one), the relative form was the only
 *     strategy available and every server render of those routes died with a
 *     500 before it could render anything.
 *
 * Resolving to the backend origin on the server also avoids a self-request back
 * through our own proxy, which would require the deployment to know its own
 * public origin during SSR.
 */
export type ApiRuntime = "browser" | "server";

/**
 * Pure URL/header construction for a backend path.
 *
 * Split out from the runtime detection below so both branches are directly
 * unit-testable — the server branch is the one that broke `/v/[id]`, and it is
 * unreachable from a jsdom test (which always has a `window`).
 *
 * The two invariants worth asserting:
 *   - server URLs are absolute (relative ones throw in Node's `fetch`); and
 *   - the server-only admin key is used on the server and the caller's operator
 *     key in the browser, never swapped.
 */
export function resolveApiRequest(
  path: string,
  runtime: ApiRuntime,
  options: {
    backendOrigin: string;
    serverApiKey?: string;
    operatorKey?: string | null;
  },
): { url: string; headers: Record<string, string> } {
  if (runtime === "browser") {
    return {
      url: `${API_BASE_URL}${path}`,
      headers: options.operatorKey
        ? { [OPERATOR_KEY_HEADER]: options.operatorKey }
        : {},
    };
  }
  return {
    url: `${options.backendOrigin.replace(/\/$/, "")}${path}`,
    headers: options.serverApiKey ? { "x-api-key": options.serverApiKey } : {},
  };
}

function resolveRequest(path: string): {
  url: string;
  headers: Record<string, string>;
} {
  return resolveApiRequest(
    path,
    typeof window === "undefined" ? "server" : "browser",
    {
      backendOrigin: backendOrigin(),
      serverApiKey: serverApiKey(),
      // `getOperatorKey` is a no-op on the server (it guards on `window`).
      operatorKey: getOperatorKey(),
    },
  );
}

/** POST JSON to the backend, attaching the operator key if set. */
export async function apiPostJson<T>(
  path: string,
  body: unknown,
  init?: RequestInit,
): Promise<T> {
  const { url, headers } = resolveRequest(path);
  const response = await fetch(url, {
    method: "POST",
    ...init,
    headers: {
      "content-type": "application/json",
      ...headers,
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response, path);
}

/** GET JSON from the backend, attaching the operator key if set. */
export async function apiGetJson<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, headers } = resolveRequest(path);
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...headers,
      ...(init?.headers ?? {}),
    },
  });
  return handleResponse<T>(response, path);
}

// Documentation is a public resource and can remain on the direct API origin.
export const API_DOCS_URL =
  process.env.NEXT_PUBLIC_QTRUST_API_URL ?? "http://localhost:3001";

export interface AssetInfo {
  asset_id: string;
  org_did: string;
  cbom_hash: string;
  metadata_uri: string;
  timestamp: number;
  last_updated: number;
  active: boolean;
}

export interface AssetVerification {
  asset_id: string;
  exists: boolean;
  active: boolean;
  org_did: string;
  chain_id: number;
  chain_name: string;
  verified_at: number;
}

export interface VendorAttestationInfo {
  attestation_id: string;
  vendor_did: string;
  product_id: string;
  version: string;
  algorithm: string;
  supported: boolean;
  evidence_uri: string;
  timestamp: number;
  revoked: boolean;
}

export interface MigrationProgressInfo {
  org_address: string;
  total_migrations: number;
  verified_migrations: number;
  unverified_migrations: number;
  fetched_at: number;
  // Indexer-enhanced fields (optional — present when served from Postgres)
  asset_count?: number;
  attestation_count?: number;
}

export interface MigrationInfo {
  migration_id: string;
  asset_id: string;
  org_did: string;
  from_algorithm: string;
  to_algorithm: string;
  evidence_hash: string;
  evidence_uri: string;
  timestamp: number;
  verified: boolean;
}

export interface LatestAuditInfo {
  org_address: string;
  exists: boolean;
  result: string;
  result_code: number;
  timestamp: number;
}

export interface OrgMigrationsResponse {
  org: string;
  progress: MigrationProgressInfo;
  migrations: MigrationInfo[];
  latest_audit: LatestAuditInfo;
}

// Backend may return paginated shape ({ items, total, ... }) for org assets/vendors.
// These interfaces capture both the legacy flat array shape and the paginated
// Page shape so the frontend can handle either without breaking (schema drift guard).
export interface Paginated<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface VendorAttestationsResponse {
  vendor: string;
  count: number;
  attestations: VendorAttestationInfo[];
  // Paginated alternative (new backend shape: vendor + Page)
  items?: VendorAttestationInfo[];
  total?: number;
}

export interface ProductSupportInfo {
  supported: boolean;
  vendor_did: string;
  attestation_id: string | null;
}

/**
 * Shared request helper for the typed read endpoints. Uses `resolveRequest`
 * because several of these are called from server components as well as from
 * the browser.
 */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, headers } = resolveRequest(path);
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...(init?.headers ?? {}),
    },
  });
  return handleResponse<T>(response, path);
}

/** Fetch an asset by ID (read-only, cacheable). */
export function fetchAsset(assetId: string): Promise<AssetInfo> {
  return apiFetch<AssetInfo>(`/v1/assets/${encodeURIComponent(assetId)}`);
}

/** Verify an asset's status (read-only). */
export function fetchAssetVerification(assetId: string): Promise<AssetVerification> {
  return apiFetch<AssetVerification>(`/v1/assets/${encodeURIComponent(assetId)}/verify`);
}

/** Fetch all attestations posted by a vendor. Resilient to paginated vs legacy shape (schema drift). */
export async function fetchVendorAttestations(
  vendorAddress: string,
): Promise<VendorAttestationsResponse> {
  const raw = await apiFetch<Record<string, unknown> & VendorAttestationsResponse & Paginated<VendorAttestationInfo>>(
    `/v1/vendors/${encodeURIComponent(vendorAddress)}/attestations`,
  );
  // New shape: { vendor, items, total, offset, limit } — normalize to legacy { vendor, count, attestations }
  if (Array.isArray((raw as unknown as { items?: unknown }).items)) {
    const items = (raw as unknown as { items: VendorAttestationInfo[] }).items;
    const total = (raw as unknown as { total?: number }).total ?? items.length;
    return {
      vendor: (raw as unknown as { vendor: string }).vendor ?? vendorAddress,
      count: total,
      attestations: items,
      items,
      total,
    };
  }
  // Legacy shape already has attestations/count — ensure both fields present
  const attestations = Array.isArray(raw.attestations) ? raw.attestations : [];
  const count = typeof raw.count === "number" ? raw.count : attestations.length;
  return { vendor: raw.vendor ?? vendorAddress, count, attestations };
}

/** Fetch an org's migration progress. Handles migrations as array vs Page (schema drift). */
export async function fetchOrgMigrations(orgAddress: string): Promise<OrgMigrationsResponse> {
  const raw = await apiFetch<Record<string, unknown> & OrgMigrationsResponse & { migrations?: unknown }>(
    `/v1/orgs/${encodeURIComponent(orgAddress)}/migrations`,
  );
  let migrations: MigrationInfo[] = [];
  const m = (raw as unknown as { migrations?: unknown }).migrations;
  if (Array.isArray(m)) {
    migrations = m as MigrationInfo[];
  } else if (m && typeof m === "object" && Array.isArray((m as { items?: unknown }).items)) {
    migrations = (m as Paginated<MigrationInfo>).items;
  }
  return {
    org: (raw as unknown as { org: string }).org ?? orgAddress,
    progress: (raw as unknown as { progress: MigrationProgressInfo }).progress,
    migrations,
    latest_audit: (raw as unknown as { latest_audit: LatestAuditInfo }).latest_audit,
  };
}

/** Fetch the assets registered by an org (full records). Handles array vs paginated Page. */
export async function fetchOrgAssets(orgAddress: string): Promise<AssetInfo[]> {
  const raw = await apiFetch<unknown>(`/v1/orgs/${encodeURIComponent(orgAddress)}/assets`);
  if (Array.isArray(raw)) return raw as AssetInfo[];
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.items)) return r.items as AssetInfo[];
    if (Array.isArray(r.assets)) return r.assets as AssetInfo[];
    // Some indexer responses nest under "assets" key
    if (Array.isArray((r as unknown as { data?: unknown }).data)) return (r as unknown as { data: AssetInfo[] }).data;
  }
  return [];
}

/** Check whether a product+version supports a PQC algorithm on-chain. */
export function checkProductSupport(
  productId: string,
  version: string,
  algorithm: string,
): Promise<{ supported: boolean; vendor_did: string; attestation_id: string | null }> {
  return apiFetch(
    `/v1/products/${encodeURIComponent(productId)}/support?version=${encodeURIComponent(version)}&algorithm=${encodeURIComponent(algorithm)}`,
  );
}

/** Fetch a vendor's current EIP-712 nonce for gasless attestations. */
export async function fetchVendorNonce(vendorAddress: string): Promise<number> {
  const data = await apiFetch<{ nonce: string }>(
    `/v1/relay/nonce/${encodeURIComponent(vendorAddress)}`,
  );
  return Number(data.nonce);
}

/** Submit a gasless EIP-712 attestation through the backend relayer. */
export async function relayAttestation(payload: {
  productId: string;
  version: string;
  algorithm: string;
  supported: boolean;
  evidenceURI: string;
  nonce: number;
  signature: string;
}): Promise<{ txHash: string; vendorDid: string; attestationId: string }> {
  // The same-origin proxy authorizes this route with the caller's own key
  // (see lib/api-route-policy.ts): it never attaches the server-side admin key
  // to relayer submissions. `apiPostJson` supplies the operator key when set.
  return apiPostJson<{ txHash: string; vendorDid: string; attestationId: string }>(
    "/v1/relay/attestation",
    payload,
  );
}

/** Request a migration plan from the AI planner (via the backend proxy). */
export async function fetchMigrationPlan(payload: {
  cbom: Record<string, unknown>;
  deadline?: string;
}): Promise<{
  migration_order: Array<{
    rank: number;
    asset_id: string;
    algorithm: string;
    criticality: string;
    pqc_ready: boolean;
    risk_score: number;
    migrate_days: number;
  }>;
  schedule?: {
    feasible: boolean;
    days_available: number;
    total_effort_days: number;
    suggested_daily_rate: number | null;
    windows: Array<{ asset_id: string; start: string; end: string }>;
  } | null;
  total_assets: number;
}> {
  return apiPostJson<{
    migration_order: Array<{
      rank: number;
      asset_id: string;
      algorithm: string;
      criticality: string;
      pqc_ready: boolean;
      risk_score: number;
      migrate_days: number;
    }>;
    schedule?: {
      feasible: boolean;
      days_available: number;
      total_effort_days: number;
      suggested_daily_rate: number | null;
      windows: Array<{ asset_id: string; start: string; end: string }>;
    } | null;
    total_assets: number;
  }>("/v1/plans", payload);
}

/** Subscribe to webhook notifications. */
export function subscribeWebhook(
  address: string,
  url: string,
  secret: string,
  events: string[] = ["*"],
): Promise<{ subscribed: boolean; subscriber: unknown }> {
  return apiFetch(`/v1/webhooks/subscribe`, {
    method: "POST",
    body: JSON.stringify({ address, url, secret, events }),
  });
}

/**
 * Fetch IPFS metadata (CORS-enabled public gateway by default).
 * Pass a custom gateway via NEXT_PUBLIC_IPFS_GATEWAY.
 *
 * SSRF hardening: metadata_uri is attacker-influenceable (it is set on-chain
 * by the asset registrar and relayed through the read model). This function
 * runs server-side, so the CID must be strictly validated before it is ever
 * concatenated onto the gateway URL — anything that is not a bare CIDv0/CIDv1
 * is rejected instead of fetched.
 */
const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1 = /^b[a-z2-7]{58,}$/; // base32-encoded CIDv1

export function isValidIpfsCid(cidOrUri: string): boolean {
  const cid = cidOrUri.replace(/^ipfs:\/\//, "");
  return CID_V0.test(cid) || CID_V1.test(cid);
}

export async function fetchIpfsJson(cidOrUri: string): Promise<Record<string, unknown> | null> {
  const gateway = process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://ipfs.io/ipfs/";
  const cid = cidOrUri.replace(/^ipfs:\/\//, "");
  if (!isValidIpfsCid(cid)) return null;
  const url = `${gateway}${cid}`;
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "error" });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The list of NIST-standardized PQC algorithms for vendor attestation forms. */
export const PQC_ALGORITHMS = [
  { value: "ML-KEM-512", label: "ML-KEM-512 (NIST FIPS 203, Category 1)" },
  { value: "ML-KEM-768", label: "ML-KEM-768 (NIST FIPS 203, Category 3)" },
  { value: "ML-KEM-1024", label: "ML-KEM-1024 (NIST FIPS 203, Category 5)" },
  { value: "ML-DSA-44", label: "ML-DSA-44 (NIST FIPS 204, Category 2)" },
  { value: "ML-DSA-65", label: "ML-DSA-65 (NIST FIPS 204, Category 3)" },
  { value: "ML-DSA-87", label: "ML-DSA-87 (NIST FIPS 204, Category 5)" },
  { value: "SLH-DSA-SHA2-128s", label: "SLH-DSA-SHA2-128s (NIST FIPS 205, Category 1)" },
  { value: "SLH-DSA-SHA2-128f", label: "SLH-DSA-SHA2-128f (NIST FIPS 205, Category 1)" },
  { value: "SLH-DSA-SHA2-192s", label: "SLH-DSA-SHA2-192s (NIST FIPS 205, Category 3)" },
  { value: "SLH-DSA-SHA2-192f", label: "SLH-DSA-SHA2-192f (NIST FIPS 205, Category 3)" },
  { value: "SLH-DSA-SHA2-256s", label: "SLH-DSA-SHA2-256s (NIST FIPS 205, Category 5)" },
  { value: "SLH-DSA-SHA2-256f", label: "SLH-DSA-SHA2-256f (NIST FIPS 205, Category 5)" },
  { value: "HQC-128", label: "HQC-128 (NIST-selected KEM, Category 1)" },
  { value: "HQC-192", label: "HQC-192 (NIST-selected KEM, Category 3)" },
  { value: "HQC-256", label: "HQC-256 (NIST-selected KEM, Category 5)" },
  { value: "FALCON-512", label: "Falcon-512 (Category 1)" },
  { value: "FALCON-1024", label: "Falcon-1024 (Category 5)" },
] as const;

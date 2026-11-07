/**
 * Session-scoped store for the short-lived operator session token, plus the
 * one-shot exchange that mints it.
 *
 * WHY
 * ---
 * The raw operator key (see `lib/operator-key.ts`, TM-FE-02/TM-FE-03) is
 * readable by any script on this origin, so XSS equals key disclosure. This
 * module shrinks that window: the raw key is presented to the backend exactly
 * ONCE — at `POST /v1/auth/session` through the same-origin proxy — and the
 * browser keeps only what the backend hands back: a short-lived session token
 * with a server-set expiry. A token that leaks via XSS is a smaller incident
 * than a static key that leaks: it dies on its own (`expiresAt`), it can be
 * revoked without rotating the operator's static key, and it is worthless
 * against `/v1/auth/session/revoke-all`.
 *
 * GRACEFUL IN BOTH DIRECTIONS
 * ---------------------------
 * Session hosting is optional backend infrastructure. When the exchange fails
 * because the session service does not exist yet (404), cannot host sessions
 * (503 `session_unavailable`), or the network is down, the caller falls back
 * to today's behaviour — the raw key persists in this tab's sessionStorage
 * exactly as before (`lib/operator-key.ts`). Nothing about the fallback path
 * is worse than the pre-session status quo. Conversely, once a session is
 * minted the raw key is dropped from storage immediately: it has done its job
 * and must not linger as a second, stronger credential.
 *
 * STORAGE CHOICE
 * --------------
 * `sessionStorage`, mirroring `lib/operator-key.ts`: scoped to the tab, cleared
 * when it closes, never sent in a URL, never logged, never rendered back in
 * full. The stored shape is `{ kind: "session", token, expiresAt }` — the
 * literal `kind` tag keeps the value self-describing in devtools and lets a
 * future storage format migrate without ambiguity.
 *
 * EXPIRY IS LAZY
 * --------------
 * There is no timer: an expired session is detected the next time it is read
 * and cleared on the spot. A timer would keep the tab alive for no benefit —
 * the only consumer of the token is a request made from this tab.
 */
// This module owns the session; `operator-key.ts` owns the raw key. Only a
// successful exchange may evict the raw key, so this is the one cross-import —
// api.ts is deliberately NOT imported here (it imports this module, and the
// exchange needs a plain fetch anyway; see exchangeOperatorKey below).
import { setOperatorKey } from "@/lib/operator-key";

const STORAGE_KEY = "qtrust.operatorSession";

export interface OperatorSession {
  kind: "session";
  /** Opaque short-lived token; presented to the proxy as `x-qtrust-session`. */
  token: string;
  /** ISO timestamp after which the token must not be used. */
  expiresAt: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

let cached: OperatorSession | null = null;
let initialized = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function readFromStorage(): OperatorSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OperatorSession> | null;
    if (
      !parsed ||
      parsed.kind !== "session" ||
      typeof parsed.token !== "string" ||
      parsed.token.length === 0 ||
      typeof parsed.expiresAt !== "string"
    ) {
      // Corrupt or foreign value: treat as absent and drop it rather than
      // forwarding garbage downstream.
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { kind: "session", token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    // Storage can be unavailable (private mode, blocked cookies) or the stored
    // value can be unparseable JSON. Degrade to "no session" rather than
    // throwing during render.
    return null;
  }
}

function isExpired(session: OperatorSession): boolean {
  const expiresAtMs = new Date(session.expiresAt).getTime();
  // An unparseable expiry cannot be trusted as "still valid" — distrust it.
  return Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now();
}

/**
 * Current operator session, or null when absent, corrupt, or expired.
 *
 * Expired sessions are cleared lazily on this read (storage write + pub/sub
 * notification), so the next reader — and the UI via the hook — sees "no
 * session" without any polling infrastructure.
 */
export function getOperatorSession(): OperatorSession | null {
  if (typeof window === "undefined") return null;
  if (!initialized) {
    cached = readFromStorage();
    initialized = true;
  }
  if (cached && isExpired(cached)) {
    clearOperatorSession();
    return null;
  }
  return cached;
}

/**
 * Store (or clear, with null/blank token) the session for this tab.
 *
 * Callers pass `{ token, expiresAt }`; the `kind: "session"` tag is added here
 * so no call site can store a malformed shape.
 */
export function setOperatorSession(
  session: { token: string; expiresAt: string } | null,
): void {
  if (typeof window === "undefined") return;
  const next =
    session && typeof session.token === "string" && session.token.trim() !== ""
      ? { kind: "session" as const, token: session.token.trim(), expiresAt: session.expiresAt }
      : null;
  cached = next;
  initialized = true;
  try {
    if (next) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Keep the in-memory value; storage persistence is best-effort.
  }
  emit();
}

/** Forget the session for this tab. No-op (no notification) when none exists. */
export function clearOperatorSession(): void {
  if (typeof window === "undefined") return;
  if (!initialized) {
    cached = readFromStorage();
    initialized = true;
  }
  if (!cached) return;
  cached = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to recover — the in-memory value is already gone.
  }
  emit();
}

/** Subscribe to session changes (used by `useSyncExternalStore`). */
export function subscribeOperatorSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a live (unexpired) session is currently present. */
export function hasOperatorSession(): boolean {
  return getOperatorSession() !== null;
}

/* -------------------------------------------------------------------------- */
/*  Exchange                                                                    */
/* -------------------------------------------------------------------------- */

export type ExchangeResult =
  | { ok: true; expiresAt: string }
  | { ok: false; reason: "unavailable" | "rejected" };

/**
 * Exchange the raw operator key for a short-lived session token.
 *
 * The raw key travels as the proxy's `x-qtrust-api-key` — the exact header the
 * fallback mode uses for every privileged call — but here it is presented ONCE,
 * to the exchange endpoint only. On success the session is stored and the raw
 * key is dropped from storage (see GRACEFUL IN BOTH DIRECTIONS above).
 *
 * `reason: "unavailable"` means the session infrastructure could not be
 * reached or does not exist (404 on an older backend, 503
 * `session_unavailable`, 5xx, or a network failure): the caller should fall
 * back to storing the raw key, which keeps working exactly as before.
 * `reason: "rejected"` means the server saw the key and refused it (400/401 —
 * a malformed or revoked key; 403 from the backend is the same class of
 * refusal): nothing is persisted, and the UI must say so honestly.
 *
 * The exchange intentionally does NOT go through `lib/api.ts`'s helpers: those
 * scope credentials per route class, while the exchange must present the raw
 * key on an operator route that the operator-key store does not yet back.
 * Importing `lib/api.ts` here would also create an import cycle — api.ts
 * imports this module to scope headers and to self-heal stale sessions.
 */
export async function exchangeOperatorKey(rawKey: string): Promise<ExchangeResult> {
  let response: Response;
  try {
    response = await fetch("/api/v1/auth/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qtrust-api-key": rawKey,
      },
      body: JSON.stringify({}),
    });
  } catch {
    // Network failure (proxy down, offline): session infra is unreachable.
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) {
    let body: { sessionToken?: unknown; expiresAt?: unknown };
    try {
      body = (await response.json()) as { sessionToken?: unknown; expiresAt?: unknown };
    } catch {
      // A 200 without parseable JSON is infra misbehaving, not a key problem.
      return { ok: false, reason: "unavailable" };
    }
    if (typeof body.sessionToken !== "string" || typeof body.expiresAt !== "string") {
      return { ok: false, reason: "unavailable" };
    }
    setOperatorSession({ token: body.sessionToken, expiresAt: body.expiresAt });
    // The raw key has been presented exactly once — keeping it stored would
    // undo the entire XSS-surface reduction. The fallback store is only for
    // when the exchange itself fails.
    setOperatorKey(null);
    return { ok: true, expiresAt: body.expiresAt };
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    return { ok: false, reason: "rejected" };
  }

  // 404: an older backend without session routes. 503: the backend reports it
  // cannot host sessions (`code: "session_unavailable"`); the status alone is
  // enough to decide, so the body is not parsed here. Any other non-2xx is
  // infra trouble rather than a key problem — fallback, don't fail.
  return { ok: false, reason: "unavailable" };
}

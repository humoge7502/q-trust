/**
 * Session-scoped store for the caller's own Q-Trust API key ("operator key").
 *
 * WHY
 * ---
 * The same-origin proxy refuses the privileged surface (scanning, evidence
 * creation, GPU jobs, planner, relayer, webhooks) unless the caller presents
 * its own key — the server-side admin key is deliberately never used for those
 * routes. This module holds that caller-supplied key in the browser.
 *
 * STORAGE CHOICE
 * --------------
 * `sessionStorage`, not `localStorage`:
 *   - scoped to the tab and cleared when it closes, so a key does not silently
 *     persist on a shared machine;
 *   - never sent in a URL, never logged, never rendered back in full.
 *
 * THREAT NOTE (see docs/SECURITY_THREAT_MODEL.md, TM-FE-02): a key held in the
 * browser is readable by any script running on this origin, so XSS is
 * equivalent to key disclosure. That is acceptable here because the key is
 * operator-supplied, revocable, session-scoped, and the deployment's own CSP
 * forbids inline/remote scripts in production. Operators should issue a
 * separate key per operator so one can be revoked independently.
 */
const STORAGE_KEY = "qtrust.operatorKey";

type Listener = () => void;
const listeners = new Set<Listener>();

let cached: string | null = null;
let initialized = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function readFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Degrade to
    // in-memory only rather than throwing during render.
    return null;
  }
}

/** Current operator key, or null when the caller has not provided one. */
export function getOperatorKey(): string | null {
  if (typeof window === "undefined") return null;
  if (!initialized) {
    cached = readFromStorage();
    initialized = true;
  }
  return cached;
}

/** Set (or clear, with null/empty) the operator key for this tab. */
export function setOperatorKey(key: string | null): void {
  if (typeof window === "undefined") return;
  const next = typeof key === "string" && key.trim() !== "" ? key.trim() : null;
  cached = next;
  initialized = true;
  try {
    if (next) window.sessionStorage.setItem(STORAGE_KEY, next);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Keep the in-memory value; storage persistence is best-effort.
  }
  emit();
}

/** Subscribe to key changes (used by `useSyncExternalStore`). */
export function subscribeOperatorKey(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether an operator key is currently present. */
export function hasOperatorKey(): boolean {
  return getOperatorKey() !== null;
}

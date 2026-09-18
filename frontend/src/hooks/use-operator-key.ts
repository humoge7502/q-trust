"use client";

/**
 * React binding for the session-scoped operator key store.
 *
 * `getServerSnapshot` returns null so SSR and the first client render agree;
 * the key only becomes visible after hydration, which avoids a hydration
 * mismatch warning for users who have a key stored.
 */
import { useSyncExternalStore } from "react";
import { getOperatorKey, subscribeOperatorKey } from "@/lib/operator-key";

export function useOperatorKey(): string | null {
  return useSyncExternalStore(subscribeOperatorKey, getOperatorKey, () => null);
}

"use client";

/**
 * React binding for the session-scoped operator session store.
 *
 * Mirror of `use-operator-key.ts`: `getServerSnapshot` returns null so SSR and
 * the first client render agree; the session only becomes visible after
 * hydration, which avoids a hydration mismatch warning for tabs that already
 * hold a session token.
 */
import { useSyncExternalStore } from "react";
import { getOperatorSession, subscribeOperatorSession, type OperatorSession } from "@/lib/operator-session";

export function useOperatorSession(): OperatorSession | null {
  return useSyncExternalStore(subscribeOperatorSession, getOperatorSession, () => null);
}

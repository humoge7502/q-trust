"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import demoRecords from "@/lib/demo-records.json";
import { parseAssetId } from "@/lib/config";

/**
 * Validate-and-navigate behaviour for an asset ID lookup.
 *
 * Two surfaces need this (the landing page's `VerifyBox` and the standalone
 * `/v` form) and they differ only in styling. Extracting it keeps the
 * validation rule — `parseAssetId`, which is the hardened 0x+64-hex check —
 * applied identically in both. A second hand-rolled regex is exactly how one
 * surface ends up accepting input the other rejects.
 *
 * Navigation is used rather than a fetch so the result page can remain a
 * server component with its own caching and metadata semantics.
 */
export function useVerifyAsset() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const verify = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setError("Enter an asset ID (0x followed by 64 hex characters).");
        return;
      }
      try {
        const assetId = parseAssetId(trimmed);
        setError(null);
        setPending(true);
        router.push(`/v/${assetId}`);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Invalid asset ID.");
      }
    },
    [router],
  );

  const clearError = useCallback(() => setError((current) => (current ? null : current)), []);

  return { error, pending, verify, clearError };
}

/**
 * Example used in placeholder copy and the "use the example" shortcut.
 *
 * It is read from the seeded demo records rather than written as a literal.
 * The hardcoded ID this replaced was never registered on chain, so every
 * visitor who followed the advertised example landed on a 404 — the one path
 * through the product that must not dead-end. Reading the same file the
 * landing page uses for its "live on-chain records" chips means the example is
 * a record that exists, and it cannot drift when the seed is regenerated.
 *
 * Empty when no record has been seeded; callers omit the shortcut in that case
 * rather than offering an example that cannot resolve.
 */
export const EXAMPLE_ASSET_ID: string =
  demoRecords.records.find((record) => record.assetId)?.assetId ?? "";

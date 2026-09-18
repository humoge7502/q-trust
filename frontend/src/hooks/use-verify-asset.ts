"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
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

/** Example used in placeholder copy and the "use the example" shortcut. */
export const EXAMPLE_ASSET_ID =
  "0x7b52d7b29272207cab6c061ee4e58141b434ce20eef955b5684c175ceb12c6b6";

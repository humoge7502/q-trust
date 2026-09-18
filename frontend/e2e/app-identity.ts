import { expect, type Page } from "@playwright/test";

/**
 * Prove the spec is talking to Q-Trust.
 *
 * Specs that only assert generic properties (no axe violations, no horizontal
 * overflow, an LCP budget) pass just as happily against a completely different
 * application. Combined with `reuseExistingServer`, that made the suite capable
 * of silently reporting on the wrong app — which is exactly what happened when
 * an unrelated service held the configured port.
 *
 * Specs that already assert Q-Trust content (e.g. the hero heading) do not need
 * this; the rest call it immediately after their first `goto`.
 */
export async function expectQTrustApp(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/Q-Trust/);
}

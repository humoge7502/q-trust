import { type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expectQTrustApp } from "./app-identity";

/**
 * The single definition of "an accessibility audit" for this suite.
 *
 * Extracted so the public-surface spec (`a11y.spec.ts`) and the
 * authenticated/populated app-surface spec (`a11y-app.spec.ts`) cannot drift
 * into auditing different rule sets or different settling behaviour — which is
 * exactly how a gate stops meaning what its name says.
 */

export const A11Y_TAGS = ["wcag2a", "wcag2aa", "best-practice"] as const;

/**
 * Wait until every finite animation/transition has finished.
 *
 * Infinite decorative motion (the signal marquee, the "Live" pulse) never
 * settles and is deliberately ignored — waiting on it would hang the gate.
 */
export async function waitForSettledAnimations(page: Page): Promise<void> {
  await page
    .waitForFunction(() => {
      const stillRunning = document.getAnimations().filter((animation) => {
        if (animation.playState !== "running") return false;
        const timing = animation.effect?.getComputedTiming();
        return timing ? timing.iterations !== Infinity : true;
      });
      return stillRunning.length === 0;
    }, undefined, { timeout: 15_000 })
    .catch(() => undefined);
}

/**
 * Run axe against the current page and return its violations.
 *
 * Order matters:
 *   1. app-identity guard — a passing audit against the *wrong* application is
 *      a false green (see `app-identity.ts`);
 *   2. settle the network;
 *   3. settle animations — axe folds opacity and `filter: blur()` into the
 *      colours it samples, so a scan that lands mid-animation reports contrast
 *      failures no settled frame shows (this produced 58 phantom
 *      `color-contrast` nodes before it was fixed).
 */
export async function auditPage(page: Page) {
  await expectQTrustApp(page);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await waitForSettledAnimations(page);

  const results = await new AxeBuilder({ page })
    .withTags([...A11Y_TAGS])
    .analyze();

  for (const violation of results.violations) {
    if (violation.impact === "critical" || violation.impact === "serious") {
      continue;
    }
    console.warn(
      `[a11y] ${violation.id} (${violation.impact ?? "unknown"}): ${violation.nodes.length} node(s), tags: ${violation.tags.join(", ")}`,
    );
  }

  return results.violations;
}

/** Only `critical` and `serious` findings fail the gate; the rest are logged. */
export function seriousViolations(
  violations: Awaited<ReturnType<typeof auditPage>>,
) {
  return violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
}

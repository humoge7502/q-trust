import { test, expect } from "@playwright/test";
import { auditPage, seriousViolations } from "./axe-audit";

/**
 * Audit the reduced-motion rendering.
 *
 * The home page enters with `hero-enter` (opacity 0→1, `blur(8px)`→0) and
 * reveals sections with `.reveal`. Axe folds opacity and filter into the
 * effective colours it samples, so a scan that lands mid-animation reports ruin
 * that no settled frame shows: this gate intermittently flagged 58
 * `color-contrast` nodes, including the hero's `bg-cyan-300 text-slate-950`
 * Verify button measured at ~47% opacity (ratio 3.62 against the required 4.5)
 * even though its settled frame is ~13:1.
 *
 * `globals.css` already collapses those animations to their final state under
 * `prefers-reduced-motion: reduce`, so emulating it audits a settled frame (and
 * covers the reduced-motion path, which the project's own motion rules require
 * to exist). `waitForSettledAnimations` makes the gate correct even if a future
 * animation forgets its reduced-motion guard.
 */
// `contextOptions` (not a top-level option) is how this Playwright version takes
// context-level media emulation.
test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("home page a11y", () => {
  test("/ has no critical or serious wcag2a/wcag2aa/best-practice violations", async ({ page }) => {
    await page.goto("/");
    const violations = await auditPage(page);
    expect(seriousViolations(violations)).toEqual([]);
  });
});

test.describe("scanner page a11y", () => {
  test("/scanner (incl. the operator-access panel) has no critical or serious violations", async ({ page }) => {
    await page.goto("/scanner");
    const violations = await auditPage(page);
    expect(seriousViolations(violations)).toEqual([]);
  });
});

test.describe("verification page a11y", () => {
  test("/v/[id] has no critical or serious wcag2a/wcag2aa/best-practice violations", async ({ page }) => {
    // This test previously skipped itself whenever the response was not 200.
    // That is a gate that disables itself precisely when the page is broken,
    // and it hid a real 500: `/v/[id]` is a server component, `lib/api.ts`
    // built its URL from the relative `API_BASE_URL`, and Node's fetch cannot
    // parse a relative URL — so the route threw before rendering anything.
    //
    // The page now renders unconditionally: either the attestation or an
    // explicit "record unreachable" state. So there is nothing to skip, and a
    // 5xx is a failure rather than a reason to stand down.
    const assetId = process.env.QTRUST_E2E_ASSET_ID ?? `0x${"0".repeat(64)}`;
    const response = await page.goto(`/v/${assetId}`);
    expect(response, "no response from /v/[id]").not.toBeNull();
    expect(response!.status(), "server error on /v/[id]").toBeLessThan(500);

    const violations = await auditPage(page);
    expect(seriousViolations(violations)).toEqual([]);
  });
});

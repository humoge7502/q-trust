import { test, expect } from "@playwright/test";
import { expectQTrustApp } from "./app-identity";

/**
 * Mobile layout-safety gates (Hallmark responsive non-negotiables):
 *  - no horizontal scroll at 320 / 375 px
 *  - no element wider than its viewport (catches clipped display type,
 *    un-wrapped long words, and fixed-width tables before users see them)
 *
 * Elements inside a clipping ancestor (`overflow-hidden`/`clip`/`auto`/
 * `scroll` containers no wider than the viewport — e.g. a deliberately
 * clipped marquee track) cannot push the page wider and are excluded; the
 * clipping ancestor itself is what gets judged.
 */

async function overflowingElements(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      // Tolerate 1px of rounding; ignore invisible elements.
      if (rect.right <= viewport + 1 || rect.width === 0) continue;
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      let clipped = false;
      for (
        let p = el.parentElement;
        p && p !== document.body;
        p = p.parentElement
      ) {
        const ps = window.getComputedStyle(p);
        if (["hidden", "clip", "scroll", "auto"].includes(ps.overflowX)) {
          const pr = p.getBoundingClientRect();
          if (pr.width <= viewport + 1) {
            clipped = true;
            break;
          }
        }
      }
      if (clipped) continue;
      offenders.push(
        `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → right=${Math.round(rect.right)} viewport=${viewport}`,
      );
    }
    return offenders;
  });
}

for (const width of [320, 375]) {
  test.describe(`mobile layout safety @ ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test(`home page has no horizontal overflow`, async ({ page }) => {
      await page.goto("/");
      await expectQTrustApp(page);
      await page.waitForLoadState("networkidle");
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(scrollWidth).toBeLessThanOrEqual(width);

      const offenders = await overflowingElements(page);
      expect(
        offenders,
        `elements wider than ${width}px:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });

    test(`scanner page has no horizontal overflow`, async ({ page }) => {
      await page.goto("/scanner");
      await expectQTrustApp(page);
      await page.waitForLoadState("networkidle");
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(scrollWidth).toBeLessThanOrEqual(width);
    });

    test(`scanner page keeps every tab reachable`, async ({ page }) => {
      // `scrollWidth` cannot see this: the document sets `overflow-x: clip`, so
      // content that overflows is silently cut off rather than producing a
      // scrollbar. The scanner's tab list used to overflow at 375px, and the
      // trailing tabs (Evidence, Side channel) were unreachable on a phone —
      // no scrollbar, no affordance, no way to open them. Width-only assertions
      // stayed green throughout. This asserts the invariant directly: a
      // control the user is meant to press must be inside the viewport.
      await page.goto("/scanner");
      await expectQTrustApp(page);
      await page.waitForLoadState("networkidle");

      // Wait for the tabs to exist before measuring. Without this the query
      // below can run against a not-yet-hydrated list and return zero
      // offenders — a vacuous pass rather than a measurement.
      await page.locator('[role="tab"]').first().waitFor({ timeout: 15_000 });

      const { offenders: unreachable, tabCount } = await page.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        const offenders: string[] = [];
        let tabCount = 0;
        for (const el of document.querySelectorAll('[role="tab"]')) {
          tabCount += 1;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.left >= -1 && rect.right <= viewport + 1) continue;
          offenders.push(
            `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}" left=${Math.round(rect.left)} right=${Math.round(rect.right)} viewport=${viewport}`,
          );
        }
        return { offenders, tabCount };
      });

      // Guard against a silent no-op: an empty offender list only means
      // something if there were tabs to measure.
      expect(tabCount, "no tabs were found to measure").toBeGreaterThan(0);
      expect(
        unreachable,
        `tabs outside the ${width}px viewport:\n${unreachable.join("\n")}`,
      ).toEqual([]);
    });
  });
}

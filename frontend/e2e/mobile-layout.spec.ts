import { test, expect } from "@playwright/test";

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
      await page.waitForLoadState("networkidle");
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(scrollWidth).toBeLessThanOrEqual(width);
    });
  });
}

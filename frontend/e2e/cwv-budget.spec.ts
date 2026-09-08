import { test, expect, type Page } from "@playwright/test";

/**
 * TD-06 — Core Web Vitals budget in the e2e job.
 *
 * Registers a real-browser regression gate for the two layout metrics the
 * Lighthouse "Performance" audit scores on desktop: LCP (good ≤ 2.5 s) and CLS
 * (good ≤ 0.1). Measured in-browser with PerformanceObserver on the same
 * Chromium the e2e suite already drives — no extra browser toolchain, no
 * chrome-launcher flake. Budgets are overridable via env for slower runners:
 *   QTRUST_CWV_LCP_BUDGET_MS  (default 2500)
 *   QTRUST_CWV_CLS_BUDGET     (default 0.1)
 *
 * The first navigation warms the dev-server compile of the route so the
 * measured navigation reflects runtime paint, not first-compile latency.
 */

const LCP_BUDGET_MS = Number(process.env.QTRUST_CWV_LCP_BUDGET_MS ?? 2500);
const CLS_BUDGET = Number(process.env.QTRUST_CWV_CLS_BUDGET ?? 0.1);

interface Vitals {
  lcp: number | null;
  cls: number;
}

function installVitalsObserver(page: Page): Promise<unknown> {
  // addInitScript runs on every navigation, so the observer is fresh per page.
  return page.addInitScript(() => {
    const w = window as unknown as { __qtrustVitals?: Vitals };
    w.__qtrustVitals = { lcp: null, cls: 0 };
    try {
      // LCP: the last largest-contentful-paint entry wins.
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          w.__qtrustVitals!.lcp = entries[entries.length - 1].startTime;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
      // CLS: cumulative layout shift, excluding shifts after user input.
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as unknown as { hadRecentInput: boolean; value: number };
          if (!shift.hadRecentInput) {
            w.__qtrustVitals!.cls += shift.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Older engines without these observer types: budget test will fail
      // loudly with "no LCP entry" rather than silently pass.
    }
  });
}

async function measureHomepage(page: Page): Promise<Vitals> {
  await page.goto("/", { waitUntil: "load" });
  // Wait for the hero to paint, then an LCP entry, then a settle window for CLS.
  await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => (window as { __qtrustVitals?: Vitals }).__qtrustVitals?.lcp != null, undefined, {
    timeout: 15_000,
  }).catch(() => undefined);
  await page.waitForTimeout(750);
  return page.evaluate(() => {
    const v = (window as { __qtrustVitals?: Vitals }).__qtrustVitals;
    return { lcp: v?.lcp ?? null, cls: v?.cls ?? 0 };
  });
}

test.describe("core web vitals budget (TD-06)", () => {
  test("home page stays inside the LCP + CLS budget", async ({ page, isMobile }) => {
    test.skip(isMobile, "measured once on the desktop project (mobile runs the a11y/layout suite)");
    test.skip(LCP_BUDGET_MS <= 0, "budget disabled via QTRUST_CWV_LCP_BUDGET_MS=0");

    await installVitalsObserver(page);
    // Warm-up navigation (dev-server compile of the route).
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 30_000 });

    // Measured navigation.
    const vitals = await measureHomepage(page);

    expect(vitals.lcp, "Largest Contentful Paint was never reported").not.toBeNull();
    expect(vitals.lcp!, `LCP ${Math.round(vitals.lcp!)}ms exceeds the ${LCP_BUDGET_MS}ms budget`).toBeLessThanOrEqual(LCP_BUDGET_MS);
    expect(vitals.cls, `CLS ${vitals.cls.toFixed(3)} exceeds the ${CLS_BUDGET} budget`).toBeLessThanOrEqual(CLS_BUDGET);
  });
});

/**
 * Focused Phase D smoke + a11y check for the four new surfaces:
 *   /demo  /why-now  /compare  /developers
 *
 * Verifies each page:
 *   - HTTP 200 and no client-side console/page errors
 *   - no serious/critical axe-core violations
 *   - no horizontal overflow at mobile (390px) and desktop (1280px)
 *   - expected signature content is present (video / table / code / timeline)
 *   - internal nav links resolve
 * Screenshots land in %TEMP%/opencode/qtrust-phase-d.
 */
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = (process.env.QTRUST_SITE_URL ?? "https://q-trust-nu.vercel.app").replace(/\/$/, "");
const OUT = resolve(tmpdir(), "opencode", "qtrust-phase-d");
mkdirSync(OUT, { recursive: true });

const results = [];
function check(section, name, ok, detail = "") {
  results.push({ section, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${section}] ${name}${detail ? ` (${detail})` : ""}`);
}

const PAGES = [
  { path: "/demo", expect: { video: true } },
  { path: "/why-now", expect: { video: true } },
  { path: "/compare", expect: { table: true } },
  { path: "/developers", expect: { code: true } },
];

const browser = await chromium.launch();

for (const p of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });

  const started = Date.now();
  const response = await page.goto(`${SITE}${p.path}`, { waitUntil: "load", timeout: 30_000 });
  check(p.path, "HTTP 200", response?.status() === 200, `${response?.status()}`);
  await page.waitForTimeout(2_500);

  // Heading present (non-empty h1)
  const h1 = (await page.locator("h1").first().innerText().catch(() => "")).trim();
  check(p.path, "hero heading present", h1.length > 0, JSON.stringify(h1).slice(0, 80));

  // Signature content
  if (p.expect.video) {
    const v = page.locator("video").first();
    const ok = (await v.count()) > 0;
    const src = ok ? await v.getAttribute("src").catch(() => "") : "";
    check(p.path, "video element present", ok, src?.slice(0, 60));
  }
  if (p.expect.table) {
    const t = page.locator("table").first();
    check(p.path, "comparison table present", (await t.count()) > 0);
  }
  if (p.expect.code) {
    const c = page.locator("pre, code").first();
    check(p.path, "code block present", (await c.count()) > 0);
  }

  // Console / page errors
  check(p.path, "no console/page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  // a11y (serious + critical only)
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("#axe-ignore")
    .analyze()
    .catch((e) => ({ violations: [{ id: "axe-failure", impact: "critical", nodes: [{ html: e.message }] }] }));
  const bad = (axe.violations || []).filter((v) => v.impact === "serious" || v.impact === "critical");
  check(p.path, "no serious/critical a11y violations", bad.length === 0, `${bad.length} (total ${axe.violations?.length ?? 0})`);

  // Overflow — desktop
  const dOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(p.path, "no desktop horizontal overflow", dOverflow <= 1, `${dOverflow}px`);

  // Overflow — mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const mOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(p.path, "no mobile horizontal overflow", mOverflow <= 1, `${mOverflow}px`);

  // Internal links resolve
  const links = await page.locator('a[href^="/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  const uniq = [...new Set(links)].filter(Boolean).slice(0, 12);
  let broken = 0;
  for (const href of uniq) {
    try {
      const r = await fetch(`${SITE}${href}`, { method: "HEAD" });
      if (r.status >= 400) broken++;
    } catch {
      broken++;
    }
  }
  check(p.path, "internal nav links resolve", broken === 0, `${broken}/${uniq.length} broken`);

  await page.screenshot({ path: resolve(OUT, `${p.path.replace(/\//g, "_") || "_home"}.png`), fullPage: true });
  console.log(`INFO [${p.path}] loaded in ${Date.now() - started}ms`);
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(resolve(OUT, "report.json"), JSON.stringify(results, null, 2));
console.log(`\n=== Phase D summary: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(`  - [${f.section}] ${f.name} :: ${f.detail}`);
  process.exit(1);
}
console.log("All Phase D page checks passed.");

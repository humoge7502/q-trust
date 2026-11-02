/**
 * Generic page check: desktop + mobile screenshot and an axe pass.
 * Usage: node scripts/page-check.mjs /research [baseUrl]
 */
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const route = process.argv[2] ?? "/";
const BASE = process.argv[3] ?? "http://localhost:3100";
const OUT = resolve(process.cwd(), "../brag-output/design");
mkdirSync(OUT, { recursive: true });
const slug = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";

const browser = await chromium.launch();

async function run(label, viewport, mobile) {
  const context = await browser.newContext({ viewport, isMobile: mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  const response = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: resolve(OUT, `${slug}-${label}.png`), fullPage: true });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );

  console.log(`\n== ${slug} ${label} ==`);
  console.log(`status ${response?.status()}  overflow ${overflow}px  errors ${errors.length}`);
  if (!serious.length) {
    console.log("axe: clean");
  } else {
    for (const v of serious) {
      console.log(`axe ${v.impact} ${v.id}: ${v.help}`);
      for (const node of v.nodes.slice(0, 5)) {
        console.log(`   ${node.target.join(" ")}`);
        console.log(`   ${(node.failureSummary ?? "").split("\n").slice(1, 3).join(" / ")}`);
      }
    }
  }
  if (errors.length) console.log("console:", errors.slice(0, 4).join(" | "));
  await context.close();
}

await run("desktop", { width: 1440, height: 1000 }, false);
await run("mobile", { width: 390, height: 844 }, true);
await browser.close();

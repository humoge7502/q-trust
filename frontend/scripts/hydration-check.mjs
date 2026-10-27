/**
 * Focused hydration diagnostic: capture the FULL console error text for a
 * route, because React 19 hydration warnings are multi-line and get truncated
 * when joined. Usage: node scripts/hydration-check.mjs /research [baseUrl]
 */
import { chromium } from "@playwright/test";

const route = process.argv[2] ?? "/";
const BASE = process.argv[3] ?? "http://localhost:3100";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push({ text: m.text(), args: (m.args() || []).length });
});
page.on("pageerror", (e) => errors.push({ text: String(e), args: 0 }));

const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

console.log(`status ${response?.status()}  errors ${errors.length}`);
for (const e of errors) {
  console.log("---- console.error ----");
  console.log(e.text);
}
await context.close();
await browser.close();

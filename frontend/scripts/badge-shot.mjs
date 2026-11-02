import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = resolve(process.cwd(), "../brag-output/design");
mkdirSync(OUT, { recursive: true });

const cases = [
  ["verified", "0x125fad1d7f435ea1dfeb014bdcbbbe0636fe7043b1e4e4ac90975768e3d1a349"],
  ["revoked-missing", "0x0000000000000000000000000000000000000000000000000000000000000000"],
  ["invalid", "not-an-id"],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 200 }, deviceScaleFactor: 3 });
for (const [name, id] of cases) {
  await page.goto(`${BASE}/api/badge/${id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `badge-${name}.png`) });
  console.log(`shot: badge-${name}.png`);
}
await browser.close();

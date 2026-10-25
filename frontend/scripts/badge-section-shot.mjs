import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = resolve(process.cwd(), "../brag-output/design");
mkdirSync(OUT, { recursive: true });

const id = "0x125fad1d7f435ea1dfeb014bdcbbbe0636fe7043b1e4e4ac90975768e3d1a349";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
await page.goto(`${BASE}/v/${id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const section = page.locator("section", { has: page.getByText("Share this proof") });
await section.screenshot({ path: resolve(OUT, "v-badge-section.png") });
console.log("shot v-badge-section.png");

// exercise the format toggle
await page.getByRole("button", { name: "HTML" }).click();
await page.waitForTimeout(300);
await section.screenshot({ path: resolve(OUT, "v-badge-section-html.png") });
console.log("shot v-badge-section-html.png (HTML format)");

await context.close();
await browser.close();
import { chromium } from "@playwright/test";

const SITE = process.argv[2] || "https://q-trust-nu.vercel.app";
const ID =
  process.argv[3] || "0x125fad1d7f435ea1dfeb014bdcbbbe0636fe7043b1e4e4ac90975768e3d1a349";
const OUT = "brag-output/design";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

// 1. Research page — hero + first two sections (Discovery stats).
await page.goto(`${SITE}/research`, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/prod-research-top.png` });

// 2. Badge share section on a real attestation.
await page.goto(`${SITE}/v/${ID}`, { waitUntil: "networkidle", timeout: 60_000 });
await page.getByText(/VALID|REVOKED/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(800);
const share = page.getByText("Share this proof").first();
await share.scrollIntoViewIfNeeded();
await share.waitFor({ timeout: 15_000 }).catch(() => {});
const section = page.locator("section").filter({ hasText: "Share this proof" }).first();
await section.screenshot({ path: `${OUT}/prod-badge-section.png` }).catch(() => {});

await browser.close();
console.log("captured prod-research-top.png and prod-badge-section.png");

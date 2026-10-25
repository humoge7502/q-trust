import { chromium } from "@playwright/test";

const SITE = process.env.QTRUST_SITE_URL ?? "https://q-trust-nu.vercel.app";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const api = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/") || u.includes("vercel.app/api")) api.push(`${r.status()} ${u.slice(0, 110)}`);
});
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0, 160)); });

await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
for (const ms of [2000, 5000, 10000, 20000, 30000]) {
  await page.waitForTimeout(ms === 2000 ? 2000 : 5000);
  const badge = await page.locator("text=/API (live|unavailable)|Checking API/i").first().innerText().catch(() => "(none)");
  console.log(`t+${ms}ms badge: ${badge.trim()}`);
  if (/API live/i.test(badge)) break;
}
console.log("--- api calls ---");
console.log(api.slice(0, 12).join("\n") || "(none)");
await browser.close();

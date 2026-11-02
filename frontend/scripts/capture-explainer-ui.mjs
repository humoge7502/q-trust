/**
 * Capture the product screenshots used by the Q-Trust explainer film.
 *
 * Requirements:
 *   - the app running at QTRUST_SITE_URL (default http://127.0.0.1:3003)
 *   - the demo estate scanned by the default target, i.e. the API's
 *     /workspace/projects/deploy/demo-estate fixture (deploy/demo-estate)
 *   - seeded Base Sepolia data for the org + asset below
 *
 * Output: brag-output/explainer/assets/ui/*.png at 1600x900 @2x.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = process.env.QTRUST_SITE_URL ?? "http://127.0.0.1:3003";
const OUT = fileURLToPath(new URL("../../brag-output/explainer/assets/ui", import.meta.url));
const ORG = process.env.QTRUST_DEMO_ORG ?? "0xE610569aE0352DC3262419bb051a86145f52875c";
const ASSET =
  process.env.QTRUST_DEMO_ASSET ??
  "0x125fad1d7f435ea1dfeb014bdcbbbe0636fe7043b1e4e4ac90975768e3d1a349";
mkdirSync(OUT, { recursive: true });

function mockFor(address) {
  return `
(() => {
  const address = "${address}";
  const provider = {
    isMetaMask: true,
    chainId: "0x14a34",
    selectedAddress: address,
    request: async ({ method }) => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts": return [address];
        case "eth_chainId": return "0x14a34";
        case "net_version": return "84532";
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain": return null;
        case "eth_getBalance": return "0xde0b6b3a7640000";
        case "eth_blockNumber": return "0x1";
        case "eth_call": return "0x" + "0".repeat(64);
        case "eth_estimateGas": return "0x5208";
        case "eth_gasPrice": return "0x3b9aca00";
        case "eth_getTransactionCount": return "0x0";
        case "eth_sendTransaction": return "0x" + "33".repeat(32);
        case "personal_sign":
        case "eth_sign":
        case "eth_signTypedData_v4": return "0x" + "11".repeat(65);
        default: return null;
      }
    },
    on: () => {}, removeListener: () => {}, enable: async () => [address],
  };
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true, writable: true });
})();
`;
}

const browser = await chromium.launch();

async function newPage(address) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  if (address) await context.addInitScript({ content: mockFor(address) });
  const page = await context.newPage();
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("captured", name);
}

// 1. Home hero
{
  const { context, page } = await newPage();
  await page.goto(`${SITE}/`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await shot(page, "home");
  await context.close();
}

// 2-5. Scanner flow
{
  const { context, page } = await newPage();
  await page.goto(`${SITE}/scanner`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(2000);
  await shot(page, "scanner-empty");

  await page.getByRole("button", { name: /^Run scan$/ }).click();
  await page.waitForFunction(
    () => [...document.querySelectorAll("h3")].some((e) => e.textContent?.trim() === "Results"),
    undefined,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(1200);
  await shot(page, "scan");

  await page.getByRole("tab", { name: "Risk Scores" }).click();
  await page.getByText("Quantum Risk Scores").waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: /Calculate risk scores/i }).click();
  await page.getByRole("columnheader", { name: "Risk Level" }).waitFor({ timeout: 120_000 });
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll("th")].find(
      (el) => el.textContent?.trim() === "Risk Level",
    );
    cell?.closest("table")?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(1500);
  await shot(page, "risk");

  await page.getByRole("tab", { name: "Roadmap" }).click();
  await page.getByRole("button", { name: "Generate roadmap" }).click();
  await page.getByText(/\d+ days/).first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1200);
  await shot(page, "roadmap");

  await page.getByRole("tab", { name: "Evidence" }).click();
  await page.getByRole("button", { name: "Create evidence record" }).click();
  await page.getByText(/index #\d+/).first().waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Verify$/ }).click();
  await page.getByRole("button", { name: /^Verified$/ }).waitFor({ timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await shot(page, "evidence");
  await context.close();
}

// 6. Public verification page
{
  const { context, page } = await newPage();
  await page.goto(`${SITE}/v/${ASSET}`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await shot(page, "verify");
  await context.close();
}

// 7. Org dashboard with the seeded wallet
{
  const { context, page } = await newPage(ORG);
  await page.goto(`${SITE}/dashboard`, { waitUntil: "load", timeout: 60_000 });
  await page.getByText("Org dashboard").waitFor({ timeout: 45_000 });
  await page.waitForTimeout(3500);
  await shot(page, "dashboard");
  await context.close();
}

// 8. Vendor portal (attestations + gasless form)
{
  const { context, page } = await newPage(ORG);
  await page.goto(`${SITE}/vendors`, { waitUntil: "load", timeout: 60_000 });
  await page.getByText("Vendor portal").waitFor({ timeout: 45_000 });
  await page.waitForTimeout(6000);
  await shot(page, "vendor");
  await context.close();
}

await browser.close();
console.log("done");

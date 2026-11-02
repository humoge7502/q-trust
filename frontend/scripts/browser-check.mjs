/**
 * Live browser verification for the public Q-Trust deployment.
 *
 * Run with:  node scripts/browser-check.mjs
 * Override:  QTRUST_SITE_URL=https://... node scripts/browser-check.mjs
 *
 * It exercises the paths an anonymous visitor actually uses:
 *   /            -> hero + links to the seeded on-chain records
 *   /v/<asset>   -> public verification page renders a real record
 *   /scanner     -> full scan, risk, compliance, roadmap, evidence,
 *                   side channel, AI planner, and the AI & GPU lab
 *   /dashboard   -> loads (wallet gate, no 500)
 *   /vendors     -> loads (wallet gate, no 500)
 *
 * Exit code is non-zero if any check fails, so it can gate a release.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = (process.env.QTRUST_SITE_URL ?? "https://q-trust-nu.vercel.app").replace(/\/$/, "");
const demo = JSON.parse(readFileSync(resolve(root, "deploy/demo-records.json"), "utf8"));
const assetId = demo.assets[0].assetId;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

// Third-party wallet noise is not a Q-Trust failure. Real page errors and
// 5xx responses from our own origin are.
const IGNORE = [
  /WalletConnect/i,
  /wagmi/i,
  /ConnectorNotConnected/i,
  /User rejected/i,
  /favicon/i,
  /MetaMask/i,
  /ERR_BLOCKED_BY_CLIENT/i,
  /Failed to load resource.*(401|403)/i,
  /Failed to load resource.*trycloudflare/i,
];
const relevant = (errors) => errors.filter((error) => !IGNORE.some((re) => re.test(error)));

const browser = await chromium.launch();
console.log(`Site: ${SITE}`);
console.log(`Asset: ${assetId}\n`);

async function open(path) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // WalletConnect's public "demo" project id makes its own config/telemetry
    // endpoints answer 400/403. Those are third-party SDK failures, not
    // Q-Trust page errors. Match on the resource URL, not the message text.
    const location = message.location()?.url ?? "";
    if (/(web3modal\.org|walletconnect\.(com|org))/.test(location)) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500 && response.url().startsWith(SITE)) {
      errors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  const response = await page.goto(`${SITE}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForTimeout(1500);
  return { context, page, response, errors };
}

// ---- Home ----------------------------------------------------------------
{
  const { context, page, response, errors } = await open("/");
  check("home: HTTP 200", response?.status() === 200);
  check("home: title", /Q-Trust/i.test(await page.title()), await page.title());
  const demoLinks = await page.locator('a[href^="/v/0x"]').count();
  check("home: seeded record links", demoLinks >= 3, `${demoLinks} links`);
  if (demoLinks > 0) {
    await page.locator('a[href^="/v/0x"]').first().click();
    await page.waitForURL(/\/v\/0x/, { timeout: 30_000 });
    check("home: record link navigates", /\/v\/0x/.test(page.url()), page.url());
  }
  const errs = relevant(errors);
  check("home: no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await context.close();
}

// ---- Public verification page -------------------------------------------
{
  const { context, page, response, errors } = await open(`/v/${assetId}`);
  check("verify: HTTP 200", response?.status() === 200);
  await page
    .getByText(/VALID|REVOKED/i)
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => {});
  check(
    "verify: status badge",
    await page.getByText(/VALID|REVOKED/i).first().isVisible().catch(() => false),
  );
  const html = await page.content();
  check("verify: shows asset id", html.includes(assetId));
  check("verify: shows asset details", (await page.getByText("Asset details").count()) > 0);
  check("verify: shows cbom hash", (await page.getByText("CBOM hash").count()) > 0);
  check(
    "verify: not an availability error",
    (await page.getByText("RECORD UNREACHABLE").count()) === 0,
  );
  const errs = relevant(errors);
  check("verify: no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await context.close();
}

// ---- Scanner: every tab, real calls through the hosted proxy -------------
{
  const { context, page, response, errors } = await open("/scanner");
  check("scanner: HTTP 200", response?.status() === 200);
  const tabs = (await page.getByRole("tab").allTextContents()).map((text) => text.trim());
  check(
    "scanner: all tabs present",
    ["Scan", "Risk Scores", "Compliance", "Roadmap", "Evidence", "Side Channel", "AI Planner", "AI & GPU Lab"].every(
      (name) => tabs.includes(name),
    ),
    tabs.join(", "),
  );

  // --- Scan
  await page.getByRole("button", { name: /^Run scan$/ }).click();
  await page.waitForFunction(
    () => {
      const hasResults = [...document.querySelectorAll("h3")].some(
        (element) => element.textContent?.trim() === "Results",
      );
      const hasError = [...document.querySelectorAll("p.text-danger")].some(
        (element) => (element.textContent ?? "").trim().length > 0,
      );
      return hasResults || hasError;
    },
    undefined,
    { timeout: 180_000 },
  );
  const scanError = (await page.locator("p.text-danger").first().textContent().catch(() => null))?.trim();
  const rows = await page.locator("table tbody tr").count();
  check("scanner: scan returns findings", !scanError && rows > 0, scanError || `${rows} rows`);

  if (!scanError) {
    // --- Risk Scores
    await page.getByRole("tab", { name: "Risk Scores" }).click();
    await page.getByText("Quantum Risk Scores").waitFor({ timeout: 30_000 });
    check(
      "scanner: risk scores render",
      (await page.getByText("Run a scan first to generate risk scores.").count()) === 0,
    );

    // --- Compliance
    await page.getByRole("tab", { name: "Compliance" }).click();
    await page.getByText("Compliance Assessment").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Evaluate" }).click();
    await page.getByText("non-compliant").first().waitFor({ timeout: 120_000 });
    check("scanner: compliance report", (await page.getByText("non-compliant").count()) > 0);

    // --- Roadmap
    await page.getByRole("tab", { name: "Roadmap" }).click();
    await page.getByRole("heading", { name: "Migration Roadmap" }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Generate roadmap" }).click();
    await page.getByText(/\d+ days/).first().waitFor({ timeout: 120_000 });
    check("scanner: roadmap generated", (await page.getByText(/\d+ days/).count()) > 0);

    // --- Evidence
    await page.getByRole("tab", { name: "Evidence" }).click();
    await page.getByRole("heading", { name: "Evidence Record" }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Create evidence record" }).click();
    await page.getByText(/index #\d+/).first().waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: /^Verify$/ }).click();
    await page
      .getByRole("button", { name: /^Verified$/ })
      .waitFor({ timeout: 60_000 })
      .catch(() => {});
    check(
      "scanner: evidence record created and verified",
      (await page.getByRole("button", { name: /^Verified$/ }).count()) > 0,
    );

    // --- Side channel
    await page.getByRole("tab", { name: "Side Channel" }).click();
    await page.getByRole("button", { name: "Run analysis" }).click();
    await page.getByText("Verdict").waitFor({ timeout: 180_000 });
    check("scanner: side-channel verdict", (await page.getByText("Leakage probability").count()) > 0);

    // --- AI planner
    await page.getByRole("tab", { name: "AI Planner" }).click();
    await page.getByRole("button", { name: "Load sample CBOM" }).click();
    await page.getByRole("button", { name: "Generate plan" }).click();
    await page.getByText("RSA-2048").first().waitFor({ timeout: 120_000 });
    check(
      "scanner: planner produces a plan",
      await page.getByText("RSA-2048").first().isVisible(),
    );

    // --- AI & GPU lab
    await page.getByRole("tab", { name: "AI & GPU Lab" }).click();
    await page.getByRole("heading", { name: "Quantum Threat Estimate" }).waitFor({ timeout: 30_000 });
    check("scanner: quantum panel", true);
    check("scanner: anomaly panel", await page.getByRole("heading", { name: "CBOM Anomaly Detection" }).isVisible());
    check("scanner: RL planner panel", await page.getByRole("heading", { name: "RL Migration Planner" }).isVisible());
  }

  const errs = relevant(errors);
  check("scanner: no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await context.close();
}

// ---- Wallet-gated app surfaces still load -------------------------------
for (const path of ["/dashboard", "/vendors"]) {
  const { context, page, response, errors } = await open(path);
  check(`${path}: HTTP 200`, response?.status() === 200);
  const errorPage = await page.getByText(/Application error|Internal Server Error/i).count();
  check(`${path}: no error page`, errorPage === 0);
  const errs = relevant(errors);
  check(`${path}: no page errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
  await context.close();
}

await browser.close();

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log(`Failed: ${failed.map((result) => result.name).join(" | ")}`);
  process.exit(1);
}

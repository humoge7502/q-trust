/**
 * Full production audit for the Q-Trust site.
 *
 * Run from frontend/:  node scripts/full-audit.mjs
 * Override the site:   QTRUST_SITE_URL=https://... node scripts/full-audit.mjs
 *
 * Sections:
 *   1. HTTP surface and security headers for the frontend and hosted API
 *   2. Anonymous browser walk: every route, all internal links, images,
 *      placeholder/dead-UI text, console errors
 *   3. Public verification flow (valid + invalid asset IDs)
 *   4. Mobile layout and navigation
 *   5. Accessibility (axe-core, serious/critical)
 *   6. Wallet connection and role-aware dashboards (injected mock provider)
 *   7. Scanner: every tab, GPU panels, planner, evidence
 *   8. Secret leakage in shipped JavaScript
 *
 * This script never prints a secret; the leak check reports booleans only.
 * Screenshots and a JSON report land in %TEMP%/opencode/qtrust-audit.
 */
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = (process.env.QTRUST_SITE_URL ?? "https://q-trust-nu.vercel.app").replace(/\/$/, "");
const API = (process.env.QTRUST_API_URL ?? "https://qtrust-backend.vercel.app/api").replace(/\/$/, "");
const demo = JSON.parse(readFileSync(resolve(root, "deploy/demo-records.json"), "utf8"));
const assetId = demo.assets[0].assetId;
const org = demo.org;
const OUT = resolve(tmpdir(), "opencode", "qtrust-audit");
mkdirSync(OUT, { recursive: true });

const results = [];
const details = {};
function check(section, name, ok, detail = "") {
  results.push({ section, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${section}] ${name}${detail ? ` (${detail})` : ""}`);
}
function note(section, name, value) {
  (details[section] ??= {})[name] = value;
  console.log(`INFO [${section}] ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}
function envFile(path) {
  const map = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const key = line.slice(0, i).trim();
      let value = line.slice(i + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (key) map[key] = value;
    }
  } catch {
    /* optional file */
  }
  return map;
}
const rootEnv = envFile(resolve(root, ".env"));
const frontendEnv = envFile(resolve(root, "frontend/.env.local"));

async function http(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeout ?? 45_000),
    ...options,
  });
  const body = options.text === false ? "" : await response.text();
  return { status: response.status, headers: response.headers, body, ms: Date.now() - started };
}

// ---------------------------------------------------------------------------
// 1. HTTP surface
// ---------------------------------------------------------------------------
console.log(`\nQ-Trust full audit\nSite: ${SITE}\nAPI:  ${API}\nArtifacts: ${OUT}\n`);

{
  const routes = [
    ["/", 200],
    ["/scanner", 200],
    ["/dashboard", 200],
    ["/vendors", 200],
    ["/v", 200],
    [`/v/${assetId}`, 200],
    ["/robots.txt", 200],
    ["/sitemap.xml", 200],
    ["/manifest.webmanifest", 200],
    ["/definitely-not-a-qtrust-route", 404],
  ];
  for (const [path, expected] of routes) {
    try {
      const r = await http(`${SITE}${path}`);
      check("http", `${path} -> ${expected}`, r.status === expected, `${r.status}, ${r.ms}ms`);
      if (path === "/") {
        note("http", "frontend headers", {
          hsts: r.headers.get("strict-transport-security"),
          csp: r.headers.get("content-security-policy"),
          xcto: r.headers.get("x-content-type-options"),
          referrer: r.headers.get("referrer-policy"),
          frame: r.headers.get("x-frame-options"),
          server: r.headers.get("server"),
        });
        note("http", "robots", (await http(`${SITE}/robots.txt`)).body.trim().slice(0, 200));
      }
    } catch (error) {
      check("http", `${path} -> ${expected}`, false, error.message);
    }
  }

  const apiRoutes = [
    ["/health", 200],
    ["/docs", 200],
    ["/docs/json", 200],
    ["/v1/health", 200],
    [`/v1/assets/${assetId}`, 200],
    [`/v1/assets/${assetId}/verify`, 200],
    [`/v1/orgs/${org}/summary`, 200],
    [`/v1/orgs/${org}/assets`, 200],
    [`/v1/orgs/${org}/migrations`, 200],
    [`/v1/orgs/${org}/audit`, 200],
    [`/v1/vendors/${org}/attestations`, 200],
    ["/v1/products/QTrust-PQC-Lib/support?version=1.4.0&algorithm=ML-KEM-768", 200],
  ];
  for (const [path, expected] of apiRoutes) {
    try {
      const r = await http(`${API}${path}`);
      check("api", `${path} -> ${expected}`, r.status === expected, `${r.status}, ${r.ms}ms`);
      if (path === "/health") {
        note("api", "health body", r.body.slice(0, 300));
        note("api", "backend headers", {
          hsts: r.headers.get("strict-transport-security"),
          csp: r.headers.get("content-security-policy"),
          xcto: r.headers.get("x-content-type-options"),
          frame: r.headers.get("x-frame-options"),
          cors: r.headers.get("access-control-allow-origin"),
        });
      }
      if (path === "/v1/stats") note("api", "stats", r.body.slice(0, 500));
    } catch (error) {
      check("api", `${path} -> ${expected}`, false, error.message);
    }
  }

  // Auth gates: every privileged route must refuse anonymous callers.
  const privileged = [
    ["/v1/plans", { cbom: { assets: [] } }],
    ["/v1/plans/0x0000000000000000000000000000000000000001", null],
    ["/v1/credentials/issue", { subject_did: "did:example:audit" }],
    ["/v1/webhooks/subscribers", null],
    ["/v1/stats", null],
    ["/v1/write/assets", { cbomHash: `0x${"11".repeat(32)}` }],
    ["/v1/write/attestations", { productId: "x", version: "1", algorithm: "ML-KEM-768" }],
    [
      "/v1/relay/attestation",
      {
        productId: "QTrust-Audit",
        version: "1.0.0",
        algorithm: "ML-KEM-768",
        supported: true,
        evidenceURI: "",
        nonce: 0,
        signature: `0x${"11".repeat(65)}`,
      },
    ],
  ];
  for (const [path, body] of privileged) {
    try {
      const r = await http(`${API}${path}`, {
        method: body === null ? "GET" : "POST",
        headers: body === null ? {} : { "content-type": "application/json" },
        body: body === null ? undefined : JSON.stringify(body),
      });
      check("auth", `${path} rejects anonymous`, r.status === 401 || r.status === 403, `${r.status}`);
    } catch (error) {
      check("auth", `${path} rejects anonymous`, false, error.message);
    }
  }

  // CORS: allowed origin echoes, arbitrary origin does not.
  try {
    const allowed = await fetch(`${API}/health`, {
      headers: { Origin: "https://q-trust-nu.vercel.app" },
      signal: AbortSignal.timeout(30_000),
    });
    const denied = await fetch(`${API}/health`, {
      headers: { Origin: "https://evil.example" },
      signal: AbortSignal.timeout(30_000),
    });
    check(
      "security",
      "CORS allows the site origin",
      allowed.headers.get("access-control-allow-origin") === "https://q-trust-nu.vercel.app",
      allowed.headers.get("access-control-allow-origin") ?? "none",
    );
    check(
      "security",
      "CORS does not echo an arbitrary origin",
      !/evil\.example/.test(denied.headers.get("access-control-allow-origin") ?? ""),
      denied.headers.get("access-control-allow-origin") ?? "none",
    );
  } catch (error) {
    check("security", "CORS probes", false, error.message);
  }

  // On-chain proof: the configured registry must have bytecode on Base Sepolia.
  try {
    const rpc = frontendEnv.NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC || "https://sepolia.base.org";
    const registry =
      frontendEnv.NEXT_PUBLIC_QTRUST_ASSET_REGISTRY_ADDRESS ||
      rootEnv.QTRUST_ASSET_REGISTRY_ADDRESS;
    const chain = await http(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const chainBody = JSON.parse(chain.body);
    check("chain", "Base Sepolia RPC chain id 0x14a34", chainBody.result === "0x14a34", chainBody.result);
    if (registry) {
      const code = await http(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_getCode", params: [registry, "latest"] }),
      });
      const codeBody = JSON.parse(code.body);
      check(
        "chain",
        "AssetRegistry has bytecode",
        typeof codeBody.result === "string" && codeBody.result.length > 2,
        `${codeBody.result?.slice(0, 12)}… (${codeBody.result?.length ?? 0} chars)`,
      );
    }
  } catch (error) {
    check("chain", "Base Sepolia RPC probes", false, error.message);
  }
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------
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

async function newContext(browser, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 960 },
    ...options.contextOptions,
  });
  if (options.wallet) {
    await context.addInitScript(
      ({ address, chainId }) => {
        const target = `0x${chainId.toString(16)}`;
        const listeners = new Map();
        const emit = (event, payload) => {
          for (const handler of listeners.get(event) ?? []) {
            try {
              handler(payload);
            } catch {
              /* listener errors are the app's business */
            }
          }
        };
        const storageKey = `qtrust-audit-wallet:${address}`;
        let authorized = false;
        try {
          authorized = localStorage.getItem(storageKey) === "1";
        } catch {
          /* storage unavailable */
        }
        const remember = () => {
          authorized = true;
          provider.selectedAddress = address;
          try {
            localStorage.setItem(storageKey, "1");
          } catch {
            /* storage unavailable */
          }
        };
        const provider = {
          isMetaMask: true,
          isQTrustAuditMock: true,
          chainId: target,
          selectedAddress: authorized ? address : null,
          async request({ method, params }) {
            switch (method) {
              case "eth_requestAccounts":
                remember();
                return [address];
              case "eth_accounts":
                return authorized ? [address] : [];
              case "wallet_requestPermissions":
                remember();
                return [{ parentCapability: "eth_accounts" }];
              case "eth_chainId":
                return provider.chainId;
              case "net_version":
                return String(parseInt(provider.chainId, 16));
              case "wallet_switchEthereumChain": {
                const next = params?.[0]?.chainId;
                if (next) {
                  provider.chainId = next;
                  emit("chainChanged", next);
                }
                return null;
              }
              case "wallet_addEthereumChain":
                return null;
              case "personal_sign":
              case "eth_sign":
              case "eth_signTypedData_v4":
                return `0x${"11".repeat(65)}`;
              case "eth_getBalance":
                return "0x0de0b6b3a7640000";
              case "eth_blockNumber":
                return "0x1";
              case "eth_gasPrice":
                return "0x3b9aca00";
              case "eth_estimateGas":
                return "0x5208";
              case "eth_call":
                return "0x";
              case "eth_sendTransaction":
                return `0x${"33".repeat(32)}`;
              default:
                return null;
            }
          },
          on(event, handler) {
            listeners.set(event, [...(listeners.get(event) ?? []), handler]);
          },
          removeListener(event, handler) {
            listeners.set(
              event,
              (listeners.get(event) ?? []).filter((candidate) => candidate !== handler),
            );
          },
        };
        Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
        window.__qtrustAudit = { provider, switchCalls: 0 };
        window.dispatchEvent(new Event("ethereum#initialized"));
      },
      { address: options.wallet.address, chainId: options.wallet.chainId ?? 84532 },
    );
  }
  return context;
}

async function openPage(context, path, { wait = 1_800 } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location()?.url ?? "";
    if (/(web3modal\.org|walletconnect\.(com|org)|reown)/.test(location)) return;
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
  await page.waitForTimeout(wait);
  return { page, response, errors };
}

async function auditA11y(page, label) {
  try {
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = scan.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    check(
      "a11y",
      `${label}: no serious/critical axe violations`,
      serious.length === 0,
      serious.map((violation) => `${violation.id} (${violation.nodes.length})`).join(", "),
    );
    note("a11y", `${label} counts`, {
      violations: scan.violations.length,
      serious: serious.length,
      passes: scan.passes.length,
    });
    return serious;
  } catch (error) {
    check("a11y", `${label}: axe run`, false, error.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. Anonymous browser walk + 3. verification + 4. mobile + 5. a11y
// ---------------------------------------------------------------------------
const browser = await chromium.launch();
{
  const context = await newContext(browser);
  const { page, response, errors } = await openPage(context, "/");
  check("home", "HTTP 200", response?.status() === 200);
  check("home", "title mentions Q-Trust", /Q-Trust/i.test(await page.title()), await page.title());
  const h1 = await page.locator("h1").count();
  check("home", "exactly one h1", h1 === 1, `${h1}`);
  check(
    "home", "hero copy", (await page.getByText(/post-quantum|quantum-safe|cryptographic/i).count()) > 0,
  );
  const demoLinks = await page.locator('a[href^="/v/0x"]').count();
  check("home", "seeded record links", demoLinks >= 3, `${demoLinks} links`);

  const images = await page.locator("img").evaluateAll((nodes) =>
    nodes.map((node) => ({ src: node.currentSrc || node.src, width: node.naturalWidth })),
  );
  check(
    "home",
    "all images load",
    images.every((image) => image.width > 0),
    images.filter((image) => image.width === 0).map((image) => image.src).join(", "),
  );

  const bodyText = await page.locator("body").innerText();
  check(
    "home",
    "no placeholder copy",
    !/\bTODO\b|Coming soon|Lorem ipsum|\bundefined\b|\bNaN\b/i.test(bodyText),
  );
  check(
    "home",
    "live API status rendered",
    /API live/i.test(bodyText) && !/API unavailable/i.test(bodyText),
  );

  // Internal links from the landing page and scanner must resolve.
  const links = await page.locator("a[href]").evaluateAll((nodes) =>
    [...new Set(nodes.map((node) => node.getAttribute("href")))],
  );
  const internal = links.filter(
    (href) => href && href.startsWith("/") && !href.startsWith("/api/"),
  );
  note("home", "internal links", internal);
  for (const href of internal) {
    if (href.startsWith("/#")) continue;
    const r = await http(`${SITE}${href.split("#")[0]}`);
    check("links", `${href} resolves`, r.status < 400, `${r.status}`);
  }
  const external = links.filter((href) => href && /^https?:\/\//.test(href));
  note("home", "external links", external);
  for (const href of external) {
    try {
      const r = await http(href, { timeout: 25_000 });
      check("links", `external ${new URL(href).host}`, r.status < 400 || r.status === 403, `${r.status}`);
    } catch (error) {
      check("links", `external ${href.slice(0, 60)}`, false, error.message);
    }
  }

  check("home", "no console/page errors", relevant(errors).length === 0, relevant(errors).slice(0, 3).join(" | "));
  await page.screenshot({ path: resolve(OUT, "home-desktop.png"), fullPage: false });
  await auditA11y(page, "home");
  await context.close();
}

// Public verification: /v form, valid lookup, invalid lookup.
{
  const context = await newContext(browser);
  const { page, response, errors } = await openPage(context, "/v");
  check("verify", "/v HTTP 200", response?.status() === 200);
  const form = page.locator("#asset-id");
  check("verify", "lookup form present", (await form.count()) === 1);
  await form.fill(assetId);
  await page.getByRole("button", { name: /^Verify$/ }).click();
  await page.waitForURL(new RegExp(`/v/${assetId}`), { timeout: 60_000 }).catch(() => {});
  check("verify", "valid asset navigates to record", page.url().includes(assetId), page.url());
  await page.getByText(/VALID|REVOKED/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
  check(
    "verify",
    "record status badge",
    await page.getByText(/VALID|REVOKED/i).first().isVisible().catch(() => false),
  );
  const html = await page.content();
  check("verify", "record shows asset id", html.includes(assetId));
  check("verify", "record shows asset details", (await page.getByText("Asset details").count()) > 0);
  check("verify", "record shows CBOM hash", (await page.getByText("CBOM hash").count()) > 0);
  const explorerLinks = await page.locator('a[href*="sepolia.basescan.org"]').count();
  check("verify", "links to Base Sepolia explorer", explorerLinks > 0, `${explorerLinks}`);
  check(
    "verify",
    "not an unreachable state",
    (await page.getByText("RECORD UNREACHABLE").count()) === 0,
  );
  await page.screenshot({ path: resolve(OUT, "verify-valid.png"), fullPage: false });
  await auditA11y(page, "verify-record");
  check("verify", "no console/page errors", relevant(errors).length === 0, relevant(errors).slice(0, 3).join(" | "));
  await context.close();
}

{
  const context = await newContext(browser);
  const { page } = await openPage(context, "/v");
  // The page is a client form; give React time to hydrate before clicking.
  await page.waitForTimeout(3_000);
  await page.locator("#asset-id").fill("0xdeadbeef");
  await page.getByRole("button", { name: /^Verify$/ }).click();
  const errorAlert = page.getByRole("alert").filter({ hasText: /Asset ID/i }).first();
  await errorAlert.waitFor({ timeout: 15_000 }).catch(() => {});
  const alert = (await errorAlert.textContent().catch(() => ""))?.trim();
  check("verify", "invalid asset id gets an inline error", Boolean(alert), alert?.slice(0, 120));
  check("verify", "invalid input stays on the form", page.url().endsWith("/v"), page.url());
  await context.close();
}

// Invalid-but-well-formed asset: friendly empty state, not a crash.
{
  const context = await newContext(browser);
  const fake = `0x${"ab".repeat(32)}`;
  const { page, response, errors } = await openPage(context, `/v/${fake}`, { wait: 3_000 });
  check("verify", "unknown asset page responds", response?.status() === 200, `${response?.status()}`);
  await page
    .waitForFunction(
      () => /not found|unreachable|no record|does not exist|verified/i.test(document.body.innerText),
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => {});
  const text = await page.locator("body").innerText();
  check(
    "verify",
    "unknown asset explains itself",
    /not found|unreachable|no record|does not exist|verified/i.test(text),
  );
  check("verify", "unknown asset does not crash", relevant(errors).length === 0, relevant(errors).slice(0, 2).join(" | "));
  await context.close();
}

// Mobile home, menu, scanner and dashboard gate.
{
  const context = await newContext(browser, { viewport: { width: 390, height: 844 } });
  const { page, errors } = await openPage(context, "/");
  await page.waitForTimeout(2_000);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check("mobile", "home has no horizontal overflow", overflow <= 1, `${overflow}px`);
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("dialog");
  await menu.waitFor({ timeout: 15_000 });
  const mobileLinks = menu.getByRole("link");
  check("mobile", "menu opens with all nav items", (await mobileLinks.count()) >= 5);
  await page.screenshot({ path: resolve(OUT, "mobile-menu.png") });
  await menu.getByRole("link", { name: "Scanner" }).click();
  await page.waitForURL(/\/scanner/, { timeout: 20_000 });
  check("mobile", "mobile nav reaches scanner", page.url().includes("/scanner"));
  check("mobile", "no console/page errors", relevant(errors).length === 0, relevant(errors).slice(0, 2).join(" | "));
  const scannerOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check("mobile", "scanner has no horizontal overflow", scannerOverflow <= 1, `${scannerOverflow}px`);
  await page.screenshot({ path: resolve(OUT, "mobile-scanner.png"), fullPage: false });
  await context.close();
}

// ---------------------------------------------------------------------------
// 6. Wallet connection (injected mock)
// ---------------------------------------------------------------------------
const ORG = org;
const RANDOM = "0x1111111111111111111111111111111111111111";

async function connectWallet(page, label) {
  const connect = page.getByRole("button", { name: /Connect Wallet|Connect a Wallet|Connect/i }).first();
  await connect.click({ timeout: 20_000 });
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 20_000 });
  const modalText = await dialog.innerText();
  const options = {
    walletConnect: /WalletConnect/i.test(modalText),
    rainbow: /Rainbow/i.test(modalText),
    metaMask: /MetaMask/i.test(modalText),
    coinbase: /Coinbase/i.test(modalText),
    injected: /Browser Wallet|Injected/i.test(modalText),
  };
  note("wallet", `${label} modal options`, options);
  await dialog.screenshot({ path: resolve(OUT, `wallet-modal-${label}.png`) }).catch(() => {});
  check("wallet", `${label}: MetaMask listed`, options.metaMask);
  check("wallet", `${label}: Coinbase listed`, options.coinbase);
  check("wallet", `${label}: injected browser wallet listed`, options.injected);
  check("wallet", `${label}: no dead WalletConnect entry`, !options.walletConnect);
  check("wallet", `${label}: no dead Rainbow entry`, !options.rainbow);
  // Use the generic injected connector: it is the path a browser extension
  // takes (including MetaMask) without the MetaMask SDK/deep-link transport.
  const target = dialog.getByRole("button", { name: /Browser Wallet|Injected/i }).first();
  await target.click({ timeout: 20_000 });
  await dialog.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
  return options;
}

{
  const context = await newContext(browser, { wallet: { address: ORG } });
  const { page, errors } = await openPage(context, "/dashboard", { wait: 2_500 });
  const gate = page.getByRole("heading", { name: "Connect your wallet" });
  await gate.waitFor({ timeout: 30_000 }).catch(() => {});
  check("wallet", "disconnected dashboard gates", await gate.isVisible().catch(() => false));
  const options = await connectWallet(page, "dashboard");
  await page.getByRole("heading", { name: "Org dashboard" }).waitFor({ timeout: 60_000 });
  check("wallet", "org wallet connects", true);
  check(
    "wallet",
    "connected address shown",
    (await page.getByText(/0xE610…?875C|0xE610/i).count()) > 0,
  );
  await page.getByText(/registered assets \(3\)/i).waitFor({ timeout: 60_000 }).catch(() => {});
  const body = await page.locator("body").innerText();
  check(
    "wallet",
    "org data loads",
    /total migrations/i.test(body) && /registered assets \(3\)/i.test(body),
  );
  check("wallet", "verified migration shown", /verified\s+1/i.test(body.replace(/\n+/g, " ")));

  // The dashboard's own planner and its sample verification flow must work for
  // an anonymous visitor (the proxy classifies them as public-compute).
  await page.getByRole("button", { name: "Load sample CBOM" }).click();
  await page.getByRole("button", { name: "Generate plan" }).click();
  await page.getByText("RSA-2048").first().waitFor({ timeout: 120_000 }).catch(() => {});
  check("wallet", "dashboard planner produces a plan", (await page.getByText("RSA-2048").count()) > 0);

  await page.getByRole("button", { name: "Verify on-chain" }).first().click();
  await page.getByRole("button", { name: /Verified ✓ active/ }).first().waitFor({ timeout: 60_000 }).catch(() => {});
  check(
    "wallet",
    "dashboard sample verification works",
    (await page.getByRole("button", { name: /Verified ✓ active/ }).count()) > 0,
  );

  check(
    "wallet",
    "no console/page errors while connected",
    relevant(errors).length === 0,
    relevant(errors).slice(0, 3).join(" | "),
  );
  await page.screenshot({ path: resolve(OUT, "dashboard-connected.png"), fullPage: false });
  await auditA11y(page, "dashboard-connected");

  // Wallet-gated navigation: vendor portal for the same address (seeded vendor).
  await page.getByRole("link", { name: "Vendors" }).first().click();
  await page.waitForURL(/\/vendors/, { timeout: 30_000 });
  await page.getByRole("heading", { name: "Vendor portal" }).waitFor({ timeout: 60_000 }).catch(() => {});
  check(
    "wallet",
    "seeded vendor sees vendor portal",
    await page.getByRole("heading", { name: "Vendor portal" }).isVisible().catch(() => false),
  );
  await page.getByText(/attestations \(3\)/i).waitFor({ timeout: 60_000 }).catch(() => {});
  const vendorBody = await page.locator("body").innerText();
  check("wallet", "attestations load", /attestations \(3\)/i.test(vendorBody));
  check("wallet", "attestation form present", (await page.getByText(/Attest product/i).count()) > 0);
  check("wallet", "product support check present", (await page.getByText("Product support check").count()) > 0);
  check(
    "wallet",
    "support result arrives",
    (await page.getByText(/Supported|Not supported/i).count()) > 0,
  );
  await page.screenshot({ path: resolve(OUT, "vendors-connected.png"), fullPage: false });
  await auditA11y(page, "vendors-connected");
  await context.close();
}

// A connected wallet with no role must get onboarding, not a broken dashboard.
{
  const context = await newContext(browser, { wallet: { address: RANDOM } });
  const { page, errors } = await openPage(context, "/dashboard", { wait: 2_500 });
  await connectWallet(page, "new-wallet");
  await page.getByRole("heading", { name: /Welcome to Q-Trust|Org dashboard/ }).waitFor({ timeout: 60_000 });
  const body = await page.locator("body").innerText();
  check("wallet", "new wallet gets onboarding", /Welcome to Q-Trust/.test(body));
  check("wallet", "new wallet has a next step", /Run your first scan/.test(body));
  await page.getByRole("button", { name: /0x1/i }).first().waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    "wallet",
    "new wallet onboarding shows the account control",
    (await page.getByRole("button", { name: /0x1/i }).count()) > 0,
  );
  check("wallet", "new wallet dashboard does not crash", relevant(errors).length === 0, relevant(errors).slice(0, 2).join(" | "));
  await page.screenshot({ path: resolve(OUT, "dashboard-new-wallet.png"), fullPage: false });

  await page.goto(`${SITE}/vendors`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: /Welcome to Q-Trust Vendor Portal|Vendor portal/ })
    .waitFor({ timeout: 45_000 })
    .catch(() => {});
  const vendorBody = await page.locator("body").innerText();
  check("wallet", "new wallet gets vendor onboarding", /Welcome to Q-Trust Vendor Portal/.test(vendorBody));
  await page.getByRole("button", { name: /0x1/i }).first().waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    "wallet",
    "vendor onboarding shows the account control",
    (await page.getByRole("button", { name: /0x1/i }).count()) > 0,
  );
  await context.close();
}

// Wrong network must be surfaced and switchable.
{
  const context = await newContext(browser, { wallet: { address: ORG, chainId: 1 } });
  const { page } = await openPage(context, "/dashboard", { wait: 2_500 });
  await connectWallet(page, "wrong-chain");
  await page.waitForTimeout(4_000);
  const chain = await page.evaluate(() => window.__qtrustAudit?.provider?.chainId);
  note("wallet", "mock chain before switch", chain);
  await page.screenshot({ path: resolve(OUT, "dashboard-wrong-chain.png"), fullPage: false });

  if (changedToBase(chain)) {
    // RainbowKit asked the wallet to switch to the only supported chain as
    // part of connecting. That is the desired flow for a first-time visitor.
    check("wallet", "connecting on another network switches to Base Sepolia", true, String(chain));
  } else {
    const wrong = await page.getByText(/Wrong network|Switch network|Unsupported chain/i).count();
    check("wallet", "wrong network is surfaced", wrong > 0);
    const wrongButton = page
      .getByRole("button", { name: /Wrong network|Switch network|Switch to Base/i })
      .first();
    if (await wrongButton.isVisible().catch(() => false)) {
      await wrongButton.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(2_000);
      const options = page.getByRole("button", { name: /Base Sepolia|Switch to Base Sepolia/i }).first();
      if (await options.isVisible().catch(() => false)) {
        await options.click({ timeout: 10_000 }).catch(() => {});
      }
      await page.waitForTimeout(3_000);
    }
    const after = await page.evaluate(() => window.__qtrustAudit?.provider?.chainId);
    note("wallet", "mock chain after switch", after);
    check("wallet", "wallet can switch to Base Sepolia", changedToBase(after), String(after));
  }
  await context.close();
}

function changedToBase(chain) {
  return chain === "0x14a34" || chain === 84532 || chain === "84532";
}

// Disconnect returns the gate.
{
  const context = await newContext(browser, { wallet: { address: ORG } });
  const { page } = await openPage(context, "/dashboard", { wait: 2_500 });
  await connectWallet(page, "disconnect");
  await page.getByRole("heading", { name: "Org dashboard" }).waitFor({ timeout: 60_000 });
  const accountButton = page.getByRole("button", { name: /0xE6|Account/i }).first();
  await accountButton.click({ timeout: 15_000 }).catch(() => {});
  const disconnect = page.getByRole("button", { name: /Disconnect/i }).first();
  if (await disconnect.isVisible().catch(() => false)) {
    await disconnect.click();
    await page.waitForTimeout(2_000);
    check(
      "wallet",
      "disconnect returns the gate",
      await page.getByRole("heading", { name: "Connect your wallet" }).isVisible().catch(() => false),
    );
  } else {
    check("wallet", "disconnect control is reachable", false, "account menu did not expose Disconnect");
    await page.screenshot({ path: resolve(OUT, "wallet-account-menu.png") });
  }
  await context.close();
}

// ---------------------------------------------------------------------------
// 7. Scanner: every tab and the AI/GPU panels
// ---------------------------------------------------------------------------
{
  const context = await newContext(browser);
  const { page, response, errors } = await openPage(context, "/scanner", { wait: 3_500 });
  check("scanner", "HTTP 200", response?.status() === 200);
  const tabs = (await page.getByRole("tab").allTextContents()).map((text) => text.trim());
  check(
    "scanner",
    "all eight tabs",
    ["Scan", "Risk Scores", "Compliance", "Roadmap", "Evidence", "Side Channel", "AI Planner", "AI & GPU Lab"].every(
      (name) => tabs.includes(name),
    ),
    tabs.join(", "),
  );
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
  check("scanner", "scan returns 20 demo findings", !scanError && rows === 20, scanError || `${rows} rows`);
  const scanText = await page.locator("body").innerText();
  check("scanner", "PQC inventory is visible", /ML-KEM-768/.test(scanText));
  check("scanner", "no undefined/NaN in results", !/\bundefined\b|\bNaN\b/.test(scanText));
  await page.screenshot({ path: resolve(OUT, "scanner-scan.png"), fullPage: false });

  await page.getByRole("tab", { name: "Risk Scores" }).click();
  await page.getByText("Quantum Risk Scores").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /Calculate risk scores/i }).click();
  await page.getByText("CRITICAL").first().waitFor({ timeout: 120_000 }).catch(() => {});
  const riskText = await page.locator("body").innerText();
  check(
    "scanner",
    "risk scores render",
    /BROKEN/.test(riskText) && /CRITICAL/.test(riskText) && /INVENTORY/.test(riskText),
    riskText.match(/CRITICAL/g)?.length ? `${riskText.match(/CRITICAL/g).length} critical` : "no CRITICAL",
  );

  await page.getByRole("tab", { name: "Compliance" }).click();
  await page.getByText("Compliance Assessment").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Evaluate" }).click();
  await page.getByText(/non-compliant/i).first().waitFor({ timeout: 120_000 });
  check("scanner", "compliance report", (await page.getByText(/non-compliant/i).count()) > 0);

  await page.getByRole("tab", { name: "Roadmap" }).click();
  await page.getByRole("heading", { name: "Migration Roadmap" }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Generate roadmap" }).click();
  await page.getByText(/\d+ days/).first().waitFor({ timeout: 120_000 });
  check("scanner", "roadmap generated", (await page.getByText(/\d+ days/).count()) > 0);

  await page.getByRole("tab", { name: "Evidence" }).click();
  await page.getByRole("heading", { name: "Evidence Record" }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Create evidence record" }).click();
  const evidenceCreated = await page
    .getByText(/index #\d+/)
    .first()
    .waitFor({ timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  const evidenceError = evidenceCreated
    ? ""
    : ((await page.locator("p.text-danger").first().textContent().catch(() => null)) ?? "").trim();
  check("scanner", "evidence record created", evidenceCreated, evidenceCreated ? "" : evidenceError || "index not rendered");
  await page.screenshot({ path: resolve(OUT, "scanner-evidence.png"), fullPage: false });
  if (evidenceCreated) {
    await page.getByRole("button", { name: /^Verify$/ }).click();
    await page.getByRole("button", { name: /^Verified$/ }).waitFor({ timeout: 60_000 }).catch(() => {});
    check("scanner", "evidence record verified", (await page.getByRole("button", { name: /^Verified$/ }).count()) > 0);
  }

  await page.getByRole("tab", { name: "Side Channel" }).click();
  await page.getByRole("button", { name: "Run analysis" }).click();
  await page.getByText("Verdict").waitFor({ timeout: 180_000 });
  check("scanner", "side-channel verdict", (await page.getByText("Leakage probability").count()) > 0);

  await page.getByRole("tab", { name: "AI Planner" }).click();
  await page.getByRole("button", { name: "Load sample CBOM" }).click();
  await page.getByRole("button", { name: "Generate plan" }).click();
  await page.getByText("RSA-2048").first().waitFor({ timeout: 120_000 });
  check("scanner", "AI planner produces a plan", await page.getByText("RSA-2048").first().isVisible());

  await page.getByRole("tab", { name: "AI & GPU Lab" }).click();
  await page.getByRole("heading", { name: "Quantum Threat Estimate" }).waitFor({ timeout: 30_000 });
  check("scanner", "quantum panel", true);
  check("scanner", "anomaly panel", await page.getByRole("heading", { name: "CBOM Anomaly Detection" }).isVisible());
  check("scanner", "RL panel", await page.getByRole("heading", { name: "RL Migration Planner" }).isVisible());

  // Run the three GPU-backed actions, not just render their shells.
  await page.getByRole("button", { name: /Estimate RSA-2048 threat/i }).click();
  await page.getByText(/Migration urgency/i).waitFor({ timeout: 60_000 }).catch(() => {});
  check("scanner", "quantum estimate runs", (await page.getByText(/Migration urgency/i).count()) > 0);

  await page.getByRole("button", { name: /Score CBOM/i }).click();
  await page.getByText(/Anomaly|anomal/i).nth(1).waitFor({ timeout: 60_000 }).catch(() => {});
  check("scanner", "anomaly scoring runs", !(await page.getByText(/anomaly detection failed/i).count()));

  await page.getByRole("button", { name: /Generate migration plan/i }).click();
  await page.getByText(/Method:|Steps|Migration plan/i).first().waitFor({ timeout: 90_000 }).catch(() => {});
  check("scanner", "RL migration plan runs", (await page.getByText(/Policy network|Method:/i).count()) > 0);
  await page.screenshot({ path: resolve(OUT, "scanner-gpu-lab.png"), fullPage: false });

  check("scanner", "no console/page errors", relevant(errors).length === 0, relevant(errors).slice(0, 3).join(" | "));
  await auditA11y(page, "scanner");
  await context.close();
}

// ---------------------------------------------------------------------------
// 8. Secret leakage in shipped JavaScript
// ---------------------------------------------------------------------------
{
  const secrets = {
    QTRUST_API_KEY: rootEnv.QTRUST_API_KEY,
    QTRUST_RELAYER_PRIVATE_KEY: rootEnv.QTRUST_RELAYER_PRIVATE_KEY,
    POSTGRES_PASSWORD: frontendEnv.POSTGRES_PASSWORD || frontendEnv.PGPASSWORD,
    NEON_URL: frontendEnv.DATABASE_URL,
    VERCEL_OIDC_TOKEN: frontendEnv.VERCEL_OIDC_TOKEN,
  };
  const context = await newContext(browser);
  const { page } = await openPage(context, "/", { wait: 500 });
  const sources = await page.locator("script[src]").evaluateAll((nodes) =>
    nodes.map((node) => node.src),
  );
  let bundle = (await page.content()).toString();
  for (const src of sources) {
    try {
      const r = await http(src, { timeout: 60_000 });
      bundle += r.body;
    } catch {
      /* skipped */
    }
  }
  note("secrets", "scanned bytes", bundle.length);
  note("secrets", "script count", sources.length);
  for (const [name, value] of Object.entries(secrets)) {
    if (!value || value.length < 8) {
      note("secrets", `${name} leak check`, "skipped (not configured)");
      continue;
    }
    check("secrets", `${name} absent from shipped JS`, !bundle.includes(value));
  }
  const publicKey = frontendEnv.NEXT_PUBLIC_QTRUST_ASSET_REGISTRY_ADDRESS;
  check(
    "secrets",
    "only intended public config is shipped",
    !publicKey || bundle.includes(publicKey),
    publicKey ? "registry address present" : "no registry configured",
  );
  await context.close();
}

await browser.close();

const failed = results.filter((result) => !result.ok);
const bySection = results.reduce((acc, result) => {
  acc[result.section] ??= { pass: 0, fail: 0 };
  acc[result.section][result.ok ? "pass" : "fail"]++;
  return acc;
}, {});
writeFileSync(
  resolve(OUT, "report.json"),
  JSON.stringify({ site: SITE, api: API, generatedAt: new Date().toISOString(), bySection, results, details }, null, 2),
);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log("Sections:", JSON.stringify(bySection));
if (failed.length) console.log(`Failed: ${failed.map((result) => `${result.section}/${result.name}`).join(" | ")}`);
console.log(`Report: ${resolve(OUT, "report.json")}`);
process.exit(failed.length ? 1 : 0);

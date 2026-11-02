/**
 * Record the Q-Trust product tour, scene by scene, at 1920x1080.
 *
 * Each scene gets its own browser context so the recordings cut cleanly and a
 * failure in one scene cannot poison the rest. The wallet is an injected
 * EIP-1193 provider (same shape as full-audit.mjs) so the connect flow can be
 * filmed without a real extension.
 *
 *   node scripts/record-tour.mjs                 # all scenes
 *   node scripts/record-tour.mjs wallet vendors  # only these
 *
 * Output: brag-output/tour/clips/<scene>.webm plus <scene>.json with the
 * scene's wall-clock duration (used to lay narration over the cut).
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = (process.env.QTRUST_SITE_URL ?? "https://q-trust-nu.vercel.app").replace(/\/$/, "");
const demo = JSON.parse(readFileSync(resolve(root, "deploy/demo-records.json"), "utf8"));
const ASSET = demo.assets[0].assetId;
const ORG = demo.org;
const OUT = resolve(root, "brag-output/tour/clips");
mkdirSync(OUT, { recursive: true });

const W = 1920;
const H = 1080;
const only = process.argv.slice(2);
const wanted = (name) => only.length === 0 || only.includes(name);

function mockWallet(context, address, chainId = 84532) {
  return context.addInitScript(
    ({ address, chainId }) => {
      const target = `0x${chainId.toString(16)}`;
      const STORE = "qtrust-tour:authorized";
      const listeners = new Map();
      const emit = (event, payload) => {
        for (const handler of listeners.get(event) ?? []) {
          try { handler(payload); } catch { /* app's business */ }
        }
      };
      // Authorization must survive a full page load: the vendor scene navigates
      // to /vendors, which re-runs this init script, and an in-memory-only flag
      // left the page stuck on "Checking wallet…".
      let authorized = false;
      try { authorized = window.localStorage.getItem(STORE) === address; } catch { /* storage blocked */ }
      const remember = () => {
        authorized = true;
        provider.selectedAddress = address;
        try { window.localStorage.setItem(STORE, address); } catch { /* storage blocked */ }
      };
      const provider = {
        isMetaMask: true,
        isQTrustTourMock: true,
        chainId: target,
        selectedAddress: null,
        async request({ method, params }) {
          switch (method) {
            case "eth_requestAccounts":
            case "wallet_requestPermissions":
              remember();
              return method === "wallet_requestPermissions"
                ? [{ parentCapability: "eth_accounts" }]
                : [address];
            case "eth_accounts":
              return authorized ? [address] : [];
            case "eth_chainId":
              return provider.chainId;
            case "net_version":
              return String(parseInt(provider.chainId, 16));
            case "wallet_switchEthereumChain": {
              const next = params?.[0]?.chainId;
              if (next) { provider.chainId = next; emit("chainChanged", next); }
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
        on(event, handler) { listeners.set(event, [...(listeners.get(event) ?? []), handler]); },
        removeListener(event, handler) {
          listeners.set(event, (listeners.get(event) ?? []).filter((h) => h !== handler));
        },
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
      window.dispatchEvent(new Event("ethereum#initialized"));
    },
    { address, chainId },
  );
}

/**
 * Scene-local clock. Scenes that have to wait on a network round-trip (a scan
 * takes several seconds) spend the first half of the shot on an empty form;
 * recording the moment the real content lands lets the assembler trim that
 * dead lead-in instead of padding the narration over nothing.
 */
let sceneStart = 0;
let marks = {};
const mark = (label = "content") => {
  marks[label] = Number(((Date.now() - sceneStart) / 1000).toFixed(2));
};

/** Slow, human-looking scroll: 60 fps-ish steps with easing. */async function glide(page, distance, ms = 1200) {
  await page.evaluate(
    async ({ distance, ms }) => {
      const start = window.scrollY;
      const t0 = performance.now();
      await new Promise((done) => {
        function frame(now) {
          const p = Math.min(1, (now - t0) / ms);
          const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          window.scrollTo(0, start + distance * eased);
          if (p < 1) requestAnimationFrame(frame); else done();
        }
        requestAnimationFrame(frame);
      });
    },
    { distance, ms },
  );
}

async function hover(page, selector, settle = 700) {
  const el = page.locator(selector).first();
  if (await el.count().catch(() => 0)) {
    await el.hover({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(settle);
  }
}

const scenes = {
  async landing(page, ctx) {
    await page.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 90_000 });
    // The hero animates in a beat after the shell paints; mark that so the
    // assembler compresses the empty first paint instead of opening on it.
    await page.getByText(/Make trust/i).first().waitFor({ timeout: 60_000 }).catch(() => {});
    mark("content");
    await page.waitForTimeout(2600);
    await glide(page, 520, 1600);
    await page.waitForTimeout(1400);
    await glide(page, 620, 1600);
    await page.waitForTimeout(1800);
    await glide(page, -500, 1200);
    await page.waitForTimeout(900);
  },

  async verify(page) {
    await page.goto(`${SITE}/v`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(1800);
    const input = page.locator("input").first();
    await input.click();
    await page.waitForTimeout(400);
    await input.pressSequentially(ASSET, { delay: 12 });
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: /^Verify$/ }).click();
    await page.getByText(/VALID|REVOKED/i).first().waitFor({ timeout: 40_000 }).catch(() => {});
    await page.waitForTimeout(2200);
    await glide(page, 430, 1400);
    await page.waitForTimeout(1800);
    await glide(page, 380, 1300);
    await page.waitForTimeout(1500);
  },

  async scan(page) {
    await page.goto(`${SITE}/scanner`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(2200);
    await page.getByRole("button", { name: /^Run scan$/ }).click();
    await page.waitForTimeout(1200);
    await page.getByText(/20 demo findings|findings/i).first().waitFor({ timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(2600);
    await glide(page, 560, 1500);
    await page.waitForTimeout(1900);
    await glide(page, 520, 1500);
    await page.waitForTimeout(1600);
  },

  async risk(page) {
    await page.goto(`${SITE}/scanner`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /^Run scan$/ }).click();
    // Switch to the target tab immediately: the scan takes several seconds and
    // watching an empty Scan form is dead air, while the Risk tab fills in as
    // soon as the findings land.
    await page.getByRole("tab", { name: "Risk Scores" }).click();
    await page.getByRole("button", { name: /Calculate risk scores/i }).click();
    await page.getByText(/CRITICAL/i).first().waitFor({ timeout: 120_000 }).catch(() => {});
    mark("content");
    await page.waitForTimeout(3000);
    await glide(page, 520, 1600);
    await page.waitForTimeout(2400);
    await glide(page, 360, 1200);
    await page.waitForTimeout(2200);
  },

  async compliance(page) {
    await page.goto(`${SITE}/scanner`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /^Run scan$/ }).click();
    await page.getByRole("tab", { name: "Compliance" }).click();
    // Evaluate against CNSA 2.0, not the permissive NIST 800-131A default: CNSA
    // is the post-quantum transition profile, so it is the one that actually
    // flags RSA and friends and shows the product doing its job.
    await page.locator("select").first().selectOption("CNSA");
    await page.getByRole("button", { name: "Evaluate" }).click();
    // Wait for a failing control, not merely for the summary line — the summary
    // reads "0 non-compliant" and would match before any verdict rendered.
    await page.getByText(/^\s*fail\s*$/i).first().waitFor({ timeout: 120_000 }).catch(() => {});
    mark("content");
    await page.waitForTimeout(3200);
    await glide(page, 480, 1500);
    await page.waitForTimeout(2400);
    await glide(page, 320, 1200);
    await page.waitForTimeout(2000);
  },

  async roadmap(page) {
    await page.goto(`${SITE}/scanner`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /^Run scan$/ }).click();
    await page.getByRole("tab", { name: "Roadmap" }).click();
    // The panel shows "Run a scan first" until the scan resolves, so the button
    // does not exist yet at this point — wait for it before wiring the response
    // listener, otherwise the click silently never happens.
    const genButton = page.getByRole("button", { name: /Generate roadmap/i }).first();
    await genButton.waitFor({ timeout: 90_000 }).catch(() => {});
    const done = page.waitForResponse(
      (r) => r.url().includes("/v1/roadmap/generate") && r.status() === 200,
      { timeout: 120_000 },
    );
    await genButton.click({ timeout: 30_000 }).catch(() => {});
    await done.catch(() => {});
    await page.getByRole("heading", { level: 3 }).first().waitFor({ timeout: 30_000 }).catch(() => {});
    mark("content");
    await page.waitForTimeout(3200);
    await glide(page, 520, 1600);
    await page.waitForTimeout(2400);
    await glide(page, 340, 1200);
    await page.waitForTimeout(2000);
  },

  async wallet(page) {
    await page.goto(`${SITE}/dashboard`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /Connect Wallet|Connect a Wallet|Connect/i }).first().click();
    await page.getByRole("dialog").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1100);
    const injected = page.getByRole("dialog").getByRole("button", { name: /Browser Wallet|Injected|MetaMask/i }).first();
    await injected.hover().catch(() => {});
    await page.waitForTimeout(500);
    await injected.click();
    await page.getByRole("heading", { name: "Org dashboard" }).waitFor({ timeout: 90_000 });
    mark("content");
    await page.waitForTimeout(2600);
    await glide(page, 460, 1500);
    await page.waitForTimeout(2200);
    await glide(page, 520, 1600);
    await page.waitForTimeout(2200);
    await glide(page, 420, 1400);
    await page.waitForTimeout(2400);
  },

  async vendors(page) {
    // Sign in on the dashboard first, then walk to the registry. The provider
    // remembers the authorization in localStorage, so the full navigation to
    // /vendors reconnects instead of stalling on "Checking wallet…".
    await page.goto(`${SITE}/dashboard`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(1000);
    const connect = page.getByRole("button", { name: /Connect Wallet|Connect a Wallet|Connect/i }).first();
    if (await connect.count()) {
      await connect.click();
      await page.getByRole("dialog").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(700);
      await page.getByRole("dialog").getByRole("button", { name: /Browser Wallet|Injected|MetaMask/i }).first().click();
      await page.getByRole("heading", { name: "Org dashboard" }).waitFor({ timeout: 90_000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    await page.goto(`${SITE}/vendors`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.getByText(/Checking wallet/i).waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {});
    mark("content");
    await page.waitForTimeout(2800);
    await glide(page, 480, 1500);
    await page.waitForTimeout(2400);
    await glide(page, 460, 1400);
    await page.waitForTimeout(2000);
  },

  async outro(page) {
    await page.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(2600);
  },
};

const browser = await chromium.launch();
const results = [];
for (const [name, run] of Object.entries(scenes)) {
  if (!wanted(name)) continue;
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    colorScheme: "dark",
  });
  mockWallet(context, ORG);
  const page = await context.newPage();
  marks = {};
  sceneStart = Date.now();
  const started = sceneStart;
  try {
    await run(page, context);
    const video = page.video();
    await context.close();
    const path = await video.path();
    const dest = resolve(OUT, `${name}.webm`);
    const { renameSync } = await import("node:fs");
    renameSync(path, dest);
    const seconds = (Date.now() - started) / 1000;
    results.push({ scene: name, file: dest, seconds, marks });
    writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify({ scene: name, seconds, marks }, null, 2));
    console.log(`OK ${name} ${seconds.toFixed(1)}s${marks.content ? ` content@${marks.content}s` : ""}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${String(err).split("\n")[0]}`);
    await context.close().catch(() => {});
  }
}
await browser.close();
// Merge into any existing index so a partial run (`record-tour.mjs risk`) does
// not erase the scenes filmed earlier.
const indexPath = resolve(OUT, "index.json");
let merged = [];
try {
  merged = JSON.parse(readFileSync(indexPath, "utf8"));
} catch {
  merged = [];
}
const byScene = new Map(merged.map((entry) => [entry.scene, entry]));
for (const entry of results) byScene.set(entry.scene, entry);
writeFileSync(indexPath, JSON.stringify([...byScene.values()], null, 2));
console.log(JSON.stringify(results, null, 2));

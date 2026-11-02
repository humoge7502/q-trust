import { expect, test } from "@playwright/test";

import { expectQTrustApp } from "./app-identity";
import { A11Y_TAGS, auditPage, waitForSettledAnimations } from "./axe-audit";

/**
 * TD-12 (2026-10-24): the wallet-gated surfaces — /dashboard and /vendors —
 * were the last unaudited screens: reaching them requires a *connected*
 * wallet, and the e2e suite deliberately does not fake `useAccount` in the
 * app bundle. This spec closes the gap from the outside: a minimal EIP-1193
 * provider is injected before app load, wagmi's injected connector
 * auto-connects against it (verified: the connected chip renders with no
 * modal interaction), and the connected UI is audited with the same axe rule
 * set as every other surface.
 *
 * The provider stub implements only what rendering needs — chainId,
 * accounts, and event plumbing. No signing: these pages never sign to render.
 */

const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BASE_SEPOLIA_CHAIN_ID = "0x14a34"; // 84532

const ETH_PROVIDER_INIT = `
  (() => {
    const listeners = {};
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method }) => {
        switch (method) {
          case "eth_chainId": return "${BASE_SEPOLIA_CHAIN_ID}";
          case "net_version": return "84532";
          case "eth_blockNumber": return "0x1";
          case "eth_accounts":
          case "eth_requestAccounts": return ["${TEST_ADDRESS}"];
          case "wallet_getPermissions": return [{ parentCapability: "eth_accounts" }];
          case "eth_call": return "0x";
          case "eth_getCode": return "0x";
          case "eth_getBalance": return "0x0";
          case "eth_gasPrice": return "0x1";
          default: return null;
        }
      },
      on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeListener: (ev, fn) => {
        listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
      },
    };
  })();
`;

test.describe("wallet-gated a11y (TD-12)", () => {
  // The connect flow races RainbowKit's remote config in CI; a single retry
  // absorbs the transient modal-render races without masking a real a11y
  // regression (the axe audit itself must still pass on the successful run).
  test.describe.configure({ retries: 1 });

  // CI compiles /dashboard and /vendors on first hit (Next dev on-demand);
  // the 30s default expires mid-compile. 240s covers a cold compile plus the
  // gate wait and the full modal connect flow on both viewports.
  test.setTimeout(240_000);

  for (const route of ["/dashboard", "/vendors"]) {
    test(`${route} connected state has no critical or serious violations`, async ({ page }) => {
      await page.addInitScript(ETH_PROVIDER_INIT);
      // No third-party egress — but respond 403 rather than abort: a network
      // error triggers fetchers' retry/backoff (appkit's remote-config loop,
      // viem's transport), which is exactly the stall this stub exists to
      // prevent. A 403 is the definitive answer every consumer here already
      // degrades on: RainbowKit logs "Using local/default values", and the
      // role queries error out immediately (retry: false) so the connected
      // empty state renders.
      await page.route(/reown\.com|walletconnect\.com|web3modal\.org|sepolia\.base\.org/, (r) =>
        r.fulfill({ status: 403, contentType: "application/json", body: "{}" }),
      );
      // The connected EMPTY states ("Your wallet is connected, but you
      // haven't registered any assets yet.") settle only after the backend
      // read-model queries resolve. CI does not start the backend on :3001,
      // so those queries must be answered here — a fulfilled 200 with a
      // valid empty payload settles them deterministically, independent of
      // whether a backend happens to be running (hermetic in CI and local).
      await page.route(/localhost:3001|127\.0\.0\.1:3001|\/v1\//, (r) => {
        const url = r.request().url();
        const body = /attestations/.test(url)
          ? JSON.stringify({ vendor: "", items: [], total: 0 })
          : "[]";
        r.fulfill({ status: 200, contentType: "application/json", body });
      });
      await page.goto(route);
      await expectQTrustApp(page);

      // The injected connector (shimDisconnect) auto-connects against the
      // stubbed provider, but CI machines start wagmi/appkit much more
      // slowly than a dev workstation, so the connected state is given the
      // LONG window first (90s) before any gate interaction. Both routes sit
      // behind the dashboard layout's WalletGate ("Connect your wallet" h1)
      // — the page-level "Org dashboard" CenteredNote is unreachable below
      // it — so if the connected state still has not rendered after 90s, the
      // gate must be up and the RainbowKit modal is driven explicitly. All
      // third-party egress is aborted above, so every step here is local.
      const connected = page.getByText(/wallet is connected/i).first();
      const gateHeading = page.getByRole("heading", { name: "Connect your wallet" });
      const autoConnected = await connected
        .waitFor({ state: "visible", timeout: 90_000 })
        .then(() => true)
        .catch(() => false);
      if (!autoConnected) {
        const gateVisible = await gateHeading
          .waitFor({ state: "visible", timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (!gateVisible) {
          // Neither the connected state nor the gate rendered: the page is
          // genuinely stuck — fail with the snapshot rather than guessing.
          await expect(connected).toBeVisible({ timeout: 5_000 });
        }
        await gateHeading
          .getByRole("button", { name: /connect/i })
          .or(page.getByRole("button", { name: /connect/i }).first())
          .first()
          .click({ timeout: 30_000 });
        // Click a wallet option by name: the modal's first button can be
        // "Close"/pagination chrome, and the dialog container's role varies
        // across RainbowKit/Reown versions. The option labels ("Browser
        // Wallet", "MetaMask", …) are the stable surface.
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /injected|browser wallet|metamask|coinbase/i })
          .or(page.getByRole("button", { name: /injected|browser wallet|metamask|coinbase/i }))
          .first()
          .click({ timeout: 30_000 });
      }
      // The gate must be gone and the connected surface must state the
      // wallet is connected (empty state on a clean chain) — asserting the
      // connected state keeps this test from passing vacuously against the
      // gate.
      await expect(page.getByText(/connect a wallet/i).first()).toBeHidden({ timeout: 30_000 });
      await expect(connected).toBeVisible({ timeout: 30_000 });

      await waitForSettledAnimations(page);
      const violations = await auditPage(page);
      const serious = violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );
      expect(
        serious.map((v) => `${v.id}: ${v.nodes.length}`),
        `axe ${A11Y_TAGS.join("+")} violations on ${route} (connected)`,
      ).toEqual([]);
    });
  }
});

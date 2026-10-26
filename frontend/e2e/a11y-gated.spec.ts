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
  // CI compiles /dashboard and /vendors on first hit (Next dev on-demand);
  // the 30s default expires mid-compile. 120s covers a cold compile + the
  // connect flow on both viewports.
  test.setTimeout(120_000);

  for (const route of ["/dashboard", "/vendors"]) {
    test(`${route} connected state has no critical or serious violations`, async ({ page }) => {
      await page.addInitScript(ETH_PROVIDER_INIT);
      // No third-party egress: RainbowKit's remote-config fetch 403s under CI
      // (placeholder project ID) and retries for the whole test window. The
      // app already degrades to local/default values, so aborting the request
      // makes that degradation instant and deterministic.
      await page.route(/reown\.com|walletconnect\.com|web3modal\.org/, (r) => r.abort());
      await page.goto(route);
      await expectQTrustApp(page);

      // The injected connector usually auto-connects — but under CI the
      // Reown remote config fetch can 403 (placeholder project ID), which
      // delays wagmi's init. Drive the RainbowKit modal explicitly when the
      // connected state has not appeared, so the test is deterministic in
      // both environments rather than depending on a third-party endpoint.
      const connected = page.getByText(/wallet is connected/i).first();
      // Wait out a possible cold on-demand compile before starting the
      // connect flow. The dashboard's unauthenticated state is the
      // "Org dashboard" CenteredNote; vendors still renders the WalletGate.
      const readyTarget =
        route === "/dashboard"
          ? page.getByRole("heading", { name: "Org dashboard" })
          : page.getByRole("heading", { name: "Connect your wallet" });
      await readyTarget
        .waitFor({ state: "visible", timeout: 60_000 })
        .catch(async () => {
          await connected.waitFor({ state: "visible", timeout: 10_000 });
        });
      try {
        await connected.waitFor({ state: "visible", timeout: 8_000 });
      } catch {
        await page
          .getByRole("button", { name: /connect/i })
          .first()
          .click();
        await page
          .getByRole("button", { name: /injected|browser wallet|metamask/i })
          .first()
          .click({ timeout: 10_000 });
      }
      // The connect prompt must be gone and the connected surface must
      // state the wallet is connected (empty state on a clean chain) —
      // asserting the connected state keeps this test from passing vacuously
      // against the gate.
      await expect(page.getByText(/connect a wallet/i).first()).toBeHidden({ timeout: 20_000 });
      await expect(connected).toBeVisible({ timeout: 20_000 });

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

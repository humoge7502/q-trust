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
  for (const route of ["/dashboard", "/vendors"]) {
    test(`${route} connected state has no critical or serious violations`, async ({ page }) => {
      await page.addInitScript(ETH_PROVIDER_INIT);
      await page.goto(route);
      await expectQTrustApp(page);

      // The injected connector auto-connects: the gate's h1 must be gone and
      // the connected account chip must render — asserting the connected
      // state first keeps this test from passing vacuously against the gate.
      await expect(page.getByRole("heading", { name: "Connect your wallet" })).toBeHidden({ timeout: 15_000 });
      // The connected surface states the wallet is connected (empty state on
      // a clean chain) — asserting it keeps this test from passing vacuously
      // against the gate.
      await expect(page.getByText(/wallet is connected/i).first()).toBeVisible({ timeout: 15_000 });

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

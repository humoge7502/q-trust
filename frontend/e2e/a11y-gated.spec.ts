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
      // No third-party egress: RainbowKit's remote-config fetch 403s under CI
      // (placeholder project ID) and retries for the whole test window; and
      // after connect, useUserRole issues two eth_calls through viem's HTTP
      // public client (sepolia.base.org) — public-RPC latency from CI runners
      // kept the page in "Checking wallet…" past every budget. Aborting these
      // hosts makes the degradation instant and deterministic: RainbowKit
      // falls back to local/default values, and the role queries error out
      // immediately (retry: false) so the connected empty state renders.
      await page.route(/reown\.com|walletconnect\.com|web3modal\.org|sepolia\.base\.org/, (r) => r.abort());
      await page.goto(route);
      await expectQTrustApp(page);

      // The injected connector (shimDisconnect) usually auto-connects against
      // the stubbed provider; if the connected state has not appeared, drive
      // the RainbowKit modal explicitly. Both routes sit behind the dashboard
      // layout's WalletGate ("Connect your wallet" h1) — the page-level
      // "Org dashboard" CenteredNote is unreachable below it, so the gate
      // heading is the only unauthenticated ready target.
      const connected = page.getByText(/wallet is connected/i).first();
      const gateHeading = page.getByRole("heading", { name: "Connect your wallet" });
      const gateVisible = await gateHeading
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => true)
        .catch(() => false);
      if (!gateVisible) {
        // Connected already — the gate never renders for a connected wallet.
        await connected.waitFor({ state: "visible", timeout: 15_000 });
      } else {
        try {
          await connected.waitFor({ state: "visible", timeout: 10_000 });
        } catch {
          await page
            .getByRole("button", { name: /connect/i })
            .first()
            .click({ timeout: 30_000 });
          // Click a wallet option by name: the modal's first button can be
          // "Close"/pagination chrome, and the dialog container's role
          // varies across RainbowKit/Reown versions. The option labels
          // ("Browser Wallet", "MetaMask", …) are the stable surface.
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /injected|browser wallet|metamask|coinbase/i })
            .or(page.getByRole("button", { name: /injected|browser wallet|metamask|coinbase/i }))
            .first()
            .click({ timeout: 30_000 });
        }
      }
      // The gate must be gone and the connected surface must state the
      // wallet is connected (empty state on a clean chain) — asserting the
      // connected state keeps this test from passing vacuously against the
      // gate.
      await expect(page.getByText(/connect a wallet/i).first()).toBeHidden({ timeout: 30_000 });
      await expect(connected).toBeVisible({ timeout: 30_000 });
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

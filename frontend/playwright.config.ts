import { defineConfig } from "@playwright/test";

/**
 * Dedicated port on purpose.
 *
 * This suite previously ran on 3000 with `reuseExistingServer: true`. On any
 * machine where another app already served 3000, Playwright silently reused it
 * and the suite tested that app instead: the smoke specs reported six false
 * failures against an unrelated site ("VoltHub CSMS"), and specs that only
 * assert generic properties — axe rule violations, horizontal overflow — could
 * just as easily have *passed* against it. Wrong-target results are worse than
 * red results.
 *
 * A dedicated port removes the collision. `e2e/app-identity.ts` additionally
 * lets any spec prove it reached Q-Trust instead of inferring it from a port.
 * Override with `QTRUST_E2E_PORT` if the port is taken.
 */
const PORT = Number(process.env.QTRUST_E2E_PORT ?? 3020);
// `localhost`, not `127.0.0.1`: Next 16's dev server blocks cross-origin requests
// for its own dev resources, so browsing via the raw IP leaves the client chunks
// unloaded, hydration never runs, and client-rendered content silently never
// appears. Keep this host identical to the one the dev server serves.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Compile every route before the first test: the dev server compiles on
  // demand, and the wallet-gated pages expired their in-test budgets waiting
  // on a cold compile under CI. See e2e/global-setup.ts.
  globalSetup: "./e2e/global-setup.ts",
  // CI here only compiles the config + spec; browsers are installed in the CI
  // job that runs this suite.
  projects: [
    {
      name: "desktop-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
    // "demo" for e2e: wagmi.ts needs a non-empty ID, and any non-"demo" value
    // makes HAS_REAL_WALLETCONNECT true — RainbowKit then lists the
    // WalletConnect wallet, whose relay rejects unknown origins over a
    // WebSocket ("Origin ... not found on Allowlist") that page.route cannot
    // intercept, hanging app init before the gate renders. "demo" is the
    // codebase's own no-cloud signal: injected-only wallets, no relay. The
    // spec additionally aborts Reown/web3modal HTTP fetches, and
    // e2e/global-setup.ts pre-warms routes.
    env: { ...process.env, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "demo" },
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

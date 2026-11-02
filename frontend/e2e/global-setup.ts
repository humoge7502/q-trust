/**
 * Pre-warm every route the e2e specs visit before the first test runs.
 *
 * CI runs `next dev`, which compiles routes on demand: the first test that
 * visits a route pays the full cold-compile cost (60s+ on slow runners for
 * the wallet-gated pages), which historically expired the in-test budgets
 * and failed the suite deterministically on CI while passing locally on a
 * warm dev server. Requesting each route here — before any test starts —
 * moves that cost into setup, where the only requirement is that the dev
 * server eventually answers. A non-2xx response still proves the route
 * compiled, so any status counts as warm.
 *
 * Mirrors the URL formula in playwright.config.ts (same env override).
 */
const PORT = Number(process.env.QTRUST_E2E_PORT ?? 3020);
const BASE_URL = `http://localhost:${PORT}`;

const ROUTES = [
  "/",
  "/scanner",
  "/v",
  "/why-now",
  "/research",
  "/evidence",
  "/pricing",
  "/certify",
  "/dashboard",
  "/vendors",
];

async function main() {
  const deadline = Date.now() + 5 * 60_000;
  for (const route of ROUTES) {
    let warmed = false;
    while (!warmed && Date.now() < deadline) {
      try {
        await fetch(`${BASE_URL}${route}`, {
          signal: AbortSignal.timeout(120_000),
          redirect: "follow",
        });
        warmed = true;
      } catch (error) {
        if (Date.now() >= deadline) break;
        console.warn(
          `[global-setup] ${route} not warm yet (${String(error).slice(0, 120)}); retrying`,
        );
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
    if (!warmed) {
      throw new Error(
        `[global-setup] ${route} did not respond within 5 minutes — dev server not usable for e2e`,
      );
    }
  }
  console.log(`[global-setup] warmed ${ROUTES.length} routes on port ${PORT}`);
}

export default main;

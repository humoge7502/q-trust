import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Operator session tokens: the exchange flow and its storage contract.
 *
 * ## What this spec pins
 *
 * Saving a key in the operator panel no longer stores the raw key. The panel
 * exchanges it once at `POST /api/v1/auth/session` (through the same-origin
 * proxy) and the tab keeps only the short-lived session token:
 *
 *   1. the exchange request presents the raw key as `x-qtrust-api-key` and
 *      never as `x-qtrust-session` (route interception assertion);
 *   2. after a 200, `sessionStorage` holds `qtrust.operatorSession` and holds
 *      NO `qtrust.operatorKey`;
 *   3. requests made with a session active carry no caller credential on
 *      public-class routes (the old bug was the key riding on EVERY request);
 *   4. a 403 `operator_key_required` response clears the stored session and
 *      the inline operator prompt appears — the stale session self-heals into
 *      the retry path.
 *
 * ## Deviation note (scanner surface)
 *
 * Every action on `/scanner` (scan, risk, compliance, roadmap, evidence) is
 * `public-compute` in `lib/api-route-policy.ts` — deliberately, so anonymous
 * visitors can use the demo. Per the header-scoping contract, public-class
 * routes carry NO caller credential, so there is no operator-class action
 * reachable from `/scanner` whose request could carry `x-qtrust-session` in
 * the wild. That attachment is pinned at the unit level
 * (`api-url-resolution.test.ts` classifies the session/revoke endpoints as
 * operator and asserts the session header) and at the proxy level
 * (`route.test.ts` forwards a session token as upstream `x-api-key`). Here we
 * pin the observable browser contracts instead: the exchange request IS an
 * operator-route call through real app code and carries the raw key exactly
 * once, and post-session public requests carry nothing.
 */

test.use({ contextOptions: { reducedMotion: "reduce" } });

const RAW_KEY = "e2e-operator-key";
const SESSION_TOKEN = "e2e-session-token";
const EXPIRES_AT = new Date(Date.now() + 15 * 60_000).toISOString();

const SCAN_TARGET = "/opt/app";

const SCAN_RESPONSE = {
  target: SCAN_TARGET,
  scanType: "full",
  timestamp: "2026-11-07T10:00:00.000Z",
  findings: [
    {
      type: "algorithm",
      file: "src/crypto/keys.ts",
      algorithm: "RSA-2048",
      line: 42,
      severity: "critical",
      message: "RSA is broken by Shor's algorithm",
    },
  ],
};

type CapturedRequest = { pathname: string; headers: Record<string, string> };

/** Read the request the interception layer actually saw, then serve a fixture. */
async function capture(route: Route): Promise<CapturedRequest> {
  const request = route.request();
  const { pathname } = new URL(request.url());
  return { pathname, headers: await request.allHeaders() };
}

/* -------------------------------------------------------------------------- */
/*  Setup                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Seed an already-exchanged session, mirroring a11y-app.spec.ts's
 * seedOperatorKey helper pattern (addInitScript + try/catch for storage).
 */
async function seedOperatorSession(page: Page): Promise<void> {
  await page.addInitScript(
    ([token, expiresAt]) => {
      try {
        window.sessionStorage.setItem(
          "qtrust.operatorSession",
          JSON.stringify({ kind: "session", token, expiresAt }),
        );
      } catch {
        /* storage unavailable — nothing in this spec depends on the seed */
      }
    },
    [SESSION_TOKEN, EXPIRES_AT],
  );
}

/** Route with a fixture map; unknown paths 404 rather than falling through. */
async function routeBackend(
  page: Page,
  fixtures: Record<string, { status: number; body: unknown }>,
  captured: CapturedRequest[],
): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    captured.push(await capture(route));
    const { pathname } = new URL(route.request().url());
    const fixture = fixtures[pathname];
    await route.fulfill({
      status: fixture ? fixture.status : 404,
      contentType: "application/json",
      body: JSON.stringify(fixture ? fixture.body : { detail: `no fixture for ${pathname}` }),
    });
  });
}

/** Open the operator strip on /scanner and save a key through the real UI. */
async function saveKeyThroughPanel(page: Page, key: string): Promise<void> {
  // The strip's <summary> is the only "Operator access" affordance on /scanner.
  await page.locator("summary").filter({ hasText: "Operator access" }).click();
  await page.getByLabel("Q-Trust API key").fill(key);
  await page.getByRole("button", { name: "Save key" }).click();
}

/* -------------------------------------------------------------------------- */
/*  Tests                                                                      */
/* -------------------------------------------------------------------------- */

test.describe("operator session tokens", () => {
  test("saving a key exchanges it once and stores a session, not a raw key", async ({ page }) => {
    const captured: CapturedRequest[] = [];
    await routeBackend(
      page,
      {
        "/api/v1/auth/session": {
          status: 200,
          body: { sessionToken: SESSION_TOKEN, expiresAt: EXPIRES_AT, ttlSeconds: 900 },
        },
      },
      captured,
    );

    await page.goto("/scanner");
    await saveKeyThroughPanel(page, RAW_KEY);

    // Anti-vacuity: the panel confirmed the exchange before we assert storage.
    await expect(page.getByText(/Session started for this tab/)).toBeVisible();

    const stored = await page.evaluate(() => ({
      session: window.sessionStorage.getItem("qtrust.operatorSession"),
      rawKey: window.sessionStorage.getItem("qtrust.operatorKey"),
    }));
    expect(stored.rawKey).toBeNull();
    expect(stored.session).not.toBeNull();
    expect(JSON.parse(stored.session ?? "{}")).toMatchObject({
      kind: "session",
      token: SESSION_TOKEN,
      expiresAt: EXPIRES_AT,
    });

    // Route interception: the exchange presented the raw key exactly once, on
    // the exchange endpoint only — never under the session header's name.
    const exchange = captured.find((r) => r.pathname === "/api/v1/auth/session");
    expect(exchange).toBeDefined();
    expect(exchange?.headers["x-qtrust-api-key"]).toBe(RAW_KEY);
    expect(exchange?.headers["x-qtrust-session"]).toBeUndefined();
  });

  test("public scanner calls carry no caller credential while a session is active", async ({ page }) => {
    const captured: CapturedRequest[] = [];
    await seedOperatorSession(page);
    await routeBackend(
      page,
      { "/api/v1/scan/full": { status: 200, body: SCAN_RESPONSE } },
      captured,
    );

    await page.goto("/scanner");
    await page.getByLabel("Target directory").fill(SCAN_TARGET);
    await page.getByRole("button", { name: "Run scan" }).click();
    await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();

    // The seeded session is what the app read (anti-vacuity for the seed).
    expect(await page.evaluate(() => window.sessionStorage.getItem("qtrust.operatorSession"))).not.toBeNull();

    // Header scoping: public-compute routes attach NEITHER header — the old
    // behaviour attached the raw key to every request.
    const scan = captured.find((r) => r.pathname === "/api/v1/scan/full");
    expect(scan).toBeDefined();
    expect(scan?.headers["x-qtrust-session"]).toBeUndefined();
    expect(scan?.headers["x-qtrust-api-key"]).toBeUndefined();
  });

  test("a 403 operator_key_required clears the session and shows the retry prompt", async ({ page }) => {
    const captured: CapturedRequest[] = [];
    await seedOperatorSession(page);
    await routeBackend(
      page,
      {
        "/api/v1/scan/full": {
          status: 403,
          body: { error: "operator access required", code: "operator_key_required" },
        },
      },
      captured,
    );

    await page.goto("/scanner");
    await page.getByLabel("Target directory").fill(SCAN_TARGET);
    await page.getByRole("button", { name: "Run scan" }).click();

    // The inline retry prompt renders with its key field (no raw key stored).
    const prompt = page.getByRole("alert").filter({ hasText: "Operator access required" });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByLabel("Q-Trust API key")).toBeVisible();

    // Stale-session self-heal: the 403 dropped the token from storage, so the
    // next attempt starts anonymous and a fresh exchange restores access.
    expect(
      await page.evaluate(() => window.sessionStorage.getItem("qtrust.operatorSession")),
    ).toBeNull();
  });
});

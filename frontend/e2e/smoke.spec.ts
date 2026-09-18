import { test, expect, type ConsoleMessage } from "@playwright/test";
import { expectQTrustApp } from "./app-identity";

test("home page renders the hero heading with no console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const url = message.location()?.url ?? "";
    const text = message.text();

    // Environmental noise, matched narrowly so real application errors still
    // fail this test:
    //
    //  - `reown` / `walletconnect`: the wallet SDK probes its remote project
    //    registry, which is unreachable in this sandbox.
    //  - `ERR_NETWORK_CHANGED`: a browser network-stack event (the connection
    //    changed mid-request). A genuinely missing asset surfaces as a 404 or
    //    ERR_ABORTED, not this.
    //  - `Cross-Origin-Opener-Policy`: a browser-internal probe with no
    //    application involvement.
    //
    // These previously leaked through (the old filter only inspected the
    // message's source URL, and these messages carry none), which made this
    // test fail intermittently for reasons unrelated to the code under test.
    const environmental = [
      /reown|walletconnect/i,
      /net::ERR_NETWORK_CHANGED/,
      /Cross-Origin-Opener-Policy/,
    ];
    if (environmental.some((pattern) => pattern.test(url) || pattern.test(text))) {
      return;
    }

    consoleErrors.push(text);
  });

  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText("verifiable");

  const startMigration = page.getByRole("link", { name: "Start a migration" });
  const verifyAsset = page.getByRole("link", { name: "Verify an asset" });
  await expect(startMigration).toBeVisible();
  await expect(verifyAsset).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("home page CTAs remain visible and tappable at the project viewport", async ({ page }) => {
  await page.goto("/");

  for (const name of ["Start a migration", "Verify an asset"]) {
    const link = page.getByRole("link", { name });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  }
});

test("/v performs the lookup instead of telling users to edit the URL bar", async ({ page }) => {
  // Regression guard. /v is the target of the "Verify" item in the primary
  // navigation on every page, and it used to contain no input at all — it
  // instructed visitors to paste an asset ID into the browser address bar, so
  // the product's most-advertised capability was a dead end.
  await page.goto("/v");
  await expectQTrustApp(page);

  const input = page.getByLabel(/Asset ID/i);
  await expect(input).toBeVisible();

  // Invalid input: reported, and no navigation. Addressed by id rather than
  // `getByRole("alert")` because the dev server injects its own alert-role
  // overlay in development, which makes the role query ambiguous.
  await input.fill("not-an-asset-id");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.locator("#asset-id-error")).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/v$/);

  // Valid input: hands off to the record page.
  await input.fill(`0x${"a".repeat(64)}`);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL(/\/v\/0x[a-f0-9]{64}$/, { timeout: 15_000 });
});

test("every app route exposes navigation", async ({ page, isMobile }) => {
  // The header lives in the root layout. Before that, only the landing page
  // rendered any navigation, so arriving at /scanner left no way to reach the
  // rest of the product except the browser back button.
  //
  // The header presents differently per breakpoint (inline nav vs. a sheet
  // behind a menu button), so the assertion follows the viewport rather than
  // pretending one form fits both.
  // This loop asserts a STRUCTURAL property — navigation exists on every route
  // — and nothing about speed (latency budgets live in `cwv-budget.spec.ts`).
  // The budget here is therefore deliberately generous: the dev server
  // compiles routes on demand, so the first hit on five routes under a loaded
  // worker can legitimately take several seconds, and a 5s default would make
  // this gate report a compile cost as a missing-navigation bug.
  //
  // The status assertion is the diagnostic that makes that distinction
  // explicit: if a route ever fails to compile or throws, this test now says
  // which route and which status instead of timing out on a locator.
  const ROUTE_BUDGET = 30_000;
  const ASSERT_BUDGET = 15_000;

  for (const route of ["/", "/scanner", "/dashboard", "/vendors", "/v"]) {
    const response = await page.goto(route, {
      waitUntil: "domcontentloaded",
      timeout: ROUTE_BUDGET,
    });
    expect(
      response?.status(),
      `${route} did not render (status ${response?.status()})`,
    ).toBeLessThan(400);

    await expectQTrustApp(page);
    if (isMobile) {
      await expect(
        page.getByRole("button", { name: "Open menu" }),
        `no menu control on ${route}`,
      ).toBeVisible({ timeout: ASSERT_BUDGET });
    } else {
      const nav = page.getByRole("navigation", { name: "Primary" });
      await expect(nav, `no primary navigation on ${route}`).toBeVisible({
        timeout: ASSERT_BUDGET,
      });
      await expect(nav.getByRole("link", { name: "Scanner" })).toBeVisible({
        timeout: ASSERT_BUDGET,
      });
    }
  }
});

test("/v/[id] does not 500 when the backend is unreachable", async ({ page }) => {
  // `/v/[id]` is a server component. `lib/api.ts` built its request URL from
  // the relative `API_BASE_URL` ("/api"), and Node's `fetch` cannot parse a
  // relative URL — it throws `TypeError: Failed to parse URL`. Every server
  // render of this route therefore died with a 500 before it could render.
  //
  // The route now resolves an absolute backend origin server-side and, when
  // that backend is unreachable, states so instead of crashing. A record page
  // is the product's central trust claim, so "we could not read it" must be
  // distinguishable from both "no such record" and a crash.
  const response = await page.goto(`/v/0x${"a".repeat(64)}`);
  expect(response, "no response from /v/[id]").not.toBeNull();
  expect(response!.status(), "server error on /v/[id]").toBeLessThan(500);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
});

test("routes have distinct, descriptive titles", async ({ page }) => {
  // The root layout applies `title.template = "%s · Q-Trust"` to every child
  // segment. Two failure modes follow, and both were live in this app:
  //   - a route with no metadata export inherits the site-wide default, so
  //     every app surface shared one identical <title>; and
  //   - a route whose title already contains the brand renders it twice
  //     ("PQC Migration Scanner: Q-Trust · Q-Trust").
  // Client components cannot export `metadata`, which is why the dashboard and
  // vendor portal had no title of their own until they gained a layout.
  const expected: Array<[string, RegExp]> = [
    ["/", /Q-Trust/],
    ["/scanner", /Scanner/],
    ["/dashboard", /Org dashboard/],
    ["/vendors", /Vendor portal/],
    ["/v", /Verify an attestation/],
  ];

  const seen = new Map<string, string>();
  for (const [route, pattern] of expected) {
    await page.goto(route);
    await expect(page, `${route} has the wrong title`).toHaveTitle(pattern);
    const title = await page.title();
    expect(title, `${route} repeats the brand suffix`).not.toMatch(/Q-Trust.*Q-Trust/);
    expect(
      seen.has(title),
      `${route} shares its title with ${seen.get(title)}`,
    ).toBe(false);
    seen.set(title, route);
  }
});

test("dashboard gates unauthenticated visitors behind wallet connection", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Connect your wallet" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { name: /Org dashboard|Welcome to Q-Trust/ })).toHaveCount(0);
});

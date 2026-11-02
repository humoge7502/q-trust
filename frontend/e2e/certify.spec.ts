import { test, expect } from "@playwright/test";

/**
 * `/certify` drives the real verification contract, so the API is mocked here
 * and asserted on: the browser must send the parsed bundle (not the raw text)
 * and the `check_chain` flag, and must render each check the API reports.
 *
 * The offline verifier itself is covered by backend and SDK tests against the
 * committed fixture — this spec is about the surface, not re-proving Ed25519.
 */
const VERIFY_ROUTE = "**/api/v1/certify/verify";

const VALID_RESULT = {
  valid: true,
  bundle_id: "bndl_e2e",
  issuer: "did:key:z6MkIssuer",
  subject: "0x00000000000000000000000000000000000000aa",
  verdict: "CERTIFIED",
  reasons: [],
  caveats: [],
  valid_until: "2026-11-23T12:00:00.000Z",
  expired: false,
  checked: { structure: true, digest: true, merkle: true, signature: true, validity: true },
  chain_anchor: "skipped",
  timestamp: "2026-10-25T00:00:00.000Z",
};

test.describe("/certify", () => {
  test("verifies a pasted bundle and reports every passing check", async ({ page }) => {
    let sent: unknown = null;
    await page.route(VERIFY_ROUTE, async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(VALID_RESULT) });
    });

    await page.goto("/certify");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Verify a certification bundle");

    await page.getByLabel("Bundle JSON").fill(JSON.stringify({ schema: "qtrust.certification.v1" }));
    await page.getByLabel(/Pinned issuer DID/).fill("did:key:z6MkExpected");
    await page.getByRole("button", { name: "Verify bundle" }).click();

    await expect(page.getByText("Verification result")).toBeVisible();
    await expect(page.getByText("Valid", { exact: true })).toBeVisible();
    await expect(page.getByText("Passed", { exact: true })).toHaveCount(5);
    await expect(page.getByText("Evidence Merkle root")).toBeVisible();
    await expect(page.getByText("Not requested — offline verification only")).toBeVisible();

    // The server component reads /v1/certify/issuer to suggest a pin. No backend
    // runs in this harness, so the suggestion must be absent and manual pinning
    // must still work — a missing public lookup may not disable the verifier.
    await expect(page.getByRole("button", { name: "Use as pinned issuer" })).toHaveCount(0);
    expect(sent).toEqual({
      bundle: { schema: "qtrust.certification.v1" },
      check_chain: false,
      trust_anchor_did: "did:key:z6MkExpected",
    });
  });

  test("shows the verifier's reasons and does not claim validity", async ({ page }) => {
    await page.route(VERIFY_ROUTE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...VALID_RESULT,
          valid: false,
          reasons: ["evidence digest mismatch at leaf 2"],
          checked: { ...VALID_RESULT.checked, digest: false },
        }),
      });
    });

    await page.goto("/certify");
    await page.getByLabel("Bundle JSON").fill('{"schema":"qtrust.certification.v1"}');
    await page.getByRole("button", { name: "Verify bundle" }).click();

    await expect(page.getByText("Not valid", { exact: true })).toBeVisible();
    await expect(page.getByText("Why this failed")).toBeVisible();
    await expect(page.getByText("evidence digest mismatch at leaf 2")).toBeVisible();
    await expect(page.getByText("Failed", { exact: true })).toHaveCount(1);
  });

  test("rejects malformed JSON before calling the API", async ({ page }) => {
    let requested = false;
    await page.route(VERIFY_ROUTE, async (route) => {
      requested = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/certify");
    await page.getByLabel("Bundle JSON").fill("{ not json");
    await page.getByRole("button", { name: "Verify bundle" }).click();

    await expect(page.locator("p[role='alert']")).toContainText("not valid JSON");
    expect(requested).toBe(false);
  });
});

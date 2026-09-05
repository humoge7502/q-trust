import { test, expect, type ConsoleMessage } from "@playwright/test";

test("home page renders the hero heading with no console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    // Wallet SDK config probes fail in sandboxed CI (no external network to
    // the Reown/WalletConnect project registry). That is environmental noise,
    // not an application error — only count same-origin console errors.
    const url = message.location()?.url ?? "";
    if (url.includes("reown") || url.includes("walletconnect")) return;
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
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

test("dashboard gates unauthenticated visitors behind wallet connection", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Connect your wallet" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { name: /Org dashboard|Welcome to Q-Trust/ })).toHaveCount(0);
});

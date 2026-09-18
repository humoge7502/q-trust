import { test, expect, type Page } from "@playwright/test";
import { auditPage, seriousViolations } from "./axe-audit";

/**
 * Accessibility gate for the **populated, operator-authorized** application
 * surface.
 *
 * ## Why this spec exists (TD-09)
 *
 * `a11y.spec.ts` audits each route in whatever state it renders on arrival.
 * Every scanner and dashboard panel is empty on arrival and only fills in after
 * a privileged round trip, so that gate had never once audited the tables,
 * pills, score bars, roadmap timeline or evidence ledger — the densest and most
 * colour-bearing UI in the product, and the place where a contrast regression
 * is most likely to be introduced.
 *
 * This spec mocks the backend so those panels render real data, then audits
 * each tab. It is the difference between "the loading skeleton is accessible"
 * and "the product is accessible".
 *
 * ## Anti-vacuity
 *
 * Each test asserts the panel it audits actually rendered its fixture data
 * before running axe. Auditing an empty state while claiming to audit the
 * populated one is the same false-green class this suite has already been
 * burned by twice (the self-skipping `/v/[id]` audit, and the mid-animation
 * scan), so the guard is deliberate rather than incidental.
 */

test.use({ contextOptions: { reducedMotion: "reduce" } });

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const FINDINGS = [
  {
    type: "algorithm",
    file: "src/crypto/keys.ts",
    algorithm: "RSA-2048",
    line: 42,
    severity: "critical",
    message: "RSA is broken by Shor's algorithm",
  },
  {
    type: "algorithm",
    file: "src/tls/config.go",
    algorithm: "ECDH-P256",
    line: 17,
    severity: "high",
    message: "ECDH key exchange is quantum-vulnerable",
  },
  {
    type: "dependency",
    file: "package.json",
    algorithm: "AES-128",
    line: 5,
    severity: "medium",
    message: "AES-128 offers 64-bit quantum security",
  },
  {
    type: "dependency",
    file: "requirements.txt",
    algorithm: "SHA-256",
    line: 3,
    severity: "low",
    message: "SHA-256 collision resistance is weakened",
  },
  {
    type: "algorithm",
    file: "src/hash.ts",
    algorithm: "MD5",
    line: 8,
    severity: "info",
    message: "MD5 is already broken classically",
  },
];

const SCAN_TARGET = "/opt/app";

const MOCKS: Record<string, unknown> = {
  "/api/v1/scan/full": {
    target: SCAN_TARGET,
    scanType: "full",
    timestamp: "2026-09-12T10:00:00.000Z",
    findings: FINDINGS,
  },
  "/api/v1/risk/score": {
    findings: FINDINGS.map((f, i) => ({
      ...f,
      algorithmClassification: i === 0 ? "BROKEN" : i === 1 ? "WEAKENED" : "SAFE",
      riskScore: [96, 71, 44, 18, 5][i],
      riskLevel: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"][i],
    })),
  },
  "/api/v1/compliance/evaluate": {
    framework: "NIST",
    compliant: 2,
    nonCompliant: 3,
    total: 5,
    results: FINDINGS.map((f, i) => ({
      ...f,
      compliance: {
        compliant: i % 2 === 0,
        reason: i % 2 === 0 ? "No deprecation before 2030" : "Deprecated for federal use",
      },
    })),
  },
  "/api/v1/roadmap/generate": {
    phases: [
      {
        phase: 1,
        title: "Inventory and classify",
        priority: "critical",
        estimatedDays: 14,
        findings: FINDINGS.slice(0, 2),
      },
      {
        phase: 2,
        title: "Migrate key exchange",
        priority: "high",
        estimatedDays: 30,
        findings: FINDINGS.slice(2),
      },
    ],
    summary: {
      totalFindings: FINDINGS.length,
      totalDays: 44,
      totalCost: 26400,
      dailyRate: 600,
      completionDate: "2026-10-26T00:00:00.000Z",
    },
  },
  "/api/v1/evidence/create": {
    ledger: {
      version: "1",
      data: {
        scanResultHash: `0x${"b".repeat(64)}`,
        scanTarget: SCAN_TARGET,
        findingsCount: FINDINGS.length,
        riskSummary: {
          totalFindings: FINDINGS.length,
          critical: 1,
          high: 1,
          medium: 1,
          low: 1,
          info: 1,
          algorithmsDetected: ["RSA-2048", "ECDH-P256", "AES-128"],
        },
        timestamp: "2026-09-12T10:00:00.000Z",
      },
      integrityHash: `0x${"c".repeat(64)}`,
      previousHash: `0x${"0".repeat(64)}`,
      chainIndex: 7,
    },
  },
  "/api/v1/evidence/verify": {
    valid: true,
    expectedHash: `0x${"c".repeat(64)}`,
    providedHash: `0x${"c".repeat(64)}`,
  },
};

/* -------------------------------------------------------------------------- */
/*  Setup                                                                      */
/* -------------------------------------------------------------------------- */

/** Seed the tab-scoped operator key so the authorized rendering path is audited. */
async function seedOperatorKey(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("qtrust.operatorKey", "e2e-operator-key");
    } catch {
      /* storage unavailable — the mocked routes never require the key anyway */
    }
  });
}

/**
 * Serve the fixtures for every privileged call.
 *
 * Unknown paths 404 with an explicit message rather than falling through to the
 * network: a silent fall-through would make this spec depend on a live backend
 * and turn a missing fixture into a confusing empty-state audit.
 */
async function routeBackend(page: Page): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const body = MOCKS[pathname];
    await route.fulfill({
      status: body ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(body ?? { detail: `no fixture for ${pathname}` }),
    });
  });
}

/** Route, seed, and run a scan so every tab has data to render. */
async function prepareScan(page: Page): Promise<void> {
  await seedOperatorKey(page);
  await routeBackend(page);

  await page.goto("/scanner");
  await page.getByLabel("Target directory").fill(SCAN_TARGET);
  await page.getByRole("button", { name: "Run scan" }).click();
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
}

async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name }).click();
}

/* -------------------------------------------------------------------------- */
/*  Tests                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * Assertions target content that exists at BOTH configured viewports. This spec
 * runs under the desktop project (1280px) and the mobile project (375px), and
 * the scanner renders tables above `md` and card lists below it — so an
 * assertion pinned to the `table` role would only ever pass on desktop, and one
 * pinned to a `.md:hidden` card would only ever pass on mobile.
 * `data-tone` is the StatusPill contract, rendered by both variants.
 */
test.describe("application surface a11y (populated state)", () => {
  test("scanner results render, then audit clean", async ({ page }) => {
    await prepareScan(page);

    // Anti-vacuity: the findings really are rendered, and as semantic tones.
    await expect(page.locator("[data-tone]").first()).toBeAttached();
    await expect(page.getByText("RSA-2048").first()).toBeAttached();

    expect(seriousViolations(await auditPage(page))).toEqual([]);
  });

  test("risk score table audits clean", async ({ page }) => {
    await prepareScan(page);
    await openTab(page, "Risk Scores");
    await page.getByRole("button", { name: "Calculate risk scores" }).click();
    // The fixture's CRITICAL finding maps to the `danger` tone.
    await expect(page.locator('[data-tone="danger"]').first()).toBeAttached();

    expect(seriousViolations(await auditPage(page))).toEqual([]);
  });

  test("compliance panel audits clean", async ({ page }) => {
    await prepareScan(page);
    await openTab(page, "Compliance");
    await page.getByRole("button", { name: "Evaluate" }).click();
    // Both outcomes are represented in the fixture (2 pass, 3 fail).
    await expect(page.locator('[data-tone="success"]').first()).toBeAttached();
    await expect(page.locator('[data-tone="danger"]').first()).toBeAttached();

    expect(seriousViolations(await auditPage(page))).toEqual([]);
  });

  test("roadmap timeline audits clean", async ({ page }) => {
    await prepareScan(page);
    await openTab(page, "Roadmap");
    await page.getByRole("button", { name: "Generate roadmap" }).click();
    await expect(page.getByRole("heading", { name: "Inventory and classify" })).toBeVisible();

    expect(seriousViolations(await auditPage(page))).toEqual([]);
  });

  test("evidence ledger and its verified pill audit clean", async ({ page }) => {
    await prepareScan(page);
    await openTab(page, "Evidence");
    await page.getByRole("button", { name: "Create evidence record" }).click();
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(
      page.locator('[data-tone="success"]', { hasText: "verified" }).first(),
    ).toBeAttached();

    expect(seriousViolations(await auditPage(page))).toEqual([]);
  });
});

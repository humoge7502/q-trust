import { describe, expect, it } from "vitest";

/**
 * Regression tests for R1/R2 + risk-parity golden vectors.
 *
 * R2: POST /v1/roadmap/generate silently dropped MEDIUM findings while
 * summary.totalFindings still counted them.
 * R1: GET /v1/plans/:did proxied to a planner endpoint that never existed.
 * Risk parity: backend computeRiskFinding must mirror
 * inspector/qtrust_inspector/risk_engine.py penalty tables
 * (BROKEN 50 / WEAKENED 25 / SAFE 5 / PQC 0, +15 NIST, +10 CNSA).
 */
const { registerScannerRoutes } = await import("../src/routes/scanner.js");
const { registerReadRoutes } = await import("../src/routes/read.js");

async function scannerApp() {
  const { default: Fastify } = await import("fastify");
  const app = Fastify({ logger: false });
  await app.register(registerScannerRoutes);
  return app;
}

describe("risk scoring parity (backend mirror of inspector risk_engine)", () => {
  it("scores RSA-2048 as BROKEN/CRITICAL with the unified penalty table", async () => {
    const app = await scannerApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/risk/score",
      payload: { findings: [{ algorithm: "RSA-2048", key_size: 2048 }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.findings).toHaveLength(1);
    // hndl 24 + penalty 60 (BROKEN 50 + CNSA 10, NIST still compliant pre-2030)
    expect(body.findings[0].quantumVulnerability).toBe("BROKEN");
    expect(body.findings[0].overallRiskScore).toBe(84);
    expect(body.findings[0].riskLevel).toBe("CRITICAL");
    await app.close();
  });

  it("scores AES-128 as WEAKENED/MEDIUM (HNDL 14.4 + penalty 35)", async () => {
    const app = await scannerApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/risk/score",
      payload: { findings: [{ algorithm: "AES-128", key_size: 128 }] },
    });
    expect(res.statusCode).toBe(200);
    const finding = res.json().findings[0];
    expect(finding.quantumVulnerability).toBe("WEAKENED");
    expect(finding.riskLevel).toBe("MEDIUM");
    await app.close();
  });
});

describe("POST /v1/roadmap/generate", () => {
  it("places MEDIUM findings in their own phase and counts every finding", async () => {
    const app = await scannerApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/roadmap/generate",
      payload: {
        findings: [
          { algorithm: "RSA-2048", key_size: 2048 },
          { algorithm: "AES-128", key_size: 128 },
          { algorithm: "ML-KEM-768" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.totalFindings).toBe(3);
    expect(body.phases).toHaveLength(4);
    const medium = body.phases.find((p: { priority: string }) => p.priority === "MEDIUM");
    expect(medium).toBeDefined();
    expect(medium.findings).toHaveLength(1);
    expect(medium.findings[0].algorithm).toBe("AES-128");
    // Every scored finding appears in exactly one phase.
    const phased = body.phases.reduce(
      (n: number, p: { findings: unknown[] }) => n + p.findings.length,
      0,
    );
    expect(phased).toBe(body.summary.totalFindings);
    await app.close();
  });
});

describe("GET /v1/plans/:did (R1 retired route)", () => {
  it("returns 410 with a migration hint instead of proxying a missing planner route", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify({ logger: false });
    await app.register(registerReadRoutes);
    const res = await app.inject({
      method: "GET",
      url: "/v1/plans/0x1234567890123456789012345678901234567890",
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ code: "plans_lookup_retired" });
    await app.close();
  });
});

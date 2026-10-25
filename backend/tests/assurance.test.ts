import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

vi.mock("../src/services/assurance.js", () => {
  class AssuranceInputError extends Error {}
  class AssuranceUnavailableError extends Error {}
  return {
    AssuranceInputError,
    AssuranceUnavailableError,
    MAX_ASSURANCE_FINDINGS: 2000,
    runAssurance: vi.fn(),
  };
});

import { registerAssuranceRoutes } from "../src/routes/assurance.js";
import {
  AssuranceInputError,
  AssuranceUnavailableError,
  runAssurance,
} from "../src/services/assurance.js";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerAssuranceRoutes(app);
  await app.ready();
  return app;
}

const FINDINGS = [
  { asset_type: "tls_certificate", host: "legacy.example", algorithm: "RSA-2048", key_size: 2048 },
];

beforeEach(() => {
  vi.mocked(runAssurance).mockReset();
});

describe("POST /v1/assurance/report", () => {
  it("returns the aggregated report with report as the default op", async () => {
    vi.mocked(runAssurance).mockResolvedValue({
      op: "report",
      asset_count: 1,
      agility: { grade: "C" },
      crqc: { expected_loss_usd: 1 },
      packs: { "cnsa-2.0": { verdict: "NOT_READY" } },
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/assurance/report",
      payload: { findings: FINDINGS, top: 3 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ op: "report", asset_count: 1 });
    expect(runAssurance).toHaveBeenCalledWith(
      expect.objectContaining({ op: "report", findings: FINDINGS, top: 3 }),
    );
  });

  it("accepts an explicit op and crqc overrides", async () => {
    vi.mocked(runAssurance).mockResolvedValue({ op: "crqc" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/assurance/report",
      payload: { findings: FINDINGS, op: "crqc", crqc: { trials: 5000 } },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(runAssurance).toHaveBeenCalledWith(
      expect.objectContaining({ op: "crqc", crqc: { trials: 5000 } }),
    );
  });

  it("validates the request shape before spawning the bridge", async () => {
    const app = await buildApp();
    const missing = await app.inject({ method: "POST", url: "/v1/assurance/report", payload: {} });
    const badOp = await app.inject({
      method: "POST",
      url: "/v1/assurance/report",
      payload: { findings: FINDINGS, op: "explode" },
    });
    const badTop = await app.inject({
      method: "POST",
      url: "/v1/assurance/report",
      payload: { findings: FINDINGS, top: 0 },
    });
    const tooMany = await app.inject({
      method: "POST",
      url: "/v1/assurance/report",
      payload: { findings: Array.from({ length: 2001 }, () => FINDINGS[0]) },
    });
    const badCrqc = await app.inject({
      method: "POST",
      url: "/v1/assurance/report",
      payload: { findings: FINDINGS, crqc: [1] },
    });
    await app.close();

    for (const res of [missing, badOp, badTop, tooMany, badCrqc]) {
      expect(res.statusCode).toBe(400);
    }
    expect(runAssurance).not.toHaveBeenCalled();
  });

  it("maps invalid findings to 422 and bridge failure to 503", async () => {
    vi.mocked(runAssurance).mockRejectedValueOnce(new AssuranceInputError("invalid finding: key_size"));
    const app = await buildApp();
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/assurance/report",
      payload: { findings: FINDINGS },
    });

    vi.mocked(runAssurance).mockRejectedValueOnce(new AssuranceUnavailableError("bridge down"));
    const down = await app.inject({
      method: "POST",
      url: "/v1/assurance/report",
      payload: { findings: FINDINGS },
    });
    await app.close();

    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().code).toBe("invalid_findings");
    expect(down.statusCode).toBe(503);
    expect(down.json().code).toBe("assurance_unavailable");
  });
});

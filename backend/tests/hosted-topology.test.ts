import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerReadRoutes } from "../src/routes/read.js";

/**
 * Hosted-topology contract.
 *
 * Production puts the Fastify API on a serverless host where the planner must
 * run in-process. Two properties have to hold at the same time, and a
 * regression in either is invisible to unit tests on the happy path:
 *
 *   1. Liveness stays public. `/v1/planner/health` is what dashboards and the
 *      production canary poll; gating it behind a key makes outages look like
 *      a healthy 401 and hides a broken model.
 *   2. Planning stays gated. `POST /v1/plans` is compute a stranger can spend,
 *      so with `QTRUST_API_KEYS` configured an anonymous caller must get 401 —
 *      on the backend, independently of whatever the Next proxy decides.
 *
 * The file also pins the mode resolution: a hosted runtime (`VERCEL`) must
 * select the embedded ONNX planner with no extra flag, because the alternative
 * is a runtime dependency on an operator tunnel.
 */

process.env.QTRUST_PLANNER_MODE = "embedded";
process.env.QTRUST_PLANNER_TODAY = "2026-10-28";

const API_KEY = "hosted-topology-test-key-0f9a3c7d";

const CBOM = {
  assets: [
    { asset_id: "legacy-rsa", algorithm: "RSA-2048", key_size: 2048, criticality: "Critical", pqc_ready: false },
    { asset_id: "modern", algorithm: "ML-KEM-768", key_size: 768, criticality: "Medium", pqc_ready: true },
  ],
};

async function app() {
  const { default: Fastify } = await import("fastify");
  const server = Fastify({ logger: false });
  await server.register(registerReadRoutes);
  return server;
}

describe("hosted topology: public liveness, key-gated planning", () => {
  beforeAll(() => {
    process.env.QTRUST_API_KEYS = API_KEY;
  });

  afterAll(() => {
    delete process.env.QTRUST_API_KEYS;
    delete process.env.QTRUST_PLANNER_MODE;
    delete process.env.QTRUST_PLANNER_TODAY;
    delete process.env.VERCEL;
    delete process.env.QTRUST_SERVERLESS;
  });

  it("keeps planner liveness public", async () => {
    const server = await app();
    try {
      const res = await server.inject({ method: "GET", url: "/v1/planner/health" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ status: "ok", mode: "embedded" });
      expect(body.model).toMatchObject({ integrity: "sha256-verified", served: true });
    } finally {
      await server.close();
    }
  });

  it("rejects anonymous planning", async () => {
    const server = await app();
    try {
      const res = await server.inject({ method: "POST", url: "/v1/plans", payload: { cbom: CBOM } });
      expect(res.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("rejects a wrong key", async () => {
    const server = await app();
    try {
      const res = await server.inject({
        method: "POST",
        url: "/v1/plans",
        headers: { "x-api-key": `${API_KEY}-wrong` },
        payload: { cbom: CBOM },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("plans with the configured key and returns an embedded-mode schedule", async () => {
    const server = await app();
    try {
      const res = await server.inject({
        method: "POST",
        url: "/v1/plans",
        headers: { "x-api-key": API_KEY },
        payload: { cbom: CBOM, deadline: "2027-09-30" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.planner_mode).toBe("embedded-onnx");
      expect(body.total_assets).toBe(CBOM.assets.length);
      expect(body.migration_order.map((row: { asset_id: string }) => row.asset_id).sort()).toEqual(
        CBOM.assets.map((asset) => asset.asset_id).sort(),
      );
      expect(body.schedule.windows).toHaveLength(CBOM.assets.length);
      expect(typeof body.schedule.feasible).toBe("boolean");
    } finally {
      await server.close();
    }
  });

  it("keeps the retired GET /v1/plans/:did behind the same gate", async () => {
    const server = await app();
    try {
      const anonymous = await server.inject({ method: "GET", url: "/v1/plans/did:web:example" });
      expect(anonymous.statusCode).toBe(401);
      const authorized = await server.inject({
        method: "GET",
        url: "/v1/plans/did:web:example",
        headers: { "x-api-key": API_KEY },
      });
      expect(authorized.statusCode).toBe(410);
    } finally {
      await server.close();
    }
  });
});

describe("hosted runtime selects the embedded planner without a flag", () => {
  it("resolves VERCEL to embedded mode", async () => {
    delete process.env.QTRUST_PLANNER_MODE;
    process.env.VERCEL = "1";
    const server = await app();
    try {
      const res = await server.inject({ method: "GET", url: "/v1/planner/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json().mode).toBe("embedded");
    } finally {
      await server.close();
      delete process.env.VERCEL;
    }
  });
});

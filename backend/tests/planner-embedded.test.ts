import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * The embedded ONNX planner replaced the hosted planner that lived behind an
 * operator quick tunnel (it returned 503 whenever that laptop slept). These
 * tests pin it to the Python reference (`planner-service/lib/planner_core.py`)
 * over every real CBOM fixture: same ranking, same schedule, same RL rollout.
 *
 * Expectations are regenerated with `python backend/scripts/gen-planner-parity.py`
 * which freezes `date.today()` to QTRUST_PLANNER_TODAY.
 */
process.env.QTRUST_PLANNER_MODE = "embedded";
process.env.QTRUST_PLANNER_TODAY = "2026-10-28";

const { planEmbedded, rlPlanEmbedded, plannerHealth, plannerErrorResponse } =
  await import("../src/services/planner-embedded.js");
const { registerReadRoutes } = await import("../src/routes/read.js");

const CBOM_DIR = fileURLToPath(new URL("../../planner/data/real_cboms/", import.meta.url));
const PARITY = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/planner-parity.json", import.meta.url)), "utf8"),
) as {
  plans: Record<
    string,
    {
      total_assets: number;
      order: Array<{
        asset_id: string;
        algorithm: string;
        key_size: number;
        priority_score: number;
        risk_score: number;
        migrate_days: number;
      }>;
    }
  >;
  schedules: Record<string, Record<string, Record<string, unknown>>>;
  rl: Record<string, { method: string; order: Array<Record<string, unknown>> }>;
};

function loadCbom(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(CBOM_DIR, `${name}.json`), "utf8"));
}

interface PlanItem {
  asset_id: string;
  algorithm: string;
  key_size: number;
  priority_score: number;
  risk_score: number;
  migrate_days: number;
}

function expectOrder(actual: PlanItem[], expected: Array<Record<string, unknown>>): void {
  expect(actual.map((item) => item.asset_id)).toEqual(expected.map((item) => item.asset_id));
  expected.forEach((want, i) => {
    const got = actual[i]!;
    expect(got.algorithm).toBe(want.algorithm);
    expect(got.key_size).toBe(want.key_size);
    expect(got.migrate_days).toBeCloseTo(want.migrate_days as number, 9);
    expect(got.priority_score).toBeCloseTo(want.priority_score as number, 3);
    expect(got.risk_score).toBeCloseTo(want.risk_score as number, 3);
  });
}

describe("embedded planner ↔ planner_core.py parity", () => {
  const names = Object.keys(PARITY.plans).sort();

  it("covers every real CBOM fixture", () => {
    expect(names.length).toBe(42);
  });

  it.each(names)("ranks %s identically", async (name) => {
    const result = (await planEmbedded({ cbom: loadCbom(name) })) as {
      total_assets: number;
      planner_mode: string;
      migration_order: PlanItem[];
    };
    const expected = PARITY.plans[name]!;
    expect(result.planner_mode).toBe("embedded-onnx");
    expect(result.total_assets).toBe(expected.total_assets);
    expectOrder(result.migration_order, expected.order);
  });

  it.each(Object.entries(PARITY.schedules))(
    "schedules %s identically for every reference deadline",
    async (name, byDeadline) => {
      const cbom = loadCbom(name);
      for (const [deadline, expected] of Object.entries(byDeadline)) {
        const result = (await planEmbedded({ cbom, deadline })) as { schedule: Record<string, unknown> };
        expect(result.schedule).toEqual(expected);
      }
    },
  );

  it.each(Object.entries(PARITY.rl))("replays the RL rollout for %s", async (name, expected) => {
    const result = (await rlPlanEmbedded({ cbom: loadCbom(name) })) as {
      method: string;
      migration_order: PlanItem[];
    };
    expect(result.method).toBe(expected.method);
    expectOrder(result.migration_order, expected.order);
  });

  it("serves a health report with an integrity-verified model", async () => {
    const health = (await plannerHealth()) as {
      status: string;
      model: { integrity: string; served: boolean; path: string };
    };
    expect(health.status).toBe("ok");
    expect(health.model.integrity).toBe("sha256-verified");
    expect(health.model.served).toBe(true);
    expect(health.model.path).toBe("model_real_v3.onnx");
  });

  it("maps failures to the Python planner's HTTP contract", () => {
    expect(plannerErrorResponse(new Error("boom"))).toMatchObject({ status: 500 });
  });
});

describe("POST /v1/plans (embedded mode)", () => {
  async function app() {
    const { default: Fastify } = await import("fastify");
    const server = Fastify({ logger: false });
    await server.register(registerReadRoutes);
    return server;
  }

  const cbom = {
    assets: [
      { asset_id: "legacy-rsa", algorithm: "RSA-2048", key_size: 2048, criticality: "high", pqc_ready: false },
      { asset_id: "modern", algorithm: "ML-KEM-768", key_size: 768, criticality: "medium", pqc_ready: true },
    ],
  };

  it("plans in-process without dialing the remote planner", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled in test")));
    vi.stubGlobal("fetch", fetchSpy);
    const server = await app();
    try {
      const res = await server.inject({ method: "POST", url: "/v1/plans", payload: { cbom } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.planner_mode).toBe("embedded-onnx");
      expect(body.total_assets).toBe(2);
      expect(body.migration_order[0].asset_id).toBe("legacy-rsa");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      await server.close();
    }
  });

  it("rejects an empty asset list before planning", async () => {
    const server = await app();
    const res = await server.inject({ method: "POST", url: "/v1/plans", payload: { cbom: { assets: [] } } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });

  it("returns 422 for a non-integer key size", async () => {
    const server = await app();
    const res = await server.inject({
      method: "POST",
      url: "/v1/plans",
      payload: { cbom: { assets: [{ algorithm: "RSA-2048", key_size: "big" }] } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toContain("key_size");
    await server.close();
  });

  it("returns 422 for a malformed deadline", async () => {
    const server = await app();
    const res = await server.inject({
      method: "POST",
      url: "/v1/plans",
      payload: { cbom, deadline: "31/03/2027" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toContain("deadline");
    await server.close();
  });

  it("reports planner health", async () => {
    const server = await app();
    const res = await server.inject({ method: "GET", url: "/v1/planner/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: "embedded", status: "ok" });
    await server.close();
  });
});

afterAll(() => {
  delete process.env.QTRUST_PLANNER_MODE;
  delete process.env.QTRUST_PLANNER_TODAY;
});

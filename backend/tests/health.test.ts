import { describe, expect, it, vi } from "vitest";

vi.mock("../src/services/attestation.js", () => ({
  relayerAddress: vi.fn(() => {
    throw new Error("QTRUST_RELAYER_PRIVATE_KEY is required");
  }),
}));

const { registerHealthRoutes } = await import("../src/routes/health.js");

describe("GET /health", () => {
  it("returns liveness even when the relayer key is absent", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify({ logger: false });
    await app.register(registerHealthRoutes);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", relayer: null });
    await app.close();
  });
});

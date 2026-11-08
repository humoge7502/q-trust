import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerAuthRoutes } from "../src/routes/auth.js";
import { requireApiKey } from "../src/middleware/auth.js";

/**
 * Operator session route contract (bare Fastify app + server.inject, the
 * hosted-topology.test.ts pattern — no live server, no live Redis).
 *
 * Pins the end-to-end behavior of the session lifecycle:
 *   - only a static key can mint (requireStaticApiKey rejects tokens),
 *   - a minted token authenticates anywhere requireApiKey is used,
 *   - revocation (single + bulk-by-key) takes effect immediately.
 *
 * Env is saved/restored in beforeEach/afterEach like apikey.test.ts so
 * NODE_ENV and the Redis URL vars never leak between tests.
 */

const API_KEY = "operator-session-routes-key-4f8d2a91";
// Unique per test that counts sessions: the in-memory store is a module
// singleton shared by every app() instance in this file, so bulk-revoke
// counts must not be polluted by tokens minted in earlier tests.
const BULK_KEY = "operator-session-routes-key-bulk-b7c31e05";

async function app() {
  const { default: Fastify } = await import("fastify");
  const server = Fastify({ logger: false });
  // Probe route guarded by the same gate as every write route — used to
  // prove a minted session token authenticates like a static key.
  server.get("/v1/_operator-probe", { preHandler: requireApiKey }, async () => ({ ok: true }));
  await server.register(registerAuthRoutes);
  return server;
}

async function mint(server: Awaited<ReturnType<typeof app>>, key: string): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/v1/auth/session",
    headers: { "x-api-key": key },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { sessionToken: string }).sessionToken;
}

describe("operator session routes", () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env.QTRUST_API_KEYS = API_KEY;
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "test";
    process.env.QTRUST_API_KEYS = API_KEY;
    // Keep every test on the in-memory session store — no Redis required.
    delete process.env.QTRUST_REDIS_URL;
    delete process.env.REDIS_URL;
    delete process.env.QTRUST_OPERATOR_SESSION_TTL_SECONDS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  afterAll(() => {
    delete process.env.QTRUST_API_KEYS;
  });

  it("rejects a wrong static key on POST /v1/auth/session", async () => {
    const server = await app();
    try {
      const res = await server.inject({
        method: "POST",
        url: "/v1/auth/session",
        headers: { "x-api-key": `${API_KEY}-wrong` },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("mints a session for the configured static key", async () => {
    const server = await app();
    try {
      const res = await server.inject({
        method: "POST",
        url: "/v1/auth/session",
        headers: { "x-api-key": API_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.sessionToken).toBe("string");
      expect(body.sessionToken.length).toBeGreaterThan(20);
      expect(typeof body.ttlSeconds).toBe("number");
      expect(body.ttlSeconds).toBe(3600); // default QTRUST_OPERATOR_SESSION_TTL_SECONDS
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    } finally {
      await server.close();
    }
  });

  it("accepts the minted token on a route guarded by requireApiKey", async () => {
    const server = await app();
    try {
      const token = await mint(server, API_KEY);
      const res = await server.inject({
        method: "GET",
        url: "/v1/_operator-probe",
        headers: { "x-api-key": token },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });

  it("rejects a session token on POST /v1/auth/session (static keys only)", async () => {
    const server = await app();
    try {
      const token = await mint(server, API_KEY);
      const res = await server.inject({
        method: "POST",
        url: "/v1/auth/session",
        headers: { "x-api-key": token },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Session tokens cannot mint sessions");
    } finally {
      await server.close();
    }
  });

  it("rejects an unknown/garbage token on the requireApiKey route", async () => {
    const server = await app();
    try {
      const res = await server.inject({
        method: "GET",
        url: "/v1/_operator-probe",
        headers: { "x-api-key": "garbage-token-that-never-existed" },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("revokes the presented token, which then stops authenticating", async () => {
    const server = await app();
    try {
      const token = await mint(server, API_KEY);

      const revoked = await server.inject({
        method: "POST",
        url: "/v1/auth/session/revoke",
        headers: { "x-api-key": token },
      });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toEqual({ revoked: 1 });

      const after = await server.inject({
        method: "GET",
        url: "/v1/_operator-probe",
        headers: { "x-api-key": token },
      });
      expect(after.statusCode).toBe(401);

      // Revoking again cannot even authenticate: the token no longer passes
      // the requireApiKey preHandler. The { revoked: 0 } no-op is reached
      // with a credential that still authenticates (a static key).
      const again = await server.inject({
        method: "POST",
        url: "/v1/auth/session/revoke",
        headers: { "x-api-key": token },
      });
      expect(again.statusCode).toBe(401);
      const staticKey = await server.inject({
        method: "POST",
        url: "/v1/auth/session/revoke",
        headers: { "x-api-key": API_KEY },
      });
      expect(staticKey.json()).toEqual({ revoked: 0 });
    } finally {
      await server.close();
    }
  });

  it("revoke-all with the static key kills every token it minted", async () => {
    process.env.QTRUST_API_KEYS = BULK_KEY;
    const server = await app();
    try {
      const first = await mint(server, BULK_KEY);
      const second = await mint(server, BULK_KEY);

      const res = await server.inject({
        method: "POST",
        url: "/v1/auth/session/revoke-all",
        headers: { "x-api-key": BULK_KEY },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ revoked: 2 });

      for (const token of [first, second]) {
        const probe = await server.inject({
          method: "GET",
          url: "/v1/_operator-probe",
          headers: { "x-api-key": token },
        });
        expect(probe.statusCode).toBe(401);
      }
    } finally {
      await server.close();
    }
  });

  it("returns 503 session_unavailable in production without Redis", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.QTRUST_REDIS_URL;
    delete process.env.REDIS_URL;
    const server = await app();
    try {
      const res = await server.inject({
        method: "POST",
        url: "/v1/auth/session",
        headers: { "x-api-key": API_KEY },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("session_unavailable");
    } finally {
      await server.close();
    }
  });

  it("stays open in dev mode with no keys configured (dev-open)", async () => {
    delete process.env.QTRUST_API_KEYS;
    const server = await app();
    try {
      const res = await server.inject({ method: "POST", url: "/v1/auth/session" });
      expect(res.statusCode).toBe(200);
      expect(typeof res.json().sessionToken).toBe("string");
    } finally {
      await server.close();
    }
  });
});

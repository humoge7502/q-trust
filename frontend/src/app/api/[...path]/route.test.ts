/**
 * S-1 regression tests (audit E-2): the same-origin API proxy must not
 * forward the admin key to privileged routes for anonymous callers.
 *
 * These tests drive the route handler directly (no network) and assert on the
 * status the proxy itself produces BEFORE any backend call is made.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

async function call(method: string, segments: string[]): Promise<Response> {
  const route = await import("./route");
  // The route module exposes Next's HTTP-method exports; GET and POST share
  // the same underlying handler, so either covers the policy check.
  const handler = (route as Record<string, unknown>)[method] ?? route.GET;
  if (typeof handler !== "function") throw new Error(`no handler for ${method}`);
  const request = new Request(`http://localhost:3000/api/${segments.join("/")}`, {
    method,
  });
  return (handler as (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>)(
    request,
    { params: Promise.resolve({ path: segments }) },
  );
}

describe("S-1 proxy route allowlist", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    process.env.QTRUST_API_KEY = "test-admin-key";
  });

  describe("public reads are proxied", () => {
    it.each([
      ["GET", ["v1", "stats"]],
      ["GET", ["v1", "health"]],
      ["GET", ["v1", "assets", "asset-1"]],
      ["GET", ["v1", "assets", "asset-1", "verify"]],
      ["GET", ["v1", "plans", "did:web:example"]],
      ["GET", ["v1", "orgs", "did:web:example", "summary"]],
      ["GET", ["v1", "orgs", "did:web:example", "assets"]],
      ["GET", ["v1", "vendors", "did:web:example", "attestations"]],
      ["GET", ["v1", "relay", "nonce", "did:web:example"]],
      ["GET", ["v1", "webhooks", "subscribers"]],
      ["GET", ["health"]],
    ])("%s %s", async (method, segments) => {
      const res = await call(method, segments as string[]);
      expect(res.status).not.toBe(403);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("stateless compute POSTs are proxied", () => {
    it.each([
      ["v1", "evaluate"],
      ["v1", "risk", "score"],
      ["v1", "risk", "summary"],
      ["v1", "compliance", "evaluate"],
      ["v1", "compliance", "full-report"],
      ["v1", "credentials", "verify"],
      ["v1", "evidence", "verify"],
    ])("POST %j", async (...segments: string[]) => {
      const res = await call("POST", segments);
      expect(res.status).not.toBe(403);
    });
  });

  describe("privileged routes are denied before reaching the backend", () => {
    it.each([
      ["POST", ["v1", "relay", "attestation"]],
      ["POST", ["v1", "relay", "cbom"]],
      ["POST", ["v1", "relay", "audit"]],
      ["POST", ["v1", "relay", "migration"]],
      ["POST", ["v1", "write", "assets"]],
      ["POST", ["v1", "write", "attestations"]],
      ["POST", ["v1", "write", "migrations"]],
      ["POST", ["v1", "evidence", "create"]],
      ["POST", ["v1", "webhooks", "subscribe"]],
      ["POST", ["v1", "webhooks", "unsubscribe"]],
      ["POST", ["v1", "scan", "source"]],
      ["POST", ["v1", "scan", "full"]],
      ["POST", ["v1", "scan", "manifests"]],
      ["POST", ["v1", "gpu", "side-channel", "analyze"]],
      ["POST", ["v1", "gpu", "rl", "plan"]],
      ["POST", ["v1", "gpu", "anomaly", "score"]],
      ["POST", ["v1", "credentials", "issue"]],
      ["POST", ["v1", "plans"]],
    ])("%s %s", async (method, segments) => {
      const res = await call(method, segments as string[]);
      expect(res.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ["DELETE", ["v1", "assets", "asset-1"]],
      ["PUT", ["v1", "stats"]],
      ["POST", ["v1", "stats"]],
    ])("%s %s (wrong method on allowed path)", async (method, segments) => {
      const res = await call(method, segments as string[]);
      expect(res.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("non-API paths stay 404", () => {
    it("rejects paths outside /v1", async () => {
      const res = await call("GET", ["internal", "debug"]);
      expect(res.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

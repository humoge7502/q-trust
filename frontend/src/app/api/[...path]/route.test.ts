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

async function call(
  method: string,
  segments: string[],
  headers?: Record<string, string>,
): Promise<Response> {
  const route = await import("./route");
  // The route module exposes Next's HTTP-method exports; GET and POST share
  // the same underlying handler, so either covers the policy check.
  const handler = (route as Record<string, unknown>)[method] ?? route.GET;
  if (typeof handler !== "function") throw new Error(`no handler for ${method}`);
  const request = new Request(`http://localhost:3000/api/${segments.join("/")}`, {
    method,
    ...(headers ? { headers } : {}),
  });
  return (handler as (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>)(
    request,
    { params: Promise.resolve({ path: segments }) },
  );
}

/** Headers the proxy actually sent upstream on the first backend call. */
function upstreamHeaders(): Headers {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
}

/** Run `fn` with temporary environment overrides, always restoring after. */
async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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
      // R1: GET /v1/plans/:did retired — intentionally NOT proxied (403).
      ["GET", ["v1", "orgs", "did:web:example", "summary"]],
      ["GET", ["v1", "orgs", "did:web:example", "assets"]],
      ["GET", ["v1", "vendors", "did:web:example", "attestations"]],
      ["GET", ["v1", "relay", "nonce", "did:web:example"]],
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
      // R1: retired planner lookup stays default-deny through the proxy.
      ["GET", ["v1", "plans", "did:web:example"]],
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

    it("does not grant access to a path that only shares a prefix", async () => {
      const res = await call("GET", ["v1", "stats-private"]);
      expect(res.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  /**
   * Operator surface: privileged routes the UI used to call and always got 403
   * for. They now require the caller's own key, and the server-side admin key
   * is never attached to them.
   */
  describe("operator routes require the caller's own key", () => {
    const operatorRoutes: Array<[string, string[]]> = [
      ["POST", ["v1", "scan", "full"]],
      ["POST", ["v1", "scan", "source"]],
      ["POST", ["v1", "scan", "manifests"]],
      ["POST", ["v1", "roadmap", "generate"]],
      ["POST", ["v1", "evidence", "create"]],
      ["POST", ["v1", "plans"]],
      ["POST", ["v1", "gpu", "side-channel", "analyze"]],
      ["POST", ["v1", "gpu", "rl", "plan"]],
      ["POST", ["v1", "gpu", "anomaly", "score"]],
      ["GET", ["v1", "gpu", "quantum", "estimate", "2048"]],
      ["POST", ["v1", "relay", "attestation"]],
      ["POST", ["v1", "webhooks", "subscribe"]],
    ];

    it.each(operatorRoutes)(
      "%s %j is denied anonymously with a machine-readable code",
      async (method, segments) => {
        const res = await call(method, segments);
        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toMatchObject({ code: "operator_key_required" });
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it("forwards the caller's key and never the server admin key", async () => {
      const res = await call("POST", ["v1", "scan", "full"], {
        "x-qtrust-api-key": "operator-own-key",
      });
      expect(res.status).not.toBe(403);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const sent = upstreamHeaders();
      expect(sent.get("x-api-key")).toBe("operator-own-key");
      expect(sent.get("x-api-key")).not.toBe("test-admin-key");
    });

    it("does not leak the caller's header upstream under its own name", async () => {
      await call("POST", ["v1", "scan", "full"], { "x-qtrust-api-key": "operator-own-key" });
      expect(upstreamHeaders().get("x-qtrust-api-key")).toBeNull();
    });

    it("ignores a caller key on public routes and keeps using the server key", async () => {
      await call("GET", ["v1", "assets", "asset-1"], { "x-qtrust-api-key": "operator-own-key" });
      expect(upstreamHeaders().get("x-api-key")).toBe("test-admin-key");
    });

    // NOTE: control characters can never reach this handler — the Headers
    // constructor rejects them first — so `isValidOperatorKeyShape` is
    // defence-in-depth for runtimes that normalise instead of throwing. It is
    // unit-tested directly in `lib/__tests__/api-route-policy.test.ts`.
    it("treats a whitespace-only key as absent rather than forwarding it", async () => {
      const res = await call("POST", ["v1", "scan", "full"], {
        "x-qtrust-api-key": "   ",
      });
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({ code: "operator_key_required" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an over-long key", async () => {
      const res = await call("POST", ["v1", "scan", "full"], {
        "x-qtrust-api-key": "k".repeat(600),
      });
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("stays open in local development when no server key is configured", async () => {
      await withEnv({ QTRUST_API_KEY: undefined, QTRUST_API_KEYS: undefined }, async () => {
        const res = await call("POST", ["v1", "scan", "full"]);
        expect(res.status).not.toBe(403);
        // No admin key exists, so nothing is attached — the backend's own
        // dev-open policy decides.
        expect(upstreamHeaders().get("x-api-key")).toBeNull();
      });
    });

    it("remains denied in production even with no server key configured", async () => {
      await withEnv(
        { QTRUST_API_KEY: undefined, QTRUST_API_KEYS: undefined, NODE_ENV: "production" },
        async () => {
          const res = await call("POST", ["v1", "scan", "full"]);
          expect(res.status).toBe(403);
          expect(fetchMock).not.toHaveBeenCalled();
        },
      );
    });
  });
});

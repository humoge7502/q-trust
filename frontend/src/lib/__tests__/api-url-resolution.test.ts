import { describe, expect, it } from "vitest";
import { API_BASE_URL, resolveApiRequest } from "@/lib/api";
import { OPERATOR_KEY_HEADER } from "@/lib/api-route-policy";

/**
 * Regression coverage for the bug that took `/v/[id]` down.
 *
 * `API_BASE_URL` is relative (`/api`) because browser calls must go through the
 * same-origin proxy. Server components import the same module, and Node's
 * `fetch` throws `TypeError: Failed to parse URL` on a relative URL — so every
 * server render of the public verification page returned a 500 instead of an
 * attestation.
 *
 * The e2e suite covers this end to end; these tests pin the invariants directly
 * so a future refactor fails fast and locally.
 */
const BACKEND = "https://api.example.test";

describe("resolveApiRequest", () => {
  it("keeps browser requests on the same-origin proxy", () => {
    const { url } = resolveApiRequest("/v1/assets/0xabc", "browser", {
      backendOrigin: BACKEND,
    });
    expect(url).toBe(`${API_BASE_URL}/v1/assets/0xabc`);
    expect(url.startsWith("/")).toBe(true);
  });

  it("produces an absolute URL on the server", () => {
    // The actual regression: a relative URL here is unparseable by Node.
    const { url } = resolveApiRequest("/v1/assets/0xabc", "server", {
      backendOrigin: BACKEND,
    });
    expect(url).toBe(`${BACKEND}/v1/assets/0xabc`);
    expect(() => new URL(url)).not.toThrow();
  });

  it("never sends the caller's operator key from the server", () => {
    const { headers } = resolveApiRequest("/v1/assets/0xabc", "server", {
      backendOrigin: BACKEND,
      serverApiKey: "server-admin-key",
      operatorKey: "operator-key-from-a-request",
    });
    expect(headers[OPERATOR_KEY_HEADER]).toBeUndefined();
    expect(headers["x-api-key"]).toBe("server-admin-key");
  });

  it("sends the caller's operator key from the browser, not the admin key", () => {
    const { headers } = resolveApiRequest("/v1/scan/full", "browser", {
      backendOrigin: BACKEND,
      serverApiKey: "server-admin-key",
      operatorKey: "operator-own-key",
    });
    // The server-side admin key must never be reachable from the browser.
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers[OPERATOR_KEY_HEADER]).toBe("operator-own-key");
  });

  it("omits auth headers entirely when no key is configured", () => {
    const server = resolveApiRequest("/health", "server", { backendOrigin: BACKEND });
    const browser = resolveApiRequest("/health", "browser", { backendOrigin: BACKEND });
    expect(server.headers).toEqual({});
    expect(browser.headers).toEqual({});
  });

  it("normalises a trailing slash on the backend origin", () => {
    const { url } = resolveApiRequest("/v1/assets/0xabc", "server", {
      backendOrigin: `${BACKEND}/`,
    });
    expect(url).toBe(`${BACKEND}/v1/assets/0xabc`);
    expect(url).not.toContain("//v1");
  });
});

import { describe, expect, it } from "vitest";
import { API_BASE_URL, resolveApiRequest } from "@/lib/api";
import { OPERATOR_KEY_HEADER, OPERATOR_SESSION_HEADER } from "@/lib/api-route-policy";

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
 *
 * Header-scoping invariants (operator session model): in the browser, the
 * caller's credential — session token preferred, raw key as fallback — is
 * attached ONLY to operator-class routes. Public reads and public compute
 * carry neither header, so a stored credential can never ride on every
 * request the page makes. The server branch is untouched by all of this.
 */
const BACKEND = "https://api.example.test";

const SESSION = { token: "qtrust-fixture-session-token" };

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

  it("never sends the caller's credential from the server", () => {
    const { headers } = resolveApiRequest("/v1/assets/0xabc", "server", {
      backendOrigin: BACKEND,
      serverApiKey: "qtrust-fixture-server-value",
      operatorKey: "qtrust-fixture-caller-value",
      operatorSession: SESSION,
    });
    expect(headers[OPERATOR_KEY_HEADER]).toBeUndefined();
    expect(headers[OPERATOR_SESSION_HEADER]).toBeUndefined();
    expect(headers["x-api-key"]).toBe("qtrust-fixture-server-value");
  });

  it("sends the session token on operator routes, not the raw key", () => {
    const { headers } = resolveApiRequest("/v1/relay/attestation", "browser", {
      backendOrigin: BACKEND,
      serverApiKey: "qtrust-fixture-server-value",
      operatorKey: "qtrust-fixture-caller-value",
      operatorSession: SESSION,
    });
    // The server-side admin key must never be reachable from the browser, and
    // the raw key is not resent once a session exists.
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers[OPERATOR_SESSION_HEADER]).toBe(SESSION.token);
    expect(headers[OPERATOR_KEY_HEADER]).toBeUndefined();
  });

  it("falls back to the raw key on operator routes when no session exists", () => {
    const { headers } = resolveApiRequest("/v1/relay/attestation", "browser", {
      backendOrigin: BACKEND,
      operatorKey: "qtrust-fixture-caller-value",
    });
    expect(headers[OPERATOR_KEY_HEADER]).toBe("qtrust-fixture-caller-value");
    expect(headers[OPERATOR_SESSION_HEADER]).toBeUndefined();
  });

  it("attaches neither header on operator routes when the caller is anonymous", () => {
    const { headers } = resolveApiRequest("/v1/relay/attestation", "browser", {
      backendOrigin: BACKEND,
    });
    expect(headers).toEqual({});
  });

  it("attaches no caller credential to public-class routes, even when one is stored", () => {
    for (const path of [
      "/v1/assets/0xabc", // public-read
      "/v1/scan/full", // public-compute
      "/v1/scan/full?ref=main", // query strings must not break classification
      "/health",
    ]) {
      const { headers } = resolveApiRequest(path, "browser", {
        backendOrigin: BACKEND,
        operatorKey: "qtrust-fixture-caller-value",
        operatorSession: SESSION,
      });
      expect(headers, path).toEqual({});
    }
  });

  it("classifies the exchange and revoke endpoints as operator routes", () => {
    for (const path of ["/v1/auth/session", "/v1/auth/session/revoke", "/v1/auth/session/revoke-all"]) {
      const { headers } = resolveApiRequest(path, "browser", {
        backendOrigin: BACKEND,
        operatorSession: SESSION,
      });
      expect(headers[OPERATOR_SESSION_HEADER], path).toBe(SESSION.token);
    }
  });

  it("omits auth headers entirely when no credential is configured", () => {
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

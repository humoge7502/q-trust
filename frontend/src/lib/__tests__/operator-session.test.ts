/**
 * Operator session plumbing: the short-lived token store, lazy expiry, and the
 * one-shot key exchange with its graceful fallback.
 *
 * The security contract under test:
 *   - the raw key is presented exactly once (to POST /v1/auth/session only);
 *   - a successful exchange stores a session and evicts the raw key;
 *   - every failure mode stores NOTHING unless the fallback (raw key) applies;
 *   - a 403 operator_key_required response self-heals by clearing the session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOperatorSession,
  exchangeOperatorKey,
  getOperatorSession,
  hasOperatorSession,
  setOperatorSession,
  subscribeOperatorSession,
} from "@/lib/operator-session";
import { getOperatorKey, setOperatorKey } from "@/lib/operator-key";
import { apiPostJson, OperatorKeyRequiredError } from "@/lib/api";

// ONE shared fetch stub for the whole file: vi.stubGlobal replaces the global,
// so a second stub would silently orphan the first mock and every request in
// earlier describes would resolve to `undefined`.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const STORAGE_KEY = "qtrust.operatorSession";

const FUTURE = new Date(Date.now() + 15 * 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

describe("operator session store", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setOperatorSession(null);
    setOperatorKey(null);
  });

  it("persists a session for the tab and reads it back", () => {
    setOperatorSession({ token: "tok-123", expiresAt: FUTURE });
    expect(getOperatorSession()).toEqual({
      kind: "session",
      token: "tok-123",
      expiresAt: FUTURE,
    });
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "")).toEqual({
      kind: "session",
      token: "tok-123",
      expiresAt: FUTURE,
    });
    expect(hasOperatorSession()).toBe(true);
  });

  it("clears the session from memory and storage", () => {
    setOperatorSession({ token: "tok-123", expiresAt: FUTURE });
    clearOperatorSession();
    expect(getOperatorSession()).toBeNull();
    expect(hasOperatorSession()).toBe(false);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("treats a blank token as a clear", () => {
    setOperatorSession({ token: "   ", expiresAt: FUTURE });
    expect(getOperatorSession()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("lazily clears an expired session on read", () => {
    setOperatorSession({ token: "tok-old", expiresAt: PAST });
    // The read itself is the expiry check — no timer involved.
    expect(getOperatorSession()).toBeNull();
    // Lazily cleared means storage is cleaned too, not just filtered.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(hasOperatorSession()).toBe(false);
  });

  it("treats an unparseable expiry as expired rather than trusting it", () => {
    setOperatorSession({ token: "tok-bad", expiresAt: "not-a-date" });
    expect(getOperatorSession()).toBeNull();
  });

  it("treats a corrupt stored value as absent", () => {
    sessionStorage.setItem(STORAGE_KEY, "{not json");
    expect(getOperatorSession()).toBeNull();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: "no-kind-tag" }));
    expect(getOperatorSession()).toBeNull();
  });

  it("notifies subscribers and unsubscribes cleanly", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOperatorSession(listener);
    setOperatorSession({ token: "tok-1", expiresAt: FUTURE });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setOperatorSession(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("exchangeOperatorKey", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sessionStorage.clear();
    setOperatorSession(null);
    setOperatorKey(null);
  });

  function lastRequest(): { url: string; headers: Headers } {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, headers: new Headers(init.headers) };
  }

  it("posts the raw key to the proxy exchange endpoint and stores the session", async () => {
    setOperatorKey("raw-operator-key");
    const expiresAt = FUTURE;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ sessionToken: "sess-abc", expiresAt, ttlSeconds: 900 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(exchangeOperatorKey("raw-operator-key")).resolves.toEqual({
      ok: true,
      expiresAt,
    });

    const { url, headers } = lastRequest();
    expect(url).toBe("/api/v1/auth/session");
    // The raw key is presented exactly once, under the fallback header name —
    // and never under the session header's name.
    expect(headers.get("x-qtrust-api-key")).toBe("raw-operator-key");
    expect(headers.get("x-qtrust-session")).toBeNull();

    expect(getOperatorSession()?.token).toBe("sess-abc");
    // A successful exchange evicts the raw key: the session now carries access.
    expect(getOperatorKey()).toBeNull();
    expect(sessionStorage.getItem("qtrust.operatorKey")).toBeNull();
  });

  it("maps 503 session_unavailable to 'unavailable' and stores nothing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "sessions not hosted", code: "session_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(exchangeOperatorKey("raw-operator-key")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(getOperatorSession()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("maps 404 (older backend) to 'unavailable' and stores nothing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    await expect(exchangeOperatorKey("k")).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(getOperatorSession()).toBeNull();
  });

  it("maps 401 to 'rejected' and stores nothing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid key" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(exchangeOperatorKey("bad-key")).resolves.toEqual({ ok: false, reason: "rejected" });
    expect(getOperatorSession()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getOperatorKey()).toBeNull();
  });

  it("maps a network failure to 'unavailable' and stores nothing", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(exchangeOperatorKey("raw-key")).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(getOperatorSession()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("maps a 200 without a usable body to 'unavailable' rather than storing junk", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(exchangeOperatorKey("raw-key")).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(getOperatorSession()).toBeNull();
  });
});

describe("stale-session self-heal on 403", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sessionStorage.clear();
    setOperatorSession(null);
    setOperatorKey(null);
  });

  it("clears a stored session before throwing OperatorKeyRequiredError", async () => {
    setOperatorSession({ token: "stale-token", expiresAt: FUTURE });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "operator access required", code: "operator_key_required" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(apiPostJson("/v1/relay/attestation", {})).rejects.toBeInstanceOf(
      OperatorKeyRequiredError,
    );
    // The stale token is gone, so the next render shows the inline key prompt.
    expect(getOperatorSession()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps plain 403s as ordinary errors without touching the session", async () => {
    setOperatorSession({ token: "still-fine", expiresAt: FUTURE });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "not exposed" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(apiPostJson("/v1/relay/attestation", {})).rejects.not.toBeInstanceOf(
      OperatorKeyRequiredError,
    );
    expect(getOperatorSession()?.token).toBe("still-fine");
  });
});

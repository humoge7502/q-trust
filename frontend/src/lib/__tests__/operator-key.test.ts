/**
 * Operator-key plumbing: session storage, header attachment, and the typed
 * error that drives the "Operator access required" UI.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOperatorKey, setOperatorKey, subscribeOperatorKey } from "@/lib/operator-key";
import { OperatorKeyRequiredError, apiPostJson } from "@/lib/api";
import { OPERATOR_KEY_HEADER } from "@/lib/api-route-policy";

const STORAGE_KEY = "qtrust.operatorKey";

describe("operator key store", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setOperatorKey(null);
  });

  it("persists a key for the tab and reads it back", () => {
    setOperatorKey("operator-key-123");
    expect(getOperatorKey()).toBe("operator-key-123");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("operator-key-123");
  });

  it("trims input and treats blank input as a clear", () => {
    setOperatorKey("  spaced-key  ");
    expect(getOperatorKey()).toBe("spaced-key");
    setOperatorKey("   ");
    expect(getOperatorKey()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("notifies subscribers and unsubscribes cleanly", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOperatorKey(listener);
    setOperatorKey("k1");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setOperatorKey("k2");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("apiPostJson", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  beforeEach(() => {
    fetchMock.mockReset();
    sessionStorage.clear();
    setOperatorKey(null);
  });

  function lastHeaders(): Headers {
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    return new Headers(init.headers);
  }

  it("attaches the operator key when one is stored", async () => {
    setOperatorKey("stored-key");
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await apiPostJson("/v1/scan/full", { target: "/tmp" });
    expect(lastHeaders().get(OPERATOR_KEY_HEADER)).toBe("stored-key");
  });

  it("omits the header when no key is stored", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await apiPostJson("/v1/risk/score", { findings: [] });
    expect(lastHeaders().get(OPERATOR_KEY_HEADER)).toBeNull();
  });

  it("throws a typed error when the proxy reports operator_key_required", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "operator access required", code: "operator_key_required" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(apiPostJson("/v1/scan/full", {})).rejects.toBeInstanceOf(
      OperatorKeyRequiredError,
    );
  });

  it("keeps plain 403s as ordinary errors", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "not exposed" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    const error = await apiPostJson("/v1/scan/full", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(OperatorKeyRequiredError);
  });
});

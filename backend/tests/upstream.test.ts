import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry, isTunnelFailure } from "../src/services/upstream.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const html = (status: number) =>
  new Response("<html>error 1033</html>", {
    status,
    headers: { "content-type": "text/html" },
  });

const json = (status: number, body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("isTunnelFailure", () => {
  it("classifies Cloudflare edge statuses as tunnel failures", () => {
    for (const status of [502, 503, 521, 522, 523, 524, 525, 526, 530]) {
      expect(isTunnelFailure(status)).toBe(true);
    }
  });

  it("treats an HTML error body as a tunnel failure even on an unlisted status", () => {
    expect(isTunnelFailure(520)).toBe(true);
    expect(isTunnelFailure(500, "text/html; charset=utf-8")).toBe(true);
  });

  it("leaves the API's own JSON errors alone", () => {
    expect(isTunnelFailure(422, "application/json")).toBe(false);
    expect(isTunnelFailure(429, "application/json")).toBe(false);
    expect(isTunnelFailure(400, "application/json")).toBe(false);
  });
});

describe("fetchWithRetry", () => {
  it("retries a tunnel blip and returns the recovered response", async () => {
    const calls: number[] = [];
    globalThis.fetch = vi.fn(async () => {
      calls.push(calls.length);
      return calls.length === 1 ? html(530) : json(200, { plan: "ok" });
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry("https://planner.test/plan", { method: "POST" }, { baseDelayMs: 1 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: "ok" });
    expect(calls.length).toBe(2);
  });

  it("does not retry a validation error", async () => {
    const spy = vi.fn(async () => json(422, { error: "bad" }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const res = await fetchWithRetry("https://planner.test/plan", { method: "POST" }, { baseDelayMs: 1 });

    expect(res.status).toBe(422);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rate limit", async () => {
    const spy = vi.fn(async () => json(429, { error: "slow down" }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const res = await fetchWithRetry("https://planner.test/plan", { method: "POST" }, { baseDelayMs: 1 });

    expect(res.status).toBe(429);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt budget and surfaces the last tunnel response", async () => {
    const spy = vi.fn(async () => html(502));
    globalThis.fetch = spy as unknown as typeof fetch;
    const onRetry = vi.fn();

    const res = await fetchWithRetry(
      "https://planner.test/plan",
      { method: "POST" },
      { attempts: 3, baseDelayMs: 1, onRetry },
    );

    expect(res.status).toBe(502);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("does not replay a timeout", async () => {
    const spy = vi.fn(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(
      fetchWithRetry("https://planner.test/plan", { method: "POST" }, { attempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow(/timeout/i);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries a connection refusal and throws once the budget is spent", async () => {
    const spy = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(
      fetchWithRetry("https://planner.test/plan", { method: "POST" }, { attempts: 2, baseDelayMs: 1 }),
    ).rejects.toThrow(/fetch failed/);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { OperatorKeyRequiredError } from "@/lib/api";
import { useApiOperation } from "@/hooks/use-api-operation";

describe("useApiOperation", () => {
  it("stores the result and clears transient state on success", async () => {
    const { result } = renderHook(() => useApiOperation<{ ok: boolean }>());
    const returned = await act(async () =>
      result.current.run(async () => ({ ok: true })),
    );
    expect(returned).toEqual({ ok: true });
    expect(result.current.data).toEqual({ ok: true });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
    expect(result.current.operatorEndpoint).toBeNull();
  });

  it("maps a thrown Error onto the error text", async () => {
    const { result } = renderHook(() => useApiOperation<{ ok: boolean }>());
    const returned = await act(async () =>
      result.current.run(async () => {
        throw new Error("proxy refused");
      }),
    );
    expect(returned).toBeNull();
    expect(result.current.error).toBe("proxy refused");
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("routes OperatorKeyRequiredError to the operator prompt, not the error text", async () => {
    const { result } = renderHook(() => useApiOperation<{ ok: boolean }>());
    await act(async () =>
      result.current.run(async () => {
        throw new OperatorKeyRequiredError("/v1/evidence/create");
      }),
    );
    expect(result.current.operatorEndpoint).toBe("/v1/evidence/create");
    expect(result.current.error).toBe("");
  });

  it("flips loading true while the call is in flight", async () => {
    const { result } = renderHook(() => useApiOperation<number>());
    let resolveCall: (value: number) => void = () => {};
    const pending = new Promise<number>((resolve) => {
      resolveCall = resolve;
    });

    let promise: Promise<number | null> | undefined;
    act(() => {
      promise = result.current.run(() => pending);
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    await act(async () => resolveCall(42));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(await promise).toBe(42);
  });

  it("clear resets data, error and the operator prompt", async () => {
    const { result } = renderHook(() => useApiOperation<number>());
    await act(async () =>
      result.current.run(async () => {
        throw new OperatorKeyRequiredError("/v1/scan/full");
      }),
    );
    expect(result.current.operatorEndpoint).not.toBeNull();
    act(() => result.current.clear());
    expect(result.current.operatorEndpoint).toBeNull();
    expect(result.current.error).toBe("");
    expect(result.current.data).toBeNull();
  });

  it("stringifies non-Error rejections", async () => {
    const { result } = renderHook(() => useApiOperation<number>());
    await act(async () =>
      result.current.run(async () => {
        throw "network down";
      }),
    );
    expect(result.current.error).toBe("network down");
  });
});

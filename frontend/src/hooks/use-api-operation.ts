"use client";

/**
 * One async API operation, one state machine.
 *
 * Panels and forms kept re-implementing the same five lines per call
 * (F-13): `setLoading(true)`, clear the error, `apiPostJson`, map the
 * `OperatorKeyRequiredError` onto an operator prompt instead of a message,
 * flip loading off in a `finally`. This hook owns that cycle once: data,
 * loading, error text, and the operator-endpoint prompt state for a single
 * operation, with `run(call)` doing the try/catch and `clear()` resetting.
 *
 * The call itself is a closure so the fetch and any response shaping stay
 * with the caller — the hook never learns what the endpoint returns beyond
 * the `T` it was parameterised with.
 */
import { useCallback, useState } from "react";
import { OperatorKeyRequiredError } from "@/lib/api";

export interface ApiOperation<T> {
  data: T | null;
  loading: boolean;
  /** Plain-text failure reason; empty while idle or after a success. */
  error: string;
  /** Set instead of `error` when the proxy demanded an operator key. */
  operatorEndpoint: string | null;
  /**
   * Runs the call with the loading/error cycle. Resolves to the result on
   * success and null on failure — the stored state tells which happened.
   */
  run: (call: () => Promise<T>) => Promise<T | null>;
  /** Drops data, error and operator prompt (e.g. before a fresh run). */
  clear: () => void;
  /** Writes data directly, for responses shaped outside the hook. */
  setData: (data: T | null) => void;
}

export function useApiOperation<T>(): ApiOperation<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [operatorEndpoint, setOperatorEndpoint] = useState<string | null>(null);

  const clear = useCallback(() => {
    setData(null);
    setError("");
    setOperatorEndpoint(null);
  }, []);

  const run = useCallback(async (call: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError("");
    setOperatorEndpoint(null);
    try {
      const result = await call();
      setData(result);
      return result;
    } catch (err) {
      if (err instanceof OperatorKeyRequiredError) {
        setOperatorEndpoint(err.endpoint);
        setError("");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, setData, loading, error, operatorEndpoint, run, clear };
}

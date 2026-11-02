/**
 * Upstream fetch helper for the operator-machine bridge.
 *
 * The scanner, evidence chain and planner all run on the operator machine and
 * reach the hosted API through a Cloudflare quick tunnel. Quick tunnels drop
 * connections at the edge fairly often: a request that would succeed a moment
 * later comes back as 502/503 or a Cloudflare 52x-53x HTML error page. Passing
 * that straight to the client turned a recoverable blip into a visible outage
 * (the scanner rendered "Error 1033", the dashboard showed "planner
 * unavailable"), which is fatal for a live demo.
 *
 * Retrying is safe for the routes that use this helper because every one of
 * them is a pure computation (scan, score, plan, verify). Only tunnel-level
 * statuses are retried — those mean the edge never reached the origin, so the
 * request cannot have been applied twice. Ambiguous outcomes (a 504 after the
 * origin started work, or a socket timeout) are surfaced immediately rather
 * than replayed.
 */

/** Cloudflare's edge-level failures: the tunnel is down or the origin is gone. */
const TUNNEL_STATUSES = new Set([502, 503]);

export function isTunnelFailure(status: number, contentType = ""): boolean {
  // 520-530 is Cloudflare's origin/tunnel error band (520 unknown error,
  // 521 origin down, 522 connection timed out, 523 unreachable, 524 origin
  // timeout, 525/526 TLS, 530 tunnel not found).
  if (TUNNEL_STATUSES.has(status) || (status >= 520 && status <= 530)) return true;
  // A non-JSON HTML body on a failure means we got an edge error page, not the
  // API's own error envelope.
  return status >= 400 && contentType.includes("text/html");
}

export interface FetchWithRetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Base backoff in milliseconds, doubled per retry. Default 150. */
  baseDelayMs?: number;
  /** Per-attempt timeout in milliseconds. Default 55_000. */
  timeoutMs?: number;
  /** Called after a transient failure, before sleeping. */
  onRetry?: (info: { attempt: number; status: number }) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetch with bounded retries on tunnel-level failures.
 *
 * Returns the first response that is not a tunnel failure, so the caller keeps
 * full control of status mapping. Throws only when every attempt failed at the
 * network layer (DNS, connection refused, timeout).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 150;
  const timeoutMs = options.timeoutMs ?? 55_000;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (attempt < attempts && isTunnelFailure(response.status, contentType)) {
        options.onRetry?.({ attempt, status: response.status });
        // Drain the body so the socket is released before retrying.
        await response.arrayBuffer().catch(() => undefined);
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      // A timeout or abort is ambiguous (the origin may have started work) and
      // retrying would double the worst-case latency past the serverless
      // limit, so surface it instead of replaying.
      const name = (err as { name?: string } | null)?.name ?? "";
      if (name === "TimeoutError" || name === "AbortError") break;
      if (attempt >= attempts) break;
      options.onRetry?.({ attempt, status: 0 });
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError ?? new Error(`Upstream request to ${url} failed`);
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison.
 *
 * Both sides are zero-padded to a common length so `timingSafeEqual` never
 * throws on a length mismatch and no comparison path short-circuits on
 * content. (The previous sha256-then-compare version also re-introduced a
 * plain `a === b` after the timing-safe step, which early-exits on the first
 * differing byte — defeating the point.)
 */
function safeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  const n = Math.max(ab.length, bb.length);
  const pa = Buffer.alloc(n);
  const pb = Buffer.alloc(n);
  ab.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb);
}

/**
 * API-key gate usable both as a route `preHandler` and as an instance hook.
 * Halting is signaled by returning the (already-sent) reply.
 *
 * Audit M-10: this is now the SINGLE requireApiKey implementation for the
 * whole backend — server.ts imports this function instead of keeping its own
 * callback-style copy with divergent env-read semantics (module-load capture
 * vs per-call read) and divergent error codes (401 vs 500).
 *
 * Policy: fail-closed whenever QTRUST_API_KEYS is configured OR the process
 * runs in production; pure-local dev with no key management stays open so the
 * scanner/GPU demo flows work out of the box.
 */
const KEY_CACHE_TTL_MS = 30_000;
let cachedKeys: { keys: string[]; at: number; raw: string | undefined } = {
  keys: [],
  at: 0,
  raw: undefined,
};

/** Parse QTRUST_API_KEYS with a short TTL cache so key rotation via env
 *  updates is picked up without re-parsing on every request. */
function configuredApiKeys(): string[] {
  const raw = process.env.QTRUST_API_KEYS;
  if (
    cachedKeys.raw === raw &&
    Date.now() - cachedKeys.at < KEY_CACHE_TTL_MS
  ) {
    return cachedKeys.keys;
  }
  const keys = (raw ?? "")
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  cachedKeys = { keys, at: Date.now(), raw };
  return keys;
}

export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const isProduction = process.env.NODE_ENV === 'production';
  const validKeys = configuredApiKeys();

  if (!validKeys.length) {
    if (!isProduction) {
      // Pure-local dev with no key management configured: keep endpoints open.
      return undefined;
    }
    // Production with no keys configured — refuse everything (fail-closed).
    return reply
      .code(401)
      .send({ error: 'API keys not configured — write routes disabled' });
  }

  const providedKey = request.headers['x-api-key'];
  if (typeof providedKey !== 'string') {
    return reply.code(401).send({ error: 'Invalid or missing API key' });
  }
  // Constant-time across all configured keys: always compare against every
  // key with safeEquals (hash + timingSafeEqual). Using Array.some would
  // short-circuit on first match and leak the matching index via timing.
  let authorized = false;
  for (const k of validKeys) {
    if (safeEquals(k, providedKey)) authorized = true;
  }
  if (!authorized) {
    return reply.code(401).send({ error: 'Invalid or missing API key' });
  }
  return undefined;
}

// Audit I-4: unused validateTarget/requestLogger/securityHeaders helpers
// were deleted — their functionality lives in scanner.ts validation and in
// the helmet plugin.

export function gracefulShutdown(
  server: FastifyInstance,
  signal: string,
  cleanup?: () => Promise<void>,
): void {
  const handler = async () => {
    server.log.info({ signal }, 'Received signal, shutting down gracefully');
    try {
      if (cleanup) {
        await cleanup();
      }
      await server.close();
      server.log.info('Server closed successfully');
      process.exit(0);
    } catch (err) {
      server.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { keyFingerprint, validateSession } from '../services/operator-sessions.js';

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
 * How the current request authenticated. `static` means the credential
 * matched a configured QTRUST_API_KEYS entry; `session` means it was a
 * minted operator session token. The fingerprint (sha256 hex prefix) names
 * the credential for audit and per-key revocation without ever exposing the
 * key or the token itself.
 */
export interface OperatorAuth {
  type: 'static' | 'session';
  keyFingerprint: string;
}

// Route handlers read request.operatorAuth to learn HOW the caller
// authenticated (e.g. revoke-all needs the static key's fingerprint to target
// the per-key revoke index). Declared here so every importer of the
// middleware picks up the augmentation with no extra d.ts file.
declare module 'fastify' {
  interface FastifyRequest {
    operatorAuth?: OperatorAuth;
  }
}

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
 * scanner/GPU demo flows work out of the box. With keys configured, a static
 * match wins; otherwise the credential is tried as a minted operator session
 * token (validateSession) before the 401.
 */
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
  let matchedKey: string | null = null;
  for (const k of validKeys) {
    if (safeEquals(k, providedKey)) matchedKey = k;
  }
  if (matchedKey === null) {
    // Not a configured static key — accept a minted operator session token
    // instead. Lookup is by sha256(token), so probing with garbage costs one
    // hash plus one store miss, and a hit slides the session's expiry window
    // forward (sliding-window semantics live in operator-sessions.ts).
    const session = await validateSession(providedKey);
    if (session) {
      request.operatorAuth = { type: 'session', keyFingerprint: session.keyFingerprint };
      return undefined;
    }
    return reply.code(401).send({ error: 'Invalid or missing API key' });
  }
  request.operatorAuth = { type: 'static', keyFingerprint: keyFingerprint(matchedKey) };
  return undefined;
}

/**
 * Static-key-only variant of requireApiKey for the session-minting route.
 * Identical env semantics (dev-open without keys, fail-closed 401 in
 * production) with one deliberate difference: a valid SESSION token is
 * rejected with a distinct 401 instead of being accepted. If a stolen token
 * could call POST /v1/auth/session it could silently renew itself forever
 * and revocation would never catch up — only a real static key may mint.
 */
export async function requireStaticApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const isProduction = process.env.NODE_ENV === 'production';
  const validKeys = configuredApiKeys();

  if (!validKeys.length) {
    if (!isProduction) {
      // Same dev-open behaviour as requireApiKey: pure-local dev with no key
      // management configured keeps endpoints open.
      return undefined;
    }
    return reply
      .code(401)
      .send({ error: 'API keys not configured — write routes disabled' });
  }

  const providedKey = request.headers['x-api-key'];
  if (typeof providedKey !== 'string') {
    return reply.code(401).send({ error: 'Invalid or missing API key' });
  }
  // Same no-short-circuit loop as requireApiKey: safeEquals runs against
  // every configured key so the timing profile is identical.
  let matchedKey: string | null = null;
  for (const k of validKeys) {
    if (safeEquals(k, providedKey)) matchedKey = k;
  }
  if (matchedKey === null) {
    // Distinguish "this is a session token" from "this is garbage" so the
    // operator sees WHY the mint failed instead of a generic 401.
    const session = await validateSession(providedKey);
    if (session) {
      return reply.code(401).send({
        error: 'Session tokens cannot mint sessions — authenticate with a static API key',
      });
    }
    return reply.code(401).send({ error: 'Invalid or missing API key' });
  }
  request.operatorAuth = { type: 'static', keyFingerprint: keyFingerprint(matchedKey) };
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

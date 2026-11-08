import { createHash, createHmac, randomBytes, scryptSync } from "node:crypto";
import { Redis } from "ioredis";
import { operatorSessionTtlSeconds } from "../config.js";

/**
 * Server-side operator session tokens.
 *
 * Static API keys are long-lived bearer credentials that get copied into
 * dashboards, scripts and CI. A leaked static key stays valid until every
 * copy is rotated by hand, so write-capable operators can instead mint
 * SHORT-LIVED session tokens (`POST /v1/auth/session`). The blast radius of
 * a leaked token is bounded three ways:
 *
 *   1. Bounded TTL — a token dies on its own after the configured sliding
 *      TTL; it never outlives the store it lives in.
 *   2. Hash-only storage — only SHA-256(token) is ever persisted (as the
 *      record id). A read of the store (Redis dump, process memory) never
 *      yields a usable credential; the raw token exists only in the
 *      createSession return value and on the operator's machine.
 *   3. Individual revocation — a token can be revoked alone, or every token
 *      minted by a key can be revoked at once via the per-key index, without
 *      touching the static keys themselves.
 *
 * Sliding window: every successful validation refreshes the TTL. An idle
 * session dies after the TTL; a session in active use stays alive — which is
 * exactly the semantics an operator wants (a stolen token that is actually
 * being used keeps working, but an abandoned one disappears silently).
 *
 * Storage tiers, checked per operation:
 *   - Redis (QTRUST_REDIS_URL / REDIS_URL) — shared across replicas; the
 *     production path. Redis keys: `qtrust:opsess:<tokenHash>` holds a JSON
 *     record {keyFingerprint, issuedAt}, and the index set
 *     `qtrust:opsess-key:<keyFingerprint>` holds the token hashes of every
 *     live session for that key (revoking a key = draining its index set).
 *   - In-memory Map — dev/local/single-instance fallback with identical
 *     semantics and lazy expiry.
 *   - Fail-closed rule — production never degrades to the in-memory store.
 *     A session that silently "survives" a Redis outage by living in one
 *     replica's process memory is state a multi-replica deployment cannot
 *     reason about (it would vanish on the next request), so production
 *     without a ready Redis refuses issuance instead. Static API keys keep
 *     working throughout — they never touch this store.
 */

/** sha256 hex of `value` — the full digest used as the token record id. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ── Operator-key fingerprints (brute-force hardening) ────────────────────────
// The fingerprint is derived from the RAW API KEY (a password-class secret)
// and is persisted in Redis index sets, route responses and audit logs, so
// the derivation must not be a bare fast hash: SHA-256(key) in a leaked store
// would be brute-forceable if the operator key is low-entropy. Two modes:
//
//   1. QTRUST_OPERATOR_FINGERPRINT_SECRET set — HMAC-SHA256 under that
//      secret (fast; per-request cheap). Recovering a key from a leaked
//      fingerprint requires the secret itself.
//   2. No secret — scrypt (adaptive KDF) over a fixed documented salt:
//      deterministic and replica-stable for the shared Redis index, and
//      brute-force-resistant even unpeppered. Memoized per value because
//      scryptSync blocks the event loop (~50ms/call) and static-auth
//      computes the fingerprint on every request. Production logs a one-
//      time warning recommending the secret (mode 1).

const FINGERPRINT_FALLBACK_SALT = "qtrust:operator-key-fingerprint:v1";
const fingerprintCache = new Map<string, string>();
let warnedMissingSecret = false;

/**
 * First 16 hex chars of the keyed digest of `value`: a stable,
 * non-reversible identifier for the per-key revoke index, route responses
 * and audit logs. 16 hex chars (64 bits) is enough to make collision and
 * reconstruction of the underlying credential impractical while never
 * persisting the secret.
 */
export function keyFingerprint(value: string): string {
  const secret = process.env.QTRUST_OPERATOR_FINGERPRINT_SECRET;
  if (secret) {
    return createHmac("sha256", secret).update(value, "utf8").digest("hex").slice(0, 16);
  }
  if (isProduction() && !warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      "[operator-sessions] QTRUST_OPERATOR_FINGERPRINT_SECRET is not set — " +
        "operator-key fingerprints fall back to scrypt (slower). Set the " +
        "secret to use the HMAC path.",
    );
  }
  let fp = fingerprintCache.get(value);
  if (fp === undefined) {
    fp = scryptSync(value, FINGERPRINT_FALLBACK_SALT, 32).toString("hex").slice(0, 16);
    fingerprintCache.set(value, fp);
  }
  return fp;
}

const TOKEN_PREFIX = "qtrust:opsess:";
const INDEX_PREFIX = "qtrust:opsess-key:";

function isProduction(): boolean {
  // Read per call, not at module load: NODE_ENV is juggled in tests and a
  // module-load capture would freeze whichever mode booted first.
  return process.env.NODE_ENV === "production";
}

// ── Redis client (lazy module singleton) ─────────────────────────────────────
// server.ts builds its own Redis client for webhooks/rate-limiting, but this
// service is also reachable from bare-app tests and other entrypoints, so it
// owns a lazily created singleton keyed off the same env vars. One client per
// process — repeated createSession calls must not open a new connection each.

let cachedClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (cachedClient !== undefined) return cachedClient;
  const url = process.env.QTRUST_REDIS_URL ?? process.env.REDIS_URL;
  if (!url) {
    cachedClient = null;
    return null;
  }
  try {
    const client = new Redis(url, {
      // Same tolerant profile as server.ts: a Redis outage must never become
      // an uncaught exception — session operations degrade per-call instead.
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
    });
    // ioredis emits connection errors asynchronously; without a listener a
    // transient outage crashes the process.
    client.on("error", () => {
      // Swallowed deliberately: every operation re-checks `status` and
      // falls back (or fails closed in production) on its own.
    });
    // Connect eagerly so the first session op after boot finds a warm
    // connection. A failed connect keeps retrying in the background while
    // individual ops treat "not ready" as "no Redis".
    client.connect().catch(() => {});
    cachedClient = client;
    return client;
  } catch {
    // Malformed URL etc. — permanently fall back (or fail closed).
    cachedClient = null;
    return null;
  }
}

// ── In-memory fallback (dev / local / single-instance) ───────────────────────
// Mirrors the Redis layout token-hash -> record + fingerprint -> token-hashes
// index. Expiry is lazy: dead entries are swept when touched rather than by a
// timer, which keeps the fallback dependency-free.

interface MemorySession {
  keyFingerprint: string;
  issuedAt: string;
  /** Epoch ms after which the session is dead (sliding — refreshed on use). */
  expiresAt: number;
}

const memorySessions = new Map<string, MemorySession>();
const memoryIndex = new Map<string, Set<string>>();

function memorySet(tokenHash: string, fingerprint: string, ttlSeconds: number): void {
  memorySessions.set(tokenHash, {
    keyFingerprint: fingerprint,
    issuedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  let set = memoryIndex.get(fingerprint);
  if (!set) {
    set = new Set();
    memoryIndex.set(fingerprint, set);
  }
  set.add(tokenHash);
}

/** Remove a session from both maps; returns the removed record or null. */
function memoryDrop(tokenHash: string): MemorySession | null {
  const entry = memorySessions.get(tokenHash);
  if (!entry) return null;
  memorySessions.delete(tokenHash);
  const set = memoryIndex.get(entry.keyFingerprint);
  if (set) {
    set.delete(tokenHash);
    if (set.size === 0) memoryIndex.delete(entry.keyFingerprint);
  }
  return entry;
}

function memoryValidate(tokenHash: string): { keyFingerprint: string } | null {
  const entry = memorySessions.get(tokenHash);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryDrop(tokenHash);
    return null;
  }
  // Sliding window — the same refresh the Redis path performs.
  entry.expiresAt = Date.now() + operatorSessionTtlSeconds() * 1000;
  return { keyFingerprint: entry.keyFingerprint };
}

function memoryRevoke(tokenHash: string): boolean {
  return memoryDrop(tokenHash) !== null;
}

function memoryRevokeForKey(fingerprint: string): number {
  const hashes = memoryIndex.get(fingerprint);
  if (!hashes) return 0;
  let revoked = 0;
  for (const hash of hashes) {
    if (memorySessions.delete(hash)) revoked++;
  }
  memoryIndex.delete(fingerprint);
  return revoked;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function parseStoredSession(raw: string): { keyFingerprint: string } | null {
  try {
    const parsed = JSON.parse(raw) as { keyFingerprint?: unknown };
    return typeof parsed?.keyFingerprint === "string" && parsed.keyFingerprint
      ? { keyFingerprint: parsed.keyFingerprint }
      : null;
  } catch {
    return null;
  }
}

function isoIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Mint a session token bound to `key` (the presented static API credential).
 * Returns null — not a degraded in-memory session — when production runs
 * without a ready Redis: silently issuing process-local sessions in a
 * multi-replica deployment would create auth that works on one replica and
 * 401s on the next. Callers map null to 503 session_unavailable.
 */
export async function createSession(
  key: string,
): Promise<{ token: string; expiresAt: string; ttlSeconds: number } | null> {
  const ttl = operatorSessionTtlSeconds();
  const fingerprint = keyFingerprint(key);
  const redis = getRedis();
  const redisReady = redis !== null && redis.status === "ready";

  // Fail-closed production rule: no ready Redis => no issuance. Static keys
  // are unaffected (they never consult this store).
  if (isProduction() && !redisReady) {
    return null;
  }

  // The token is generated once and returned once; everything persisted from
  // here on is hashes and fingerprints only.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(token);
  const payload = JSON.stringify({
    keyFingerprint: fingerprint,
    issuedAt: new Date().toISOString(),
  });

  if (redisReady) {
    try {
      await redis!.set(TOKEN_PREFIX + tokenHash, payload, "EX", ttl);
      await redis!.sadd(INDEX_PREFIX + fingerprint, tokenHash);
      // The index outlives its newest member by 60s so a token expiring
      // mid-revoke-all is still listed when its key asks for revocation;
      // it is refreshed alongside the token key on every validation.
      await redis!.expire(INDEX_PREFIX + fingerprint, ttl + 60);
      return { token, expiresAt: isoIn(ttl), ttlSeconds: ttl };
    } catch {
      if (isProduction()) {
        // A half-written session (token key without index entry) is worse
        // than no session — refuse instead of degrading.
        return null;
      }
      // Dev: fall through to the in-memory store so local flows keep
      // working through a laptop Redis outage.
    }
  }

  memorySet(tokenHash, fingerprint, ttl);
  return { token, expiresAt: isoIn(ttl), ttlSeconds: ttl };
}

/**
 * Validate a presented credential as a session token. On a hit the TTL is
 * refreshed (sliding window) and the issuing key's fingerprint is returned;
 * on a miss, an expired token, or an unusable store, returns null. The raw
 * token is hashed before lookup — the store never sees it.
 */
export async function validateSession(token: string): Promise<{ keyFingerprint: string } | null> {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const redis = getRedis();
  const redisReady = redis !== null && redis.status === "ready";

  if (redisReady) {
    try {
      const raw = await redis!.get(TOKEN_PREFIX + tokenHash);
      if (raw === null) {
        // Redis is authoritative while it is reachable — a miss here is a
        // real miss (or an expired key), not a reason to probe the fallback.
        return null;
      }
      const parsed = parseStoredSession(raw);
      if (parsed === null) {
        // Corrupt record: treat as invalid rather than trust it.
        return null;
      }
      const ttl = operatorSessionTtlSeconds();
      await redis!.expire(TOKEN_PREFIX + tokenHash, ttl);
      await redis!.expire(INDEX_PREFIX + parsed.keyFingerprint, ttl + 60);
      return { keyFingerprint: parsed.keyFingerprint };
    } catch {
      if (isProduction()) {
        // An unusable store in production means no provable session —
        // fail closed (static keys remain unaffected).
        return null;
      }
      // Dev: Redis errored mid-read — fall back below.
    }
  } else if (isProduction()) {
    return null;
  }
  return memoryValidate(tokenHash);
}

/**
 * Revoke one session by its raw token. Returns true when a live session was
 * removed. Revoking a credential that was never a session (a static key,
 * garbage) is a no-op returning false.
 */
export async function revokeSession(token: string): Promise<boolean> {
  if (!token) return false;
  const tokenHash = sha256Hex(token);
  const redis = getRedis();
  const redisReady = redis !== null && redis.status === "ready";

  if (redisReady) {
    try {
      const raw = await redis!.get(TOKEN_PREFIX + tokenHash);
      if (raw === null) return false;
      const parsed = parseStoredSession(raw);
      const deleted = await redis!.del(TOKEN_PREFIX + tokenHash);
      if (parsed !== null) {
        // Keep the per-key index honest so revoke-all counts stay accurate.
        await redis!.srem(INDEX_PREFIX + parsed.keyFingerprint, tokenHash);
      }
      return deleted > 0;
    } catch {
      if (isProduction()) return false;
      // Dev: fall back below.
    }
  } else if (isProduction()) {
    return false;
  }
  return memoryRevoke(tokenHash);
}

/**
 * Revoke every live session minted by the key with fingerprint
 * `keyFingerprint` (keyed/scrypt fingerprint of the raw key, first 16 chars —
 * as returned by keyFingerprint()). Returns the number of sessions actually
 * revoked.
 */
export async function revokeSessionsForKey(keyFingerprint: string): Promise<number> {
  const redis = getRedis();
  const redisReady = redis !== null && redis.status === "ready";

  if (redisReady) {
    try {
      const hashes = await redis!.smembers(INDEX_PREFIX + keyFingerprint);
      let revoked = 0;
      for (const hash of hashes) {
        revoked += await redis!.del(TOKEN_PREFIX + hash);
      }
      await redis!.del(INDEX_PREFIX + keyFingerprint);
      return revoked;
    } catch {
      if (isProduction()) return 0;
      // Dev: fall back below.
    }
  } else if (isProduction()) {
    return 0;
  }
  return memoryRevokeForKey(keyFingerprint);
}

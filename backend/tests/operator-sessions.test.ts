import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  keyFingerprint,
  revokeSession,
  revokeSessionsForKey,
  validateSession,
} from "../src/services/operator-sessions.js";

/**
 * Operator-key fingerprint derivation (hardening).
 *
 * The fingerprint is persisted (Redis index, logs, responses) and derives
 * from the raw API key, so it must never be a bare fast hash — CodeQL
 * js/insufficient-password-hash guards exactly that. These tests pin the
 * contract: HMAC under the configured secret when present, deterministic
 * scrypt fallback otherwise, and never plain SHA-256.
 */
describe("operator key fingerprint derivation", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("is deterministic, 16 hex chars, and key-distinct (scrypt fallback)", () => {
    delete process.env.QTRUST_OPERATOR_FINGERPRINT_SECRET;
    const a1 = keyFingerprint("fp-key-a");
    const a2 = keyFingerprint("fp-key-a");
    const b = keyFingerprint("fp-key-b");
    expect(a1).toMatch(/^[0-9a-f]{16}$/);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("mixes the configured secret into the derivation (HMAC path)", () => {
    process.env.QTRUST_OPERATOR_FINGERPRINT_SECRET = "pepper-one";
    const withOne = keyFingerprint("fp-key-hmac");
    process.env.QTRUST_OPERATOR_FINGERPRINT_SECRET = "pepper-two";
    const withTwo = keyFingerprint("fp-key-hmac");
    expect(withOne).toMatch(/^[0-9a-f]{16}$/);
    expect(withOne).not.toBe(withTwo);
  });

  it("never equals a bare sha256 truncation of the key", () => {
    delete process.env.QTRUST_OPERATOR_FINGERPRINT_SECRET;
    const bareSha = createHash("sha256")
      .update("fp-key-scrypt", "utf8")
      .digest("hex")
      .slice(0, 16);
    expect(keyFingerprint("fp-key-scrypt")).not.toBe(bareSha);
  });
});

/**
 * Operator session store (unit).
 *
 * Runs entirely against the in-memory fallback — no live Redis is required
 * (and none may be: the env juggling below deletes the Redis URL vars so the
 * store always takes the dev in-memory path). The fail-closed production
 * rule is exercised via env juggling the way apikey.test.ts manages NODE_ENV.
 *
 * The module singleton keeps state across tests in this file, so every test
 * mints under a UNIQUE key fingerprint to stay independent.
 */
describe("operator sessions (in-memory store)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Force the dev in-memory path for every test; a developer .env with a
    // QTRUST_REDIS_URL must not turn these into live-connection tests.
    delete process.env.QTRUST_REDIS_URL;
    delete process.env.REDIS_URL;
    delete process.env.QTRUST_OPERATOR_SESSION_TTL_SECONDS;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  it("creates a session and validates it back to the key fingerprint", async () => {
    const created = await createSession("unit-key-create");
    expect(created).not.toBeNull();
    expect(created!.token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(created!.ttlSeconds).toBe(3600);
    const expires = new Date(created!.expiresAt).getTime();
    expect(expires).toBeGreaterThan(Date.now());

    const validated = await validateSession(created!.token);
    expect(validated).not.toBeNull();
    expect(validated!.keyFingerprint).toBe(keyFingerprint("unit-key-create"));
  });

  it("slides the expiry window forward on every validation", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    const created = await createSession("unit-key-sliding");
    expect(created).not.toBeNull();

    // Half-way through the window the session is still alive...
    vi.advanceTimersByTime(1_800_000); // t = 30 min
    expect(await validateSession(created!.token)).not.toBeNull();

    // ...and because that validation refreshed the TTL, the session survives
    // past its ORIGINAL expiry (3600s) — proof the window slides.
    vi.advanceTimersByTime(3_200_000); // t = ~83 min > original 60 min expiry
    expect(await validateSession(created!.token)).not.toBeNull();
  });

  it("expires a token that is not used within the window", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    const created = await createSession("unit-key-expiry");
    expect(created).not.toBeNull();

    vi.advanceTimersByTime(3_601_000); // past the 3600s TTL, no use in between
    expect(await validateSession(created!.token)).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const created = await createSession("unit-key-tamper");
    expect(created).not.toBeNull();
    const token = created!.token;
    // Flip one character — the sha256 lookup must miss.
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
    expect(await validateSession(tampered)).toBeNull();
    expect(await validateSession("not-a-token-at-all")).toBeNull();
    expect(await validateSession("")).toBeNull();
  });

  it("revokes a single session and reports unknown credentials as not revoked", async () => {
    const created = await createSession("unit-key-revoke");
    expect(created).not.toBeNull();

    expect(await revokeSession(created!.token)).toBe(true);
    expect(await validateSession(created!.token)).toBeNull();
    // Already revoked — nothing to remove the second time.
    expect(await revokeSession(created!.token)).toBe(false);
    // A static key (or any non-token) is never a live session.
    expect(await revokeSession("unit-key-revoke")).toBe(false);
  });

  it("revokes every session of a key without touching other keys' sessions", async () => {
    const first = await createSession("unit-key-bulk");
    const second = await createSession("unit-key-bulk");
    const other = await createSession("unit-key-bulk-other");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(other).not.toBeNull();

    const count = await revokeSessionsForKey(keyFingerprint("unit-key-bulk"));
    expect(count).toBe(2);
    expect(await validateSession(first!.token)).toBeNull();
    expect(await validateSession(second!.token)).toBeNull();
    // The other key's session survives a targeted bulk revoke.
    expect(await validateSession(other!.token)).not.toBeNull();

    // Index drained — a second bulk revoke finds nothing.
    expect(await revokeSessionsForKey(keyFingerprint("unit-key-bulk"))).toBe(0);
  });

  it("refuses issuance in production without Redis (fail-closed)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.QTRUST_REDIS_URL;
    delete process.env.REDIS_URL;

    expect(await createSession("unit-key-prod")).toBeNull();
    // No store to validate against either — fail closed, not fail open.
    expect(await validateSession("any-token-under-the-sun")).toBeNull();
    expect(await revokeSession("any-token-under-the-sun")).toBe(false);
    expect(await revokeSessionsForKey(keyFingerprint("unit-key-prod"))).toBe(0);
  });
});

describe("operatorSessionTtlSeconds clamping", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to 3600 and clamps to [60, 86400]", async () => {
    const { operatorSessionTtlSeconds } = await import("../src/config.js");

    delete process.env.QTRUST_OPERATOR_SESSION_TTL_SECONDS;
    expect(operatorSessionTtlSeconds()).toBe(3600);

    process.env.QTRUST_OPERATOR_SESSION_TTL_SECONDS = "10";
    expect(operatorSessionTtlSeconds()).toBe(60); // floor

    process.env.QTRUST_OPERATOR_SESSION_TTL_SECONDS = "100000";
    expect(operatorSessionTtlSeconds()).toBe(86400); // ceiling

    process.env.QTRUST_OPERATOR_SESSION_TTL_SECONDS = "abc";
    expect(operatorSessionTtlSeconds()).toBe(3600); // garbage -> default
  });
});

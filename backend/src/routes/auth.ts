import type { FastifyInstance } from "fastify";
import { requireApiKey, requireStaticApiKey } from "../middleware/auth.js";
import {
  createSession,
  revokeSession,
  revokeSessionsForKey,
} from "../services/operator-sessions.js";

/**
 * Operator session lifecycle routes.
 *
 * POST /v1/auth/session exchanges a static API key for a short-lived session
 * token so long-lived bearer credentials can stay out of dashboards and
 * scripts. The gate is requireStaticApiKey, not requireApiKey: a stolen
 * session token must never be able to mint a fresh one, or revocation could
 * never catch up with an attacker. Rate limited 10/min like the relay routes
 * because minting is the only operation here an attacker can spend.
 */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/auth/session", {
    preHandler: requireStaticApiKey,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      tags: ["auth"],
      summary: "Mint a short-lived operator session token",
      description:
        "Exchanges a static API key (x-api-key) for a session token that expires after a sliding-window TTL. The token is accepted anywhere requireApiKey is used, but cannot mint further sessions. Production without Redis refuses issuance (503 session_unavailable); static keys keep working.",
    },
  }, async (request, reply) => {
    const provided = request.headers["x-api-key"];
    // Dev-open mode has no configured key to fingerprint; the pseudo-key
    // "dev" gives those sessions a stable identity. In every gated mode the
    // presented static key is fingerprinted (sha256 prefix — the raw key is
    // never persisted).
    const key = typeof provided === "string" && provided ? provided : "dev";
    const session = await createSession(key);
    if (!session) {
      // Production without a ready Redis. Mapped to a typed 503 (not 500) so
      // operators can distinguish "no sessions right now" from a bug; the
      // static key presented here continues to work on every other route.
      return reply.status(503).send({
        error: "Operator session issuance is unavailable — production requires Redis for session storage",
        code: "session_unavailable",
      });
    }
    return {
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      ttlSeconds: session.ttlSeconds,
    };
  });

  app.post("/v1/auth/session/revoke", {
    preHandler: requireApiKey,
    schema: {
      tags: ["auth"],
      summary: "Revoke the presented session token",
      description:
        "Revokes the session token presented in x-api-key (static keys and session tokens are both accepted by requireApiKey). Presenting a static key or an unknown token is a no-op returning { revoked: 0 }.",
    },
  }, async (request) => {
    // Deliberately revoke by the presented credential itself rather than by
    // request.operatorAuth: this works identically in dev-open mode (where
    // no operatorAuth is set) and costs one store miss for non-tokens.
    const provided = request.headers["x-api-key"];
    if (typeof provided === "string" && provided) {
      const revoked = await revokeSession(provided);
      return { revoked: revoked ? 1 : 0 };
    }
    return { revoked: 0 };
  });

  app.post("/v1/auth/session/revoke-all", {
    preHandler: requireStaticApiKey,
    schema: {
      tags: ["auth"],
      summary: "Revoke every session minted by the presented static key",
      description:
        "Requires a static API key (session tokens cannot mint sessions, and are likewise barred from bulk revocation) and revokes every live session issued under that key's fingerprint.",
    },
  }, async (request) => {
    // requireStaticApiKey set operatorAuth for a matched static key; in
    // dev-open mode (no keys configured) sessions minted without a header
    // share the "dev" identity.
    const fingerprint = request.operatorAuth?.keyFingerprint ?? "dev";
    const revoked = await revokeSessionsForKey(fingerprint);
    return { revoked };
  });
}

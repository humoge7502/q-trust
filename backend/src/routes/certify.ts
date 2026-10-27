import type { FastifyInstance } from "fastify";
import { isValidAddress } from "../config.js";
import { requireApiKey } from "../middleware/auth.js";
import {
  CertificationPolicyError,
  CertificationRefusedError,
  certificationIssuerIdentity,
  certificationPolicySummary,
  issueCertification,
  verifyCertificationBundle,
} from "../services/certification.js";

/**
 * Certification API.
 *
 * POST /v1/certify         — issue a signed, policy-gated assurance bundle (API key).
 * POST /v1/certify/verify  — verify a bundle, offline by default (public).
 * GET  /v1/certify/policies — list the admission policies (public).
 * GET  /v1/certify/issuer   — the DID + fingerprint the process signs with (public).
 */
export async function registerCertifyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/certify/policies", async () => ({
    policies: certificationPolicySummary(),
    schema: "qtrust.certification.v1",
  }));

  app.get("/v1/certify/issuer", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    try {
      return certificationIssuerIdentity();
    } catch (err) {
      // Production refuses to run without a valid issuer seed; that is a
      // deployment fault, not a caller error.
      request.log.error({ err }, "certification issuer identity unavailable");
      return reply.status(503).send({
        error: "Certification issuer identity unavailable — check QTRUST_VC_ISSUER_KEY",
        code: "issuer_unavailable",
      });
    }
  });

  app.post("/v1/certify", {
    preHandler: requireApiKey,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = request.body as {
      org?: string;
      policy?: string;
      validity_days?: number;
      evidence_limit?: number;
    };

    if (!body?.org || !isValidAddress(body.org)) {
      return reply.status(400).send({
        error: "org (0x-prefixed address) is required",
        code: "invalid_org",
      });
    }
    if (body.validity_days !== undefined && !Number.isInteger(body.validity_days)) {
      return reply.status(400).send({ error: "validity_days must be an integer", code: "invalid_validity" });
    }
    if (body.evidence_limit !== undefined && !Number.isInteger(body.evidence_limit)) {
      return reply.status(400).send({ error: "evidence_limit must be an integer", code: "invalid_evidence_limit" });
    }

    try {
      const bundle = await issueCertification({
        org: body.org as `0x${string}`,
        policy: body.policy,
        validity_days: body.validity_days,
        evidence_limit: body.evidence_limit,
      });
      return bundle;
    } catch (err) {
      if (err instanceof CertificationPolicyError) {
        return reply.status(400).send({ error: err.message, code: "invalid_policy" });
      }
      if (err instanceof CertificationRefusedError) {
        // 409: the request is well-formed, the evidence simply does not
        // support the claim. Refusals are never signed.
        return reply.status(409).send({
          error: err.message,
          code: "certification_refused",
          reasons: err.reasons,
          policy: err.policy,
        });
      }
      request.log.error({ err }, "certification issuance failed");
      return reply.status(503).send({
        error: "Certification evidence unavailable — check indexer/RPC connectivity",
        code: "evidence_unavailable",
      });
    }
  });

  app.post("/v1/certify/verify", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = request.body as {
      bundle?: unknown;
      check_chain?: boolean;
      trust_anchor_did?: unknown;
    };
    if (!body?.bundle || typeof body.bundle !== "object") {
      return reply.status(400).send({
        error: "bundle (object) is required",
        code: "invalid_bundle",
      });
    }
    if (
      body.trust_anchor_did !== undefined &&
      (typeof body.trust_anchor_did !== "string" || body.trust_anchor_did.length > 512)
    ) {
      return reply.status(400).send({
        error: "trust_anchor_did must be a DID string (max 512 chars)",
        code: "invalid_trust_anchor",
      });
    }
    const result = await verifyCertificationBundle(body.bundle, {
      check_chain: body.check_chain === true,
      ...(typeof body.trust_anchor_did === "string"
        ? { trust_anchor_did: body.trust_anchor_did }
        : {}),
    });
    return result;
  });
}

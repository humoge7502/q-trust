import type { FastifyInstance } from "fastify";
import { requireApiKey } from "../middleware/auth.js";
import {
  AssuranceInputError,
  AssuranceUnavailableError,
  MAX_ASSURANCE_FINDINGS,
  runAssurance,
} from "../services/assurance.js";

const OPS = new Set(["report", "agility", "crqc", "packs"]);

/**
 * POST /v1/assurance/report — crypto-agility grade, CRQC financial exposure
 * and sector-pack verdicts for one CBOM. API-key gated because each request
 * spawns a Python process.
 */
export async function registerAssuranceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/assurance/report", {
    preHandler: requireApiKey,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = request.body as {
      findings?: unknown;
      op?: string;
      pack?: unknown;
      top?: unknown;
      crqc?: unknown;
    };

    if (!Array.isArray(body?.findings)) {
      return reply.status(400).send({ error: "findings (array of AssetFinding) is required" });
    }
    if (body.findings.length > MAX_ASSURANCE_FINDINGS) {
      return reply.status(400).send({
        error: `too many findings (max ${MAX_ASSURANCE_FINDINGS})`,
      });
    }
    if (body.op !== undefined && !OPS.has(body.op)) {
      return reply.status(400).send({ error: "op must be report, agility, crqc or packs" });
    }
    if (body.pack !== undefined && typeof body.pack !== "string") {
      return reply.status(400).send({ error: "pack must be a string" });
    }
    if (body.top !== undefined && (!Number.isInteger(body.top) || (body.top as number) < 1 || (body.top as number) > 50)) {
      return reply.status(400).send({ error: "top must be an integer in [1, 50]" });
    }
    if (body.crqc !== undefined && (typeof body.crqc !== "object" || body.crqc === null || Array.isArray(body.crqc))) {
      return reply.status(400).send({ error: "crqc must be an object of assumption overrides" });
    }

    try {
      return await runAssurance({
        op: (body.op as "report" | "agility" | "crqc" | "packs" | undefined) ?? "report",
        findings: body.findings,
        pack: body.pack as string | undefined,
        top: body.top as number | undefined,
        crqc: body.crqc as Record<string, unknown> | undefined,
      });
    } catch (err) {
      if (err instanceof AssuranceInputError) {
        return reply.status(422).send({ error: err.message, code: "invalid_findings" });
      }
      request.log.error({ err }, "assurance bridge failed");
      return reply.status(503).send({
        error: "Assurance engine unavailable — check the inspector bridge configuration",
        code: "assurance_unavailable",
      });
    }
  });
}

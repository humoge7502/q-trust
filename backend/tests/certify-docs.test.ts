import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { parse } from "yaml";

// The route module pulls in the certification service, which pulls in config
// (pool, RPC client). Only the route *table* matters here, so the service is
// stubbed exactly as the behaviour test for these routes does.
vi.mock("../src/services/certification.js", () => ({
  CertificationPolicyError: class extends Error {},
  CertificationRefusedError: class extends Error {},
  issueCertification: vi.fn(),
  verifyCertificationBundle: vi.fn(),
  certificationPolicySummary: vi.fn(() => []),
  certificationIssuerIdentity: vi.fn(() => ({})),
}));

/**
 * The hand-maintained `openapi.yaml` is what SDK authors and integration tests
 * read; Fastify's own `/docs` output is generated from route schemas. Two
 * documents describing one API drift silently unless something compares them —
 * which is exactly how a newly added route ends up undocumented and a removed
 * one stays published.
 *
 * Scoped to the certification routes because those are the ones whose contract
 * is load-bearing for verification decisions; the rest of the API is covered by
 * its own route tests.
 */
const specPath = fileURLToPath(new URL("../openapi.yaml", import.meta.url));
const spec = parse(readFileSync(specPath, "utf8")) as {
  paths: Record<string, Record<string, { operationId?: string }>>;
  components: { schemas: Record<string, unknown> };
};

/** Fastify spells params `:name`; OpenAPI spells them `{name}`. */
function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

async function certifyRoutes(): Promise<string[]> {
  const app: FastifyInstance = Fastify({ logger: false });
  const registered: string[] = [];
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      // OPTIONS and the implicit HEAD of every GET are transport detail; an
      // OpenAPI document describes the operations callers use.
      if (method === "OPTIONS" || method === "HEAD") continue;
      registered.push(`${method} ${toOpenApiPath(route.url)}`);
    }
  });
  const { registerCertifyRoutes } = await import("../src/routes/certify.js");
  await registerCertifyRoutes(app);
  await app.ready();
  await app.close();
  return registered;
}

describe("openapi coverage of the certification API", () => {
  it("documents exactly the routes the certification plugin registers", async () => {
    const live = await certifyRoutes();
    expect(live).toContain("GET /v1/certify/issuer");

    const documented = Object.entries(spec.paths)
      .filter(([path]) => path.startsWith("/v1/certify"))
      .flatMap(([path, ops]) => Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`));

    // One assertion in both directions: an undocumented route is a broken
    // integration, and a documented route that no longer exists is worse,
    // because callers will build against it.
    expect([...documented].sort()).toEqual([...live].sort());
  });

  it("gives every operation a unique operationId", () => {
    const seen = new Map<string, string>();
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (!op?.operationId) continue;
        const key = `${method.toUpperCase()} ${path}`;
        expect(seen.has(op.operationId), `${key} reuses operationId ${op.operationId}`).toBe(false);
        seen.set(op.operationId, key);
      }
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it("resolves every component $ref", () => {
    const components = spec.components as unknown as Record<string, Record<string, unknown>>;
    const collected: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          if (key === "$ref" && typeof value === "string") collected.push(value);
          else walk(value);
        }
      }
    };
    walk(spec);
    expect(collected.length).toBeGreaterThan(50);
    for (const ref of collected) {
      const match = /^#\/components\/(\w+)\/([\w.-]+)$/.exec(ref);
      expect(match, `unparseable $ref ${ref}`).not.toBeNull();
      const [, section, name] = match!;
      expect(components[section], `$ref ${ref} names an unknown section`).toBeDefined();
      expect(components[section][name], `$ref ${ref} points at nothing`).toBeDefined();
    }
  });
});

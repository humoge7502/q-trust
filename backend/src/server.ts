
import fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { Redis } from "ioredis";
import { startIndexer, stopIndexer, pool as pgPool } from "./services/indexer.js";
import { fetchWithRetry } from "./services/upstream.js";
import { registerScannerRoutes } from "./routes/scanner.js";
import { registerRelayRoutes } from "./routes/relay.js";
import { registerGPURoutes } from "./services/gpu-service.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerReadRoutes } from "./routes/read.js";
import { registerWriteRoutes } from "./routes/write.js";
import { registerCertifyRoutes } from "./routes/certify.js";
import { registerAssuranceRoutes } from "./routes/assurance.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { gracefulShutdown, requireApiKey } from "./middleware/auth.js";
import { initSentry, registerSentryHooks } from "./plugins/sentry.js";
import { registerMetrics } from "./plugins/metrics.js";
import { CORS_ORIGINS, CONTRACTS, allContractsConfigured } from "./config.js";

dotenv.config({ quiet: true });
initSentry();

function readPackageVersion(): string {
  try {
    return (JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string }).version;
  } catch {
    // Serverless bundles may not trace package.json; the version is only used
    // for API metadata, so a missing file must not take the process down.
    return process.env.QTRUST_VERSION ?? "0.0.0";
  }
}

const PACKAGE_VERSION: string = readPackageVersion();

/**
 * Serverless hosts (Vercel) set VERCEL=1. In that mode the module only builds
 * the Fastify app; it never binds a port or starts the background indexer.
 * The same applies when QTRUST_SERVERLESS=1 is set explicitly.
 */
const IS_SERVERLESS = Boolean(process.env.VERCEL) || process.env.QTRUST_SERVERLESS === "1";

let redisClient: Redis | null = null;
let processHandlersInstalled = false;

/**
 * Build (but do not start) the Q-Trust API.
 *
 * Extracted from the previous top-level script so serverless entrypoints can
 * reuse the exact same plugin/route graph. Standalone `node dist/server.js`
 * still builds and starts the HTTP listener plus the on-chain indexer.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const server = fastify({ logger: true, bodyLimit: 1 * 1024 * 1024 }).withTypeProvider<TypeBoxTypeProvider>();

  if (!processHandlersInstalled) {
    processHandlersInstalled = true;
    process.on("unhandledRejection", (reason) => {
      server.log.error({ err: reason }, "Unhandled promise rejection — keeping process alive");
    });
    // A serverless instance must survive handler-scoped rejections; exiting
    // would turn a transient error into a cold-start outage. Standalone keeps
    // the original fail-fast behaviour.
    if (!IS_SERVERLESS) {
      process.on("uncaughtException", (err) => {
        server.log.error({ err }, "Uncaught exception — exiting");
        process.exit(1);
      });
    }
  }

  const redisUrl = process.env.QTRUST_REDIS_URL ?? process.env.REDIS_URL;
  let redis: Redis | null = null;
  if (redisUrl) {
    try {
      redis = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 2_000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
      });
      // ioredis emits connection errors asynchronously; always attach a
      // listener so a transient Redis outage cannot become an uncaught error.
      redis.on("error", (err) => {
        server.log.warn({ err }, "Redis unavailable");
      });
      redis.connect().catch(() => {
        server.log.warn("Redis unavailable at startup; Redis-backed features will retry on demand");
      });
    } catch (err) {
      server.log.warn({ err }, "Redis client initialization failed");
      redis = null;
    }
  }
  redisClient = redis;

  // REG-14: API returns JSON, not HTML — CSP false is intentional for /docs Swagger UI.
  // Frontend (Next.js) enforces strict CSP via next.config.js (QTRUST-014).
  await server.register(helmet, { contentSecurityPolicy: false, hsts: { maxAge: 15552000 } });
  server.register(cors, { origin: CORS_ORIGINS.includes("*") ? true : CORS_ORIGINS, methods: ["GET", "POST", "OPTIONS"] });

  const rateLimitOptions = {
    max: Number(process.env.QTRUST_RATE_LIMIT_MAX) || 120,
    timeWindow: "1 minute",
    // Per-route buckets. The default key is the caller IP only, which made
    // every request from the shared tunnel count against the lowest route
    // limit (scan was 30/min): ordinary page reads and health checks could
    // exhaust the scan budget and trigger 429 storms through the tunnel.
    keyGenerator: (request: { ip: string; url: string }) =>
      `${request.ip}:${request.url.split("?")[0] ?? request.url}`,
    // Redis is shared across API replicas when explicitly configured. In
    // production a Redis storage error rejects the request rather than silently
    // disabling abuse protection; local development remains available during a
    // laptop Redis outage.
    ...(redis ? {
      redis,
      skipOnError: process.env.NODE_ENV !== "production",
    } : {}),
  };
  if (process.env.QTRUST_RATE_LIMIT_MAX === "0") {
    server.register(rateLimit, { global: false });
  } else {
    server.register(rateLimit, rateLimitOptions);
  }

  registerSentryHooks(server);
  registerMetrics(server);

  await server.register(swagger, {
    openapi: { info: { title: "Q-Trust API", version: PACKAGE_VERSION, description: "Q-Trust supply-chain verification API." }, servers: [{ url: process.env.QTRUST_PUBLIC_URL ?? "http://localhost:3001" }] },
  });
  await server.register(swaggerUi, { routePrefix: "/docs" });

  // REG-18: /docs (Swagger UI) and the raw OpenAPI JSON map the whole API
  // surface for anyone — in production they are gated behind the same API-key
  // middleware. Set QTRUST_DOCS_PUBLIC=true to publish the reference instead
  // (the frontend header links to it); local dev stays open either way.
  const docsPublic = process.env.QTRUST_DOCS_PUBLIC === "true";
  if (process.env.NODE_ENV === "production" && !docsPublic) {
    server.addHook("onRequest", async (request, reply) => {
      const url = request.url.split("?")[0];
      if (url === "/docs" || url.startsWith("/docs/") || url === "/documentation" || url.startsWith("/documentation/")) {
        const verdict = await requireApiKey(request, reply);
        if (verdict !== undefined) return reply;
      }
    });
  }

  // Hosted deployments keep the Python inspector and the ML model server on
  // the operator machine. When QTRUST_SCANNER_PROXY_URL is set, the scanner
  // and GPU routes are transparently forwarded there (the caller's API key is
  // preserved so the upstream enforces the same policy). The evidence ledger
  // is NOT proxied: it lives in Postgres and runs in-process on every
  // instance, so a ledger created anywhere verifies everywhere.
  //
  // Guard: only proxy from a hosted runtime. The local Docker API shares the
  // same .env (which carries the public tunnel URL for the Vercel deploy), so
  // without this check the local API would forward /v1/scan/* to its own
  // public tunnel and loop back into itself until the rate limiter stops it.
  const isHostedRuntime =
    process.env.QTRUST_SERVERLESS === "1" || Boolean(process.env.VERCEL);
  const scannerProxy = isHostedRuntime
    ? (process.env.QTRUST_SCANNER_PROXY_URL ?? "").replace(/\/$/, "")
    : "";
  if (scannerProxy) {
    server.addHook("preHandler", async (request, reply) => {
      const path = request.url.split("?")[0] ?? "";
      // Repository ingestion is served by the hosted scanner service (or the
      // local archive fallback), never by the operator tunnel.
      if (path === "/v1/scan/repo") {
        return;
      }
      if (
        !path.startsWith("/v1/scan/") &&
        !path.startsWith("/v1/gpu/")
      ) {
        return;
      }
      try {
        const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
        const key = request.headers["x-api-key"];
        if (typeof key === "string" && key) headers["x-api-key"] = key;
        const upstream = await fetchWithRetry(`${scannerProxy}${request.url}`, {
          method: request.method,
          headers,
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
        }, {
          attempts: 3,
          timeoutMs: 45_000,
          onRetry: ({ attempt, status }) =>
            server.log.warn({ attempt, status, path }, "Scanner proxy retrying after tunnel failure"),
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        const upstreamType = upstream.headers.get("content-type") ?? "";
        // A dead quick tunnel answers 502/530 with a Cloudflare HTML page. Pass
        // that through and the browser renders "Error 1033" inside the scanner;
        // report a typed outage instead so the UI can show a retry state.
        const tunnelDown =
          (upstream.status >= 520 && upstream.status <= 530) ||
          upstream.status === 502 || upstream.status === 503 || upstream.status === 504 ||
          (upstream.status !== 200 && upstreamType.includes("text/html"));
        if (tunnelDown) {
          server.log.warn({ status: upstream.status, type: upstreamType }, "Scanner proxy upstream unavailable");
          return reply.code(503).send({
            error: "Local compute bridge is offline — the scanner and GPU routes run on the operator machine and its tunnel is not reachable right now.",
            code: "scanner_unavailable",
            upstream_status: upstream.status,
          });
        }
        reply
          .code(upstream.status)
          .header("content-type", upstreamType || "application/json")
          .send(body);
        return reply;
      } catch (err) {
        server.log.warn({ err }, "Scanner proxy unavailable");
        return reply.code(503).send({ error: "Scanner backend unavailable", code: "scanner_unavailable" });
      }
    });
  }

  // Route plugins — each is a Fastify plugin with its own schemas and per-route limits.
  await registerHealthRoutes(server);
  await registerReadRoutes(server);
  await registerWriteRoutes(server);
  await registerCertifyRoutes(server);
  await registerAssuranceRoutes(server);
  await registerRelayRoutes(server);
  registerScannerRoutes(server);
  await server.register(registerGPURoutes);
  await registerWebhookRoutes(server, redis);

  return server;
}

const isStandalone = !IS_SERVERLESS && process.env.QTRUST_STANDALONE !== "0";

if (isStandalone) {
  const start = async () => {
    const server = await buildServer();
    try {
      if (process.env.NODE_ENV === "production" && !process.env.QTRUST_SCAN_ALLOWED_ROOTS) {
        server.log.error("Refusing to start: QTRUST_SCAN_ALLOWED_ROOTS is required in production");
        process.exit(1);
      }
      await startIndexer();
      if (!allContractsConfigured()) {
        server.log.warn(
          "Contract addresses are NOT configured (0x0). On-chain read/write and the indexer are DISABLED — scans/plans still work against local data. Run deploy-contracts.ps1 or set the QTRUST_*_ADDRESS env vars to enable on-chain features."
        );
      }
      await server.listen({ port: Number(process.env.PORT) || 3001, host: "0.0.0.0" });
      console.log(`Server listening on ${JSON.stringify(server.server.address())}`);
      gracefulShutdown(server, "SIGTERM", async () => {
        stopIndexer();
        if (redisClient) { try { await redisClient.quit(); } catch {} }
        if (pgPool) { await pgPool.end(); }
      });
    } catch (err) { server.log.error(err); process.exit(1); }
  };
  await start();
}

// The Vercel project carries the Fastify framework preset, whose lambda wraps
// this module and requires a default function/server export (it receives no
// traffic — routes send /api/* to api/index.mjs — but an invalid export fails
// the whole deployment at boot). Under serverless the IS_SERVERLESS guard
// above keeps this module from ever binding a port.
export default buildServer;

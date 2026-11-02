import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { requireApiKey } from "../middleware/auth.js";
import { RepoScanError, scanGithubRepo } from "../services/repo-scan.js";
import {
  computeIntegrityHash,
  evidenceStore,
  verifyChain,
  type LedgerEntry,
} from "../services/evidence-store.js";
import {
  appendScanHistory,
  hashScanTarget,
  scanHistoryStore,
  type ScanHistoryEntry,
} from "../services/scan-history-store.js";
import {
  ScanRequestSchema,
  ScanFullRequestSchema,
  ScanRepoRequestSchema,
  ScanRepoResponseSchema,
  ScanResponseSchema,
  ErrorResponseSchema,
  RiskScoreSchema,
  ScoredFindingsResponseSchema,
  ComplianceEvaluateSchema,
  ComplianceEvaluateResponseSchema,
  EvidenceCreateSchema,
  EvidenceCreateResponseSchema,
  EvidenceVerifySchema,
} from "../schemas/index.js";

const scanResponseSchemas = {
  200: ScanResponseSchema,
  400: ErrorResponseSchema,
  403: ErrorResponseSchema,
  503: ErrorResponseSchema,
};

const execFileAsync = promisify(execFile);

const INSPECTOR_SCRIPT = fileURLToPath(new URL("../../scripts/run_inspector.py", import.meta.url));

/**
 * Execute the real Python inspector and parse its JSON output.
 * Fails loudly (throws) — callers must NEVER substitute fabricated findings.
 */
async function runInspector(args: string[]): Promise<any> {
  const pythonBin = process.env.QTRUST_INSPECTOR_PYTHON || "python3";
  const script = process.env.QTRUST_INSPECTOR_SCRIPT || INSPECTOR_SCRIPT;
  const { stdout } = await execFileAsync(pythonBin, [script, ...args], {
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** Validate a scan directory against SSRF/path-traversal abuse. Throws on invalid input. */
export async function validateScanDirectory(rawDir: string): Promise<string> {
  if (!path.isAbsolute(rawDir)) {
    throw Object.assign(new Error("directory must be an absolute path"), { statusCode: 400 });
  }
  const allowedRootsRaw = process.env.QTRUST_SCAN_ALLOWED_ROOTS;
  if (!allowedRootsRaw && process.env.NODE_ENV === "production") {
    // Fail closed: in production an unset allowlist would let any caller scan
    // arbitrary absolute paths on this host.
    throw Object.assign(
      new Error("QTRUST_SCAN_ALLOWED_ROOTS must be configured in production"),
      { statusCode: 503 },
    );
  }

  // String-level normalization only — no filesystem call touches the
  // caller-supplied path until it has passed the allowed-roots guard below.
  const normalized = path.resolve(rawDir);
  /** CodeQL-recognized containment guard: the canonical path.relative idiom. */
  const isInsideRoot = (candidate: string, root: string): boolean => {
    const rel = path.relative(root, candidate);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  let roots: string[] = [];
  if (allowedRootsRaw) {
    roots = await Promise.all(
      allowedRootsRaw
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
        .map(async (root) => {
          if (!path.isAbsolute(root)) {
            throw Object.assign(
              new Error("QTRUST_SCAN_ALLOWED_ROOTS must contain only absolute paths"),
              { statusCode: 503 },
            );
          }
          try {
            const rootPath = await fsp.realpath(path.resolve(root));
            const rootStat = await fsp.stat(rootPath);
            if (!rootStat.isDirectory()) throw new Error("not a directory");
            return rootPath;
          } catch {
            throw Object.assign(
              new Error("QTRUST_SCAN_ALLOWED_ROOTS contains a missing or invalid directory"),
              { statusCode: 503 },
            );
          }
        }),
    );
    if (!roots.some((root) => isInsideRoot(normalized, root))) {
      throw Object.assign(
        new Error("directory is outside the configured scan roots"),
        { statusCode: 403 },
      );
    }
  }

  // The path is inside an allowed root: now resolve symlinks/.. segments and
  // re-check, so a symlink inside an allowed root cannot point outside it.
  let resolved: string;
  try {
    resolved = await fsp.realpath(normalized);
  } catch {
    throw Object.assign(new Error("directory does not exist"), { statusCode: 400 });
  }
  const stat = await fsp.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    throw Object.assign(new Error("path is not a directory"), { statusCode: 400 });
  }
  if (roots.length > 0 && !roots.some((root) => isInsideRoot(resolved, root))) {
    throw Object.assign(
      new Error("directory is outside the configured scan roots"),
      { statusCode: 403 },
    );
  }
  return resolved;
}

// P2-12: single canonical risk scoring — mirrors inspector/qtrust_inspector/risk_engine.py
// and qtrust_common/heuristics.py so that parallel_scanner, risk_engine, and
// scanner.ts no longer diverge (RSA-2048 scored 74 vs 90 before unification).

const ALGORITHM_VULNERABILITY_DB: Record<string, string> = {
  RSA: "BROKEN", "RSA-1024": "BROKEN", "RSA-2048": "BROKEN", "RSA-4096": "BROKEN",
  ECDSA: "BROKEN", "ECDSA-P256": "BROKEN", "ECDSA-P384": "BROKEN", "ECDSA-P521": "BROKEN",
  ECDH: "BROKEN", "ECDH-P256": "BROKEN", "ECDH-P384": "BROKEN", "ECDH-P521": "BROKEN",
  DSA: "BROKEN", Ed25519: "BROKEN", Ed448: "BROKEN", DH: "BROKEN", "DH-2048": "BROKEN", "DH-4096": "BROKEN",
  X25519: "BROKEN", X448: "BROKEN",
  "AES-128": "WEAKENED", "3DES": "WEAKENED", DES: "WEAKENED", "HMAC-MD5": "WEAKENED",
  "AES-256": "SAFE", "AES-192": "SAFE", "ChaCha20-Poly1305": "SAFE", "SHA-256": "SAFE", "SHA-384": "SAFE", "SHA-512": "SAFE",
  "SHA3-256": "SAFE", "SHA3-384": "SAFE", "SHA3-512": "SAFE", "HMAC-SHA256": "SAFE", "HMAC-SHA384": "SAFE", "HMAC-SHA512": "SAFE",
  "ML-KEM-512": "PQC_READY", "ML-KEM-768": "PQC_READY", "ML-KEM-1024": "PQC_READY",
  "ML-DSA-44": "PQC_READY", "ML-DSA-65": "PQC_READY", "ML-DSA-87": "PQC_READY",
  "SLH-DSA-SHA2-128s": "PQC_READY", "SLH-DSA-SHA2-128f": "PQC_READY", "SLH-DSA-SHA2-192s": "PQC_READY", "SLH-DSA-SHA2-192f": "PQC_READY",
  "SLH-DSA-SHA2-256s": "PQC_READY", "SLH-DSA-SHA2-256f": "PQC_READY",
  "HQC-128": "PQC_READY", "HQC-192": "PQC_READY", "HQC-256": "PQC_READY",
  "FALCON-512": "PQC_READY", "FALCON-1024": "PQC_READY",
};

const NIST_800_131A_DEPRECATION: Record<string, number> = {
  "RSA-1024": 2030, "RSA-2048": 2030, "ECDSA-P256": 2030, "ECDSA-P384": 2030, "SHA-1": 2030, "3DES": 2030, DES: 2030, RC4: 2030,
  RSA: 2035, "RSA-4096": 2035, ECDSA: 2035, "ECDSA-P521": 2035, DSA: 2035,
};
const CNSA2_ALLOWED = new Set(["ML-KEM-1024","ML-DSA-87","SLH-DSA-SHA2-256s","AES-256","SHA-384","SHA-512","SHA3-384","SHA3-512","HMAC-SHA384","HMAC-SHA512"]);
const _CNSA2_ALLOWED_UPPER = new Set([...CNSA2_ALLOWED].map(s => s.toUpperCase()));
const _ASYMMETRIC_MARKERS = ["RSA","ECDSA","ECDH","ED25519","ED448","X25519","X448","DSA","DH"] as const;
const _SYMMETRIC_MARKERS = ["AES","CHACHA20"] as const;

function _normalizeAlg(n: string): string { return n.toUpperCase().replace(/ /g,"").replace(/_/g,"-"); }
function _isAsymmetric(u: string): boolean { return _ASYMMETRIC_MARKERS.some(m => u.includes(m)); }
function _lookupVuln(algorithm: string, keySize?: number | null): string {
  const up = _normalizeAlg(algorithm);
  let vuln = ALGORITHM_VULNERABILITY_DB[up];
  if (!vuln) {
    vuln = "BROKEN";
    for (const [k,v] of Object.entries(ALGORITHM_VULNERABILITY_DB)) {
      const nk = _normalizeAlg(k);
      if (nk.includes(up) || up.includes(nk)) { vuln = v; break; }
    }
  }
  if (_isAsymmetric(up)) return vuln;
  if (keySize != null && _SYMMETRIC_MARKERS.some(m => up.includes(m))) {
    return keySize < 256 ? "WEAKENED" : "SAFE";
  }
  return vuln;
}
function _checkNIST(algorithm: string, keySize?: number | null): [boolean, number | null] {
  const up = algorithm.toUpperCase().replace(/ /g,"");
  const now = new Date().getFullYear();
  if (up in NIST_800_131A_DEPRECATION) {
    const d = NIST_800_131A_DEPRECATION[up];
    return [now < d, d];
  }
  if (keySize != null) {
    if (up.includes("RSA") && keySize < 2048) return [now < 2030, 2030];
    if (up.includes("ECDSA") && keySize < 384) return [now < 2030, 2030];
  }
  return [true, null];
}
function _checkCNSA(algorithm: string): boolean { return _CNSA2_ALLOWED_UPPER.has(_normalizeAlg(algorithm)); }
function _hndlScore(vuln: string, sensitivity = 3, lifetimeYears = 2, exposureYears = 0): number {
  const w: Record<string, number> = { BROKEN:5, WEAKENED:3, SAFE:0, PQC_READY:0 };
  const v = w[vuln] ?? 0;
  const s = Math.max(0, Math.min(5, sensitivity));
  const l = Math.max(0, Math.min(5, lifetimeYears));
  const e = Math.max(0, exposureYears);
  return Math.min(100, v*s*l*(1+e/10)*(100/125));
}
function classifyRisk(score: number): string {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  if (score > 0) return "LOW";
  return "NONE";
}
const LIBRARY_ALGORITHMS = new Set([
  "HAZMAT", "OPENSSL", "BORINGSSL", "LIBGCRYPT", "LIBOQS", "WOLFSSL",
  "CRYPTOGRAPHY", "CRYPTO", "NODEFORGE", "NODE-FORGE", "PYOPENSSL",
]);
const PROTOCOL_ALGORITHMS = new Set(["TLS", "JWT", "SSH"]);

/**
 * Not every finding's `algorithm` is an algorithm.
 *
 * The scanner emits library names (hazmat, OpenSSL, liboqs) and protocol
 * markers (TLS, JWT) alongside real algorithms. Scoring those through
 * ALGORITHM_VULNERABILITY_DB used to fall through to BROKEN/84 for every
 * unknown name — a scan of a healthy estate reported fifteen criticals,
 * including liboqs (a post-quantum library) and BoringSSL (ships ML-KEM).
 *
 * This branch keeps the score honest:
 *   - library with supports_pqc=true   -> PQC_READY / 6  / LOW
 *   - library with supports_pqc=false  -> WEAKENED  / 62 / HIGH
 *   - library with no capability flag  -> INVENTORY / 18 / LOW
 *   - dependency inventory             -> INVENTORY / 30 / MEDIUM
 *   - TLS / JWT / SSH                  -> DEPENDENCY / 45 / MEDIUM
 *
 * `riskLevel` (not the classification string) drives the roadmap buckets, so
 * the new labels are additive and do not change phase assignment.
 */
function _classifyNonAlgorithm(finding: any): Record<string, unknown> | null {
  const algorithm = finding.algorithm || finding.name || "unknown";
  const up = _normalizeAlg(algorithm);
  const meta = finding.metadata ?? {};
  const assetType = String(finding.asset_type ?? "");

  if (assetType === "dependency_crypto_library") {
    const score = meta.supports_pqc === true ? 8 : 30;
    return _inventory(finding, algorithm, score,
      meta.supports_pqc === true
        ? `${algorithm} dependency ships post-quantum algorithms`
        : `${algorithm} dependency — inventory only, inherited from the manifest`,
      meta.supports_pqc === true ? "PQC_READY" : "INVENTORY");
  }

  const isLibrary =
    LIBRARY_ALGORITHMS.has(up) ||
    assetType === "binary_crypto_artifact" ||
    Boolean(meta.library);
  if (isLibrary) {
    if (meta.supports_pqc === true) {
      return _inventory(finding, algorithm, 6,
        `${meta.library ?? algorithm} ships post-quantum algorithms (ML-KEM / ML-DSA)`, "PQC_READY");
    }
    if (meta.supports_pqc === false) {
      return _inventory(finding, algorithm, 62,
        `${meta.library ?? algorithm} is classical-only: no ML-KEM or ML-DSA support`, "WEAKENED");
    }
    return _inventory(finding, algorithm, 18,
      `Crypto library inventory — resolve to the algorithms it provides`, "INVENTORY");
  }

  if (PROTOCOL_ALGORITHMS.has(up)) {
    return _inventory(finding, algorithm, 45,
      `${algorithm} usage — inherits the negotiated cipher suite`, "DEPENDENCY");
  }
  return null;
}

function _inventory(
  finding: any, algorithm: string, score: number, message: string, classification: string,
): Record<string, unknown> {
  return {
    ...finding,
    algorithm,
    algorithmClassification: classification,
    quantumVulnerability: classification,
    nist800131aCompliant: classification === "PQC_READY",
    cnsa2Compliant: classification === "PQC_READY",
    hndlExposureScore: 0,
    riskScore: score,
    overallRiskScore: score,
    riskLevel: classifyRisk(score),
    message,
  };
}

function computeRiskFinding(finding: any) {
  const inventory = _classifyNonAlgorithm(finding);
  if (inventory) return inventory;
  const algorithm = finding.algorithm || finding.name || "unknown";
  const keySize = finding.key_size ?? finding.keySize ?? null;
  const vuln = _lookupVuln(algorithm, keySize);
  const [nistCompliant] = _checkNIST(algorithm, keySize);
  const cnsaCompliant = _checkCNSA(algorithm);
  // Exposure years from first_seen if present
  let exposureYears = 0;
  if (finding.first_seen) {
    try { exposureYears = (Date.now() - new Date(finding.first_seen).getTime())/ (365.25*864e5); } catch {}
  }
  const hndl = _hndlScore(vuln, 3, 2, exposureYears);
  const penalties: Record<string, number> = { BROKEN:50, WEAKENED:25, SAFE:5, PQC_READY:0 };
  let penalty = penalties[vuln] ?? 5;
  if (!nistCompliant) penalty += 15;
  if (!cnsaCompliant) penalty += 10;
  const overall = Math.min(100, Math.round((hndl + penalty)*100)/100);
  const level = classifyRisk(overall);
  // Preserve backward-compatible fields plus new detailed ones
  return {
    ...finding,
    algorithmClassification: vuln,
    quantumVulnerability: vuln,
    nist800131aCompliant: nistCompliant,
    cnsa2Compliant: cnsaCompliant,
    hndlExposureScore: Math.round(hndl*100)/100,
    riskScore: overall,
    overallRiskScore: overall,
    riskLevel: level,
  };
}

function evaluateNISTCompliance(finding: any): { compliant: boolean; reason: string } {
  const [compliant, deadline] = _checkNIST(finding.algorithm || "", finding.key_size ?? finding.keySize ?? null);
  if (!compliant) return { compliant:false, reason: `${finding.algorithm} is below NIST SP 800-131A deadline ${deadline}` };
  return { compliant:true, reason: "Algorithm is acceptable under NIST guidelines" };
}
function evaluateCNSACompliance(finding: any): { compliant: boolean; reason: string } {
  const alg = finding.algorithm || "";
  if (_checkCNSA(alg)) return { compliant:true, reason: `${alg} is CNSA approved` };
  return { compliant:false, reason: `${alg} is not on the CNSA approved list` };
}

/** A failed history write must never fail the scan that produced it. */
async function recordScan(log: FastifyBaseLogger, entry: ScanHistoryEntry): Promise<void> {
  try {
    await appendScanHistory(entry);
  } catch (err) {
    log.warn({ err }, "scan history append failed");
  }
}

/** Return a stable label without disclosing the host filesystem layout. */
function publicScanTarget(resolvedPath: string): string {
  return `scan-${hashScanTarget(resolvedPath)}`;
}

export async function registerScannerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/health", async () => {
    return { status: "ok", version: "1.0.0", services: { scanner: true, risk: true, compliance: true } };
  });

  app.post("/v1/scan/source", {
    preHandler: requireApiKey,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { body: ScanRequestSchema, response: scanResponseSchemas },
  }, async (request, reply) => {
    const { directory } = request.body as { directory: string };
    let resolvedDir: string;
    try {
      resolvedDir = await validateScanDirectory(directory);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      reply.code(statusCode === 403 || statusCode === 503 ? statusCode : 400);
      return { error: (err as Error).message };
    }
    let result: { findings?: any[]; error?: string };
    try {
      result = await runInspector(["--scan-type", "source", "--path", resolvedDir]);
    } catch (err) {
      // REG-15: internal inspector stderr/raw error strings are logged, but
      // never returned to the caller — only a generic 503.
      request.log.error(err, "Inspector scan failed");
      reply.code(503);
      return { error: "Cryptographic scanner unavailable or failed" };
    }
    if (result?.error) {
      reply.code(503);
      return { error: "Cryptographic scanner failed" };
    }
    const findings = Array.isArray(result.findings) ? result.findings : [];
    const timestamp = new Date().toISOString();
    await recordScan(request.log, { targetHash: hashScanTarget(resolvedDir), type: "source", timestamp, count: findings.length });
    return { directory: publicScanTarget(resolvedDir), findings, scanType: "source", timestamp };
  });

  app.post("/v1/scan/manifests", {
    preHandler: requireApiKey,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { body: ScanRequestSchema, response: scanResponseSchemas },
  }, async (request, reply) => {
    const { directory } = request.body as { directory: string };
    let resolvedDir: string;
    try {
      resolvedDir = await validateScanDirectory(directory);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      reply.code(statusCode === 403 || statusCode === 503 ? statusCode : 400);
      return { error: (err as Error).message };
    }
    let result: { findings?: any[]; error?: string };
    try {
      result = await runInspector(["--scan-type", "manifests", "--path", resolvedDir]);
    } catch (err) {
      // REG-15: internal inspector stderr/raw error strings are logged, but
      // never returned to the caller — only a generic 503.
      request.log.error(err, "Inspector scan failed");
      reply.code(503);
      return { error: "Cryptographic scanner unavailable or failed" };
    }
    if (result?.error) {
      reply.code(503);
      return { error: "Cryptographic scanner failed" };
    }
    const findings = Array.isArray(result.findings) ? result.findings : [];
    const timestamp = new Date().toISOString();
    await recordScan(request.log, { targetHash: hashScanTarget(resolvedDir), type: "manifests", timestamp, count: findings.length });
    return { directory: publicScanTarget(resolvedDir), findings, scanType: "manifests", timestamp };
  });

  app.post("/v1/scan/full", {
    preHandler: requireApiKey,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { body: ScanFullRequestSchema, response: scanResponseSchemas },
  }, async (request, reply) => {
    const { target, includeSource = true, includeManifests = true } = request.body as {
      target: string;
      includeSource?: boolean;
      includeManifests?: boolean;
    };
    if (!includeSource && !includeManifests) {
      reply.code(400);
      return { error: "at least one of includeSource or includeManifests must be true" };
    }
    let resolvedTarget: string;
    try {
      resolvedTarget = await validateScanDirectory(target);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      reply.code(statusCode === 403 || statusCode === 503 ? statusCode : 400);
      return { error: (err as Error).message };
    }
    const scanType =
      includeSource && includeManifests ? "full" : includeSource ? "source" : "manifests";
    let result: { findings?: any[]; error?: string };
    try {
      result = await runInspector(["--scan-type", scanType, "--path", resolvedTarget]);
    } catch (err) {
      // REG-15: internal inspector stderr/raw error strings are logged, but
      // never returned to the caller — only a generic 503.
      request.log.error(err, "Inspector scan failed");
      reply.code(503);
      return { error: "Cryptographic scanner unavailable or failed" };
    }
    if (result?.error) {
      reply.code(503);
      return { error: "Cryptographic scanner failed" };
    }
    const allFindings = Array.isArray(result.findings) ? result.findings : [];
    const timestamp = new Date().toISOString();
    await recordScan(request.log, { targetHash: hashScanTarget(resolvedTarget), type: "full", timestamp, count: allFindings.length });
    return { target: publicScanTarget(resolvedTarget), findings: allFindings, scanType: "full", timestamp };
  });

  app.post("/v1/scan/repo", {
    preHandler: requireApiKey,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      body: ScanRepoRequestSchema,
      response: {
        200: ScanRepoResponseSchema,
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
        413: ErrorResponseSchema,
        422: ErrorResponseSchema,
        502: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { repo, ref, scanType = "full" } = request.body as {
      repo: string;
      ref?: string;
      scanType?: "source" | "manifests" | "full";
    };
    try {
      const result = await scanGithubRepo({ repo, ref, scanType, log: request.log });
      const timestamp = new Date().toISOString();
      await recordScan(request.log, {
        targetHash: hashScanTarget(`repo:${result.repo}`),
        type: scanType,
        timestamp,
        count: result.findings.length,
      });
      return {
        repo: result.repo,
        ...(result.ref ? { ref: result.ref } : {}),
        findings: result.findings,
        scanType,
        ...(result.filesScanned !== undefined ? { filesScanned: result.filesScanned } : {}),
        ...(result.detector ? { detector: result.detector } : {}),
        timestamp,
      };
    } catch (err) {
      if (err instanceof RepoScanError) {
        request.log.warn({ err, statusCode: err.statusCode }, "Repository scan failed");
        reply.code(err.statusCode);
        return { error: err.message };
      }
      request.log.error(err, "Repository scan failed unexpectedly");
      reply.code(503);
      return { error: "Cryptographic scanner unavailable or failed" };
    }
  });

  app.post("/v1/risk/score", {
    schema: { body: RiskScoreSchema, response: { 200: ScoredFindingsResponseSchema } },
  }, async (request) => {
    const { findings } = request.body as { findings: any[] };
    const scored = findings.map(computeRiskFinding);
    return { findings: scored };
  });

  app.post("/v1/risk/summary", {
    schema: {
      body: RiskScoreSchema,
      response: {
        200: Type.Object({
          totalFindings: Type.Integer(),
          critical: Type.Integer(),
          high: Type.Integer(),
          medium: Type.Integer(),
          low: Type.Integer(),
          none: Type.Integer(),
          averageRiskScore: Type.Integer(),
          overallRiskLevel: Type.String(),
        }),
      },
    },
  }, async (request) => {
    const { findings } = request.body as { findings: any[] };
    const scored = findings.map(computeRiskFinding);
    const critical = scored.filter((f) => f.riskLevel === "CRITICAL").length;
    const high = scored.filter((f) => f.riskLevel === "HIGH").length;
    const medium = scored.filter((f) => f.riskLevel === "MEDIUM").length;
    const low = scored.filter((f) => f.riskLevel === "LOW").length;
    const none = scored.filter((f) => f.riskLevel === "NONE").length;
    const totalScore = scored.reduce((sum, f) => sum + f.riskScore, 0);
    const averageScore = scored.length > 0 ? Math.round(totalScore / scored.length) : 0;
    return {
      totalFindings: scored.length,
      critical,
      high,
      medium,
      low,
      none,
      averageRiskScore: averageScore,
      overallRiskLevel: classifyRisk(averageScore),
    };
  });

  app.post("/v1/compliance/evaluate", {
    schema: { body: ComplianceEvaluateSchema, response: { 200: ComplianceEvaluateResponseSchema } },
  }, async (request) => {
    const { findings, framework } = request.body as { findings: any[]; framework: string };
    const evaluator = framework.toUpperCase() === "CNSA" ? evaluateCNSACompliance : evaluateNISTCompliance;
    const results = findings.map((f) => ({
      ...f,
      compliance: evaluator(f),
    }));
    const compliant = results.filter((r) => r.compliance.compliant).length;
    const nonCompliant = results.length - compliant;
    return { framework, results, compliant, nonCompliant, total: results.length };
  });

  app.post("/v1/compliance/full-report", {
    schema: { body: RiskScoreSchema },
  }, async (request) => {
    const { findings } = request.body as { findings: any[] };
    const frameworks = ["NIST", "CNSA"];
    const reports: Record<string, any> = {};
    for (const fw of frameworks) {
      const evaluator = fw === "CNSA" ? evaluateCNSACompliance : evaluateNISTCompliance;
      const results = findings.map((f) => ({ ...f, compliance: evaluator(f) }));
      const compliant = results.filter((r) => r.compliance.compliant).length;
      reports[fw] = {
        framework: fw,
        results,
        compliant,
        nonCompliant: results.length - compliant,
        total: results.length,
        complianceScore: results.length > 0 ? Math.round((compliant / results.length) * 100) : 100,
      };
    }
    return { reports, timestamp: new Date().toISOString() };
  });

  app.post("/v1/evidence/create", {
    // Appends to the shared SHA-256 chain, so it must not be anonymous or
    // unbounded. Storage is Postgres when configured, JSONL for local dev.
    preHandler: requireApiKey,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: {
      body: EvidenceCreateSchema,
      response: { 200: EvidenceCreateResponseSchema, 503: ErrorResponseSchema },
    },
  }, async (request, reply) => {
    const { scanResultHash, scanTarget, findingsCount, riskSummary } = request.body as {
      scanResultHash: string;
      scanTarget: string;
      findingsCount: number;
      riskSummary: object;
    };
    try {
      const ledger = await evidenceStore.append({
        scanResultHash,
        scanTarget,
        findingsCount,
        riskSummary,
        timestamp: new Date().toISOString(),
      });
      return { ledger };
    } catch (err) {
      request.log.error({ err }, "evidence ledger append failed");
      return reply.code(503).send({
        error: "evidence ledger storage is unavailable",
        code: "evidence_store_unavailable",
      });
    }
  });

  app.post("/v1/evidence/verify", {
    schema: { body: EvidenceVerifySchema },
  }, async (request, reply) => {
    const { ledger } = request.body as { ledger: any };
    if (typeof ledger.previousHash !== "string" || typeof ledger.chainIndex !== "number") {
      return {
        valid: false,
        reason: "malformed_entry",
        detail: "Ledger entry is missing chain metadata (previousHash/chainIndex)",
        expectedHash: null,
        providedHash: ledger.integrityHash,
      };
    }

    // 1. Re-compute the submitted entry's own integrity hash.
    const recomputed = computeIntegrityHash(ledger);
    if (recomputed !== ledger.integrityHash) {
      return {
        valid: false,
        reason: "integrity_hash_mismatch",
        expectedHash: recomputed,
        providedHash: ledger.integrityHash,
      };
    }

    let entries: LedgerEntry[];
    let known: LedgerEntry | null;
    try {
      // 2. Validate the whole chain (tamper detection across history). With
      //    Postgres this is the shared chain, so a ledger issued by any
      //    instance verifies here — the old per-process array could not.
      entries = await evidenceStore.list();
      // 3. Confirm this entry still matches the chain record at its index.
      known = await evidenceStore.find(ledger.chainIndex);
    } catch (err) {
      request.log.error({ err }, "evidence ledger read failed");
      return reply.code(503).send({
        error: "evidence ledger storage is unavailable",
        code: "evidence_store_unavailable",
      });
    }

    const chainCheck = verifyChain(entries);
    if (!chainCheck.valid) {
      return {
        valid: false,
        reason: `chain_broken_at_index_${chainCheck.failedIndex}`,
        detail: chainCheck.reason,
      };
    }

    if (known && known.integrityHash !== ledger.integrityHash) {
      return {
        valid: false,
        reason: "entry_not_in_chain",
        detail: "Entry does not match the chain record at its index",
      };
    }
    if (!known) {
      return {
        valid: false,
        reason: "unknown_chain_index",
        detail: `No ledger entry exists at chainIndex ${ledger.chainIndex}`,
      };
    }

    return { valid: true, expectedHash: recomputed, providedHash: ledger.integrityHash, chainLength: entries.length };
  });

  app.post("/v1/roadmap/generate", {
    schema: { body: RiskScoreSchema },
  }, async (request) => {
    const { findings, dailyRate } = request.body as { findings: any[]; dailyRate?: number };
    const rate = dailyRate || 1500;
    const scored = findings.map(computeRiskFinding);
    const broken = scored.filter((f) => f.riskLevel === "CRITICAL");
    const weakened = scored.filter((f) => f.riskLevel === "HIGH");
    const medium = scored.filter((f) => f.riskLevel === "MEDIUM");
    const safe = scored.filter((f) => f.riskLevel === "NONE" || f.riskLevel === "LOW");

    const phases = [
      {
        phase: 1,
        title: "Critical: Replace Broken Cryptography",
        findings: broken,
        estimatedDays: Math.max(1, broken.length * 3),
        priority: "CRITICAL",
      },
      {
        phase: 2,
        title: "High: Strengthen Weakened Algorithms",
        findings: weakened,
        estimatedDays: Math.max(1, weakened.length * 2),
        priority: "HIGH",
      },
      {
        // R2 fix: MEDIUM findings (typically WEAKENED penalty 25 + HNDL
        // exposure) were silently dropped while summary.totalFindings still
        // counted them. They get their own review phase between HIGH and LOW.
        phase: 3,
        title: "Medium: Review Weakened Cryptography",
        findings: medium,
        estimatedDays: Math.max(1, medium.length * 1),
        priority: "MEDIUM",
      },
      {
        phase: 4,
        title: "Standard: Validate Safe Algorithms",
        findings: safe,
        estimatedDays: Math.max(1, safe.length * 0.5),
        priority: "LOW",
      },
    ];
    const totalDays = phases.reduce((sum, p) => sum + p.estimatedDays, 0);
    const totalCost = totalDays * rate;
    return {
      phases,
      summary: {
        totalFindings: scored.length,
        totalDays,
        totalCost,
        dailyRate: rate,
        completionDate: new Date(Date.now() + totalDays * 86400000).toISOString(),
      },
    };
  });

  app.get("/v1/stats", {
    // Audit M-7: only keyed target hashes are stored, never the absolute
    // resolved filesystem paths of scanned directories.
    preHandler: requireApiKey,
  }, async (request, reply) => {
    let totals: { totalScans: number; totalFindings: number };
    let scanHistory: ScanHistoryEntry[];
    try {
      [totals, scanHistory] = await Promise.all([
        scanHistoryStore.stats(),
        scanHistoryStore.list(500),
      ]);
    } catch (err) {
      request.log.error({ err }, "scan history read failed");
      reply.code(503);
      return { error: "scan history storage is unavailable", code: "scan_history_unavailable" };
    }
    return {
      totalScans: totals.totalScans,
      totalFindings: totals.totalFindings,
      historyPersistent: scanHistoryStore.mode === "postgres",
      riskLevels: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 },
      complianceScores: { NIST: 100, CNSA: 100 },
      scanHistory,
      timestamp: new Date().toISOString(),
    };
  });
}

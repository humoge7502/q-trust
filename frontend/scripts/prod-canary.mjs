#!/usr/bin/env node
/**
 * Production canary for Q-Trust.
 *
 * Answers one question: is the deployed product actually working end to end
 * for an anonymous visitor? It is deliberately dependency-free (Node 24 fetch)
 * so it can run from CI, a cron job or a laptop without installing the app.
 *
 * Run from frontend/:   node scripts/prod-canary.mjs
 * Target another site:  node scripts/prod-canary.mjs --site=http://localhost:3000
 * Promote infra checks: node scripts/prod-canary.mjs --strict
 * Require the durable planner: node scripts/prod-canary.mjs --require-embedded
 *
 * Checks are split into two tiers:
 *   required  — the product's public surface and durable compute. Any failure
 *               exits non-zero; these must work on a serverless deployment.
 *   optional  — capabilities that depend on operator infrastructure (the
 *               filesystem scanner, sticky in-memory evidence chains, the
 *               Hugging Face Space). Failures print WARN and are reported but
 *               do not fail the run unless `--strict` is passed.
 *
 * Every check goes through the same-origin proxy (`${SITE}/api/...`), which is
 * exactly the path a browser uses — not the backend's public URL. That way the
 * canary catches proxy-policy regressions (the class of bug where the UI calls
 * an endpoint the proxy refuses) rather than bypassing them with direct access.
 *
 * The canary never prints credentials; it never touches them. A JSON report is
 * written to %TEMP%/opencode/qtrust-canary/report.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const argValue = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const SITE = (
  argValue("site") ??
  process.env.QTRUST_CANARY_SITE ??
  process.env.QTRUST_SITE_URL ??
  "https://q-trust-nu.vercel.app"
).replace(/\/$/, "");
const API = `${SITE}/api`;
const OUT = resolve(tmpdir(), "opencode", "qtrust-canary");
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const STRICT = flag("strict");
const REQUIRE_EMBEDDED = flag("require-embedded");

const HF_SPACE_ID = "KRISHNAPURI/q-trust-scanner";
const HF_SPACE_API = `https://huggingface.co/api/spaces/${HF_SPACE_ID}`;
const HF_SPACE_PAGE = `https://huggingface.co/spaces/${HF_SPACE_ID}`;

/**
 * Routes the sitemap must advertise. Excluded by design (documented in
 * app/sitemap.ts): `/dashboard` and `/vendors` are wallet-gated, `/v/[id]` is
 * a per-record page.
 */
const PUBLIC_PAGES = [
  "/",
  "/scanner",
  "/research",
  "/demo",
  "/why-now",
  "/evidence",
  "/compare",
  "/developers",
  "/v",
  "/certify",
  "/pricing",
];

/** Every page that must render for an anonymous visitor. */
const RENDER_PAGES = [...PUBLIC_PAGES, "/dashboard", "/vendors"];

/** The exact sample CBOM the planning panel loads with one click. */
const SAMPLE_CBOM = {
  schema_version: "1.0",
  assets: [
    { asset_id: "asset-0001", algorithm: "RSA-2048", key_size: 2048, criticality: "Critical", pqc_ready: false },
    { asset_id: "asset-0002", algorithm: "ECC-P256", key_size: 256, criticality: "High", pqc_ready: false },
    { asset_id: "asset-0003", algorithm: "AES-256", key_size: 256, criticality: "Medium", pqc_ready: true },
    { asset_id: "asset-0004", algorithm: "SHA-256", key_size: 0, criticality: "Low", pqc_ready: true },
  ],
};
const SAMPLE_ASSET_IDS = SAMPLE_CBOM.assets.map((a) => a.asset_id).sort();

/** Findings shaped like scanner output, used to exercise the compute routes. */
const SAMPLE_FINDINGS = [
  { file: "services/api-gateway/tls.py", line: 12, algorithm: "RSA-2048", key_size: 2048, severity: "HIGH", usage: "key_exchange" },
  { file: "services/payments/cipher.py", line: 40, algorithm: "AES-256", key_size: 256, severity: "INFO", usage: "encryption" },
];

const checks = [];
const notes = {};
let currentSection = "setup";

function section(name) {
  currentSection = name;
}

function record(name, ok, detail, { required = true, skipped = false } = {}) {
  const entry = {
    section: currentSection,
    name,
    ok: skipped ? null : Boolean(ok),
    required,
    skipped,
    detail: detail ?? "",
    at: new Date().toISOString(),
  };
  checks.push(entry);
  if (skipped) {
    console.log(`SKIP [${currentSection}] ${name}${detail ? ` (${detail})` : ""}`);
  } else if (ok) {
    console.log(`PASS [${currentSection}] ${name}${detail ? ` (${detail})` : ""}`);
  } else if (required) {
    console.log(`FAIL [${currentSection}] ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    console.log(`WARN [${currentSection}] ${name}${detail ? ` (${detail})` : ""}`);
  }
  return entry;
}

function note(key, value) {
  notes[key] = value;
  console.log(`INFO ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

const truncate = (value, max = 160) =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

async function rawFetch(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    ...options,
  });
  const text = options.method === "HEAD" ? "" : await response.text();
  return { status: response.status, headers: response.headers, text, ms: Date.now() - started, url };
}

/** GET/POST with one retry on transport failure (never on an HTTP status). */
async function request(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await rawFetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 750));
    }
  }
  throw lastError;
}

async function requestJson(url, options = {}) {
  const res = await request(url, options);
  let body = null;
  try {
    body = res.text ? JSON.parse(res.text) : null;
  } catch {
    body = null;
  }
  return { ...res, body };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index;
      index += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Extract paths and origins from a sitemap. Absolute URLs are normalised to
 * paths because the sitemap bakes its origin at build time — a local run of a
 * production build legitimately advertises the production host.
 */
function parseSitemap(xml) {
  const paths = new Set();
  const origins = new Set();
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const decoded = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
    try {
      const parsed = new URL(decoded);
      origins.add(parsed.origin);
      paths.add(`${parsed.pathname}${parsed.search}` || "/");
    } catch {
      /* malformed loc — counted by the sitemap check itself */
    }
  }
  return { paths: [...paths], origins: [...origins] };
}

/** Asset id of the public demo record, used for the verification-page check. */
function demoAssetId() {
  try {
    const demo = JSON.parse(readFileSync(resolve(REPO_ROOT, "deploy/demo-records.json"), "utf8"));
    return demo.assets?.[0]?.assetId ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Site surface
// ---------------------------------------------------------------------------
async function checkSite() {
  section("site");

  const robots = await request(`${SITE}/robots.txt`);
  record("robots.txt", robots.status === 200 && robots.text.length > 0, `status ${robots.status}, ${robots.text.length} bytes`);

  const manifest = await request(`${SITE}/manifest.webmanifest`);
  let manifestBody = null;
  try {
    manifestBody = JSON.parse(manifest.text);
  } catch {
    manifestBody = null;
  }
  record(
    "web app manifest",
    manifest.status === 200 && Boolean(manifestBody?.name),
    `status ${manifest.status}, name=${truncate(manifestBody?.name ?? "none", 40)}`,
  );

  const sitemap = await request(`${SITE}/sitemap.xml`);
  const { paths: sitemapPaths, origins: sitemapOrigins } =
    sitemap.status === 200 ? parseSitemap(sitemap.text) : { paths: [], origins: [] };
  record(
    "sitemap.xml",
    sitemap.status === 200 && sitemapPaths.length > 0,
    `status ${sitemap.status}, ${sitemapPaths.length} URLs`,
  );
  note("sitemapUrls", sitemapPaths.length);
  note("sitemapOrigins", sitemapOrigins);
  if (SITE.startsWith("https://") && !sitemapOrigins.includes(new URL(SITE).origin)) {
    record(
      "sitemap advertises this origin",
      false,
      `sitemap origins [${sitemapOrigins.join(", ")}] do not include ${new URL(SITE).origin}`,
    );
  }

  const missingPages = PUBLIC_PAGES.filter((page) => !sitemapPaths.includes(page));
  record(
    "sitemap lists every public page",
    missingPages.length === 0,
    missingPages.length ? `missing: ${missingPages.join(", ")}` : `${PUBLIC_PAGES.length} public pages`,
  );

  // Fetch every page that must render for an anonymous visitor, in parallel.
  const pageResults = await mapLimit(RENDER_PAGES, 5, async (page) => {
    try {
      const res = await request(`${SITE}${page}`, { timeoutMs: 40_000 });
      const hasTitle = /<title[^>]*>\s*[^<\s]/i.test(res.text);
      return { page, status: res.status, hasTitle, ms: res.ms };
    } catch (error) {
      return { page, status: 0, hasTitle: false, error: error.message };
    }
  });
  const badPages = pageResults.filter((r) => r.status !== 200 || !r.hasTitle);
  record(
    "required pages render",
    badPages.length === 0,
    badPages.length
      ? badPages.map((r) => `${r.page} -> ${r.status}${r.hasTitle ? "" : " no-title"}`).join("; ")
      : `${pageResults.length}/${pageResults.length} pages 200 with a title`,
  );

  // Sweep every sitemap URL (bounded) so a broken public route is caught even
  // when it is not one of the routes listed above.
  const sweep = sitemapPaths.slice(0, 60);
  const sweepResults = await mapLimit(sweep, 6, async (path) => {
    try {
      const res = await request(`${SITE}${path}`, { timeoutMs: 40_000 });
      return { path, status: res.status };
    } catch (error) {
      return { path, status: 0, error: error.message };
    }
  });
  const broken = sweepResults.filter((r) => r.status >= 400 || r.status === 0);
  record(
    "every sitemap URL resolves",
    broken.length === 0,
    broken.length
      ? broken.map((r) => `${r.path} -> ${r.status}`).join("; ")
      : `${sweep.length}/${sweep.length} URLs 200`,
  );

  // Public verification detail page. `/[asset]` pages are intentionally not in
  // the sitemap, so the id comes from the published demo record.
  const assetId = demoAssetId();
  if (!assetId) {
    record("public verification detail page", false, "deploy/demo-records.json has no asset id", {
      skipped: true,
      required: false,
    });
  } else {
    const res = await request(`${SITE}/v/${assetId}`, { timeoutMs: 40_000 });
    record(
      "public verification detail page",
      res.status === 200 && res.text.includes(assetId),
      `/v/${assetId.slice(0, 12)}… -> ${res.status}${res.text.includes(assetId) ? "" : ", asset id not rendered"}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Durable API surface (through the same-origin proxy a browser uses)
// ---------------------------------------------------------------------------
async function checkApi() {
  section("api");

  try {
    const bare = await requestJson(`${API}/health`);
    record(
      "GET /api/health",
      bare.status === 200 && bare.body?.status === "ok" && typeof bare.body?.chain_id === "number",
      `status ${bare.status}, body=${truncate(bare.text)}`,
    );
  } catch (error) {
    record("GET /api/health", false, error.message);
  }

  try {
    const health = await requestJson(`${API}/v1/health`);
    const services = health.body?.services ?? {};
    record(
      "GET /api/v1/health",
      health.status === 200 &&
        health.body?.status === "ok" &&
        services.scanner === true &&
        services.risk === true &&
        services.compliance === true,
      `status ${health.status}, services=${JSON.stringify(services)}`,
    );
  } catch (error) {
    record("GET /api/v1/health", false, error.message);
  }

  // Planner liveness: this is the endpoint the frontend proxy had no rule for,
  // so a 403 here means the policy module is out of sync with the backend.
  let plannerMode = null;
  try {
    const res = await requestJson(`${API}/v1/planner/health`);
    const ok = res.status === 200 && res.body?.status === "ok";
    plannerMode = res.body?.mode ?? null;
    record(
      "GET /api/v1/planner/health",
      ok,
      ok
        ? `mode=${plannerMode}, integrity=${res.body?.model?.integrity}, runtime=${res.body?.model?.runtime}`
        : `status ${res.status}, body=${truncate(res.text)}`,
    );
    if (res.body?.model) {
      note("plannerModel", {
        mode: plannerMode,
        arch: res.body.model.arch,
        variant: res.body.model.variant,
        integrity: res.body.model.integrity,
        served: res.body.model.served,
      });
    }
    if (plannerMode && plannerMode !== "embedded") {
      record(
        "planner runs in-process (no tunnel dependency)",
        false,
        `planner mode is "${plannerMode}" — plans depend on the operator tunnel`,
        { required: REQUIRE_EMBEDDED },
      );
    }
  } catch (error) {
    record("GET /api/v1/planner/health", false, error.message);
  }

  // Plans without a deadline: ranking only.
  try {
    const res = await requestJson(`${API}/v1/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cbom: SAMPLE_CBOM }),
      timeoutMs: 120_000,
    });
    const order = Array.isArray(res.body?.migration_order) ? res.body.migration_order : [];
    const ids = order.map((row) => row.asset_id).sort();
    const ranks = order.map((row) => row.rank).sort((a, b) => a - b);
    const ranksOk = ranks.length === order.length && ranks.every((rank, i) => rank === i + 1);
    const idsOk = ids.length === SAMPLE_ASSET_IDS.length && ids.every((id, i) => id === SAMPLE_ASSET_IDS[i]);
    const rowsOk = order.every(
      (row) =>
        typeof row.algorithm === "string" &&
        typeof row.criticality === "string" &&
        typeof row.pqc_ready === "boolean" &&
        typeof row.risk_score === "number" &&
        typeof row.migrate_days === "number",
    );
    record(
      "POST /api/v1/plans ranks the sample CBOM",
      res.status === 200 && idsOk && ranksOk && rowsOk && res.body?.total_assets === 4,
      res.status === 200
        ? `${order.length} rows, ranks=${ranks.join(",")}, planner_mode=${res.body?.planner_mode ?? "none"}`
        : `status ${res.status}, body=${truncate(res.text)}`,
    );
    note("plannerModeOnPlan", res.body?.planner_mode ?? null);
  } catch (error) {
    record("POST /api/v1/plans ranks the sample CBOM", false, error.message);
  }

  // Plans with a deadline: schedule windows.
  try {
    const res = await requestJson(`${API}/v1/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cbom: SAMPLE_CBOM, deadline: "2027-09-30" }),
      timeoutMs: 120_000,
    });
    const schedule = res.body?.schedule;
    const windows = Array.isArray(schedule?.windows) ? schedule.windows : [];
    const windowsOk =
      windows.length === 4 &&
      windows.every(
        (w) =>
          typeof w.asset_id === "string" &&
          !Number.isNaN(Date.parse(w.start)) &&
          !Number.isNaN(Date.parse(w.end)),
      );
    record(
      "POST /api/v1/plans returns a bounded schedule",
      res.status === 200 && typeof schedule?.feasible === "boolean" && windowsOk,
      res.status === 200
        ? `${windows.length} windows, feasible=${schedule?.feasible}, days_available=${schedule?.days_available}`
        : `status ${res.status}, body=${truncate(res.text)}`,
    );
  } catch (error) {
    record("POST /api/v1/plans returns a bounded schedule", false, error.message);
  }

  // Risk scoring: pure compute, no filesystem.
  try {
    const res = await requestJson(`${API}/v1/risk/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ findings: SAMPLE_FINDINGS }),
    });
    const scored = Array.isArray(res.body?.findings) ? res.body.findings : [];
    const rsa = scored.find((f) => f.algorithm === "RSA-2048");
    const shaped = scored.length === SAMPLE_FINDINGS.length && scored.every(
      (f) => typeof f.riskScore === "number" && typeof f.riskLevel === "string",
    );
    record(
      "POST /api/v1/risk/score classifies findings",
      res.status === 200 && shaped && rsa && rsa.riskScore >= 50,
      res.status === 200
        ? `${scored.length} scored, RSA-2048=${rsa?.riskScore ?? "?"}/${rsa?.riskLevel ?? "?"}`
        : `status ${res.status}, body=${truncate(res.text)}`,
    );
  } catch (error) {
    record("POST /api/v1/risk/score classifies findings", false, error.message);
  }

  // Compliance evaluation.
  try {
    const res = await requestJson(`${API}/v1/compliance/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ findings: SAMPLE_FINDINGS, framework: "NIST" }),
    });
    const body = res.body;
    const resultsOk =
      Array.isArray(body?.results) &&
      body.results.length === SAMPLE_FINDINGS.length &&
      body.results.every((r) => typeof r.compliance?.compliant === "boolean");
    record(
      "POST /api/v1/compliance/evaluate returns verdicts",
      res.status === 200 &&
        resultsOk &&
        body?.total === SAMPLE_FINDINGS.length &&
        body?.compliant + body?.nonCompliant === body?.total,
      res.status === 200
        ? `${body.total} verdicts, ${body.compliant} compliant, ${body.nonCompliant} not`
        : `status ${res.status}, body=${truncate(res.text)}`,
    );
  } catch (error) {
    record("POST /api/v1/compliance/evaluate returns verdicts", false, error.message);
  }

  // Roadmap generation.
  try {
    const res = await requestJson(`${API}/v1/roadmap/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ findings: SAMPLE_FINDINGS }),
    });
    const phases = Array.isArray(res.body?.phases) ? res.body.phases : [];
    const covered = phases.reduce((sum, p) => sum + (Array.isArray(p.findings) ? p.findings.length : 0), 0);
    const days = phases.reduce((sum, p) => sum + (Number(p.estimatedDays) || 0), 0);
    record(
      "POST /api/v1/roadmap/generate covers every finding",
      res.status === 200 &&
        phases.length === 4 &&
        covered === SAMPLE_FINDINGS.length &&
        res.body?.summary?.totalFindings === SAMPLE_FINDINGS.length &&
        days > 0,
      res.status === 200
        ? `${phases.length} phases, ${covered} findings, ${days} days`
        : `status ${res.status}, body=${truncate(res.text)}`,
    );
  } catch (error) {
    record("POST /api/v1/roadmap/generate covers every finding", false, error.message);
  }

  // Stats: proxy attaches the server-side key on a public-read rule.
  try {
    const res = await requestJson(`${API}/v1/stats`);
    record(
      "GET /api/v1/stats",
      res.status === 200 && typeof res.body?.totalScans === "number",
      `status ${res.status}, totalScans=${res.body?.totalScans ?? "?"}`,
    );
  } catch (error) {
    record("GET /api/v1/stats", false, error.message);
  }

  // Public asset lookup: the data behind the /v/<id> verification page.
  const assetId = demoAssetId();
  if (!assetId) {
    record("GET /api/v1/assets/:id", false, "deploy/demo-records.json has no asset id", {
      skipped: true,
      required: false,
    });
  } else {
    try {
      const res = await requestJson(`${API}/v1/assets/${assetId}`);
      const body = res.body?.asset ?? res.body ?? {};
      record(
        "GET /api/v1/assets/:id",
        res.status === 200 && JSON.stringify(body).includes(assetId),
        res.status === 200 ? `status 200, ${truncate(res.text, 80)}` : `status ${res.status}, body=${truncate(res.text)}`,
      );
    } catch (error) {
      record("GET /api/v1/assets/:id", false, error.message);
    }
  }

  // Auth gate: privileged writes must still reject anonymous callers through
  // the proxy. A 2xx here would mean the proxy leaked the server-side key.
  try {
    const res = await requestJson(`${API}/v1/write/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cbomHash: `0x${"11".repeat(32)}` }),
    });
    record(
      "operator route rejects anonymous callers",
      res.status === 401 || res.status === 403,
      `status ${res.status}`,
    );
  } catch (error) {
    record("operator route rejects anonymous callers", false, error.message);
  }
}

// ---------------------------------------------------------------------------
// Operator-infrastructure-dependent capabilities (optional by default)
// ---------------------------------------------------------------------------
async function checkInfra() {
  section("infra");

  // Filesystem scan: only works when the backend can reach a scanner host.
  try {
    const res = await requestJson(`${API}/v1/scan/full`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "/workspace/projects/deploy/demo-estate", includeSource: true, includeManifests: true }),
      timeoutMs: 120_000,
    });
    const findings = Array.isArray(res.body?.findings) ? res.body.findings : [];
    record(
      "POST /api/v1/scan/full scans the demo estate",
      res.status === 200 && findings.length > 0,
      res.status === 200 ? `${findings.length} findings` : `status ${res.status}, body=${truncate(res.text)}`,
      { required: false },
    );
  } catch (error) {
    record("POST /api/v1/scan/full scans the demo estate", false, error.message, { required: false });
  }

  // Public-repository ingestion. Unlike /v1/scan/full this does not need the
  // operator tunnel: GitHub archives are fetched and scanned by the hosted
  // scanner service, which is deployed and rate limited, so this is required.
  try {
    const res = await requestJson(`${API}/v1/scan/repo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "octocat/Spoon-Knife", scanType: "full" }),
      timeoutMs: 120_000,
    });
    const files = res.body?.filesScanned;
    const findings = Array.isArray(res.body?.findings) ? res.body.findings.length : -1;
    record(
      "POST /api/v1/scan/repo scans a public GitHub repo",
      res.status === 200 && typeof files === "number" && files > 0,
      res.status === 200 ? `${files} files, ${findings} findings` : `status ${res.status}, body=${truncate(res.text)}`,
      { required: true },
    );
  } catch (error) {
    record("POST /api/v1/scan/repo scans a public GitHub repo", false, error.message, { required: true });
  }

  // Evidence roundtrip: create and verify must land on the same backend
  // instance, which a serverless deployment does not guarantee.
  try {
    const create = await requestJson(`${API}/v1/evidence/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scanResultHash: "0".repeat(64),
        scanTarget: "canary",
        findingsCount: 0,
        riskSummary: { totalFindings: 0, critical: 0, high: 0, medium: 0, low: 0, none: 0, averageRiskScore: 0, overallRiskLevel: "NONE" },
      }),
    });
    const ledger = create.body?.ledger;
    if (create.status !== 200 || !ledger) {
      record("evidence create -> verify roundtrip", false, `create status ${create.status}`, { required: false });
    } else {
      const verify = await requestJson(`${API}/v1/evidence/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ledger }),
      });
      record(
        "evidence create -> verify roundtrip",
        verify.status === 200 && verify.body?.valid === true,
        verify.status === 200 ? `valid=${verify.body?.valid}, reason=${verify.body?.reason ?? "none"}` : `status ${verify.status}`,
        { required: false },
      );
    }
  } catch (error) {
    record("evidence create -> verify roundtrip", false, error.message, { required: false });
  }

  // Hugging Face Space (model demo). The direct app host is resolved from the
  // Hub API rather than guessed: a Space may run on <owner>-<name>.hf.space,
  // <owner>-<name>.static.hf.space, or a custom subdomain.
  try {
    const page = await request(HF_SPACE_PAGE, { redirect: "follow", timeoutMs: 20_000 });
    record("HF Space page", page.status === 200, `status ${page.status}`, { required: false });
  } catch (error) {
    record("HF Space page", false, error.message, { required: false });
  }
  try {
    const hub = await requestJson(HF_SPACE_API, { redirect: "follow", timeoutMs: 20_000 });
    const host = typeof hub.body?.host === "string" ? hub.body.host.replace(/\/$/, "") : null;
    const stage = hub.body?.runtime?.stage ?? "unknown";
    if (!host) {
      record("HF Space app", false, `no direct host reported (runtime=${stage})`, { required: false });
    } else {
      const app = await request(host, { redirect: "follow", timeoutMs: 20_000 });
      record("HF Space app", app.status === 200, `status ${app.status}, runtime=${stage}`, { required: false });
    }
  } catch (error) {
    record("HF Space app", false, error.message, { required: false });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const startedAt = new Date();
const t0 = Date.now();

console.log(`Q-Trust production canary`);
console.log(`site:   ${SITE}`);
console.log(`api:    ${API} (same-origin proxy)`);
console.log(`strict: ${STRICT}  require-embedded: ${REQUIRE_EMBEDDED}\n`);

for (const step of [checkSite, checkApi, checkInfra]) {
  try {
    await step();
  } catch (error) {
    record(`${step.name} crashed`, false, error.message);
  }
  console.log("");
}

const required = checks.filter((c) => c.required && !c.skipped);
const optional = checks.filter((c) => !c.required && !c.skipped);
const requiredFailed = required.filter((c) => !c.ok);
const optionalFailed = optional.filter((c) => !c.ok);
const failed = requiredFailed.length > 0 || (STRICT && optionalFailed.length > 0);
const durationMs = Date.now() - t0;

console.log("Summary");
console.log(`  required: ${required.length - requiredFailed.length}/${required.length} passed`);
console.log(`  optional: ${optional.length - optionalFailed.length}/${optional.length} passed`);
if (optionalFailed.length && !STRICT) {
  console.log(`  warnings: ${optionalFailed.map((c) => c.name).join("; ")}`);
}
console.log(`  duration: ${(durationMs / 1000).toFixed(1)}s`);
console.log(`  verdict:  ${failed ? "FAIL" : "PASS"}`);

mkdirSync(OUT, { recursive: true });
const report = {
  site: SITE,
  api: API,
  startedAt: startedAt.toISOString(),
  durationMs,
  strict: STRICT,
  requireEmbedded: REQUIRE_EMBEDDED,
  verdict: failed ? "FAIL" : "PASS",
  summary: {
    required: required.length,
    requiredPassed: required.length - requiredFailed.length,
    optional: optional.length,
    optionalPassed: optional.length - optionalFailed.length,
  },
  notes,
  checks,
};
const reportPath = resolve(OUT, "report.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nReport: ${reportPath}`);

process.exitCode = failed ? 1 : 0;

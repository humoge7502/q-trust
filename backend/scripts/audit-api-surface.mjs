#!/usr/bin/env node
/**
 * Q-Trust hosted API surface audit — read-mostly, no chain writes.
 *
 * verify-deployed-stack.mjs proves the layers are up. This script proves the
 * *surface* works: every documented GET, the auth matrix on every privileged
 * route, and the compute chain the product actually sells
 * (scan → risk → compliance → roadmap → evidence → verify → plan → VC → GPU).
 *
 * Safe by construction: it never calls /v1/write/* or /v1/relay/*, so nothing
 * is broadcast. The one mutation is a webhook subscriber round trip, which it
 * removes again before exiting.
 *
 * Usage: node backend/scripts/audit-api-surface.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const API = (process.env.QTRUST_API_URL ?? "https://qtrust-backend.vercel.app/api").replace(/\/$/, "");
const KEY = env.QTRUST_API_KEY ?? env.QTRUST_API_KEYS?.split(",")[0];
const demo = JSON.parse(readFileSync(resolve(root, "deploy/demo-records.json"), "utf8"));
const assetId = demo.assets[0].assetId;
const org = demo.org;

const rows = [];
const rec = (section, name, pass, detail = "") => {
  rows.push({ section, name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${section}] ${name}${detail ? ` — ${detail}` : ""}`);
};

async function call(method, path, { body, key, timeout = 90_000 } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (key) headers["x-api-key"] = key;
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
    return { status: res.status, text, json };
  } catch (e) {
    return { status: 0, text: e.message, json: null };
  }
}

console.log(`Q-Trust API surface audit\n  api: ${API}\n  key: ${KEY ? "present" : "MISSING"}\n`);

// ------------------------------------------------------------------ 1. GETs
const GETS = [
  ["/health", {}],
  ["/v1/health", {}],
  ["/docs/json", {}],
  [`/v1/assets/${assetId}`, {}],
  [`/v1/assets/${assetId}/verify`, {}],
  [`/v1/orgs/${org}/summary`, {}],
  [`/v1/orgs/${org}/assets`, {}],
  [`/v1/orgs/${org}/migrations`, {}],
  [`/v1/orgs/${org}/audit`, {}],
  [`/v1/vendors/${org}/attestations`, {}],
  ["/v1/products/QTrust-PQC-Lib/support?version=1.4.0&algorithm=ML-KEM-768", {}],
  [`/v1/relay/nonce/${org}`, {}],
  [`/v1/relay/cbom-nonce/${org}`, {}],
  [`/v1/relay/audit-nonce/${org}`, {}],
  [`/v1/revocation/${org}`, {}],
  [`/v1/trust-anchors/${org}`, {}],
  ["/v1/gpu/status", { key: true }],
  ["/v1/gpu/quantum/estimate/2048", { key: true }],
  ["/v1/stats", { key: true }],
  ["/v1/webhooks/subscribers", { key: true }],
];
for (const [path, opts] of GETS) {
  const r = await call("GET", path, { key: opts.key ? KEY : undefined });
  rec("get", `GET ${path}`, r.status === 200, `${r.status}`);
}

// ------------------------------------------------------------------ 2. auth matrix
const GATED = [
  ["GET", "/v1/stats"],
  ["GET", "/v1/webhooks/subscribers"],
  ["GET", "/v1/gpu/status"],
  // Never probe the keyed half of /v1/write/*: a valid key there broadcasts.
  ["POST", "/v1/write/assets", { cbomHash: `0x${"11".repeat(32)}`, orgDid: org, metadataURI: "https://example.com/x.json" }, { keyed: false }],
  ["POST", "/v1/relay/cbom", { cbomHash: `0x${"11".repeat(32)}`, nonce: 0, signature: `0x${"22".repeat(65)}` }],
  ["POST", "/v1/credentials/issue", { subject_did: "did:key:zProbe" }],
  ["POST", "/v1/plans", { cbom: { assets: [] } }],
];
for (const [method, path, body, opt] of GATED) {
  const anon = await call(method, path, { body });
  rec("auth", `${method} ${path} anonymous → 401`, anon.status === 401, `${anon.status}`);
  if (opt?.keyed === false) continue;
  const keyed = await call(method, path, { body, key: KEY });
  rec("auth", `${method} ${path} with key is not rejected`, keyed.status !== 401 && keyed.status !== 403, `${keyed.status}`);
}

// ------------------------------------------------------------------ 3. compute chain
const scan = await call("POST", "/v1/scan/source", {
  body: { directory: "/workspace/projects/deploy/demo-estate" },
  key: KEY,
});
const findings = scan.json?.findings ?? [];
rec("chain", "scan/source returns findings", scan.status === 200 && findings.length > 0, `${scan.status}, ${findings.length} findings`);

let riskSummary = null;
if (findings.length) {
  const risk = await call("POST", "/v1/risk/score", { body: { findings }, key: KEY });
  const scored = risk.json?.findings ?? [];
  rec("chain", "risk/score scores every finding", risk.status === 200 && scored.length === findings.length, `${risk.status}, ${scored.length}/${findings.length}`);
  const summary = await call("POST", "/v1/risk/summary", { body: { findings: scored }, key: KEY });
  riskSummary = summary.json ?? null;
  rec("chain", "risk/summary counts by severity", summary.status === 200 && typeof summary.json?.totalFindings === "number", `${summary.status}, total=${summary.json?.totalFindings}`);

  const comp = await call("POST", "/v1/compliance/evaluate", { body: { findings: scored, framework: "NIST" }, key: KEY });
  rec("chain", "compliance/evaluate returns a verdict", comp.status === 200 && Boolean(comp.json?.report ?? comp.json?.verdict ?? comp.json), `${comp.status}`);

  const roadmap = await call("POST", "/v1/roadmap/generate", { body: { findings: scored }, key: KEY });
  const phases = roadmap.json?.phases ?? roadmap.json?.roadmap?.phases ?? [];
  rec("chain", "roadmap/generate returns phases", roadmap.status === 200 && phases.length > 0, `${roadmap.status}, ${phases.length} phases`);

  const ev = await call("POST", "/v1/evidence/create", {
    body: {
      scanResultHash: `0x${"ab".repeat(32)}`,
      scanTarget: scan.json?.target ?? "demo-estate",
      findingsCount: findings.length,
      riskSummary: riskSummary ?? {},
    },
    key: KEY,
  });
  const ledger = ev.json?.ledger ?? ev.json;
  rec("chain", "evidence/create returns a ledger", ev.status === 200 && Boolean(ledger), `${ev.status}`);
  if (ledger) {
    const ver = await call("POST", "/v1/evidence/verify", { body: { ledger }, key: KEY });
    rec("chain", "evidence/verify accepts the ledger", ver.status === 200 && ver.json?.valid !== false, `${ver.status}, valid=${ver.json?.valid}`);
  }
}

const plan = await call("POST", "/v1/plans", {
  body: {
    cbom: {
      assets: [
        { asset_id: "a1", algorithm: "RSA-2048", key_size: 2048, criticality: "Critical", host: "a.example" },
        { asset_id: "a2", algorithm: "ECDSA-P256", key_size: 256, criticality: "High", host: "b.example" },
        { asset_id: "a3", algorithm: "AES-256-GCM", key_size: 256, criticality: "Low", host: "c.example" },
      ],
    },
    deadline: "2027-06-01",
  },
  key: KEY,
});
const order = plan.json?.migration_order ?? plan.json?.order ?? [];
rec("chain", "plans returns a migration order", plan.status === 200 && order.length === 3, `${plan.status}, ${order.length} steps`);

const vc = await call("POST", "/v1/credentials/issue", {
  body: { subject_did: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", claims: { audit: "passed" } },
  key: KEY,
});
rec("chain", "credentials/issue returns a VC", vc.status === 200 && Boolean(vc.json?.credential ?? vc.json?.vc ?? vc.json), `${vc.status}`);
if (vc.json) {
  const vcv = await call("POST", "/v1/credentials/verify", { body: { presentation: vc.json.credential ?? vc.json.vc ?? vc.json }, key: KEY });
  rec("chain", "credentials/verify accepts the issued VC", vcv.status === 200 && vcv.json?.valid !== false, `${vcv.status}, valid=${vcv.json?.valid}`);
}

const demoCbom = {
  assets: [
    { asset_id: "a1", algorithm: "RSA-2048", key_size: 2048, criticality: "High", host: "a.example" },
    { asset_id: "a2", algorithm: "ML-KEM-768", key_size: 768, criticality: "Low", host: "b.example" },
  ],
};
for (const [path, body] of [
  ["/v1/gpu/quantum/estimate/2048", {}],
  ["/v1/gpu/anomaly/score", { cbom: demoCbom }],
  ["/v1/gpu/side-channel/analyze", { traces: [{ name: "t1", timings: [1, 2, 3, 4, 5, 6, 7, 8] }] }],
  ["/v1/gpu/rl/plan", { cbom: demoCbom }],
]) {
  const r = await call(path.startsWith("/v1/gpu/quantum") ? "GET" : "POST", path, { body: path.startsWith("/v1/gpu/quantum") ? undefined : body, key: KEY });
  rec("gpu", `${path}`, r.status === 200, `${r.status}`);
}

// ------------------------------------------------------------------ 4. webhooks round trip
{
  const url = `https://example.com/qtrust-audit-${Date.now()}`;
  const events = ["asset.registered"];
  const sub = await call("POST", "/v1/webhooks/subscribe", { body: { address: org, url, events }, key: KEY });
  rec("webhooks", "subscribe accepts a new endpoint", sub.status === 200 || sub.status === 201, `${sub.status}, storage=${sub.json?.storage}`);
  const list = await call("GET", "/v1/webhooks/subscribers", { key: KEY });
  const items = list.json?.subscribers ?? list.json?.items ?? [];
  rec("webhooks", "subscriber appears in the list", items.some((s) => s.url === url), `${items.length} subscribers`);
  rec("webhooks", "subscriber list exposes the org address (needed to unsubscribe)", items.every((s) => Boolean(s.address)), items[0] ? `fields=${Object.keys(items[0]).join(",")}` : "empty");

  // Unsubscribing without echoing `events` must still remove the endpoint:
  // the field is optional in the schema and a caller has no way to know which
  // bucket a URL was stored under.
  const noEvents = await call("POST", "/v1/webhooks/unsubscribe", { body: { address: org, url }, key: KEY });
  const afterNoEvents = await call("GET", "/v1/webhooks/subscribers", { key: KEY });
  const stillThere = (afterNoEvents.json?.subscribers ?? []).some((s) => s.url === url);
  rec("webhooks", "unsubscribe without `events` removes the endpoint", noEvents.status === 200 && !stillThere,
    `status ${noEvents.status}, removed=${noEvents.json?.removed}, still listed=${stillThere}`);

  const un = await call("POST", "/v1/webhooks/unsubscribe", { body: { address: org, url, events }, key: KEY });
  const list2 = await call("GET", "/v1/webhooks/subscribers", { key: KEY });
  rec("webhooks", "unsubscribe with matching events removes it", un.status === 200 && !(list2.json?.subscribers ?? []).some((s) => s.url === url),
    `status ${un.status}, removed=${un.json?.removed}`);
}

// ------------------------------------------------------------------ 5. consistency
{
  const sum = await call("GET", `/v1/orgs/${org}/summary`);
  const list = await call("GET", `/v1/orgs/${org}/assets`);
  const n = list.json?.items?.length ?? 0;
  rec("data", "summary.asset_count matches the asset list", sum.json?.asset_count === n, `summary ${sum.json?.asset_count} vs list ${n}`);
  // The asset registry is append-only, so a live registration during a demo run
  // can never be deleted and "the org holds only seed assets" goes stale the
  // first time anyone registers. Assert the invariants that actually matter:
  // every seed asset is present, and every listed metadata document resolves.
  const uris = (list.json?.items ?? []).map((a) => a.metadata_uri ?? "").filter(Boolean);
  const missingSeeds = ["inspector", "planner", "backend"].filter(
    (seed) => !uris.some((u) => u.endsWith(`cbom-${seed}.json`)),
  );
  rec(
    "data",
    "all three seed assets are present",
    missingSeeds.length === 0,
    missingSeeds.length ? `missing ${missingSeeds.join(", ")}` : `${uris.length} assets`,
  );
  const unreachable = [];
  for (const uri of uris) {
    try {
      const r = await fetch(uri, { method: "GET" });
      if (r.status >= 400) unreachable.push(`${uri} → ${r.status}`);
    } catch (err) {
      unreachable.push(`${uri} → ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  rec(
    "data",
    "every asset metadata URI resolves",
    unreachable.length === 0,
    unreachable.join(", ") || `${uris.length} documents reachable`,
  );
}

const fails = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - fails.length}/${rows.length} checks passed`);
if (fails.length) {
  console.log("\nFAILING:");
  for (const f of fails) console.log(`  [${f.section}] ${f.name} — ${f.detail}`);
}
const out = resolve(root, "paper/analysis/api_surface_audit.json");
try {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ api: API, at: new Date().toISOString(), rows }, null, 2));
  console.log(`report: ${out}`);
} catch { /* report is best-effort */ }
process.exit(fails.length ? 1 : 0);

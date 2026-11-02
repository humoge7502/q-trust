#!/usr/bin/env node
/**
 * Seed the live demo with real, on-chain records.
 *
 * What it does:
 *   1. Runs the Python inspector over three directories mounted in the API
 *      container (default: backend/src, frontend/src, inspector/qtrust_inspector).
 *   2. Builds a CycloneDX-style CBOM per scan and registers its keccak256 hash
 *      on the AssetRegistry through POST /v1/write/assets (signed by the
 *      relayer, which holds REGISTRAR_ROLE).
 *   3. Records one migration for the first asset.
 *   4. Waits for the indexer to catch up, then writes deploy/demo-records.json.
 *
 * Usage (from the repository root, local API healthy):
 *   node backend/scripts/seed-demo-records.mjs
 *
 * Environment:
 *   QTRUST_LOCAL_API_URL   default http://localhost:3001
 *   QTRUST_API_KEY         read from .env
 *   QTRUST_RELAYER_ADDRESS read from .env
 *
 * Vendor attestations are intentionally skipped: VendorRegistry requires
 * VENDOR_ROLE + vendor registration, and the demo relayer is not a vendor.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex } from "viem";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const API = (process.env.QTRUST_LOCAL_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

function loadEnv() {
  const path = resolve(REPO_ROOT, ".env");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

const env = loadEnv();
const API_KEY = process.env.QTRUST_API_KEY ?? env.QTRUST_API_KEY ?? env.QTRUST_API_KEYS?.split(",")[0];
const ORG = process.env.QTRUST_RELAYER_ADDRESS ?? env.QTRUST_RELAYER_ADDRESS;
const SITE_URL = (process.env.NEXT_PUBLIC_QTRUST_SITE_URL ?? env.NEXT_PUBLIC_QTRUST_SITE_URL ?? "https://q-trust-nu.vercel.app").replace(/\/$/, "");

if (!API_KEY) throw new Error("QTRUST_API_KEY is not set in .env");
if (!ORG) throw new Error("QTRUST_RELAYER_ADDRESS is not set in .env");

// Targets with rich findings in the shipped inspector. The CBOM JSON for each
// is written to frontend/public/demo/ and served from the site, so the on-chain
// metadata URI resolves to the exact document whose keccak256 is registered.
const TARGETS = [
  { slug: "inspector", path: "/workspace/projects/inspector/qtrust_inspector", label: "Q-Trust inspector (Python)" },
  { slug: "planner", path: "/workspace/projects/planner/qtrust_planner", label: "Q-Trust planner (Python)" },
  { slug: "backend", path: "/workspace/projects/backend/src", label: "Q-Trust backend (TypeScript)" },
];

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${body.error ?? text.slice(0, 300)}`);
  }
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scan(target) {
  // Reuse an existing CBOM document when present: the hash registered on-chain
  // must match the exact bytes served at metadataURI, and re-running the seed
  // must not register duplicate assets.
  const demoDir = resolve(REPO_ROOT, "frontend", "public", "demo");
  const filePath = resolve(demoDir, `cbom-${target.slug}.json`);
  const metadataURI = `${SITE_URL}/demo/cbom-${target.slug}.json`;
  if (existsSync(filePath)) {
    const json = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(json);
    console.log(`Reusing ${filePath} (${parsed.components?.length ?? 0} components)`);
    return {
      target,
      findings: parsed.components ?? [],
      cbomHash: keccak256(toHex(json)),
      metadataURI,
    };
  }
  process.stdout.write(`Scanning ${target.path} ... `);
  const result = await api("/v1/scan/full", {
    method: "POST",
    body: JSON.stringify({ target: target.path, includeSource: true, includeManifests: true }),
  });
  console.log(`${result.findings?.length ?? 0} findings`);
  const cbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp: result.timestamp ?? new Date().toISOString(),
      component: { type: "application", name: target.label, version: "2.2.0" },
      tools: [{ vendor: "Q-Trust", name: "crypto-inspector", version: "2.2.0" }],
      properties: [{ name: "qtrust.scan.target", value: result.target ?? target.path }],
    },
    components: (result.findings ?? []).map((finding, index) => ({
      type: "cryptographic-asset",
      "bom-ref": `finding-${index}`,
      name: finding.algorithm ?? finding.name ?? "unknown-algorithm",
      properties: [
        { name: "qtrust.category", value: String(finding.category ?? "") },
        { name: "qtrust.severity", value: String(finding.severity ?? "") },
        { name: "qtrust.file", value: String(finding.file ?? finding.path ?? "") },
        { name: "qtrust.line", value: String(finding.line ?? "") },
      ],
    })),
  };
  const json = JSON.stringify(cbom, null, 2);
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(filePath, json);
  return { target, findings: result.findings ?? [], cbomHash: keccak256(toHex(json)), metadataURI };
}

async function waitForAssets(hashes, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await api(`/v1/orgs/${ORG}/assets?limit=50`);
    const items = page.items ?? page.assets ?? [];
    const byHash = new Map(items.map((a) => [String(a.cbom_hash).toLowerCase(), a]));
    if (hashes.every((h) => byHash.has(h.toLowerCase()))) return items;
    await sleep(5_000);
    process.stdout.write(".");
  }
  throw new Error("indexer did not catch up with the seeded assets in time");
}

async function main() {
  console.log(`Seeding demo records via ${API}`);
  console.log(`Org (relayer): ${ORG}`);

  const scans = [];
  for (const target of TARGETS) scans.push(await scan(target));

  // Skip anything the indexer already knows about (re-runs stay idempotent).
  const existingPage = await api(`/v1/orgs/${ORG}/assets?limit=200`).catch(() => ({ items: [] }));
  const existingHashes = new Set(
    (existingPage.items ?? []).map((a) => String(a.cbom_hash).toLowerCase()),
  );

  const registrations = [];
  for (const s of scans) {
    if (existingHashes.has(s.cbomHash.toLowerCase())) {
      console.log(`Already registered ${s.target.path}`);
      registrations.push({ ...s, txHash: "already-registered" });
      continue;
    }
    const result = await api("/v1/write/assets", {
      method: "POST",
      body: JSON.stringify({ cbomHash: s.cbomHash, metadataURI: s.metadataURI }),
    });
    registrations.push({ ...s, txHash: result.txHash });
    console.log(`Registered ${s.target.path}: ${result.txHash}`);
  }

  process.stdout.write("Waiting for the indexer");
  const indexed = await waitForAssets(scans.map((s) => s.cbomHash));
  console.log(`\nIndexed ${indexed.length} asset(s) for ${ORG}`);

  const byHash = new Map(indexed.map((a) => [String(a.cbom_hash).toLowerCase(), a]));
  const assets = registrations.map((r) => ({
    assetId: byHash.get(r.cbomHash.toLowerCase())?.asset_id ?? null,
    target: r.target,
    cbomHash: r.cbomHash,
    metadataURI: r.metadataURI,
    findings: r.findings.length,
    txHash: r.txHash,
  }));
  const first = assets.find((a) => a.assetId);
  if (!first) throw new Error("no indexed asset id found");

  const migrationId = keccak256(toHex(`qtrust-demo-migration:${first.assetId}`));
  const migration = await api("/v1/write/migrations", {
    method: "POST",
    body: JSON.stringify({
      migrationId,
      assetId: first.assetId,
      fromAlgorithm: "RSA-2048",
      toAlgorithm: "ML-KEM-768",
      evidenceHash: first.cbomHash,
      evidenceURI: "",
    }),
  });
  console.log(`Recorded migration ${migrationId}: ${migration.txHash}`);

  // Give the indexer a moment to ingest the migration so the dashboard shows it.
  await sleep(10_000);
  let migrationState = null;
  try {
    migrationState = await api(`/v1/orgs/${ORG}/migrations?limit=10`);
  } catch (err) {
    console.warn(`Could not read migrations back: ${err.message}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    network: { name: "Base Sepolia", chainId: 84532 },
    org: ORG,
    assets,
    migration: { id: migrationId, txHash: migration.txHash, from: "RSA-2048", to: "ML-KEM-768" },
    verified: {
      assets: indexed.length,
      migrations: migrationState?.progress ?? null,
    },
  };
  const outPath = resolve(REPO_ROOT, "deploy", "demo-records.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  // The site imports this file at build time to render the "Live on-chain
  // records" strip in the hero, so it must contain real asset IDs only.
  const recordsPath = resolve(REPO_ROOT, "frontend", "src", "lib", "demo-records.json");
  writeFileSync(
    recordsPath,
    JSON.stringify(
      {
        generatedAt: out.generatedAt,
        network: out.network.name,
        chainId: out.network.chainId,
        records: assets
          .filter((asset) => asset.assetId)
          .map((asset) => ({
            label: asset.target.label,
            assetId: asset.assetId,
            findings: asset.findings,
            target: asset.target.path,
            metadataURI: asset.metadataURI,
          })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nWrote ${outPath}`);
  console.log(JSON.stringify({ org: ORG, assets: assets.map((a) => ({ id: a.assetId, target: a.target.path })), migration: migrationId }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

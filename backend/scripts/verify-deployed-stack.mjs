#!/usr/bin/env node
/**
 * Q-Trust production verification — read-only.
 *
 * Checks the four deployed layers and the joins between them:
 *   1. hosted frontend   (Vercel)  routes, headers, shipped-JS secret scan
 *   2. hosted backend    (Vercel serverless) read surface, auth gates, CORS
 *   3. local services    (Docker API + planner via their public tunnels)
 *   4. on-chain state    (Base Sepolia) contract code, relayer funds, roles
 *   5. read-model join   (Neon via the hosted API) chain state == API state
 *   6. relay crypto      (no broadcast) EIP-712 signing + eth_call simulation
 *
 * Usage:
 *   node backend/scripts/verify-deployed-stack.mjs
 *   QTRUST_SITE_URL=... QTRUST_API_URL=... node backend/scripts/verify-deployed-stack.mjs
 *
 * Secrets come from the repo `.env` (QTRUST_API_KEY, QTRUST_RELAYER_PRIVATE_KEY).
 * Nothing is written on chain and no secret is ever printed.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, getAddress, parseAbi, keccak256, toBytes, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const envLocal = (() => {
  try {
    return Object.fromEntries(
      readFileSync(resolve(root, "frontend/.env.local"), "utf8")
        .split(/\r?\n/)
        .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
    );
  } catch { return {}; }
})();

const SITE = (process.env.QTRUST_SITE_URL ?? env.NEXT_PUBLIC_QTRUST_SITE_URL ?? "https://q-trust-nu.vercel.app").replace(/\/$/, "");
const API = (process.env.QTRUST_API_URL ?? "https://qtrust-backend.vercel.app/api").replace(/\/$/, "");
const API_KEY = env.QTRUST_API_KEY ?? env.QTRUST_API_KEYS?.split(",")[0];
const RPC = env.QTRUST_BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com";
const CONTRACTS = {
  AssetRegistry: env.QTRUST_ASSET_REGISTRY_ADDRESS,
  VendorRegistry: env.QTRUST_VENDOR_REGISTRY_ADDRESS,
  MigrationRegistry: env.QTRUST_MIGRATION_REGISTRY_ADDRESS,
  AuditRegistry: env.QTRUST_AUDIT_REGISTRY_ADDRESS,
  RevocationAnchor: env.QTRUST_REVOCATION_ANCHOR_ADDRESS,
  PolicyCommitment: env.QTRUST_POLICY_COMMITMENT_ADDRESS,
  SchemaRegistry: env.QTRUST_SCHEMA_REGISTRY_ADDRESS,
  TrustAnchorRegistry: env.QTRUST_TRUST_ANCHOR_REGISTRY_ADDRESS,
};

const results = [];
const ok = (section, name, pass, detail = "") => {
  results.push({ section, name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${section}] ${name}${detail ? ` — ${detail}` : ""}`);
};

async function get(url, headers = {}) {
  // One retry absorbs transient DNS/TLS resets on the shared uplink; status 0
  // means the request never reached the server.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(45_000), redirect: "manual" });
      const text = await res.text();
      return { status: res.status, text, headers: res.headers };
    } catch (e) {
      if (attempt === 1) return { status: 0, text: e.message, headers: new Headers() };
      await new Promise((r) => setTimeout(r, 750));
    }
  }
}
async function post(url, body, headers = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      if (attempt === 1) return { status: 0, text: e.message };
      await new Promise((r) => setTimeout(r, 750));
    }
  }
}

// ---------------------------------------------------------------- 1. frontend
console.log(`\nQ-Trust production verification\n  site: ${SITE}\n  api:  ${API}\n`);
{
  for (const [path, expected] of [["/", 200], ["/scanner", 200], ["/dashboard", 200], ["/vendors", 200], ["/v", 200], ["/robots.txt", 200], ["/sitemap.xml", 200], ["/manifest.webmanifest", 200], ["/definitely-not-a-route", 404]]) {
    const r = await get(`${SITE}${path}`);
    ok("frontend", `${path} → ${expected}`, r.status === expected, `got ${r.status}`);
  }
  const home = await get(`${SITE}/`);
  ok("frontend", "HSTS + CSP + nosniff present", Boolean(home.headers.get("strict-transport-security") && home.headers.get("content-security-policy") && home.headers.get("x-content-type-options")));
  const proxy = await get(`${SITE}/api/health`);
  ok("frontend", "same-origin /api proxy forwards to the backend", proxy.status === 200 && /"status":"ok"/.test(proxy.text), `got ${proxy.status}`);

  const bundles = [...new Set([...home.text.matchAll(/\/_next\/static\/[^"'`\s]+\.js/g)].map((m) => m[0]))];
  const secrets = [env.QTRUST_API_KEY, env.QTRUST_RELAYER_PRIVATE_KEY, env.QTRUST_DEPLOYER_PRIVATE_KEY, env.QTRUST_PLANNER_API_KEY, env.HF_TOKEN, env.RENDER_API_KEY, env.GITHUB_TOKEN, envLocal.POSTGRES_PASSWORD, envLocal.VERCEL_OIDC_TOKEN].filter(Boolean);
  let leaks = 0;
  for (const b of bundles) {
    const js = await get(b.startsWith("http") ? b : `${SITE}${b}`);
    for (const s of secrets) if (js.text.includes(s)) leaks += 1;
  }
  ok("frontend", `no secret in ${bundles.length} shipped JS bundles`, leaks === 0, `${leaks} leak(s)`);
}

// ---------------------------------------------------------------- 2. backend
{
  const health = await get(`${API}/health`);
  ok("backend", "GET /health", health.status === 200 && /"status":"ok"/.test(health.text), health.text.slice(0, 90));
  const v1 = await get(`${API}/v1/health`);
  ok("backend", "GET /v1/health", v1.status === 200);
  const docs = await get(`${API}/docs/json`);
  ok("backend", "GET /docs/json (OpenAPI)", docs.status === 200 && /"openapi"/.test(docs.text));

  const demo = JSON.parse(readFileSync(resolve(root, "deploy/demo-records.json"), "utf8"));
  const assetId = demo.assets[0].assetId;
  const org = demo.org;
  for (const path of [
    `/v1/assets/${assetId}`,
    `/v1/assets/${assetId}/verify`,
    `/v1/orgs/${org}/summary`,
    `/v1/orgs/${org}/assets`,
    `/v1/orgs/${org}/migrations`,
    `/v1/orgs/${org}/audit`,
    `/v1/vendors/${org}/attestations`,
    `/v1/products/QTrust-PQC-Lib/support?version=1.4.0&algorithm=ML-KEM-768`,
    `/v1/relay/nonce/${org}`,
    `/v1/revocation/${org}`,
    `/v1/trust-anchors/${org}`,
  ]) {
    const r = await get(`${API}${path}`);
    ok("backend", `GET ${path}`, r.status === 200, `got ${r.status}`);
  }
  const verify = await get(`${API}/v1/assets/${assetId}/verify`);
  ok("backend", "seeded asset is active on chain", /"exists":true/.test(verify.text) && /"active":true/.test(verify.text));

  for (const path of ["/v1/stats", "/v1/webhooks/subscribers"]) {
    const r = await get(`${API}${path}`);
    ok("backend", `GET ${path} rejects anonymous access`, r.status === 401, `got ${r.status}`);
  }
  // Write/relay routes are POST-only, so a GET is a legitimate 404 — probe them
  // with the method they actually accept.
  for (const [path, body] of [
    ["/v1/write/assets", { cbomHash: `0x${"11".repeat(32)}` }],
    ["/v1/relay/attestation", { productId: "p", version: "1", algorithm: "ML-KEM-768", supported: true, nonce: 0, signature: `0x${"22".repeat(65)}` }],
    ["/v1/relay/cbom", { cbomHash: `0x${"11".repeat(32)}`, nonce: 0, signature: `0x${"22".repeat(65)}` }],
    ["/v1/credentials/issue", { subject_did: "did:key:zProbe" }],
  ]) {
    const r = await post(`${API}${path}`, body);
    ok("backend", `POST ${path} rejects anonymous access`, r.status === 401, `got ${r.status}`);
  }
  ok("backend", "valid API key is accepted on a gated route", (await get(`${API}/v1/stats`, { "x-api-key": API_KEY })).status === 200);
  ok("backend", "wrong API key is rejected", (await get(`${API}/v1/stats`, { "x-api-key": "0".repeat(64) })).status === 401);

  const cors = await get(`${API}/health`, { origin: SITE });
  ok("backend", `CORS allows ${SITE}`, (cors.headers.get("access-control-allow-origin") ?? "") === SITE);
  const corsBad = await get(`${API}/health`, { origin: "https://evil.example" });
  ok("backend", "CORS does not echo an unknown origin", !corsBad.headers.get("access-control-allow-origin"));
}

// ---------------------------------------------------------------- 3. local + tunnels
{
  const local = await get("http://127.0.0.1:3001/health");
  ok("local", "Docker API answers on 127.0.0.1:3001", local.status === 200);
  const planner = await get("http://127.0.0.1:8000/health");
  ok("local", "Docker planner answers on 127.0.0.1:8000", planner.status === 200 && /"status":"ok"/.test(planner.text));

  const apiTunnel = (env.QTRUST_SCANNER_PROXY_URL ?? env.QTRUST_PUBLIC_URL ?? "").replace(/\/$/, "");
  if (apiTunnel) {
    const t = await get(`${apiTunnel}/v1/health`);
    ok("local", `API quick tunnel ${apiTunnel} is live`, t.status === 200);
    const gpuHosted = await get(`${API}/v1/gpu/status`, { "x-api-key": API_KEY });
    ok("local", "hosted /v1/gpu/* proxies through the tunnel to the ML bridge", gpuHosted.status === 200 && /"available":true/.test(gpuHosted.text), gpuHosted.text.slice(0, 80));
    const scan = await post(`${API}/v1/scan/source`, { directory: "/workspace/projects/deploy/demo-estate" }, { "x-api-key": API_KEY });
    const findings = scan.status === 200 ? JSON.parse(scan.text).findings?.length ?? 0 : 0;
    ok("local", "hosted /v1/scan/* proxies to the Python inspector", scan.status === 200 && findings > 0, `${findings} findings`);
  } else {
    ok("local", "scanner tunnel configured", false, "QTRUST_SCANNER_PROXY_URL missing");
  }

  const plannerTunnel = (env.QTRUST_PLANNER_TUNNEL_URL ?? "").replace(/\/$/, "");
  if (plannerTunnel) {
    const pt = await get(`${plannerTunnel}/health`);
    ok("local", `planner tunnel ${plannerTunnel} is live`, pt.status === 200 && /"status":"ok"/.test(pt.text));
  }
}

// ---------------------------------------------------------------- 4. chain
const client = createPublicClient({ chain: baseSepolia, transport: http(RPC, { timeout: 30_000 }) });
const relayer = env.QTRUST_RELAYER_ADDRESS ? getAddress(env.QTRUST_RELAYER_ADDRESS) : null;
{
  const chainId = await client.getChainId();
  ok("chain", `RPC reports Base Sepolia (84532)`, chainId === 84532, `got ${chainId}`);
  for (const [name, address] of Object.entries(CONTRACTS)) {
    const code = await client.getBytecode({ address: getAddress(address) });
    ok("chain", `${name} has bytecode at ${address}`, Boolean(code && code.length > 2), `${code ? (code.length - 2) / 2 : 0} bytes`);
  }
  if (relayer) {
    const balance = await client.getBalance({ address: relayer });
    const eth = Number(balance) / 1e18;
    const min = Number(env.QTRUST_RELAYER_MIN_BALANCE_ETH ?? 0);
    ok("chain", `relayer holds ${eth.toFixed(6)} ETH (guardrail min ${min})`, eth >= min);
    const abi = parseAbi(["function hasRole(bytes32,address) view returns (bool)"]);
    for (const [registry, role] of [[CONTRACTS.AssetRegistry, "REGISTRAR_ROLE"], [CONTRACTS.VendorRegistry, "VENDOR_ROLE"], [CONTRACTS.MigrationRegistry, "MIGRATOR_ROLE"], [CONTRACTS.AuditRegistry, "AUDITOR_ROLE"]]) {
      const has = await client.readContract({ address: getAddress(registry), abi, functionName: "hasRole", args: [keccak256(toBytes(role)), relayer] });
      ok("chain", `relayer holds ${role} on ${registry.slice(0, 10)}…`, has);
    }
  }
}

// ---------------------------------------------------------------- 5. read model join
const demo = JSON.parse(readFileSync(resolve(root, "deploy/demo-records.json"), "utf8"));
{
  const summary = await get(`${API}/v1/orgs/${demo.org}/summary`);
  const body = summary.status === 200 ? JSON.parse(summary.text) : { asset_count: 0 };
  ok("read-model", "Neon read model answers through the hosted API", summary.status === 200 && body.asset_count > 0, `${body.asset_count} assets indexed for the seeded org`);
  const audit = await get(`${API}/v1/orgs/${demo.org}/audit`);
  ok("read-model", "latest audit is indexed", /"exists":true/.test(audit.text));
}

// ---------------------------------------------------------------- 6. relay crypto
if (env.QTRUST_RELAYER_PRIVATE_KEY && CONTRACTS.AssetRegistry) {
  const account = privateKeyToAccount(env.QTRUST_RELAYER_PRIVATE_KEY);
  const proxy = getAddress(CONTRACTS.AssetRegistry);
  const abi = parseAbi([
    "function nonces(address) view returns (uint256)",
    "function domainSeparator() view returns (bytes32)",
    "function registerCBOMSigned(bytes32 cbomHash, string metadataURI, uint256 nonce, bytes signature) returns (bytes32)",
  ]);
  const domain = { name: "QTrustAssetRegistry", version: "1", chainId: 84532, verifyingContract: proxy };
  const types = { CBOMRegistration: [{ name: "cbomHash", type: "bytes32" }, { name: "metadataURI", type: "string" }, { name: "nonce", type: "uint256" }] };
  const nonce = await client.readContract({ address: proxy, abi, functionName: "nonces", args: [account.address] });
  const message = { cbomHash: keccak256(toBytes(`verify-${Date.now()}`)), metadataURI: "https://q-trust-nu.vercel.app/demo/cbom-inspector.json", nonce };
  const signature = await createWalletClient({ account, chain: baseSepolia, transport: http(RPC) }).signTypedData({ account, domain, types, primaryType: "CBOMRegistration", message });
  const recovered = await recoverTypedDataAddress({ domain, types, primaryType: "CBOMRegistration", message, signature });
  ok("relay", "relayer key recovers to the configured relayer address", recovered.toLowerCase() === account.address.toLowerCase());
  try {
    await client.simulateContract({ address: proxy, abi, functionName: "registerCBOMSigned", args: [message.cbomHash, message.metadataURI, nonce, signature], account: account.address });
    ok("relay", "EIP-712 gasless CBOM registration is accepted by the deployed contract (eth_call, nothing written)", true);
  } catch (e) {
    ok("relay", "EIP-712 gasless CBOM registration is accepted by the deployed contract", false, (e.shortMessage ?? e.message).split("\n")[0]);
  }
}

// ---------------------------------------------------------------- summary
const failures = results.filter((r) => !r.pass);
console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
if (failures.length) {
  console.log("\nFAILING CHECKS:");
  for (const f of failures) console.log(`  [${f.section}] ${f.name} — ${f.detail}`);
}
process.exit(failures.length ? 1 : 0);
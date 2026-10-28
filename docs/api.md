# API Reference

Q-Trust exposes a Fastify API (TypeScript) on Base L2 that fronts 11 UUPS contracts, a Postgres read model, Redis webhooks, and the planner GNN microservice. This page summarizes the HTTP interface; the canonical OpenAPI 3.0.3 spec lives at [`backend/openapi.yaml`](https://github.com/humoge7502/q-trust/blob/main/backend/openapi.yaml) and is served live as Swagger UI at `GET /docs` (`/docs/json`).

> **Live docs:** when the backend is running, open `http://localhost:3001/docs` for interactive Swagger (try-it, schemas, `X-Api-Key` authorizer). The static spec is also validated in CI via `backend/openapi.yaml`.

---

## Base URL

| Environment | URL |
|---|---|
| Local dev (default) | `http://localhost:3001` |
| Docker Compose | `http://127.0.0.1:3001` |
| Production | `https://api.q-trust.example` (set via `QTRUST_BASE_SEPOLIA_RPC` / reverse proxy; see `.env.example`) |

Servers are declared in `backend/openapi.yaml:29`:

```yaml
servers:
  - url: http://localhost:3001
    description: Local development server
```

All paths below are relative to the base URL. Legacy alias routes (`/assets/{id}`, `/migration/progress/{org}`) are deprecated and sunset `2026-12-31` with `Deprecation`/`Sunset` headers.

---

## Authentication

* **Header:** `X-Api-Key: <key>`
* **Scheme:** `ApiKeyAuth` (`backend/openapi.yaml:1008`) — `in: header`, `name: X-Api-Key`.
* **Required for:** `POST /v1/write/*`, `POST /v1/relay/*`, `POST /v1/credentials/issue`, `POST /v1/evidence/create`, `POST /v1/plans`, `POST /v1/webhooks/*`, and all `/v1/gpu/*` routes. See `backend/src/middleware/auth.ts:requireApiKey` — fail-closed in production when `QTRUST_API_KEYS` is unset; dev without keys is unchanged.
* **Not required for:** `GET /health`, `GET /v1/assets/*`, `GET /v1/orgs/*`, `GET /v1/revocation/*`, `GET /v1/trust-anchors/*`, etc. (read paths).
* **Relay pre-check:** `/v1/relay/*` pre-validates the signer's on-chain role before broadcasting, so a bad signature never costs relayer gas (audit H-3).

Example — gasless CBOM registration:

```bash
NONCE=$(curl -s http://localhost:3001/v1/relay/cbom-nonce/0xYourAddr | jq -r .nonce)
# sign EIP-712 typed data with eth_account (domain: Q-Trust, chainId 84532) -> $SIG
curl -s http://localhost:3001/v1/relay/cbom \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $QTRUST_API_KEYS" \
  -d "{\"cbomHash\":\"0x…\",\"metadataURI\":\"ipfs://Qm…\",\"nonce\":$NONCE,\"signature\":\"$SIG\"}" | jq
```

---

## Pagination

List endpoints use offset/limit (`backend/openapi.yaml:1037`):

| Param | In | Type | Default | Bounds | Description |
|---|---|---|---|---|---|
| `offset` | query | integer | `0` | `≥0` | Result offset |
| `limit` | query | integer | `50` | `1…200` | Page size (max 200) |

Response shape is `Page` (`backend/openapi.yaml:1200`):

```json
{ "items": [...], "total": 42, "offset": 0, "limit": 50 }
```

Paginated routes:

* `GET /v1/orgs/{did}/assets`
* `GET /v1/orgs/{did}/migrations`
* `GET /v1/vendors/{did}/attestations`
* (plus indexer-backed `GET /v1/vendors/...` and `GET /v1/migrations` views)

---

## Error codes

All errors return `application/json` with `ErrorResponse` (`backend/openapi.yaml:1060`):

```json
{ "error": "human-readable message" }
```

| Code | Meaning | Typical cause |
|---|---|---|
| `400` | Bad Request | Missing/invalid params, bad `0x` id, `cbomHash` shape |
| `401` | Unauthorized | Missing or invalid `X-Api-Key` on write/relay |
| `404` | Not Found | Unknown `asset_id`, `migration_id`, org DID not indexed |
| `422` | Unprocessable | On-chain revert (`NotVendor`, duplicate id, role check) |
| `429` | Too Many Requests | Global 120/min/IP (`QTRUST_RATE_LIMIT_MAX`) or per-route 30/min on writes; relay 429 surge monitored in `ops/` alerts |
| `503` | Service Unavailable | Planner down (`POST /v1/plans`), Redis down (`/v1/webhooks/*`), chain RPC unavailable |

Rate limits are documented in [`PERFORMANCE.md`](PERFORMANCE.md) — 147.8 req/s @100 VUs, p95 11.3 ms; disable globally with `QTRUST_RATE_LIMIT_MAX=0` for load tests.

---

## Endpoints

### Health

| Method | Path | Description | Auth | Notes |
|---|---|---|---|---|
| `GET` | `/health` | Server health, `chain_id`, `relayer` | — | `backend/openapi.yaml:72` |
| `GET` | `/docs` | Swagger UI | — | `@fastify/swagger-ui` |
| `GET` | `/docs/json` | Raw OpenAPI JSON | — | Proxied from `backend/openapi.yaml` |
| `GET` | `/metrics` | Prometheus metrics | `X-Api-Key` in production | `prom-client` histogram + gauges |
| `GET` | `/v1/stats` | Scan counters, history and `historyPersistent` (Postgres-backed when `QTRUST_PG_URL` is set); API-key gated | `X-Api-Key` | `routes/scanner.ts` |

### Scan

CBOM/scan routes invoke the real `qtrust_inspector` engine end-to-end (not stubs) via `routes/scanner.ts`.

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/v1/scan/source` | Source-code crypto scan (`ast_scanner` + `source_scanner`) | `X-Api-Key` |
| `POST` | `/v1/scan/manifests` | Manifest dependency scan (10+ formats) | `X-Api-Key` |
| `POST` | `/v1/scan/full` | Full target scan (TLS + source + manifests + binaries + config + PCAP) | `X-Api-Key` |

All three accept `ScanRequest` with `target`, `options` (detectors toggles) and return `ScanResult` serialized as CBOM JSON (`qtrust.cbom.v1`) plus optional risk/compliance enrichment.

### Risk

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/v1/risk/score` | Per-finding quantum/HNDL/risk_level scoring | — |
| `POST` | `/v1/risk/summary` | Aggregate risk rollup over a `ScanResult` | — |

Risk engine (`qtrust_inspector/risk_engine.py:calculate_risk_score`) classifies `quantum_vulnerability`, `nist_800_131a_compliant`, `hndl_exposure_score`, `risk_level` (0–100, see `WHITEPAPER.md:6.1`).

### Compliance

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/v1/compliance/evaluate` | Single-framework check (`n framework= nist|cnsa|fips|...`) | — |
| `POST` | `/v1/compliance/full-report` | Full 7-framework report (NIST, CNSA 2.0, FIPS 140-3, NIS2, FISMA, FedRAMP, CMMC) | — |

Compliance engine is `qtrust_inspector/compliance.py:ComplianceEngine` — conformance tested via `CBOM_CONFORMANCE.md`. Frameworks: NIST SP 800-131A, CNSA 2.0, FIPS 140-3, EU NIS2, FISMA, FedRAMP, CMMC, PCI DSS 4.0, BSI TR-02102, NCSC UK, ASD ISM, **DORA**, **HIPAA**.

### Assurance analytics

One call scores an estate three ways using the real inspector engines (no TypeScript reimplementation): six-factor crypto-agility, Monte-Carlo CRQC financial exposure, and sector assurance packs.

| Method | Path | Description | Auth | Rate limit |
|---|---|---|---|---|
| `POST` | `/v1/assurance/report` | `op=report` returns agility + CRQC + all packs; `op=agility\|crqc\|packs` runs one engine | `X-Api-Key` | 30/min |

```bash
curl -s http://localhost:3001/v1/assurance/report \
  -H "Content-Type: application/json" -H "X-Api-Key: $QTRUST_API_KEYS" \
  -d '{"findings":[{"asset_type":"tls_certificate","host":"pay.example","algorithm":"RSA-2048","key_size":2048,"criticality":"high"}],"top":5}' | jq '{grade:.agility.grade, p50:.crqc.loss_p50_usd, cnsa:.packs["cnsa-2.0"].verdict}'
```

* **Agility** (`qtrust_inspector/agility.py`): A–E grade over algorithm posture (25), abstraction (20), configurability (15), PQC path (20), observability (10), lifecycle (10); returns weakest assets and the highest-leverage upgrade levers.
* **CRQC** (`qtrust_inspector/crqc.py`): lognormal CRQC arrival (median 2032, σ 0.35 by default), per-asset vulnerability, data lifetime, present-value discounting → `expected_loss_usd`, P10/P50/P90, `p_any_exposure`, exposure by arrival year. Seeded and deterministic; limitations are returned with the numbers.
* **Packs** (`qtrust_inspector/assurance_packs.py`): `cnsa-2.0`, `pci-dss-4.0`, `dora`, `hipaa`, `fedramp-rev5`. Manual controls are `MANUAL` (never `PASS`), an empty estate is `NOT_READY`, and each report carries a tamper-evident `pack_digest`.

### Evidence

| Method | Path | Description | Auth | Rate limit |
|---|---|---|---|---|
| `POST` | `/v1/evidence/create` | Append to SHA-256 hash-chained ledger (bounded in-memory) | `X-Api-Key` | 5/min |
| `POST` | `/v1/evidence/verify` | Verify chain integrity (`verify_chain`) | — | — |

Ledger is persisted as append-only JSONL at `/var/lib/qtrust` (Docker volume `qtrust-postgres-data` sibling); `GET /v1/evidence/verify` fails closed on tamper (Hypothesis property tests in `sdk/tests`).

### Roadmap

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/v1/roadmap/generate` | 5-phase migration plan + cost (`--daily-rate`) | — |
| `POST` | `/v1/plans` | Create AI migration plan (proxied to planner) | `X-Api-Key` (planner) |
| `GET` | `/v1/plans/{did}` | Get migration plan for an org (planner proxied) | `X-Api-Key` |

Planner proxy requires `QTRUST_PLANNER_API_KEY` (audit HIGH-1); returns `503` when planner is down. See `GPU_FEATURES.md` for GNN/RL details and `PERFORMANCE.md` for benchmark τ 0.975 (synthetic-scale, held-out).

### Assets

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/v1/assets/{id}` | CBOM asset by `0x` 32-byte id | — |
| `GET` | `/v1/assets/{id}/verify` | On-chain verification (`exists`, `active`, `org_did`, `chain_id`) | — |
| `GET` | `/v1/orgs/{did}/summary` | Indexer-backed org summary (`asset_count`, `migration_counts`, `latest_audit`) | — |
| `GET` | `/v1/orgs/{did}/assets` | List assets for an org (paginated) | — |
| `GET` | `/v1/orgs/{did}/migrations` | List migrations + progress + latest audit (paginated) | — |
| `GET` | `/v1/orgs/{did}/audit` | Latest audit for an org | — |
| `GET` | `/v1/migrations/{id}` | Single migration by id | — |
| `POST` | `/v1/write/assets` | Admin `registerCBOM` via relayer | `X-Api-Key` |

`GET /v1/assets/{id}` source: `services/verify.ts:getAsset`; `verify` adds chain-name resolution.

### Attestations

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/v1/vendors/{did}/attestations` | List attestations for a vendor (paginated) | — |
| `GET` | `/v1/products/{id}/support` | Check algorithm support for `?version=&algorithm=` | — |
| `POST` | `/v1/write/attestations` | Admin `attestProduct` via relayer | `X-Api-Key` |
| `POST` | `/v1/write/migrations` | Admin `recordMigration` via relayer | `X-Api-Key` |
| `GET` | `/v1/policies/{policyId}/versions/{version}` | Policy hash from `PolicyCommitment` | — |
| `GET` | `/v1/schemas/{schemaId}` | Schema from `SchemaRegistry` | — |
| `GET` | `/v1/trust-anchors/{issuer}` | Accreditation from `TrustAnchorRegistry` | — |
| `GET` | `/v1/revocation/{issuer}` | Revocation Merkle root from `RevocationAnchor` | — |
| `POST` | `/v1/evaluate` | Policy-based PQC readiness (`confidence` 0–1) | — |
| `POST` | `/v1/credentials/issue` | Issue W3C VC signed with Ed25519Signature2020 (`did:key` issuer) | `X-Api-Key` |
| `POST` | `/v1/credentials/verify` | Verify VC cryptographically (fail-closed: structure + expiry + Ed25519 sig vs issuer DID) | — |
| `GET` | `/v1/revocation/{issuer}` | Revocation root (duplicate listing for discoverability) | — |
| `POST` | `/v1/webhooks/subscribe` | Subscribe to events (Redis, encrypted secrets) | `X-Api-Key` |
| `POST` | `/v1/webhooks/unsubscribe` | Unsubscribe | `X-Api-Key` |
| `GET` | `/v1/webhooks/subscribers` | List subscribers by event | `X-Api-Key` |

Vendor attestation uniqueness is bounded by `MAX_ATTESTATIONS_PER_PRODUCT` (governor-settable [16,4096], default 256).

### Certification bundles

A certification bundle is a signed, self-contained snapshot of an org's assurance state: assets, migrations, vendor attestations and the latest audit, committed to a sha256 Merkle root and anchored to a block. Issuance is **validity-gated** — the API refuses (HTTP 409) rather than signing a claim the evidence cannot support. Verification is **offline by default** and works in TypeScript and Python against the same bytes.

| Method | Path | Description | Auth | Rate limit |
|---|---|---|---|---|
| `POST` | `/v1/certify` | Issue a policy-gated, signed bundle (409 = refused) | `X-Api-Key` | 10/min |
| `POST` | `/v1/certify/verify` | Verify structure + digest + Merkle + Ed25519 + validity; optional `trust_anchor_did` pin and `check_chain` re-anchor | — | 60/min |
| `GET` | `/v1/certify/policies` | List admission policies | — | — |
| `GET` | `/v1/certify/issuer` | Public identity of the key this deployment signs with, for pinning | — | 60/min |

Policies (`backend/src/services/certification.ts:getCertificationPolicy`):

| Policy | Requires assets | Requires audit | Max audit age | Revocation root | Verified-migration floor | Max validity |
|---|---|---|---|---|---|---|
| `default` | yes | no | 365 d | no | 0% | 365 d |
| `regulated` | yes | yes | 365 d | yes | 0% | 180 d |
| `strict` | yes | yes | 180 d | yes | 90% | 90 d |

```bash
# Issue (refusal returns 409 with the failed reasons)
curl -s http://localhost:3001/v1/certify \
  -H "Content-Type: application/json" -H "X-Api-Key: $QTRUST_API_KEYS" \
  -d '{"org":"0xYourOrg","policy":"regulated","validity_days":30}' > cert.json

# Verify offline — backend CLI (no RPC unless --chain)
cd backend && npm run certify:verify -- ../cert.json

# Verify offline — Python SDK (same bundle, byte-compatible canonicalisation)
python -m qtrust.bundle cert.json

# Discover the issuer DID to pin, then pin it (503 if no key is configured)
curl -s http://localhost:3001/v1/certify/issuer | jq -r .issuer
cd backend && npm run certify:issuer   # same value, read from the local config
```

The bundle commits evidence with a per-record `digest = sha256(canonical_json(record))` and a sorted-pair Merkle root, so dropping, reordering or editing any record fails verification. The Ed25519 signature covers the canonical bundle (everything except `proof`; `digest` covers everything except `digest`/`proof`). `check_chain: true` is the only path that touches the network and re-compares the anchored block hash.

An unpinned verification proves only that *some* Ed25519 key signed the content — pin the issuer you expect, with `verify_bundle(..., trust_anchor_did=...)` in the SDK, or read `GET /v1/certify/issuer` to learn what this deployment signs with. Rotation is an out-of-band event: see [`docs/runbook/issuer-key-rotation.md`](runbook/issuer-key-rotation.md).

### Relay (EIP-712 gasless)

All writes can be done gaslessly — vendors/orgs sign typed data off-chain, relayer submits. Every relay pre-checks the signer's on-chain role (audit H-3).

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/v1/relay/attestation` | Relay `SignedAttestationPayload` (EIP-712) | `X-Api-Key` + signature |
| `POST` | `/v1/relay/cbom` | Relay `SignedCBOMRegistrationPayload` | `X-Api-Key` + signature |
| `POST` | `/v1/relay/migration` | Relay `SignedMigrationPayload` | `X-Api-Key` + signature |
| `GET` | `/v1/relay/nonce/{did}` | Vendor nonce for EIP-712 | — |
| `GET` | `/v1/relay/cbom-nonce/{did}` | Org nonce for CBOM registration | — |
| `GET` | `/v1/relay/audit-nonce/{did}` | Auditor nonce (see `BASE_SEPOLIA.md:8`) | — |
| `POST` | `/v1/relay/audit` | Relay audit attestation (EIP-712) | `X-Api-Key` + signature |

Domain separator is per `block.chainid` (defensive, 6 contracts) with sequential nonces. Recovery validates `VENDOR_ROLE` (`VendorRegistry.attestProductSigned`) etc.

### GPU

Gated by `QTRUST_GPU_ENABLED=true` per request (`services/gpu-service.ts`); payloads reach Python via `backend/scripts/gpu_bridge.py` stdin JSON (no shell interpolation). Untrained detectors return `409`.

| Method | Path | Description | Auth | Notes |
|---|---|---|---|---|
| `GET` | `/v1/gpu/status` | GPU availability, model paths, accelerator | `X-Api-Key` | Always available |
| `POST` | `/v1/gpu/side-channel/analyze` | Timing side-channel CNN+LSTM analysis | `X-Api-Key` | Needs `QTRUST_SIDE_CHANNEL_MODEL`; 409 if untrained |
| `POST` | `/v1/gpu/anomaly/score` | CBOM anomaly VAE scoring (per-CBOM threshold) | `X-Api-Key` | Needs `QTRUST_ANOMALY_MODEL`; 409 if untrained |
| `GET` | `/v1/gpu/quantum/estimate/:bits` | Quantum threat estimate for RSA bits | `X-Api-Key` | `quantum_estimator.py` |
| `POST` | `/v1/gpu/rl/plan` | RL migration agent plan (`rl_policy` vs `heuristic_fallback`) | `X-Api-Key` | Reads `planner/rl_agent.pt` |

See `GPU_FEATURES.md` and `make -f Makefile.gpu help` for training.

---

## OpenAPI source & Swagger

* **File:** `backend/openapi.yaml` (OpenAPI 3.0.3, version 2.2.0, 56 paths, 20 tags — `health`, `scanner`, `gpu`, `assets`, `orgs`, `vendors`, `products`, `plans`, `write`, `relay`, `evaluate`, `credentials`, `certification`, `assurance`, `revocation`, `policies`, `schemas`, `trust-anchors`, `webhooks`, `legacy`).
* **Live JSON:** `GET http://localhost:3001/docs/json` (API-key protected in production)
* **Swagger UI:** `GET http://localhost:3001/docs` (API-key protected in production) — includes the `X-Api-Key` authorizer, request/response examples, and `TxResult`/`RelayResult` schemas.

To regenerate frontend types:

```bash
npx openapi-typescript backend/openapi.yaml -o frontend/src/lib/generated/api-schema.ts
```

CI verifies ABI drift (`scripts/generate_abis.py`) and OpenAPI is served via `@fastify/swagger` (`backend/src/server.ts:register`).

---

## Additional notes

* **Deprecation:** `GET /assets/{id}` and `GET /migration/progress/{org}` return `Deprecation: true`, `Sunset: 2026-12-31`, `Link: </v1/...>; rel="successor-version"`.
* **Idempotency:** asset/migration ids are deterministic content-addressed (`keccak256(canonical json)` — ADR 0006), duplicates revert.
* **SSRF safety:** webhook URLs are DNS-pinned; scanner targets are validated against private ranges.
* **Observability:** `/metrics` exposes `http_request_duration_seconds`, `indexer_lag_blocks`, `rpc_pool_unhealthy_endpoints`; alert rules in `ops/prometheus/alerts.yml`.

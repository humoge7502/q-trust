# Certification bundles & assurance analytics

Two capabilities extend the core discover → score → plan → attest pipeline into
audit-facing deliverables:

1. **Certification bundles** — a signed, tamper-evident, offline-verifiable
   snapshot of an organisation's PQC posture.
2. **Assurance analytics** — crypto-agility grading, CRQC/HNDL financial
   exposure and sector control crosswalks computed from the same CBOM.

Both are deliberately *evidence-preserving*: a bundle contains the records it
claims about, so a third party does not have to trust the issuer's database; and
an assurance pack reports `MANUAL` instead of silently passing controls it
cannot decide from machine evidence.

---

## 1. Certification bundles

### 1.1 What is signed

`POST /v1/certify` snapshots the current read model for an organisation:

| Evidence kind | Source | Counted in claims |
|---|---|---|
| `asset` | registered CBOM assets | `asset_count` |
| `migration` | recorded migrations + verification state | `migration_counts` |
| `attestation` | vendor product attestations | `attestation_count` |
| `audit` | latest on-chain audit | `latest_audit` |

Each record is canonicalised (sorted keys, compact separators, Python-compatible
string escaping), hashed with SHA-256, and committed through a sorted-pair
Merkle tree. The bundle body excludes `digest` and `proof`, so:

```
digest     = "sha256:" + sha256(canonical_json(bundle without digest, proof))
merkle_root = sorted-pair sha256 tree over leaf hashes
proof       = Ed25519Signature2020 over canonical_json(bundle including digest)
```

Issuer identity is a `did:key` Ed25519 key derived from
`QTRUST_VC_ISSUER_KEY` (a 32-byte hex seed, required in production). The same
key issues verifiable credentials, and `did:web` resolution is supported on the
verification side with an SSRF guard.

A bundle is **portable**: JSON in, JSON out, no database or RPC access needed for
offline verification.

### 1.2 Admission policies

Bundles are refused (HTTP 409, never signed) when the evidence cannot support
the requested claim. Policies are public:

| Policy | Requires asset evidence | Requires audit | Max audit age | Requires revocation root | Min verified migration ratio | Max validity |
|---|---|---|---|---|---|---|
| `default` | yes | no | 365 d | no | 0 | 365 d |
| `regulated` | yes | yes | 365 d | yes | 0 | 180 d |
| `strict` | yes | yes | 180 d | yes | ≥ 0.90 | 90 d |

A failed audit is always a refusal. `GET /v1/certify/policies` returns the live
registry (`qtrust.certification.default|regulated|strict`, schema
`qtrust.certification.v1`).

### 1.3 Issue

```bash
curl -sS -X POST "$QTRUST_API/v1/certify" \
  -H "x-api-key: $QTRUST_API_KEY" \
  -H "content-type: application/json" \
  -d '{"org":"0x1111111111111111111111111111111111111111","policy":"regulated","validity_days":30}' \
  > bundle.json
```

Responses:

| Status | Code | Meaning |
|---|---|---|
| 200 | — | signed bundle |
| 400 | `invalid_org` / `invalid_validity` / `invalid_evidence_limit` / `invalid_policy` | malformed request or unknown policy |
| 409 | `certification_refused` | evidence does not satisfy the policy; `reasons` lists every failure |
| 503 | `evidence_unavailable` | indexer/RPC unavailable — nothing is signed |

Rate limit: 10 requests/minute per caller.

### 1.4 Verify

```bash
curl -sS -X POST "$QTRUST_API/v1/certify/verify" \
  -H "content-type: application/json" \
  --data-binary @<(jq -n --slurpfile b bundle.json '{bundle:$b[0], check_chain:false}')
```

Verification is **fail-closed** and reports each check separately:

```json
{
  "valid": true,
  "bundle_id": "urn:uuid:…",
  "issuer": "did:key:z6Mk…",
  "subject": "0x1111…",
  "verdict": "CERTIFIED",
  "reasons": [],
  "caveats": [],
  "expired": false,
  "checked": {"structure": true, "digest": true, "merkle": true,
              "signature": true, "validity": true},
  "chain_anchor": "skipped"
}
```

Checks performed:

1. **Structure** — schema id, required fields, leaf shapes.
2. **Digest** — recompute the canonical digest and compare.
3. **Merkle** — recompute every record digest, the root, and the leaf count.
4. **Signature** — resolve the issuer DID and verify Ed25519 over the canonical
   payload; `verificationMethod` must be bound to the issuer DID.
5. **Validity** — `valid_from`/`valid_until`, with an explicit `expired` flag.
6. **Pinned issuer** (optional) — when `trust_anchor_did` is supplied, a bundle
   whose `issuer` differs fails the signature check even if the proof is
   cryptographically valid. This is the check that makes a bundle admissible
   against a known platform identity; without it, any self-signed bundle passes.
7. **Chain re-anchor** (opt-in, `check_chain: true`) — refetch the anchored
   block and compare `block_hash`; unavailable RPC yields `chain_anchor:
   "unavailable"` rather than a false pass.

`POST /v1/certify/verify` is public (60/min). Issuance is operator-key gated in
the same-origin proxy: the proxy never attaches the server-side admin key when
issuing, because a signed assurance claim is a platform-identity statement.

Add `"trust_anchor_did": "did:key:z6Mk…"` beside `check_chain` in the request to
pin the issuer. A bundle from a different key then fails even though its
signature verifies.

### 1.5 Offline verification

TypeScript (repository checkout):

```bash
cd backend
npm run certify:verify -- ../bundle.json          # offline
npm run certify:verify -- ../bundle.json --chain  # re-anchor on-chain
```

Python SDK:

```bash
pip install -e ./sdk
python -m qtrust.bundle bundle.json
# or
python -c "from qtrust import verify_bundle_file; print(verify_bundle_file('bundle.json').valid)"
```

Exit codes: `0` valid, `1` invalid, `2` unreadable/malformed input.

#### Browser verifier (`/certify`)

`frontend/src/app/certify/page.tsx` exposes the same check set without a
terminal: paste or load a bundle, optionally tick **Re-anchor to the chain**,
and read the per-check report. The browser does not re-implement any check —
it calls `POST /v1/certify/verify` through the same-origin proxy, so the UI and
the API cannot disagree about what "valid" means. The admission policies are
listed beside the form (and omitted gracefully when the backend is unreachable).

Coverage: `frontend/src/components/__tests__/certification-verifier.test.tsx`
(component states), `frontend/e2e/certify.spec.ts` (real browser, mocked API
contract) and `frontend/e2e/a11y.spec.ts` (axe on `/certify`). The golden path
was additionally exercised against the running backend with the committed
fixture: `valid: true`, five checks passed, `chain_anchor: "skipped"`.

The same fixture (`sdk/tests/fixtures/certification_bundle.json`) is issued by
the TypeScript service and verified by the Python SDK. CI regenerates it and
fails on byte drift, so canonicalisation, Merkle construction and signature
semantics cannot diverge between the two implementations.

### 1.6 Verification cost (measured)

```bash
cd backend && npm run certify:bench          # 2,000 iterations over the fixture
CERTIFY_BENCH_N=10000 npm run certify:bench
```

Measured on the development host (win32-x64, Node 24.16.0, 5-leaf fixture,
while a model-training job was using all cores):

| p50 | p95 | mean | throughput |
|---|---|---|---|
| 4.21 ms | 7.29 ms | 4.59 ms | ~218 verifications/s |

Ed25519 verification dominates; there is no network or database access. A
verifier can therefore check a bundle in the request path or in a batch job
without a service dependency. Re-run the command above before quoting a number
for different hardware.

### 1.7 Security properties and non-properties

Guaranteed:

- Any modification to a record, claim, digest, Merkle root, leaf count, or the
  signature is detected (individual record digest → Merkle root → Ed25519).
- A bundle cannot be extended with additional evidence without invalidating the
  Merkle root and the signature.
- An expired bundle is reported as expired even when its signature is valid.
- Issuance refuses rather than signs unsupportable claims.

Not guaranteed:

- **Truth of the underlying records.** The signature attests *what the platform
  observed*, not that a vendor's attestation is honest. Evidence URIs are
  included so a verifier can inspect the primary source.
- **Chain state at verification time.** Offline verification does not replay
  revocation or anchor state; use `check_chain` or query
  `/v1/revocation/:issuer` when current state matters.
- **Revocation of the issuer key.** Verification accepts an optional pinned
  trust anchor: `trust_anchor_did` in the Python SDK and in
  `POST /v1/certify/verify`, and the "Pinned issuer DID" field on `/certify`.
  Without a pin, a bundle signed by any self-consistent key is internally valid;
  pin the issuer before using a bundle for an admission decision. Operational
  key rotation and compromise handling are procedure, not crypto: see
  [Issuer Key Rotation](runbook/issuer-key-rotation.md).

### 1.8 Discovering the issuer identity to pin

Pinning needs the issuer DID *before* a bundle arrives, so the platform publishes
it:

```bash
curl -sS "$QTRUST_API/v1/certify/issuer" | jq
# {
#   "schema": "qtrust.certification.v1",
#   "issuer": "did:key:z6Mk…",
#   "verification_method": "did:key:z6Mk…#key-1",
#   "public_key_multibase": "z…",
#   "key_fingerprint": "<sha256 of the raw Ed25519 public key>"
# }
```

The same identity can be derived offline from the configured seed, which is how
a rotation is announced before it is deployed:

```bash
cd backend && QTRUST_VC_ISSUER_KEY=$NEW_SEED npm run certify:issuer
```

`/v1/certify/issuer` is a public read (no API key, reachable through the
dashboard's same-origin proxy) and reports the key the **currently running**
process signs with; it never exposes private material.

---

## 2. Assurance analytics

`POST /v1/assurance/report` runs the inspector's analytics over caller-supplied
findings (maximum 2,000). The bridge enforces a strict input contract and returns
an `input_digest` so a report can be tied to the exact evidence set.

```bash
curl -sS -X POST "$QTRUST_API/v1/assurance/report" \
  -H "x-api-key: $QTRUST_API_KEY" \
  -H "content-type: application/json" \
  -d '{
        "findings": [{"asset_id":"tls:example.com:443","algorithm":"RSA-2048",
                      "key_size":2048,"protocol":"tls_1_2","location":"example.com"}],
        "op": "report",
        "pack": "dora",
        "top": 5
      }'
```

| Field | Default | Notes |
|---|---|---|
| `op` | `report` | `report` (agility + CRQC + pack), `agility`, `crqc`, `packs` |
| `pack` | `cnsa-2.0` | `cnsa-2.0`, `pci-dss-4.0`, `dora`, `hipaa`, `fedramp-rev5` |
| `top` | 10 | 1–50 |
| `crqc` | `{}` | overrides: hazard rate, data lifetime, horizon, exposure value, trials, seed |
| `findings` | — | 0–2,000 records (an empty estate returns grade E / zero exposure) |

### 2.1 Crypto-agility grading

Six weighted factors per asset: algorithm posture, abstraction, configurability,
PQC migration path, observability, lifecycle. Scores map to grades A–E; the
estate report includes the distribution and the weakest assets. Grades are
explanations, not verdicts: each factor carries its points and evidence text.

### 2.2 CRQC / harvest-now-decrypt-later exposure

A Monte-Carlo model (`CRQCAssumptions`, default hazard rate and 30-year horizon)
combines per-asset data lifetime, exposure value and vulnerability class:

- post-quantum: 0.02, hybrid: 0.05, broken: 0.60 (exposure is immediate), classical
  asymmetric: 0.95.

Outputs include per-arrival-year exposure percentiles, probability of any
exposure, and the top exposed assets. The model is an assumption-driven risk
estimate, **not** a forecast; all assumptions are echoed in the response.

### 2.3 Sector packs

Each pack maps framework controls to machine-checkable predicates and reports
`PASS`, `FAIL`, `PARTIAL`, `MANUAL` or `NOT_APPLICABLE` with affected assets,
evidence text, remediation and a pack digest. A control that cannot be decided
from the CBOM is `MANUAL` — packs never overstate readiness.

---

## 3. Verification commands

```bash
# Backend: certification service, routes, policy gates and the TS→Python
# fixture contract (every file whose name contains "certif")
cd backend && npx vitest run certification certify-routes certify-docs

# SDK: byte-compatible verification + Hypothesis fail-closed properties
cd .. && python -m pytest sdk/tests/test_bundle.py sdk/tests/test_bundle_properties.py

# Inspector: agility, CRQC and every sector pack
python -m pytest inspector/tests/test_advanced_risk.py

# Regenerate the cross-language fixture. The bundle id is derived from the
# bundle's own content, so this is byte-reproducible, and CI compares a fresh
# regeneration against the committed file.
cd backend && npm run certify:fixture

# Mutation-test the certification service (see docs/TESTING.md for the score
# this is expected to hold)
cd backend && npm run test:mutation

# Measure offline verification cost on this host
cd backend && npm run certify:bench
```

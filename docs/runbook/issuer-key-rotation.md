# Issuer Key Rotation Runbook

Applies to the Ed25519 key that signs **certification bundles** (`POST /v1/certify`)
and **verifiable credentials** (`POST /v1/credentials/issue`). Both derive their
identity from one seed, `QTRUST_VC_ISSUER_KEY`, in `backend/src/services/vc.ts`;
the issuer DID is the `did:key` of the corresponding public key
(`<did>#key-1` is the verification method written into every proof).

Read this **before** you need it. Planned rotation is 20 minutes of work;
rotating under a suspected key compromise is the SEV1 variant at the bottom.

---

## 1. What rotation does and does not break

Understand these three properties before changing anything.

| Situation | After rotation | Why |
|---|---|---|
| Bundles issued with the **old** key | **Still verify** | A bundle carries `proof.verificationMethod` and a `did:key` issuer, which resolves offline without a registry. Nothing is looked up "live", so an old bundle keeps checking out until `valid_until`. |
| Bundles issued with the **new** key, checked against a **pinned old anchor** | **Rejected** (`issuer does not match the pinned trust anchor`) | Pinning is the auditor's control against substituted bundles. It is deliberately brittle: a new key is exactly the case where an auditor must opt in. |
| Continued trust in the **new** key | **Out of band** | Nothing in the bundle format links the old key to the new one. The handover is a governance act (this runbook), not a cryptographic one. Verification proves *which* key signed, never *who is allowed to sign next*. |

> Third-party verifiers that rely on `did:web` issuer DIDs (organisation DIDs,
> not the platform key) get continuity for free: rotate by publishing the new
> verification method in the DID document. `backend/src/services/vc.ts` binds
> `controller` to the issuer DID and honours `publicKeyMultibase` /
> `publicKeyJwk`. This runbook covers the **platform** key, which is a
> self-certifying `did:key` and therefore has no document to edit.

---

## 2. Planned rotation (quarterly, or on operator change)

### 2.1 Generate the new seed and learn its DID *before* deploying

```bash
# 32-byte hex seed. Store it in the secrets manager first, then keep the value.
NEW_SEED=$(openssl rand -hex 32)

# Print the identity this seed will produce, without starting the API.
cd backend && QTRUST_VC_ISSUER_KEY=$NEW_SEED npm run certify:issuer
# {
#   "schema": "qtrust.certification.v1",
#   "issuer": "did:key:z6Mk...",
#   "verification_method": "did:key:z6Mk...#key-1",
#   "public_key_multibase": "z...",
#   "key_fingerprint": "<sha256 of the raw public key, hex>"
# }
```

Record **both** fingerprints (old and new) in the change ticket. The
fingerprint is what an auditor compares when two bundles disagree about who
signed them.

### 2.2 Announce, then rotate, then prove

1. **Announce** the incoming `issuer` DID and fingerprint to every consumer
   that pins `trust_anchor_did` (see `sdk/README.md` and
   [Certification & Assurance](../CERTIFICATION_AND_ASSURANCE.md)). Give them
   the overlap window in step 2.3 — they need to widen their pin set *before*
   the switch, not after.
2. **Rotate the secret** where it is actually read:
   - Render: `deploy/deploy-render.ps1` maps `QTRUST_VC_ISSUER_KEY` from your
     local env; update the dashboard secret and deploy.
   - Docker/compose: set it in the environment file, restart the API.
   Verify the process picked the new identity:

   ```bash
   curl -sS "$QTRUST_API/v1/certify/issuer" | jq .issuer
   ```

3. **Issue a canary bundle** and verify it the way a customer would — offline,
   with the new key pinned, and with no chain access:

   ```bash
   curl -sS -X POST "$QTRUST_API/v1/certify" \
     -H "x-api-key: $QTRUST_API_KEY" -H 'content-type: application/json' \
     -d '{"org":"0x1111111111111111111111111111111111111111","policy":"default"}' \
     > canary.json

   cd backend && npm run certify:verify -- ../canary.json            # offline
   npm run certify:verify -- ../canary.json --chain                   # + re-anchor
   cd .. && python -m qtrust.bundle canary.json                       # cross-language
   ```

   All three must exit 0 and agree. If the Python SDK disagrees with the
   TypeScript verifier, **stop** — that is a canonicalisation regression, not a
   key problem (see the fixture job in `.github/workflows/ci.yml`).

4. **Publish** the new DID + fingerprint where consumers find it: the
   `/v1/certify/issuer` endpoint is the machine-readable source; mirror it in
   the status page or the customer-facing trust statement.

### 2.3 Overlap window

Do not delete the old secret until every bundle issued under it has expired —
`default` ≤ 365 d, `regulated` ≤ 180 d, `strict` ≤ 90 d per policy. Two
practical options:

- **Freeze issuance, keep one deployable copy.** Keep the old seed in escrow
  (offline, access-logged) and never let the running service hold two signing
  keys. Rotate the service to the new key immediately; old bundles stay
  verifiable because the key material travels inside them.
- **Dual-window issuance** (only if a consumer cannot re-pin in time): deploy
  the old key, issue their outstanding bundles, then switch. This is an
  extension of the compromise window, so prefer the first option.

### 2.4 Retire

After the last pre-rotation bundle expires (`valid_until` on the newest one is
the date to check): destroy the escrowed seed, close the ticket, and note the
retirement date next to the fingerprint register.

---

## 3. SEV1 — suspected key compromise

A leaked `QTRUST_VC_ISSUER_KEY` means anyone with it can mint bundles that pass
offline verification, because a `did:key` issuer vouches for itself. Rotation
alone does **not** revoke what the leaked key already signed, and offline
verification cannot know about the leak. Treat this as an integrity incident:

1. **Rotate now** — sections 2.1 and 2.2, skipping the announcement lead time.
2. **Tell verifiers to stop trusting the old DID** and to switch to
   chain-anchored checks while the exposure is triaged:

   ```bash
   cd backend && npm run certify:verify -- <bundle>.json --chain
   ```

   `--chain` (and `check_chain: true` on the API) re-reads the block anchor from
   the RPC and reports `chain_anchor: "mismatch" | "unavailable"` instead of
   `skipped`. An attacker with the key cannot forge an on-chain anchor, so
   during a compromise window `skipped` is not enough assurance.
3. **Enumerate exposure**: every bundle with the compromised
   `key_fingerprint` in the issuance window is suspect. Pull the issuer DID from
   `/v1/certify/issuer` history (or your issuance logs, which record
   `bundle_id`) and publish the list to affected customers.
4. **Revocation roots**: for orgs whose bundles claimed a revocation root
   (`regulated`, `strict`), re-check `/v1/revocation/:issuer` — the root is read
   from the `RevocationAnchor` contract at issuance time, so a stale root inside
   a suspect bundle is detectable on chain but *not* offline.
5. File the incident in [Incident Response](incident-response.md) — a signing
   key leak is SEV1 by that matrix's definition (broken signature guarantees).

---

## 4. Checks this runbook assumes are true

- `GET /v1/certify/issuer` answers without an API key and is reachable through
  the dashboard's same-origin proxy (`public-read`).
- `POST /v1/certify` is operator-only; the proxy never attaches the server-side
  admin key to it (see `frontend/src/lib/api-route-policy.ts`).
- Verification is fail-closed: an unknown proof type, a wrong-length signature,
  a non-canonical bundle or an expired window all yield `valid: false`.
- Rotation is *not* covered by the certification test suite's mutation gate on
  its own; the gate proves the verifier cannot be silently weakened, which is
  what makes pinning worth configuring. See `backend/stryker.config.json`.

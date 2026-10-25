# Q-Trust Complete Dataset Package

**Built:** 2026-09-18 · **Coverage:** every dataset the Q-Trust project demands
(verified against all data-loading code: `scripts/build_real_datasets.py`,
`scripts/train_real_models.py`, `scripts/train_qtrust_all.py`, `scripts/train_factory.py`,
`scripts/expand_real_corpus.py`, `scripts/expand_real_cbom.py`, `qtrust/models/risk/model.py`,
`qtrust/evaluation/run_all.py`, `dvc.yaml`, `planner/data/DATA_CARD.md`, `docs/TRUTH_AUDIT.md`).

## How to use

Extract at the **repository root** (paths overlay directly onto the repo):

```bash
cd q-trust/
tar -xzf q-trust-datasets.tar.gz          # creates/merges the directories below
```

Honest-labeling policy (per `docs/TRUTH_AUDIT.md`): every directory below carries a
`MANIFEST.json` with `status` = `REAL` or `SYNTHETIC_DEMO`. Never publish demo data as expert/enterprise results.

---

## 1. `qtrust_ai/artifacts/real_datasets/` — core real-dataset artifacts  [REAL]

Was **missing** from the repo; rebuilt by actually running the project's own builders.

| File | What it is | Status |
|---|---|---|
| `code_corpus.json` | **12,462 real code files (6,636 crypto-labeled)** from 34 GitHub repos (openssl, boringssl, aws-lc, mbedtls, wolfssl, botan, libgcrypt, liboqs, circl, bc-java, pycryptodome, … + non-crypto: numpy, pandas, react, go, node …) + Q-Trust_Dataset_Collection expansion (SolidiFI, SmartBugs, EIPs, WebAuthn) + OpenZeppelin/contracts + contracts/src. Labeled by the deterministic `CryptoCodeDetector` (seed 42) | REAL |
| `tls_scan.json` + `tls_scan.summary.json` | **Live TLS scan of 283 curated hosts, 275 succeeded (97%)** — run 2026-09-18 with `scripts/scan_hosts.py` | REAL (fresh) |
| `tls_inventory.json` | Per-host CBOMs derived from the live scan (schema = `build_real_datasets.scan_real_hosts`) | REAL (fresh) |
| `hosts.txt` | The 283 curated hosts (v1.1 list) | REAL |
| `nvd_cves.json` | **407 real CVEs (398 unique IDs) across 16 crypto libraries** (openssl, mbedtls, wolfssl, libsodium, bouncy-castle, python-cryptography, boringssl, aws-lc, botan, libgcrypt, cryptopp, gnupg, libressl, nettle, gnutls, nss) from NVD API 2.0, fetched 2026-09-18 | REAL (fresh) |
| `vendor_dataset.json` | 16 vendor-readiness records (real CVE counts × deterministic PQC KB) | REAL |
| `manifest.json` | Builder manifest with counts + provenance | — |

`cache/` (2.9 GB of repo tarballs used to build the corpus) is intentionally NOT in the
package — rebuildable with `python scripts/build_real_datasets.py --parts code`.

## 2. `Q-Trust_Dataset_Collection/` — real-world code corpora  [REAL]

Was **missing**; restored from the upstream public sources, directory names exactly as
`scripts/expand_real_corpus.py` expects (already merged into `code_corpus.json` above,
kept here as the primary source material):

| Directory | Contents |
|---|---|
| `SolidiFI-benchmark-master/` | 3,734 files — injected-bug Solidity benchmark contracts |
| `smartbugs-curated-main/` | SmartBugs curated vulnerable contracts (143 .sol) |
| `EIPs-master/` | Ethereum Improvement Proposals (asset contracts, 1,354 files) |
| `webauthn-main/` | W3C WebAuthn specification + test vectors |

## 3. `qtrust_data/` — the data lake (was empty: only `.gitkeep`)

| Layer | Contents | Status |
|---|---|---|
| `raw/` | 51 pristine immutable captures: all 42 real CBOMs, 5 liboqs trace files, uni/top500 CBOMs, cbom_for_planner, tls_scan (SHA-256 per file in MANIFEST) | REAL |
| `bronze/` | 277 normalized per-asset records (`train_real_models.normalize_asset`) | REAL |
| `silver/` | 277 feature rows in the **frozen 6-dim schema** (DATA_CARD Phase 0): alg_type/14, key_size/4096, vendor_pqc_ready, criticality/5, days_to_deadline/730, required_rate | REAL (derived) |
| `gold/cboms/` | The 42 real host-disjoint enterprise CBOMs (277 unique hosts, cross-CBOM overlap verified = 0) + MANIFEST — layout expected by `scripts/expand_real_cbom.py` | REAL |
| `gold/riskbench-v1/` | `pairs.jsonl` (10,000 pairs over 277 real-derived assets), `experts.json`, `manifest.json` — **exact `QTrustRiskBench.load_real()` schema**; **SYNTHETIC_DEMO** (QTRUST-001): generated with the project's own `generate_qtrust_risk_bench(seed=42)`, explicitly marked NOT human annotation. Real v1 still needs 5–10 human experts (schema + structure is ready) | SYNTHETIC_DEMO |
| `gold/migration-outcomes/` | 5,000 records in the exact `MigrationOutcome` schema (cost/failure predictor training shape). No public dataset exists for this — labeled SYNTHETIC_DEMO, replaceable via `mine_git_history()` | SYNTHETIC_DEMO |
| `gold/temporal/` | 200 org histories × 24 monthly `Snapshot`s (day/nodes/edges/risk) for TemporalGNN — SYNTHETIC_DEMO (QTRUST-003) | SYNTHETIC_DEMO |
| `splits/` | **REAL host-disjoint train/val/test over the 42 real CBOMs** (33/4/5, `repository_split` seed 42, 80/10/10, **host overlap verified = 0**). Makes `dvc repro` / `qtrust.evaluation.run_all` run with `is_demo: false` (verified) | REAL |
| `annotations/` | 277 weak labels over real TLS assets (LF name + confidence + expert-review flag per row) | REAL (weak) |

## 4. `planner/data/estates_v1/` — enterprise synthetic estates  [SYNTHETIC, deterministic]

500 migration graphs with `enterprise_topology=True` (DATA_CARD: "enterprise generator
switched on"; DVC path `planner/data/estates_v1`), native `.pt` (torch_geometric `Data`),
seed 42, 20–100 assets each, frozen 6-dim features. Generated by the project's own
`planner/qtrust_planner/data_generator.py`.

## 5. `planner/data/real_cboms_v2_2026_09_18/` — fresh CBOM corpus  [REAL]

38 new host-disjoint CBOMs packed from **today's live scan** (industry-grouped, 8 hosts/CBOM,
provenance per file) — extends the original 42-CBOM corpus with 275 fresh hosts.

## 6. `data/traces_v1/` + `inspector/data/traces_v1/` — side-channel traces  [REAL]

The 5 real liboqs timing captures (ML-KEM-512 encaps/decaps, ML-KEM-768 decaps,
ML-DSA-44 sign/verify; 10K samples each) copied to both canonical DVC paths
(DATA_CARD: `data/traces_v1`; `inspector/data/` is DVC-locked).

## 7. `qtrust/data/gold/gold.json` — discovery gold  [REAL code, scanner-labeled]

2,000 `GoldSample`-schema records sampled (seed 42) from the real code corpus — feeds
`scripts/train_factory.py --phase discovery`.

---

## Existing repo data (assessment — already good, keep as-is)

| Data | Verdict |
|---|---|
| `planner/data/real_cboms/*.json` (42 CBOMs) | **REAL, host-disjoint, leakage-free** (builder fixed 2026-08-29; verified host_overlap=0) |
| `research/data/real/traces_*.txt` (5 × 10K) | **REAL liboqs captures** — but only 3.5/10+ NIST parameter sets vs the DATA_CARD program target |
| `research/data/real/uni_cbom.json`, `top500_cbom.json`, `cbom_for_planner.json` | REAL single-estate scans |
| `inspector/benchmarks/corpus/*` (4 fixtures + ground truth) | REAL by design (small benchmark fixture set) |
| `planner/data/algorithms.json` | REAL NIST catalog |

## Known gaps that no dataset package can fully close

1. **RiskBench human annotations** — `qtrust_data/gold/riskbench-v1/` ships schema-complete
   synthetic demo data; real v1 requires 5–10 blinded human experts (5k–10k pairs).
2. **Trace corpus breadth** — DATA_CARD targets ≥10 PQC parameter sets + RSA/ECC baselines
   with multi-point power/EM capture; the 5 timing files cover ML-KEM-512/768 + ML-DSA-44.
   Capture more with the (planned) `trace_harness.c`.
3. **Migration outcomes** — inherently proprietary; mine real git histories via
   `qtrust/models/migration/cost.py:mine_git_history` when available.
4. **Enterprise estates at scale** — DATA_CARD target is ≥1K real org CBOMs; expand with
   `scripts/expand_real_cbom.py` (Tranco + CT logs) and scheduled volunteer-org scans.

## Verification

- All JSON/JSONL files parse; counts match the tables above (`SHA256SUMS.txt` at package root).
- `python -m qtrust.evaluation.run_all --splits qtrust_data/splits ...` → `is_demo: false`.
- `QTrustRiskBench.load_real()` → 10,000 pairs loaded.
- `torch.load(planner/data/estates_v1/estate_0000.pt)` → 34-node graph, 6-dim features.

## code_corpus_v2.json (2026-10-23)

Superset of `code_corpus.json` (untouched original): 14,664 files / 42 sources
(+691 files from tink-crypto/tink-java [250], tink-crypto/tink-cc [200],
pyca/pyopenssl [15], redis/redis [226 — negative control]). Transparent
keyword labelling; provenance in the `stats.expansion` block; builder:
`scripts/expand_code_corpus.py`. CryptoAPI-Bench / ApacheCryptoAPI-Bench are
deliberately excluded (evaluation-only, protects E-08). The detector has NOT
been retrained on v2 — v1 metrics remain canonical until that retrain.

## code_corpus_v3.json (2026-10-24)

Superset of v2 (untouched): **16,100 files / 50 sources** (+1,436 from 8 new
GitHub sources — Mbed-TLS/mbedtls, golang/crypto, ziglang/zig [new language],
RustCrypto/hashes [new language], spring-projects/spring-security,
nextauthjs/next-auth, django/django [negative control], git/git). Transparent
keyword labelling; provenance in `stats.expansion`; builder:
`scripts/expand_code_corpus_v3.py`. Repo-disjoint split (seed 42): 12,919
train / 3,181 eval across 40/10 repos; three new sources sit in eval, making
the held-out set strictly harder than v1's (new languages: Rust, Zig).
CryptoAPI-Bench / ApacheCryptoAPI-Bench remain evaluation-only (E-08).
Detector fine-tuned on v3: see EXPERIMENTS.md E-13; v1 F1 0.9395 remains the
canonical benchmark until v3 results are recorded there.

### Protocol correction (2026-10-24)

The v3 report above used the **legacy** split in
`scripts/train_qtrust_all._code_splits`, which shuffled the *source list* and
therefore reshuffled every repository when the corpus grew. That made the v3
report and any later corpus non-comparable, and allowed the shipped v3
checkpoint to have seen 9 of the 12 repositories in an independently computed
holdout. The legacy number is retained for lineage but must not be compared
with v4.

Training now uses `qtrust_ai/discovery/data_split.py`: a keyed SHA-256 bucket
per source. A source's side of the split never changes when other sources are
added. The default buckets are 20 % evaluation, 10 % calibration, 70 % fit,
with no source overlap. The calibration split is used only for temperature
scaling and threshold selection.

## code_corpus_v4.json (2026-10-24)

Superset of v3 (untouched original): **17,171 files / 58 sources** (+1,071
files from 8 additional PQC-dense / modern-crypto repositories):

| Source | Files | Crypto | Why it was added |
|---|---:|---:|---|
| `PQClean/PQClean` | 220 | 126 | reference ML-KEM / ML-DSA / SPHINCS+ / Falcon / HQC implementations |
| `nss-dev/nss` | 200 | 91 | Mozilla NSS `freebl` / `softoken` / `ssl` — mature C crypto |
| `gnutls/gnutls` | 200 | 171 | GnuTLS C TLS implementation |
| `bitcoin-core/secp256k1` | 128 | 69 | C ECC anchor (ECDSA/ECDH) |
| `dalek-cryptography/curve25519-dalek` | 77 | 36 | Rust Ed25519 / X25519 |
| `panva/jose` | 47 | 20 | Node JWE/JWS/JWK |
| `RustCrypto/AEADs` | 39 | 18 | Rust AES-GCM / ChaCha20-Poly1305 |
| `ethers-io/ethers.js` | 160 | 17 | Ethereum / Solidity-ecosystem JS crypto |

Transparent keyword labelling; provenance in the `stats.expansion` block of
the corpus; builder: `scripts/expand_code_corpus_v4.py`. The builder reports
token-free/master tarball provenance and the exact per-source file cap (200
for most sources, whole small repositories).

The near-duplicate audit
(`scripts/paper_near_dup.py --corpus-version 4 --stable`) found **zero**
evaluation/fit pairs at Jaccard ≥ 0.80 or ≥ 0.95; the maximum was 0.5598 and
the p99 was 0.0037. The v4 corpus therefore does not rely on copied code
leaking across the split.

CryptoAPI-Bench / ApacheCryptoAPI-Bench remain evaluation-only (E-08). See
`qtrust_ai/artifacts/model_comparison_stable.md` for the v3-stable vs v4-stable
result and the promotion decision.

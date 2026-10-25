# Q-Trust Truth Audit — Day 1-14 Integrity (QTRUST P0)

Every number displayed by Q-Trust must be classified (Phase 0, §4):

| Metric | Value | Source | Training | Validation | Status |
|---|---|---|---|---|---|
| Discovery F1 0.952 | REAL (expanded 13,973-file corpus, repo-disjoint held-out) | real code corpus 14k (incl. SolidiFI/SmartBugs/EIPs/WebAuthn) | CodeBERTa GPU fine-tune on A100 (epoch count not recorded in the shipped artifact; script default `--hf-epochs 2`) | repo-disjoint 30→8 split (38 repos, seed 42; 11,558 train / 2,415 eval files — verified by re-running `_code_splits`) | **REAL — major improvement (was 0.841)** — +0.11 F1 from expanded real blockchain code corpus |
| GNN τ 0.971 in-dist | REAL (synthetic held-out) | 60k synthetic + 37 real CBOMs | **BatchNorm1d GNN (legacy)** — LayerNorm is now the default; retrain with `norm="layer"` before validated claim (see `planner/qtrust_planner/model_v3.py` AUDIT NOTE) | host-disjoint 80/20 | **SYNTHETIC L1** — do not claim enterprise |
| GNN real-CBOM LOO τ-b ≈0.73 | **REAL (out-of-sample, 40-fold COMPLETE)** | 40 host-disjoint real TLS CBOMs (280 hosts), leave-one-out | 30-epoch real fine-tune per fold on A100, folds sharded across 4 GPUs, deterministic-kernel harness (re-run 2026-09-02; 3-fold repro bit-identical to merged shards) — **trained with BatchNorm1d (legacy normalization)** | τ-b **0.7263** vs heuristic **0.7450** (Δ **−0.0188**; 60-epoch overfits, Δ −0.0545); **reproduces the doctrine on 38/40 folds** (0 wins / 38 ties / 2 losses, both n≤13); +0.503 vs random | REAL — 40 CBOMs, 30-epoch fine-tune is the best out-of-sample operating point; **caveat: the v3 checkpoints use BatchNorm1d, which leaks cross-graph statistics under PyG batching (model_v3 AUDIT NOTE, resolved 2026-10-23). Retrain with `norm="layer"` (now the default) before presenting these LOO numbers as validated. The pre-fix τ-b 0.7377 (39/40) is superseded by the deterministic run |
| Risk τ (synthetic demo) | SYNTHETIC | features → synthetic expert formula | RF | synthetic prefs | **DEMO ONLY** (QTRUST-001) — NOT expert |
| WhatIf 43h/4.6%/8.2%/94% | **DEMO FABRICATED** | hard-coded (§QTRUST-002) | — | — | DEMO — production must call calibrated models with intervals |
| Digital Twin 0.6*last | **SIMULATED PLACEHOLDER** (§QTRUST-003) | deterministic growth | — | — | DEMO — requires graph+CP-SAT |
| Graph edges | **SYNTHETIC DEMO** linear chain (§QTRUST-004) | CBOM assets → asset-0→1→2 | — | — | DEMO — replace with imports/calls/SBOM |
| RL agent on real CBOMs | **REAL (out-of-sample on 40 packed real CBOMs)** | 40 packed real-CBOM estates, greedy rollout | PPO on real-CBOM packs (risk labels derived from real scan fields: RSA-1024 → critical, RSA-2048 → high, expired/near-expiry raise the class) | mean reward **140.34** ± 8.13 vs heuristic **140.62** (Δ −0.28 — **tie**) vs random **136.84** (+2.6%), 100% completion (2/40 wins · 27 ties · 11 losses) | **REAL — learns risk-priority and matches the doctrine** (archived 130.20 vs 112.40 “beats heuristic” was NOT reproducible — every real asset defaulted to the builder's `criticality: medium`, zero reward signal; fixed and re-measured 2026-09-02) |
| Real CBOM 39 | REAL (prototype, QTRUST-006) | 277 TLS hosts → 37 CBOMs host-disjoint | — | — | REAL but target 1k orgs / 10k CBOMs |
| Side-channel detector | **REAL (5/5 class-accurate)** | real liboqs ML-KEM-512/768, ML-DSA-44 timing traces | 60-epoch CNN train on real traces + injected leaks | 5/5 clean → VERIFIED (0.05), 5/5 leak → HIGH_RISK (0.95) | REAL — calibrated on liboqs timing data |
| Contracts 11 UUPS | **UNAUDITED** (§QTRUST-010) | no external audit, no Sepolia, EOA governance, backend relayer | — | — | P0 blocker |

**Policy:** Any benchmark using synthetic expert/WhatIf/Twin/graph must be labeled `synthetic` (Level 1) and never published as `expert` or `enterprise` performance. Real RiskBench requires `qtrust_data/gold/riskbench-v1/` human annotations (5-10 experts, 5k-10k pairs, blinded, adjudicated, inter-rater κ).

**Leakage audit (2026-09-06, empirical):** Repo-level split integrity confirmed — re-running `_code_splits(seed=42)` on the 13,973-file corpus reproduces 30 train repos / 8 eval repos with 11,558/2,415 files and **zero repo overlap**. Cross-repo exact-duplicate code snippets (vendored/test-fixture copies): 11 distinct snippets affecting 58 files (0.4% of corpus); exact full-record train/eval overlap: 11 files (0.46% of eval) — organic cross-repo copies, not split manipulation; effect on held-out F1 bounded well below the 0.11 claimed gain. Vendor dataset (16 records): zero duplicates. No host-level leakage: CBOM builder guarantees each host lands in exactly one CBOM (`scripts/build_real_cboms.py`), and LOO folds are host-disjoint.

**Artifact lineage:** Every prediction stores `model_version + dataset_hash + feature_schema + policy` → Merkle → chain (§42, `qtrust/data/lineage.py`).

## Addendum — outcome-based evaluation & calibration (2026-10-23)

| Claim | Classification | Evidence |
|---|---|---|
| "GNN beats heuristic under the quantum-risk-days objective" | **REAL (simulation-grounded)** | `planner/results/outcome_loo_42.json` (E-09): GNN QRD ratio 1.0000 vs heuristic 1.0473 over the 42 host-disjoint estates, 40/2/0 wins, Wilcoxon p=1.7e-08; precedence probe GNN 1.049 vs Smith 1.065 vs heuristic 1.128. Labels are generated by the transparent execution simulator `qrd-sim/1.0` (`planner/qtrust_planner/outcome_sim.py`, SIM_SPEC_VERSION pinned) applied to real CBOM structure — **simulation-grounded, NOT observed org outcomes**. Smith's rule ties the GNN on the edgeless real estates; the GNN's unique edge is dependency-dense estates. The E-06 formula-label tie (τ-b 0.7168 vs 0.7210) is NOT superseded and remains the reported formula-label result. |
| "Detector confidence is calibrated" | **REAL (cross-fitted)** | `qtrust_ai/artifacts/calibration.json` (E-10): temperature T=1.2142 shipped, ECE 0.1557→0.1387 (−10.9%), Brier 0.0697→0.0692, 5-fold cross-fitted selection (temperature beat Platt). Ranking/F1 unchanged (monotone). "Calibrated" must be stated as *improved*, not *solved* — residual ECE 0.1387 dominated by the class-0 tail under the paper's ECE convention. |
| Corpus v2 (14,664 files / 42 sources) | **REAL, NOT YET TRAINED ON** | `qtrust-datasets/code_corpus_v2.json` (E-11). v1 F1 0.9395 remains canonical until a GPU retrain + repo-disjoint re-eval on v2; no v2-based number may be cited yet. CryptoAPI-Bench/ApacheCryptoAPI-Bench stay evaluation-only (protects E-08). |

**Also closed this pass:** TD-02 (`planner/checkpoint_manifest.json` — flags `model_ddp_v3.pt` + `rl_agent.pt` as raw state dicts without lineage), TD-04 (`.github/workflows/invariant-fuzz.yml` nightly high-run Foundry invariant fuzzing), TD-05 (`scripts/verify_all.sh` now 3 parallel lanes, `VERIFY_ALL_SERIAL=1` for old behaviour).

## Addendum — corpus v3, planner strengthening, CPU-budget detector attempt (2026-10-24)

| Claim | Classification | Evidence |
|---|---|---|
| "Planner strengthened by more synthetic data" | **REAL (simulation-grounded)** | E-12 (`planner/results/planner_strengthening.json`): probe ratio 1.0421±0.0046 → 1.0293±0.0013 with 4× synthetic data / 70 epochs; real estates 126/126 at optimum in both configs. qrd-sim/1.0 objective; synthetic-baseline probe. |
| "Detector retrained on corpus v3" | **REAL but NOT an improvement — do not cite as one** | E-13: same-eval comparison shows the CPU-budget v3 model (F1 0.8319) LOSES to the shipped v1 checkpoint (0.9033) on identical files. v3 artifacts (`crypto_codebert_v3/`, `training_report_v3.json`, `calibration_v3.json`, `v1_vs_v3_same_eval.json`) are kept as records; `crypto_codebert` canonical artifacts and F1 0.9395 are untouched. |
| Corpus v3 (16,100 files / 50 sources) | **REAL, NOT YET USED BY A STRONGER MODEL** | `qtrust-datasets/code_corpus_v3.json`; the GPU retrain that could beat 0.9395 on the harder split has not run (CPU-only machine). |
| RL PPO checkpoints now carry lineage | **REAL (forward-looking)** | `train_agent_ppo` saves state_dict + config + seed + protocol (`planner/tests/test_rl_agent.py` asserts it). Existing `rl_agent.pt`/`model_ddp_v3.pt` remain NO-LINEAGE until next retrain. |

# Q-Trust Experiment Register

Records for ML experiments and empirical validations. Metrics are copied from artifacts or measured live — never estimated.

## E-01 — GNN GPU training smoke (executed 2026-09-06)
- **Hypothesis:** the project's own training path (`qtrust_planner.train`) runs correctly on the available CUDA A100 and improves validation τ.
- **Setup:** `python3 -m qtrust_planner.train` with output to `/tmp` (no tracked checkpoint touched); project defaults; CUDA 1-device.
- **Result:** val τ 0.922 → 0.927 across epochs; checkpoint saved; exit 0.
- **Conclusion:** training path healthy on GPU. Smoke validation only — not a hyperparameter experiment.
- **Artifacts:** `/tmp` checkpoint (discarded by design; no repo change).

## E-02 — RL agent training smoke (executed 2026-09-06)
- **Hypothesis:** `scripts/run_rl_train.py` completes and its checkpoint loads on CUDA and drives `/rl/plan`.
- **Result:** training completed; checkpoint loaded via the planner's resolution chain; inference ran on CUDA.
- **Conclusion:** full RL train→load→serve loop validated end to end.

## E-03 — Planner latency under the new validation gate (executed 2026-09-06)
- **Hypothesis:** the 422 validation gate + asset cap (PR #51-era fix) does not regress `/plan` latency.
- **Method:** local uvicorn with rate limit disabled, 150 requests per size, `/tmp` harness, measured p50/p95.
- **Result:** p50 28–123 ms, p95 43–337 ms across 50–2,000 assets.
- **Conclusion:** no regression; numbers recorded in `docs/PERFORMANCE.md`. Rate limiter verified separately (kicked in correctly when limit was low).

## E-04 — Dataset leakage audit (executed 2026-09-06; recorded in TRUTH_AUDIT.md)
- **Hypothesis:** the F1 0.9395 discovery claim could be invalidated by split leakage.
- **Method:** re-ran `_code_splits(seed=42)` on the 13,973-file corpus; hashed every file for cross-repo exact duplicates; computed full-record train/eval overlap; scanned the 16-record vendor dataset for duplicates.
- **Result:** split reproduces exactly (38 repos → 30 train / 8 eval; 11,558 / 2,415 files; zero repo overlap). Cross-repo duplicate snippets: 11 affecting 58 files (0.4%). Full-record train/eval overlap: 11 files (0.46% of eval). Vendor dataset: 0 duplicates.
- **Conclusion:** split discipline holds; duplication is organic and bounded far below the claimed +0.11 F1 gain. Claim stands as scientifically defensible.

## E-05 — Benchmark artifact coherence check (executed 2026-09-06)
- **Hypothesis:** README headline claims trace to internally coherent artifacts.
- **Result:** `benchmark_comparison.json` — seed 42, n=2,415, P 0.9279 / R 0.9514 / F1 0.9395, baselines recorded, 6/7 models beat best baseline, mean relative gain 1.55×; RL artifact matches README exactly; LOO τ-b 0.7263 matches.
- **Conclusion:** all traced claims verified; the two stale citations found in this engagement were corrected (README SDK API, TRUTH_AUDIT split/epoch wording).

## Pre-existing experiments (authoritative, from TRUTH_AUDIT.md)
CodeBERTa fine-tune (F1 0.9395, repo-disjoint held-out), GNN LOO τ-b 0.7263 across 40 real CBOMs (deterministic-kernel re-run, bit-identical 3-fold repro), RL on real CBOMs (reward 140.34 ± 8.13 vs heuristic 140.62 — tie), side-channel detector (5/5 on real liboqs traces). These are recorded in `docs/TRUTH_AUDIT.md` with lineage and are not re-derived here.

## E-06 — 42-fold LOO on GPU, host-disjoint 42-CBOM corpus (executed 2026-09-18)
- **Hypothesis:** GNN ranking holds out-of-sample on the fixed 42-CBOM corpus (277 unique hosts, 0 overlaps — replaced the leaky 40-file corpus with 11 cross-CBOM dupes).
- **Setup:** 2× A100, 30-epoch fine-tune, seed 42. Report: `planner/results/real_cbom_loo_42.json` (+2 shard files); 40-fold files kept as historical records.
- **Result:** model τ-b 0.7168 vs doctrine heuristic 0.7210 (Δ −0.0042, medians identical 0.7237) — 0 wins / 41 ties / 1 loss, model top-10 1.0 on all 42 folds, +0.687 vs random.
- **Conclusion:** honest tie with the heuristic out-of-sample; no superiority claim. Closes R-03 for the GNN leg.

## E-07 — Side-channel retrain on 54 real trace sets (executed 2026-09-18)
- **Setup:** `train_real_side_channel.py --traces-dir /tmp/real_data`, 54 sets, loss 0.178→0.080, anchors 0.000/1.000. Weights: `inspector/side_channel_model_real.pt` (previous backed up before overwriting; SHA in `models.sha256`).
- **Result:** clean 46 VERIFIED + 8 LOW_RISK (0 false alarms); leak-injected 51/54 HIGH_RISK (misses: FALCON1024/FALCON512/SLH-256s keygen, n≤200).
- **Conclusion:** retrain validated; residual misses recorded, not hidden.

## E-08 — External head-to-head on public crypto benchmarks (measured 2026-09-18)
- **Setup:** deterministic scanner layers (`CryptoCodeDetector(seed=42)`, static + AST — no HF weights), `scan_file` per case. Records: `benchmarks/external/results/cryptobench_filelevel.json`, `apache_filelevel.json`. Report: `benchmarks/external/HEAD-TO-HEAD.md`.
- **Result:** CryptoAPI-Bench (203 files: 187 misuse, 16 secure) usage recall 164/187 = 0.877, file-level misuse precision 164/176 = 0.932; Apache (71/121 mapped, 50 absent from shipped jars — unevaluable, stated) recall 33/34 = 0.971, file-level P 0.532 / F1 0.688 (FPs are a file-level artifact; line-level scoring rejected after proving GT-line vs jar-source version drift).
- **Conclusion:** usage-discovery framing, no SOTA superiority claim (CryptoGuard/CogniCrypt/GPT-4 measure misuse detection — a different task). Closes the "formal benchmark vs named external systems" gap honestly.

## E-09 — ACVP oracle verification + liboqs KATs (executed 2026-09-18)
- **Setup:** placed corpus `inspector/data/acvp/ACVP-vectors/` (34 families); independent oracle via platform stack (`cryptography`/`hashlib`), not the code under test. Tests: `inspector/tests/test_acvp_vectors.py`, `test_liboqs_kats.py` (12 passed).
- **Result:** ECDSA-SigVer 196, RSA-SigVer 270, EdDSA-SigVer 20, SHA2-256 517, HMAC-SHA2-256 150 verified against NIST expected results; liboqs KATs 6/6 PQC match published hashes (skip cleanly without binaries). PQC ACVP vectors placed as fixtures, explicitly NOT claimed as verified here.
- **Conclusion:** placed corpus is a sound oracle chain for future conformance work; skipped-test debt from `inspector/tests/test_v1.py:738` retired for the classical families.

## E-09 — Outcome-based LOO: GNN vs heuristic under quantum-risk-days (executed 2026-10-23)
- **Hypothesis:** under an *outcome* objective the shipped static heuristic is no longer the ceiling by construction, and a learned sequence planner beats it out-of-sample. (Under the formula-label LOO [E-06] the heuristic *is* the label generator — its τ-b 0.7210 equals the mean per-fold tie ceiling √(d/n₀); no model can win that comparison.)
- **Setup:** transparent execution simulator `qrd-sim/1.0` (`planner/qtrust_planner/outcome_sim.py`): sequential migration, deterministic per-asset durations, exposure rate = quantum-vulnerability × criticality, objective QRD = Σ w·C (1|prec|ΣwⱼCⱼ); every ranking executed via the same dependency-feasible list-scheduling projection; exact optimum via subset DP (verified against brute force in tests). LOO over the same 42 host-disjoint estates; per fold a fresh MigrationGNNv3 (norm=layer, 10-dim outcome features incl. durations + exposure + dependency degree) trained on the other 41 estates (optimal labels, ×6) + 200 seeded synthetic dependency-DAG estates; 40 epochs, seed 42, CPU. Harness: `scripts/eval_outcome_loo.py`; tests: `planner/tests/test_outcome_sim.py` (23).
- **Result** (`planner/results/outcome_loo_42.json`): QRD ratio (achieved/optimal, lower better) — **GNN 1.0000** vs heuristic 1.0473, Smith's rule 1.0000, random 1.0226. GNN vs heuristic: **40 wins / 2 ties / 0 losses, Wilcoxon p = 1.7e-08**, mean Δ 0.047. Precedence probe (40 dependency-dense synthetic estates): **GNN 1.0493 < Smith 1.0651 < heuristic 1.1282** < random 1.3546 — the learned planner beats the closed-form Smith baseline precisely where precedence constraints bind. Heuristic τ-b vs optimal order −1.0 (it orders vendor-ready PQC assets first — zero-exposure items — inverting the optimal sequence).
- **Honesty:** simulation-grounded labels from real CBOM structure + documented assumptions (SIM_SPEC_VERSION pinned) — NOT observed org outcomes. Smith's rule also attains 1.0000 on the edgeless real estates, so the deployable *product* win is outcome-aware sequencing (Smith/GNN), with the GNN uniquely handling dependency-dense estates. No formula-label claim is superseded: E-06's tie stands as reported.

## E-10 — Detector confidence calibration (executed 2026-10-23)
- **Hypothesis:** the CodeBERTa detector's raw sigmoid is systematically under-confident (paper eval: ECE 0.1557, Brier 0.0697, base rate 0.767); monotone post-hoc calibration improves trustworthiness without touching ranking.
- **Setup:** `qtrust_ai/discovery/calibration.py` + `scripts/calibrate_codebert.py`; 5-fold cross-fitted temperature vs Platt scaling on the 2,415 held-out predictions (`paper/analysis/codebert_predictions.jsonl`); model selected by cross-fitted ECE; shipped artifact `qtrust_ai/artifacts/calibration.json` applied opt-in in `code_detector._ml_layer`. Tests: `qtrust_ai/tests/test_calibration.py` (17).
- **Result:** temperature wins cross-fitted (T per fold 1.206–1.237, shipped median 1.2142); **ECE 0.1557 → 0.1387 (−10.9%)**, Brier 0.0697 → 0.0692. Ranking-invariance asserted in tests (monotone transform); F1 0.9395 unchanged.
- **Honesty:** the ECE convention (mean confidence vs hard-prediction accuracy) is the paper's own and is matched exactly — the residual 0.1387 is dominated by the class-0 tail the convention penalises; reported as-is.

## E-11 — Corpus v2 expansion (executed 2026-10-23)
- **Setup:** `scripts/expand_code_corpus.py` — 4 new GitHub sources absent from the 39-source v1 (tink-crypto/tink-java 250 files, tink-crypto/tink-cc 200, pyca/pyopenssl 15, redis/redis 226 as negative control), transparent keyword labelling, original corpus untouched; v2 written to `qtrust-datasets/code_corpus_v2.json`.
- **Result:** 14,664 files / 42 sources (+691; +205 crypto-labelled). CryptoAPI-Bench and ApacheCryptoAPI-Bench deliberately kept evaluation-only to protect E-08's head-to-head from train contamination.
- **Next:** retrain the detector on v2 (GPU) and re-run the repo-disjoint eval before citing new F1; v1 numbers remain canonical until then.

## E-12 — Planner strengthening: synthetic-data sweep on the precedence objective (executed 2026-10-24)
- **Hypothesis:** E-09's precedence probe (GNN 1.0493 vs Smith 1.0651) improves with more synthetic dependency-dense training data and longer training.
- **Setup:** `scripts/strengthen_planner_outcome.py` — fixed never-trained probe (40 synthetic estates, seed 999_999, 8–12 assets), configs A = E-09 recipe (200 synthetic / 40 epochs) vs B = 4× data / 70 epochs; 3 seeds each; real-estate regression check in the same runs. CPU.
- **Result** (`planner/results/planner_strengthening.json`): probe ratio A **1.0421 ± 0.0046** → B **1.0293 ± 0.0013** (mean gap-to-optimum −31%, variance −3.5×). Real estates: **126/126 evaluations at the exact optimum in both configs** (no regression). Probe baselines: heuristic 1.1631, Smith 1.0759 — the strengthened GNN beats Smith by a wider margin (1.0293 vs 1.0759) and sits within 2.9% of the exact optimum where no closed-form baseline can use the dependency structure.
- **Conclusion:** the outcome planner is measurably stronger with 4× synthetic data; adopted as the recommended training recipe (config B). E-09's headline (real estates at the optimum) is preserved exactly.

## E-13 — Corpus v3 + detector CPU-budget fine-tune: honest negative on the same eval (executed 2026-10-24)
- **Setup:** corpus v3 (16,100 files / 50 sources; 8 new GitHub sources incl. mbedtls, golang/crypto, ziglang/zig, RustCrypto/hashes, spring-security, next-auth, django, git — two NEW languages). Repo-disjoint split (seed 42): 12,919 train / 3,181 eval / 40+10 repos; 3 new sources land in eval, so the held-out set is strictly harder than v1's (new languages Rust, Zig; base rate 51.5% vs 76.7%). Fine-tuned CodeBERTa on CPU (`scripts/train_discovery_v3.py`): 2 epochs / max_len 128 / batch 32 (a 4-epoch/256-len attempt measured ~6× the naive time estimate and was retired — see script docstring).
- **Result:** on the v3 eval, v3 model F1 **0.8371**; the DECISIVE same-eval comparison (`scripts/compare_v1_v3_checkpoint.py`, artifact `qtrust_ai/artifacts/v1_vs_v3_same_eval.json`): **v1 GPU checkpoint 0.9033 vs v3 CPU-budget 0.8319 (Δ −0.071)** — precision collapses 0.941→0.810. Per-language: v3 wins only on C (0.23→0.32, n=42, both poor) and ties Java/JS; it loses Go (0.83→0.76), Rust (0.75→0.70) and Solidity (0.82→0.42). Calibration refit on v3 predictions: ECE 0.344→0.245 (T=1.92) — worse than the canonical model's 0.156, consistent with undertraining.
- **Conclusion (negative, recorded as such):** the CPU-budget fine-tune does NOT strengthen the detector — undertraining dominates any data benefit; the canonical 4-epoch/256-len GPU recipe and its F1 0.9395 remain the shipped model and the canonical benchmark. The corpus v3 expansion + harder split + comparison harness are durable assets: the NEXT GPU retrain (4 epochs, 256 len, corpus v3) is the experiment that can actually beat 0.9395, now with a strictly harder honest eval waiting for it. No v3-based number may be cited as an improvement.

## E-14 — Corpus v4 + detector CPU retrain at max_len 256 (executed 2026-10-25; clean result, leakage-corrected)
- **Motivation:** E-13 recorded a negative — the 128-len CPU fine-tune undertrained and collapsed Solidity F1 (0.82→0.42) via truncation. Two levers target it: (a) **more PQC-dense data**, (b) **max_len 128→256** so the first training window (4,096 chars) actually contains contract bodies instead of license/import headers.
- **Setup:** corpus v4 (`scripts/expand_code_corpus_v4.py` → `qtrust-datasets/code_corpus_v4.json`): 17,171 files / 58 sources / 8,814 crypto. +8 PQC-dense/modern-crypto repos over v3: PQClean (126 crypto), GnuTLS (171), NSS (91), secp256k1 (69), curve25519-dalek, panva/jose, RustCrypto/AEADs, ethers.js. Retrain via `scripts/train_discovery_v4.py`: 3 epochs / **max_len 256** / **batch 16** (halved after two batch-32 runs segfaulted mid-epoch on this Windows host; per-epoch checkpoints make resume cost at most one epoch), CPU (no GPU on this host; system py3.13.6 = only interpreter with torch 2.14.1+cpu). Checkpoint `qtrust_ai/artifacts/crypto_codebert_v4/`.
- **CRITICAL split-refactor caveat (honesty):** `train_qtrust_all._code_splits` now resolves to the digest-keyed stable split (`qtrust_ai/discovery/data_split.py`), NOT the `random.Random(seed).shuffle` tail-20% used when E-13 and `v1_vs_v3_same_eval.json` were produced. On corpus v3 the digest eval is **8 repos / 2,238 files** (Mbed-TLS, contracts/src, expressjs/express, numpy, pyca/cryptography, serde-rs/serde, sveltejs, wolfSSL) — a DIFFERENT set from the historical 3,181-file/10-repo shuffle eval. Therefore **the historical v1 0.9033 (shuffle split) and canonical 0.9395 (v1-corpus 2,415-file split) are NOT reproducible under current code** and must not be cited as the bar for v4. `scripts/compare_v1_v4_checkpoint.py` re-measures **v1, v3 and v4 on the identical current digest split**, each at the length it was trained with: v1 256, v3 128 (v3 predates `training_config.json`, so its native length is pinned in the script), v4 from its own config. The two new v4 sources that hash into eval buckets 0/1 (secp256k1, gnutls) are forced into training so eval stays byte-identical to v3's — new repos are training-only, zero leakage.
- **Result (executed 2026-10-25 01:03Z):** v4 trained cleanly — 3 epochs, batch 16, max_len 256, **388 min**, train_acc **0.9514**, loss 0.1192 (`training_report_v4.json`).
  - **v4 on the digest/pinned split** (2,238 raw / 1,779 unique files, 8 repos, **0 % train overlap**): **P 0.9429 / R 0.8546 / F1 0.8966**, FN 177.
  - **v4 on its native split** (2,566 files / 10 repos incl. new repos, 0 % overlap): **P 0.9444 / R 0.8737 / F1 0.9077**.
  - **Beats the TF-IDF + LogisticRegression baseline** (`linear_code_baseline_v4.json`, native F1 **0.6675**) by **+0.24 F1**.
  - Calibration refit: T 1.8416, ECE 0.411→0.388, Brier 0.0853→0.0845 (`calibration_v4.json`).
- **CRITICAL leakage correction (the real finding):** a naive same-split comparison reports v1 = **0.9329** (measured) and v3 ≈ higher than v4, implying "v4 is worse." That is **false**. `scripts/audit_eval_leakage.py` (`eval_leakage_audit.json`) shows **87.6 % of the unique eval files were exact paths v1 trained on** (2,018/2,238 raw — same repo *and* same file) and **92.2 %** for v3. v1/v3 memorized the eval set; their numbers there are invalid held-out metrics. **v4 is the only checkpoint with a zero-overlap held-out evaluation**, so v4's 0.8966 / 0.9077 are the only trustworthy numbers on this corpus.
- **Honest verdict (no overclaim):** v4 is a genuinely strong, *cleanly evaluated* detector (precision 0.943, +0.24 over the n-gram baseline). But **"v4 beats v1" cannot be claimed** — no clean shared split exists because v1/v3 were trained on the eval files. The only honest cross-model statement is that the prior v1-vs-v3 "same-eval" comparison was itself contaminated. A true head-to-head requires **retraining v1 on the v4 corpus with the identical split** (a GPU job) — recorded as the remaining experiment, not asserted as done.
- **Solidity caveat:** the digest eval holds only **10 Solidity files** (9 tp / 0 fp / 0 fn / 1 tn), so a rigorous "Solidity 0.82→0.9 recovery" is **not** claimable from this split (OpenZeppelin, the Solidity-heavy repo, is in train). Defensible improvement evidence = the precision jump (v3 0.810 → v4 0.943) + baseline beat, not a Solidity sub-score.
- **Corpus-hygiene note:** the eval split carries **459 duplicate (source,path) records** (2,238 raw vs 1,779 unique) — de-duplicate the corpus before the next retrain.

### E-14b — GPU retrain, 5 epochs (executed 2026-10-25; NEGATIVE — more epochs overfit)
- **Setup:** GPU enabled on this host — NVIDIA RTX 2050 (4.29 GB), CUDA 12.4. Installed **torch 2.6.0+cu124** into an isolated venv (`--system-site-packages`, main env's torch 2.14.1 + torch_geometric untouched; pip's 2.5 GB download stalled, so the wheel was pulled with curl at ~2.2 MB/s). Same v4 corpus / same pinned split, `scripts/train_discovery_v4.py --hf-epochs 5 --max-len 256 --batch-size 8 --out-suffix _gpu`.
- **Result:** trained 5 epochs in **49.9 min** on GPU (vs 388 min for 3 epochs on CPU ⇒ ~8× faster per epoch), train_acc **0.9774**, loss 0.0586. **But held-out got WORSE, not better:** pinned F1 **0.8752** (P 0.8959 / R 0.8554) vs the 3-epoch CPU model's **0.8966**; native F1 **0.8914** vs **0.9077**. Calibration T 2.7954, ECE 0.408→0.317.
- **Conclusion (honest negative, recorded as such):** the 5-epoch GPU model **overfits** (train 0.977, held-out 0.875) — more epochs at this data size degrade generalization. **3 epochs at max_len 256 is the sweet spot; the 3-epoch CPU v4 (F1 0.8966 / 0.9077) remains the best clean model.** The GPU pipeline is validated and ~8× faster, but "train more epochs on GPU" does **not** make the model stronger here; exceeding 0.8966 requires more/better data or a larger base model (e.g. codebert-base), not more epochs. Checkpoint kept at `crypto_codebert_v4_gpu/` for the record; the canonical artifact stays `crypto_codebert_v4/`.

### E-14c — Corpus v5 (+8 repos), GPU 3 epochs (executed 2026-10-25; NEGATIVE — more data did not help)
- **Setup:** v5 corpus = v4 + 8 repos (`scripts/expand_code_corpus_v5.py` → `code_corpus_v5.json`): 17,831 files / 66 sources / 9,114 crypto (+660 files, +300 crypto: google/tink 180, RustCrypto/signatures 41, digitalbazaar/forge 38, curl + libressl C-TLS, noble-hashes, bcrypt, httpcomponents). Trained 3 epochs / max_len 256 / batch 8 on GPU, eval split **identical** to v4 (same 8 repos, 2,238 files), so any change is purely from the extra data.
- **Result:** 31.6 min on GPU, train_acc 0.9445. **Held-out got worse:** pinned F1 **0.8707** (P 0.9366 / R **0.8135**) vs v4 **0.8966** (Δ −0.0259); native F1 0.8846 vs 0.9077 (Δ −0.0231). Recall dropped most.
- **Conclusion (honest negative):** adding 8 repos did **not** help — the extra data (mostly Java `google/tink`, some C TLS) shifted the distribution and hurt recall. **The 3-epoch v4 (F1 0.8966) remains the best clean model.** Together with E-14b this shows the detector is at a **local optimum**: neither more epochs nor naive more data improves it. The binding constraint is likely **label noise** — both train and eval labels are regex-derived (`is_crypto` = any crypto keyword), so held-out F1 is capped by the labeler's own error, not model capacity. Genuine improvement needs better labels (human-annotated or AST/static-precise) or a larger base model — not more of the same. Recorded so this is not retried blindly.

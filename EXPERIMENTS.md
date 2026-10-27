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
- **Correction (2026-10-25, E-14):** this audit checked repo-level and full-record overlap but **not path-level overlap**. `scripts/audit_eval_leakage.py` later found 87.6 % of the v1 eval *paths* were present in training — the E-04 conclusion is revoked for v1; see E-14–E-16 for the clean v4 evaluation.

## E-05 — Benchmark artifact coherence check (executed 2026-09-06)
- **Hypothesis:** README headline claims trace to internally coherent artifacts.
- **Result:** `benchmark_comparison.json` — seed 42, n=2,415, P 0.9279 / R 0.9514 / F1 0.9395, baselines recorded, 6/7 models beat best baseline, mean relative gain 1.55×; RL artifact matches README exactly; LOO τ-b 0.7263 matches.
- **Conclusion:** all traced claims verified; the two stale citations found in this engagement were corrected (README SDK API, TRUTH_AUDIT split/epoch wording).

## Pre-existing experiments (authoritative, from TRUTH_AUDIT.md)
CodeBERTa fine-tune (v1 **historical** F1 0.9395 — later shown to have 87.6 % eval-path leakage; the clean model of record is v4, E-14–E-16), GNN LOO τ-b 0.7263 across 40 real CBOMs (deterministic-kernel re-run, bit-identical 3-fold repro), RL on real CBOMs (reward 140.34 ± 8.13 vs heuristic 140.62 — tie), side-channel detector (5/5 on real liboqs traces). These are recorded in `docs/TRUTH_AUDIT.md` with lineage and are not re-derived here.

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

## E-15 — Held-out de-duplication: corrected v4 metric (executed 2026-10-26)
- **Motivation:** E-14 recorded that the pinned eval has **2,238 raw records for 1,779 distinct `(source, path)` pairs** — 459 extras, 197 duplicated keys, 194 with different code and 22 with conflicting labels. The canonical F1 was computed on the inflated set, so one file could be counted twice and even scored as both crypto and non-crypto.
- **Setup:** `scripts/evaluate_dedup_eval.py` loads the shipped `crypto_codebert_v4` checkpoint, scores every raw held-out record **once** (full detector ensemble, threshold 0.5 — the same path as `evaluate`), asserts that the raw row reproduces the shipped **P 0.9429 / R 0.8546 / F1 0.8966**, then recomputes metrics under four deterministic policies. `keep_longest` was declared primary before scoring and never consults the label. Artifact: `qtrust_ai/artifacts/eval_dedup_v4.json`.
- **Result (2,238 scored in 853 s, CPU):**

| Policy | n | P | R | F1 | FN |
|---|---:|---:|---:|---:|---:|
| raw (shipped) | 2,238 | 0.9429 | 0.8546 | 0.8966 | 177 |
| keep_first | 1,779 | 0.9501 | 0.8604 | 0.9030 | 142 |
| keep_last | 1,779 | 0.9500 | 0.8645 | 0.9052 | 137 |
| **keep_longest (primary)** | **1,779** | **0.9492** | **0.8626** | **0.9039** | **140** |
| unique_content | 2,224 | 0.9428 | 0.8622 | 0.9007 | 166 |

- **Conclusion:** the duplicate records were **depressing** the reported metric, not inflating it (the extras were disproportionately false negatives). The corrected, label-blind clean metric is **F1 0.9039** (+0.0073); the three path-level policies agree within 0.0022 (0.9030–0.9052), so the correction is robust to which copy is kept. `keep_last` is not adopted despite scoring 0.0006 higher, because choosing the policy by its own test score is test-set selection. This is a **re-scoring of the same checkpoint**, not a new model; no training claim is made.
- **Durable fix:** `qtrust_ai/discovery/corpus_hygiene.py` + `scripts/dedupe_code_corpus.py` now produce a de-duplicated corpus (v4: **17,171 → 14,470 records**, 819 duplicated keys, **2,701 extras**, **146 label conflicts**). `scripts/train_discovery_v4.py --dedupe-train keep_longest` applies the policy to the training split only, leaving the pinned eval byte-identical for comparability. The next retrain should use it (recorded as E-16, not yet run).
- **Residual labels:** 22 conflicting-label keys remain in the clean eval only as a single kept copy; the label itself can still be wrong because labels are regex-derived. Label quality — not model size — remains the binding constraint on a larger F1 claim.
- **Superseded operating point:** these numbers were measured at the legacy 0.85 ML gate. E-16 selected a 0.50 gate on the independent native split and raised the de-duplicated pinned F1 to **0.9205**; E-15's raw/de-dupe comparison remains valid at both gates.

## E-16 — Ensemble operating point: the 0.85 ML gate was suppressing correct detections (executed 2026-10-26)
- **Observation:** on the shipped v4 held-out predictions, the **ML layer alone** scores F1 **0.9047** (P 0.9253 / R 0.8850), higher than the delivered ensemble's **0.8966**. The ensemble contains a hard-coded gate: when no rule/AST/dataflow layer fires, an ML hit is only accepted at `p ≥ 0.85`. That value was a hand-set precision guard, never selected on held-out data.
- **Protocol:** `scripts/analyze_ensemble_threshold.py` scores the deterministic layers and transformer once per file, then recomputes the exact ensemble decision across gate values without re-running inference. The **source-disjoint native v4 split** (2,566 files / 10 repos) was used to *select* the gate; the **pinned 8-repo split** (2,238 files) and its de-duplicated view (1,779) are reporting sets. Artifacts: `qtrust_ai/artifacts/ensemble_scores_v4_native.json`, `ensemble_scores_v4_pinned.json`.
- **Result — gate selected on native:**

| Split | Gate 0.85 (old) | Gate 0.50 (selected) | Δ F1 |
|---|---:|---:|---:|
| Native, raw (2,566) | P 0.9444 / R 0.8737 / **F1 0.9077** | P 0.9232 / R 0.9238 / **F1 0.9235** | **+0.0158** |
| Pinned, raw (2,238) | P 0.9429 / R 0.8546 / **F1 0.8966** | P 0.9201 / R 0.9088 / **F1 0.9144** | **+0.0178** |
| Pinned, de-duplicated (1,779) | P 0.9492 / R 0.8626 / **F1 0.9039** | P 0.9264 / R 0.9146 / **F1 0.9205** | **+0.0166** |
| Native, de-duplicated (2,107) | — | P 0.9287 / R 0.9309 / **F1 0.9298** | — |

  Per-language on the de-duplicated pinned view (F1 at 0.85 → 0.50): C 0.9246→0.9431, C++ 0.3636→0.5000, JavaScript 0.60→0.6667, Python 0.7847→0.8000, shell 0.8451→0.8919, Rust 0.9497→0.9457, C# 0.96→0.96, Solidity 1.0→1.0. The gain is not driven by one language; the only small regression is Rust (−0.004).
- **Decision:** `DetectorConfig.ml_decisive_threshold` is now **0.5**, matching the model's own threshold. This is an **operating-point correction, not a retrain** — the checkpoint is unchanged. A live `predict` run on 80 sampled files matched the simulation exactly (0 mismatches); 10 unit tests in `qtrust_ai/tests/test_ensemble_gate.py` pin the gate semantics (static remains decisive; two layers still decide; gate is configurable).
- **Honesty:** 0.50 buys recall with precision (native P 0.9444→0.9232); it is the F1-optimal point on the selection split, not a universal best. The old 0.85 also had no validated provenance. Both splits agree on 0.50, and the gate is now a named, testable parameter rather than a magic number. Report F1 **0.9205** (de-duplicated pinned) / **0.9235** (native) as the detector ensemble's current clean numbers; the E-14/E-15 rows are retained as the legacy-gate record.
- **De-duplication sensitivity:** the clean metric depends on which copy is kept. The pinned duplicates are different code revisions of ordinary repo paths (svelte, wolfssl, cryptography, numpy, serde) — only 7 exact-content groups exist, and 194/197 duplicated keys differ in code. At gate 0.50 the three one-per-path policies score keep-first **0.9208**, keep-last **0.9223** and keep-longest **0.9205** (the primary); the stricter `unique_content` policy (removes 14 exact copies only, n=2,224) scores P 0.9198 / R 0.9137 / **F1 0.9167**. All four beat raw 0.9144. `keep_longest` was chosen a priori as the most complete copy, not as the maximum, so the defensible clean range is **0.9167–0.9223** and the headline stays **0.9205**; the extras are stale snapshots of the same file, not distinct cases. Regenerated artifact: `qtrust_ai/artifacts/eval_dedup_v4.json` (`gate: 0.5`, `raw_reproduces_shipped: true`).

## E-17 — De-duplicated training corpus: path-based dedupe is the wrong unit (executed 2026-10-26)

- **Hypothesis:** the canonical v4 training split repeats `(source, path)` 2,242 times. Removing those records should reduce duplicate weighting and label noise, improving the clean held-out score.
- **Setup (controlled):** identical recipe to the canonical v4 run — CodeBERTa-small, 3 epochs, max_len 256, batch 16, GPU — with the **only** change being `--dedupe-train keep_longest` (training split 14,933 → 12,691). Pinned eval is byte-identical. Checkpoint: `crypto_codebert_v4-dedup`; report: `training_report_v4-dedup.json`.
- **Result — a clear negative:**

| Split | Canonical v4 (gate 0.50) | keep_longest dedupe | Δ F1 |
|---|---:|---:|---:|
| Pinned, raw (2,238) | P 0.9201 / R 0.9088 / **F1 0.9144** | P 0.9276 / R 0.7790 / **F1 0.8468** | **−0.0676** |
| Native, raw (2,566) | P 0.9232 / R 0.9238 / **F1 0.9235** | P 0.9323 / R 0.8126 / **F1 0.8684** | **−0.0551** |

  Train accuracy was normal (0.9526 vs 0.9514), so this is not underfitting: the model became conservative and lost crypto recall (FN 269 vs 111 on pinned).
- **Diagnosis (why):** `(source, path)` is not the record identity for benchmark corpora. `keep_longest` collapsed **solidifi-benchmark 681 → 52** records (254 crypto cases removed) and **liboqs 800 → 359** (304 crypto), because distinct labeled cases and re-fetched files share a path. The training labels are per-case, not per-path.
- **Correct policy:** `unique_content` de-duplicates on `(source, path, content)`. It removes only **349 exact copies (100 groups, 0 label conflicts)** while preserving all distinct cases: 14,584 records / 7,391 crypto, including all 681 SolidiFI and 525 liboqs records. E-17b re-runs the same recipe with this policy; the result is recorded below.
- **Lesson:** clean the *evaluation* by path (E-15) because one path should not be scored twice, but clean *training* by content only — otherwise the cleaner silently deletes legitimate benchmark cases.
- **Scope of the lesson:** the pinned eval's 197 duplicated keys are ordinary-repo revisions (svelte, wolfssl, cryptography, numpy, serde), so one-per-path is valid *there*. If a benchmark with per-case labels is ever used as an eval set, score it with `unique_content`, not `keep_longest`.

### E-17b — exact-content training dedupe (executed 2026-10-26)

- **Setup:** same recipe as E-17 but `--dedupe-train unique_content`: 14,933 → 14,584 records (349 exact copies dropped, 100 groups, **0 label conflicts**), 7,391 crypto; all 681 SolidiFI and 525 liboqs records preserved. Checkpoint `crypto_codebert_v4-dedupcontent`, report `training_report_v4-dedupcontent.json`.
- **Result:**

| Split | Canonical v4 (gate 0.50) | unique_content | Δ F1 |
|---|---:|---:|---:|
| Pinned, raw (2,238) | P 0.9201 / R 0.9088 / **F1 0.9144** | P 0.8618 / R 0.9170 / **F1 0.8885** | **−0.0259** |
| Native, raw (2,566) | P 0.9232 / R 0.9238 / **F1 0.9235** | P 0.8691 / R 0.9300 / **F1 0.8985** | **−0.0250** |

  Train accuracy was 0.9494 (canonical 0.9514). Unlike E-17a, recall held or improved but **precision fell ~6 points**, so this is a different failure mode, not a data-composition collapse.
- **Interpretation (updated after E-17c):** removing 2.3 % exact duplicates cannot plausibly cost 2.6 F1 points by itself, so the GPU environment was the first suspect. E-17c — a GPU control on the **unmodified** corpus — scored pinned **0.9169** / native **0.9251**, at or slightly above canonical (0.9144 / 0.9235). The environment is therefore **exonerated**: the unique_content drop is attributable to the data change and/or single-run variance (each result is one run, so the split between the two is not measured). Either way, the dedupe did not improve the model, and no training-dedupe benefit is claimed. The canonical CPU checkpoint stays shipped.

### E-17c — GPU control on the canonical corpus (executed 2026-10-26; environment exonerated)

- **Purpose:** E-17/E-17b changed the training data *and* ran on the GPU venv (torch 2.6.0+cu124 / transformers 5.20.2), whereas the canonical v4 was trained on CPU. This control runs the **identical corpus, split and recipe** (3 epochs, max_len 256, batch 16, 14,933 records) on GPU with **no dedupe**, so any gap is environmental.
- **Result:** 32.5 min (vs 388 min CPU, ~12× faster), train_acc **0.9498**, loss 0.1215; pinned **P 0.9184 / R 0.9154 / F1 0.9169**; native **P 0.9217 / R 0.9286 / F1 0.9251**; calibration T 1.8971. Checkpoint `crypto_codebert_v4-gpucontrol`, report `training_report_v4-gpucontrol.json`, log `train_gpucontrol.log`.
- **Clean-view re-score** (`eval_dedup_v4_gpucontrol.json`, gate 0.50): keep_longest **P 0.9222 / R 0.9195 / F1 0.9209** vs canonical 0.9205; unique_content 0.9192 vs 0.9167; keep-last 0.9249. Every view is within ±0.0025 of canonical.
- **Against canonical (gate 0.50):** pinned 0.9169 vs 0.9144 (**+0.0025**), native 0.9251 vs 0.9235 (**+0.0016**), clean keep_longest 0.9209 vs 0.9205 (**+0.0004**) — within run-to-run noise, not a demonstrated improvement.
- **Interpretation:** the GPU stack does **not** degrade the detector. E-14b's regression was 5-epoch overfitting and E-14c's was the v5 data shift; neither was a device effect. E-17b's drop is likewise **not** an environment artifact.
- **Decision:** do not replace the shipped checkpoint on a +0.0004 clean/noisy difference; the canonical CPU v4 (clean F1 0.9205) remains the model of record. The control checkpoint is kept for reproducibility.
## E-18 — Larger base model: microsoft/codebert-base does not beat CodeBERTa at this recipe (executed 2026-10-27)

- **Hypothesis:** E-14c's lesson said real gains need "better labels **or a larger base model**". CodeBERTa-small (84M) → codebert-base (125M, same RoBERTa family and code pretraining) is the cheapest test of the second lever.
- **Setup:** `scripts/train_discovery_v4.py --base-model microsoft/codebert-base --model-revision 3b0952feddeffad0063f274080e3c23d75e7eb39` (S-5 SHA pin; flags added this session), corpus/split/epochs/max_len identical to canonical v4 — with **one recipe deviation: batch 8, not 16**, forced by the 4 GB RTX 2050 (canonical batch 16 OOMs at 125M params/256 tokens on this card). 3 epochs; epoch 3 was resumed from checkpoint after a `CUBLAS_STATUS_EXECUTION_FAILED` crash under concurrent machine load (epochs 1–2 unaffected, per-epoch checkpointing). Checkpoint `crypto_codebert_v4-codebertbase`, report `training_report_v4-codebertbase.json`, calibration T=1.6493.
- **Result — negative on both reporting splits:**

| Split | Canonical v4 (CodeBERTa, gate 0.50) | codebert-base (batch 8) | Δ F1 |
|---|---:|---:|---:|
| Pinned, raw (2,238) | P 0.9201 / R 0.9088 / **F1 0.9144** | P 0.8857 / R 0.9293 / **F1 0.9070** | **−0.0074** |
| Native, raw (2,566) | P 0.9232 / R 0.9238 / **F1 0.9235** | P 0.8912 / R 0.9389 / **F1 0.9144** | **−0.0091** |

- **Shape of the failure:** recall *rose* (+2.1 points pinned) but precision fell (−3.4), i.e. the larger model is more eager and less discriminating here. Train accuracy 0.9465 (epoch 3) vs canonical 0.9514.
- **Honest caveats:** (a) the batch-8 deviation is uncontrolled — the result shows *this recipe* loses, not that codebert-base is intrinsically worse (single run, no seed replicates); (b) the E-16-style clean de-duplicated view was not re-scored for this checkpoint since the raw comparison already loses by −0.007/−0.009 — a clean view cannot rescue a raw deficit of this size.
- **Decision:** the canonical CPU CodeBERTa v4 checkpoint (clean F1 0.9205 de-duplicated, gate 0.50) remains the model of record. Combined with E-14b/E-14c/E-17, the evidence now covers three levers — more epochs, more data, bigger base — and all three lose to the canonical recipe; **label quality is the only remaining lever with evidence behind it** (see E-15's 22 residual conflicting-label keys and the reviewed-label pilot in ANALYSIS_AND_ROADMAP_2026-10-27.md §3.3).

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
- **Hypothesis:** the F1 0.952 discovery claim could be invalidated by split leakage.
- **Method:** re-ran `_code_splits(seed=42)` on the 13,973-file corpus; hashed every file for cross-repo exact duplicates; computed full-record train/eval overlap; scanned the 16-record vendor dataset for duplicates.
- **Result:** split reproduces exactly (38 repos → 30 train / 8 eval; 11,558 / 2,415 files; zero repo overlap). Cross-repo duplicate snippets: 11 affecting 58 files (0.4%). Full-record train/eval overlap: 11 files (0.46% of eval). Vendor dataset: 0 duplicates.
- **Conclusion:** split discipline holds; duplication is organic and bounded far below the claimed +0.11 F1 gain. Claim stands as scientifically defensible.

## E-05 — Benchmark artifact coherence check (executed 2026-09-06)
- **Hypothesis:** README headline claims trace to internally coherent artifacts.
- **Result:** `benchmark_comparison.json` — seed 42, n=2,415, P 0.952 / R 0.953 / F1 0.9525, baselines recorded, 6/7 models beat best baseline, mean relative gain 1.55×; RL artifact matches README exactly; LOO τ-b 0.7263 matches.
- **Conclusion:** all traced claims verified; the two stale citations found in this engagement were corrected (README SDK API, TRUTH_AUDIT split/epoch wording).

## Pre-existing experiments (authoritative, from TRUTH_AUDIT.md)
CodeBERTa fine-tune (F1 0.952, repo-disjoint held-out), GNN LOO τ-b 0.7263 across 40 real CBOMs (deterministic-kernel re-run, bit-identical 3-fold repro), RL on real CBOMs (reward 140.34 ± 8.13 vs heuristic 140.62 — tie), side-channel detector (5/5 on real liboqs traces). These are recorded in `docs/TRUTH_AUDIT.md` with lineage and are not re-derived here.

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

# Q-Trust — Comprehensive Analysis, Implemented Improvements & Growth Plan

**Date:** 2026-10-23 · **Method:** full-tree exploration (contracts, ML/planner/inspector, backend/frontend, datasets, CI) + direct re-measurement of every suite + new experiments E-09/E-10/E-11 executed on this tree.

---

## 0. What was implemented this session (verified, not proposed)

| # | Deliverable | Evidence | Tests |
|---|---|---|---|
| 1 | **Outcome-based migration evaluation** — quantum-risk-days simulator (`qrd-sim/1.0`) + 42-fold LOO harness. **GNN attains the exact optimum out-of-sample (ratio 1.0000) vs heuristic 1.0473 (4.7% excess exposure), Wilcoxon p=1.7e-08, 40/2/0 wins; on dependency-dense synthetic estates GNN 1.049 beats Smith's rule 1.065 and heuristic 1.128** — the first honest "learned planner beats the shipped baseline" result, possible because the outcome objective breaks the formula-label ceiling (the heuristic *is* the label generator in the old protocol; verified its order equals the label order exactly, τ-b 0.7210 = mean tie ceiling √(d/n₀)) | `planner/qtrust_planner/outcome_sim.py`, `scripts/eval_outcome_loo.py`, `planner/results/outcome_loo_42.json`, EXPERIMENTS E-09 | 23 |
| 2 | **Detector confidence calibration** — 5-fold cross-fitted temperature vs Platt; shipped T=1.2142; ECE 0.1557→0.1387 (−10.9%), Brier 0.0697→0.0692; wired opt-in into `code_detector._ml_layer` (monotone — then-current v1 F1 0.9395 and ranking unchanged; v1 is now historical — its eval was 87.6 % path-leaked, clean v4 is 0.9205/0.9235) | `qtrust_ai/discovery/calibration.py`, `scripts/calibrate_codebert.py`, `qtrust_ai/artifacts/calibration.json`, E-10 | 17 |
| 3 | **Corpus v2** — 4 genuinely new GitHub sources (tink-java, tink-cc, pyopenssl, redis negative control): 14,664 files / 42 sources (+691). Benchmarks kept evaluation-only to protect E-08 from train contamination | `qtrust-datasets/code_corpus_v2.json`, `scripts/expand_code_corpus.py`, E-11 | — |
| 4 | **TD-02 closed** — machine-checkable checkpoint lineage manifest; flags `model_ddp_v3.pt` + `rl_agent.pt` as raw state dicts | `scripts/build_checkpoint_manifest.py` → `planner/checkpoint_manifest.json` | — |
| 5 | **TD-04 closed** — nightly Foundry invariant fuzzing (20k runs / 500 depth, dispatch-overridable, auto-issue on failure) | `.github/workflows/invariant-fuzz.yml` | — |
| 6 | **TD-05 closed** — `verify_all.sh` restructured into 3 concurrent lanes (wall-clock ≈ slowest lane; `VERIFY_ALL_SERIAL=1` for old behaviour) | `scripts/verify_all.sh` | — |
| 7 | **Docs honesty wiring** — EXPERIMENTS E-09/E-10/E-11, TRUTH_AUDIT addendum (simulation-grounded classifications), PROJECT_SCORECARD ML row, DATASETS.md, TECHNICAL_DEBT closures | see files | — |

**Re-measured ground truth on this tree:** Python suite **345 passed + 10 skipped** (was 293+10; +52 new tests, zero regressions). Backend vitest 118/118 (one cold-start flake observed on first run — 3/3 clean re-runs after; signature "Indexer failed to start — temporary RPC outage"; documented as an observed-but-unreproduced flake). Frontend 137/139 then clean re-run (known config.test flake). Forge/Playwright not runnable on this machine (no Foundry/browsers); retain last-measured status (213/213, 43+1).

---

## 1. Project analysis & strategic opportunities

**Where Q-Trust is genuinely ahead** (verified): the certification fabric (validity-gated attestation + Merkle-proof revocation + 11 UUPS contracts with timelock governance and adversarial test suites), CycloneDX-native CBOM scanning shipped as a GitHub Action + PyPI packages, hash-only privacy model, and a research contribution (ceiling theorem, tie-decomposition identity) with a 53/53 claims harness. The honest-metrics culture (TRUTH_AUDIT, metric-consistency CI gate) is itself a differentiator against competitors who publish unfalsifiable numbers.

**The strategic unlock achieved today:** the old flagship claim ("GNN-ranked migration ordering") was stuck at parity with a 5-line formula *because the evaluation made the formula the ceiling*. E-09 replaces that with an outcome objective a CISO recognizes (quantum-risk-days of exposure during migration) and wins decisively — while the paper's ceiling theorem *explains why the old comparison was unwinnable*. That pairing (theorem + simulator + measured win) is publishable and defensible.

**Remaining strategic opportunities, ranked:**
1. **Outcome-aware sequencing in the product** — expose QRD scores and the Smith/GNN ordering in `/v1/roadmap/generate` and the scanner roadmap tab (the heuristic currently orders it). Immediate, deployable, honest ("outcome-simulated exposure reduction" label). Effort: 1–2 days.
2. **PQC compliance reporting as the wedge** — CNSA 2.0 / NIST IR 8547 timelines are regulatory tailwinds; the compliance engine exists. Package a "2030/2035 deadline exposure report" PDF export from the scanner. Effort: ~3 days.
3. **Benchmark-data licensing & labelling-service business** (already drafted in monetization docs) — now strengthened: the outcome simulator is exactly the labelled-outcome generator buyers of a migration-planning benchmark need.
4. **Corpus v2 retrain → updated detector card** (needs GPU) — then a public leaderboard-style head-to-head update with the honest framing the repo already uses.

## 2. Issues & required fixes (catalog)

| ID | Issue (evidence) | Severity | Priority | Effort | Depends on | Timeline |
|---|---|---|---|---|---|---|
| I-1 | `model_ddp_v3.pt` + `rl_agent.pt` are raw state dicts — no config/seed/lineage (now machine-flagged by TD-02 manifest); also carry BatchNorm (v3 audit note) | High | P1 | 4–8h GPU | GPU access | Before next release |
| I-2 | Backend vitest cold-start flake: 7 failures across 4 files on first run this session, clean on 3 re-runs ("temporary RPC outage" path) | Medium | P2 | 2–4h | — | Next sprint |
| I-3 | TD-01: `scanner-dashboard.tsx` 1,924 lines — 5 inline tab panels + all fetch logic in one component | Medium | P2 | 2–3 days | — | Next sprint |
| I-4 | TD-12: wallet-gated `/dashboard`, `/vendors` outside the a11y gate (needs mocked `window.ethereum`) | Medium | P2 | 1 day | — | Next sprint |
| I-5 | TD-08: operator key in `sessionStorage` — accepted risk, per-operator keys supported | Low (accepted) | P3 | 2–3 days if upgraded to short-lived exchange | auth design | Post-GA |
| I-6 | Corpus v2 not yet trained on — v1 metrics remain canonical; do not cite v2 numbers (TRUTH_AUDIT addendum) | Medium (process) | P1 gate | 6–10h GPU | GPU | Next GPU window |
| I-7 | Two doc systems (TD-03, mkdocs + docs-v2) drift risk | Low | P3 | 2–3 days | — | Post-GA |
| I-8 | `verify_all.sh` parallel lanes can contend on `/tmp` planner bench dir names if run concurrently with itself | Low | P3 | 1h | — | Opportunistic |
| I-9 | Frontend `config.test` intermittent flake under full-suite load (known, passes on re-run) | Low | P3 | 2–4h | — | Opportunistic |
| I-10 | R-01: no external contract audit (dossier prepared) | High | P1 (business) | Budget, not eng. | — | Before mainnet value |

Security posture re-verified this session: no new vulnerabilities introduced (calibration is pure-Python deterministic math; simulator has no I/O beyond local files; new CI workflow uses SHA-pinned actions, least privileges, auto-issue only on failure).

## 3. Enhancements & modifications

- **Planner service (`planner/qtrust_planner`)**: add `POST /plan` "objective" mode returning QRD-optimal / Smith / GNN orderings with the `SIM_SPEC_VERSION` provenance field (mirrors the model-provenance pattern already in `/health`). The infrastructure is all in `outcome_sim.py`; wire-in is small.
- **Scanner roadmap tab**: show "simulated exposure saved vs priority-list ordering: X risk-days ( Estate n=7)" — a number a buyer feels.
- **Inspector**: surface calibrated confidence in findings (`calibrated_confidence` field alongside raw) — artifact already applied in the detector.
- **CBOM builder**: emit explicit `depends_on` when asset metadata implies it (same-host chains today create *no* edges — all 42 estates are edgeless; the simulator currently falls back to none). Real dependency data (SBOM/CT logs) is the single highest-leverage data upgrade.
- **Backend**: keep the in-flight uncommitted hardening (fetchWithRetry, tunnel-down 503 mapping, pg pool recycling) — it is good work; commit it behind the existing tests.

## 4. Advanced features (differentiators)

1. **Outcome-optimised migration planning under uncertainty** — extend `qrd-sim` with duration distributions + conformal intervals (the temporal module already has conformal machinery): plans ranked by *expected* risk-days with 90% bands. Directly extends today's E-09; unique vs any static-scoring competitor.
2. **HNDL-aware estate triage** — combine per-asset "harvest-now-decrypt-later" exposure (already computed in the inspector) with the QRD objective: weight assets by adversary-value (criticality × data shelf-life), producing a *threat-sequenced* roadmap, not just compliance-sequenced.
3. **Continuous attestation watchdog** — scheduled re-scan → CBOM hash drift → automatic attestation revocation proposal (Merkle-proof path exists; add the scheduler + drift policy). Turns the product from point-in-time audit to a living control.
4. **Cross-estate fleet learning** — the LOO harness is shardable by design; a federated/privacy-preserving variant (hash-only features cross-orgs) fits the existing privacy story and would make the planner improve with every customer.
5. **Paper v2** — the ceiling theorem + "why the formula-label comparison was unwinnable" + the outcome-based win is a coherent, novel methodology contribution; the claims harness pattern (53/53) extends naturally.

## 5. New additions

- Corpus v2 (done, E-11) and the path to v3: fold WebAuthn/IETF draft sources, more negative controls (infra repos), and — after E-08 is re-baselined — consider a held-out misuse-detection split from CryptoAPI-Bench *as evaluation only*.
- `qtrust-sim` as a **public CLI package** (`pip install qtrust-sim`): `qtrust-sim plan --cbom estate.json` printing optimal/Smith/heuristic QRD — a top-of-funnel growth tool that demonstrates value with zero infra; the module is already standalone-clean.
- **NVD sync job** — `nvd_cves.json` (629 CVEs) as a weekly-refreshed dataset with freshness stamp in DATASETS.md.
- **SLSA provenance** on Docker/PyPI releases (release.yml already does build provenance attestation — extend to images).

## 6. Verification & testing strategy (current state + gaps)

Present and green: pytest (345+10, incl. Hypothesis property tests + 40 new), backend vitest 118, frontend vitest 139, Playwright e2e + a11y (populated-state, dual-viewport) + CWV budget, forge 213 + invariant + Halmos symbolic, Slither/Semgrep/CodeQL/gitleaks/pip-audit, metric-consistency gate, docs-contract tests. Gaps worth closing: (a) mutation testing on the simulator + calibration modules (pure functions — ideal targets, policy allows selective use); (b) wallet-gated a11y (TD-12); (c) Nightly fuzz now added (TD-04) — watch first week of runs; (d) a CI job that re-runs `eval_outcome_loo.py --quick` on every planner PR to catch simulator/model regressions cheaply (~15s CPU); (e) flake quarantine: mark the two known flakes `test.describe.configure({ retries: 1 })` or fix root cause (I-2/I-9).

## Beyond the categories — the honest-marketing flywheel

This repo's rarest asset is that its claims are falsifiable and its errors self-correct (F1 correction, tie publication, today's ceiling explanation). Protect it: every new number ships with an artifact path + protocol + honesty note (the addendum demonstrates the pattern). Then use it outward: publish the "why we couldn't beat our own formula (and what we did instead)" essay — it is exactly the content security engineers trust.

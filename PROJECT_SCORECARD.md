# Q-Trust Project Scorecard

Status legend: PASS / PARTIAL / FAIL / NOT TESTED / NOT APPLICABLE.
Every PASS cites executed verification from this engagement (PRs #51–#55, all CI-green and merged to `main`).

| Area | Status | Evidence | Remaining Work |
|---|---|---|---|
| Architecture | PASS | `docs/ARCHITECTURE.md` + 7 ADRs; component boundaries verified by live cross-service test (backend→planner 401/200/422 chain) | None blocking |
| Code Quality | PASS | ruff clean (repo-wide); sdk mypy strict clean; backend tsc + eslint clean; frontend tsc + eslint clean | Large files remain (scanner-dashboard.tsx ~1.2k lines) — tracked in TECHNICAL_DEBT.md |
| ML | PARTIAL | CodeBERTa discovery fine-tune: clean repo-disjoint v4 model F1 **0.9205** de-duplicated (1,779 files; P 0.9264 / R 0.9146) and **0.9235** native (E-14/E-15/E-16); the older v1 F1 **0.9395 is superseded** — `scripts/audit_eval_leakage.py` found **87.6 % of its eval paths were in training**. Confidence now **calibrated** (E-10: temperature T=1.2142, ECE 0.1557→0.1387 cross-fitted, `qtrust_ai/artifacts/calibration.json`). Formula-label LOO remains an honest tie (E-06: τ-b 0.7168 vs heuristic 0.7210 — the heuristic replicates the label formula, so its score is the per-fold tie ceiling by construction). **New (E-09, 2026-10-23): under the outcome-based quantum-risk-days objective (`qrd-sim/1.0`), the GNN attains the exact optimum out-of-sample on all 42 real estates (ratio 1.0000 vs heuristic 1.0473, Wilcoxon p=1.7e-08, 40/2/0) and beats both heuristic (1.128) and Smith's rule (1.065) at 1.049 on dependency-dense synthetic estates.** Side-channel retrained (E-07); RL is a genuine REINFORCE agent; leakage audit holds. Corpus v4 built (E-14: 17,171 files / 58 sources, +8 PQC-dense repos). **v4 retrain COMPLETE (E-14, 2026-10-25):** 3 epochs / max_len 256 / batch 16 / CPU, 388 min, train_acc 0.9514. **Clean held-out (0 % train overlap): F1 0.9205 on the de-duplicated digest eval (1,779 files, P 0.9264 / R 0.9146; E-15/E-16) and F1 0.9235 on its native split (P 0.9232 / R 0.9238), beating the TF-IDF+LogReg baseline (0.6675) by +0.25 F1; at the legacy hand-set 0.85 ML gate these were 0.8966 raw inflated / 0.9039 de-duplicated / 0.9077 native.** **GPU retrain (E-14b):** torch 2.6.0+cu124 installed into an isolated venv, RTX 2050 used; 5 epochs ran in 49.9 min (~8× faster than CPU) but **overfit** — held-out F1 dropped to 0.8752/0.8914, so **3 epochs is optimal and the CPU 3-epoch v4 stays canonical** (more epochs ≠ stronger). **v5 corpus (+8 repos, 17,831 files) also regressed** (pinned F1 0.8707, Δ −0.026) — so *naive more data ≠ stronger either*; the detector is at a local optimum bounded by **regex-label noise**, and real gains need better labels or a larger base model, not more of the same. **Leakage correction (critical):** the naive same-split comparison shows v1 0.9329 > v4 — but `scripts/audit_eval_leakage.py` proves **87.6 % of eval files were exact paths v1 trained on (92.2 % for v3)**; v1/v3 memorized the split, so their numbers there are invalid and **"v4 beats v1" is NOT claimed** (no clean shared split exists without retraining v1 on the v4 corpus) | Cite E-09 with the simulation-grounded framing (not observed org outcomes); **training-dedupe experiments E-17/E-17b are recorded negatives** (E-17c GPU control matches canonical at 0.9169/0.9251, exonerating the environment); a "v1 vs v4" head-to-head is not constructible because v1 trained on the only shared eval paths (retraining v1 on v4 would just be the v4 recipe); next real gain requires better labels or a larger base model; near-duplicate (fuzzy) scan beyond exact hashes |
| Dataset | PASS | Corpus **v4** (17,171 files / 58 sources / 8,814 crypto) is the active training corpus (E-14); pinned digest split reproducible (14,933 train / 2,238 eval, repo-disjoint, seed 42). Duplicate-path audit E-15: 819 duplicated `(source, path)` keys / 2,701 extras corpus-wide, 197/459 in the pinned eval; deterministic de-duplication shipped (`corpus_hygiene.py`, `dedupe_code_corpus.py`). Vendor dataset 16 records, 0 duplicates | Near-duplicate (fuzzy) scan beyond exact hashes |
| Evaluation | PASS | `benchmark_comparison.json` internally coherent (seed, baselines, n=2415); dvc evaluate stage honestly reports `not_available` on empty splits (verified) | Calibration curve analysis for CodeBERTa confidence |
| Explainability | PASS | Inspector emits evidence-backed findings (exact key sizes from AST); planner returns model provenance in `/health` and `/plan` (variant, path, config, eval metrics) | Per-asset feature attribution for GNN ranking |
| Trustworthiness | PASS | `docs/TRUTH_AUDIT.md` classifies every headline metric (REAL / SYNTHETIC / DEMO); corrected to empirically verified split + honest epoch default | External audit of contracts (see Risks) |
| Security | PASS | Secret scan clean (gitleaks + `dev-key-guard` in `security.yml`); **npm audit: 0 vulnerabilities** (2026-10-24 — the 21 "high" were one `zod` DoS advisory, fixed via `overrides.zod ^4.6.6`; the CI gate `npm audit --audit-level=high` had been red on advisory-DB drift and is now green); planner SSRF/size-cap/auth defenses verified live; backend fail-closed startup gates verified (CORS, relayer key, scan roots); Slither/Semgrep/CodeQL clean on project sources (vendored OpenZeppelin findings upstream); repo threat model with 11 classified threats + evidence anchors (`docs/SECURITY_THREAT_MODEL.md`); IPFS SSRF (TM-FE-01) fixed with CID validation + 8 tests; planner docs exposure fixed; constant-time review clean; external-audit dossier prepared (`docs/audit/DOSSIER.md`); checkpoint SHA-256 pin verified at startup, fail-closed (TM-PL-02, 2026-09-08); proxy operator-key boundary (TM-FE-03, 2026-09-12) verified live — anonymous privileged calls 403 with zero upstream requests, the server admin key is never attached to operator routes, caller key is forwarded and its own header name never leaks — with 12 enforcement tests; **new UUPS storage-layout guard** (`contracts/scripts/check-storage-layout.sh`) | Slither findings in vendored OpenZeppelin (upstream); external audit itself still pending (R-01); browser-held operator key (TD-08); storage-layout baseline to be seeded on a Foundry host |
| Testing | PASS | **Re-measured 2026-10-26 (all green):** **backend vitest 306 passed across 23 files**; **frontend vitest 168 passed across 23 files** (the intermittent `config.test` flake is now fixed at the root — pure `deriveChain(env)` replaces env-mutating module re-import; +4 route-policy assertions, 5 certification-verifier component tests, 2 `cn` merge regressions); **Playwright 14/14** for `/certify` + a11y across desktop and mobile viewports; **planner+inspector pytest 318 passed + 56 skipped** (56 skips are `importorskip` gates on optional deps absent in this env; CI runs more). Fixed 4 real test defects: the `pg`-mock EventEmitter gap, a **Windows CLI path-validation bug** (missing `\`-separator handling let a mistyped path fall through to the network scanner and crash on IDNA), a `/bin/true`-only timing test, and a Hypothesis `too_slow` trip. **CI-gated (12 workflows):** forge 213, Playwright (7 specs), `qtrust_ai`, property-tests, plus `security.yml` (slither/semgrep/codeql/pip-audit/gitleaks/dev-key-guard/model-integrity), `invariant-fuzz.yml` (nightly), `halmos.yml` (symbolic). New: **UUPS storage-layout guard** (`contracts/scripts/check-storage-layout.sh`) | Mutation testing absent; storage-layout baseline to be seeded on a Foundry host; `qtrust_ai` still thin (5 test files / 60 tests / 44 modules) |
| Performance | PASS | Planner `/plan` measured: p50 28–123ms, p95 43–337ms @ 50–2,000 assets (recorded in `docs/PERFORMANCE.md`); rate limiter verified under load; CWV budget (LCP ≤ 2.5 s, CLS ≤ 0.1) automated in the e2e job (TD-06, 2026-09-08). **Measured 2026-09-12:** with the new self-hosted fonts the home page passes the CWV gate with the LCP budget tightened from 2500 ms to **1500 ms** (`QTRUST_CWV_LCP_BUDGET_MS=1500`), i.e. LCP < 1.5 s, and CLS stays inside the 0.1 budget — `next/font` self-hosts and emits metric-adjusted fallbacks, so no third-party font request sits on the critical path | Full Lighthouse toolchain in CI not automated (manual optional run) |
| API | PASS | Planner: malformed `key_size` → 422 with precise message (was 500); CBOM asset cap (`QTRUST_PLANNER_MAX_ASSETS`); backend proxy maps planner 4xx→422, 5xx→503 | None blocking |
| Certification & Assurance | PASS | Signed, policy-gated bundles (`qtrust.certification.v1`) with per-record SHA-256, sorted-pair Merkle root, Ed25519 proof and validity window; issuance refuses (409) rather than overclaiming. Offline verification in TypeScript and Python over the same committed fixture; CI regenerates and diffs the fixture. Browser verifier at `/certify` (paste/file, optional re-anchor, per-check report, policy list, axe-audited at both viewports). Assurance API exposes agility grades, CRQC/HNDL exposure and five sector packs (`cnsa-2.0`, `pci-dss-4.0`, `dora`, `hipaa`, `fedramp-rev5`) with `MANUAL` for undecidable controls. Verified: 19+9+6 backend, 12+7 Python, 4 route, 19 inspector, 5+3 UI tests. See `docs/CERTIFICATION_AND_ASSURANCE.md` | Issuer-key rotation runbook; bundle redaction policy; bridge containerization; mutation + load tests |
| Frontend/UX | PASS | Design-craft pass (PR #55): reduced-motion spinner fix, button press feedback, tx-state bridge, em-dash/version-tell copy hygiene; hallmark + impeccable + taste-skill audits applied. **Correction 2026-09-12:** a follow-up audit found a large part of the interactive surface (scanner scan/roadmap/evidence, planner, four GPU panels, vendor attestation) called privileged endpoints the same-origin proxy denies by default, so those controls were permanently 403 in the documented deployment path. Fixed via the shared policy module + operator-key path (TD-07); the dead sample-verification button on the dashboard is fixed too. **Correction 2026-09-12 (second pass):** three further defects found by auditing rather than by trusting the suite — (1) `/v/[id]` returned a **500 on every request** (server component using the relative `API_BASE_URL`; Node's `fetch` cannot parse it) so the public verification page never rendered; (2) `/v`, the target of the "Verify" nav item on every page, contained **no input at all** and told visitors to edit the address bar; (3) the header/footer existed **only on `/`**, so every other route had no navigation and no skip link, and its one anchor (`/#protocol`) pointed at an id that does not exist.All fixed, plus self-hosted typography (no web font was loaded anywhere), `robots`/`sitemap`/`manifest`/JSON-LD, and per-route metadata. **Third pass 2026-09-12:** the application layer was a *third* visual language — raw Tailwind palette classes plus ad-hoc shadcn tokens, with status colours invented per file ("success" was `emerald-50/700`, `green-500` and `green-600`-on-`green-500/15` in three different files). Unified onto a semantic state palette and a named type scale, with `StatusPill`/`Panel`/`State` primitives replacing per-file colour helpers; `scanner-dashboard.tsx` goes from 101 raw palette utilities to 4. The compliance chips' ~2.8:1 contrast failure went with it (TD-10 closed) | Operator key is browser-held (TD-08); scanner-dashboard.tsx decomposition still open (TD-01); wallet-gated `/dashboard` + `/vendors` still outside the automated a11y gate (TD-12) | Accessibility | PASS | Playwright a11y suite passes; skip link, focus rings, aria-labels, semantic headings verified; touch targets ≥ WCAG 2.5.8 (24px). **Correction 2026-09-12:** the previous PASS was certified by a flaky gate (wrong-target port + mid-animation scans); once made deterministic it exposed seven genuine WCAG 2 AA contrast failures, including a home-page section heading rendered `#ffffff` on `#f4f5f2` (**1.09:1 — effectively invisible**) because its section never reset the inherited `text-white`. All seven fixed and re-verified: `/` and `/scanner` now pass axe (wcag2a + wcag2aa + best-practice) with zero critical/serious violations across four consecutive runs. **Correction 2026-09-12 (second pass):** the same gate also skipped `/v/[id]` on any non-200 response, and its enabling env var was set nowhere in the repository — so that route had **never** been audited, and the one condition that would have exposed the 500 above was also the condition that silenced the test. Running it unconditionally immediately surfaced five unlabelled scrollable code regions (`scrollable-region-focusable`, serious), now a shared `CodeBlock` (`tabIndex={0}` + `role="region"` + `aria-label`). Separately, the scanner's five tabs overflowed 375px and were clipped by `overflow-x: clip`, leaving two panels **unreachable on a phone** with no scrollbar or affordance; the width-only layout assertion could not detect it, so a tab-reachability test with a non-vacuity guard was added. `/`, `/scanner` and `/v/[id]` pass axe (wcag2a + wcag2aa + best-practice) with zero critical/serious violations across four consecutive runs. **Third pass 2026-09-12:** the gate only ever saw *empty* states — every scanner panel fills in after a privileged round trip — so the result tables, status pills, score bars, roadmap timeline and evidence ledger had never been scanned. `e2e/a11y-app.spec.ts` now mocks the backend, seeds an operator key, drives a scan and audits all five tabs at **both** viewports (1280px and 375px; the scanner renders tables above `md` and card lists below, so one viewport alone audits half the UI), asserting each panel rendered fixture data first so it cannot pass vacuously. It immediately found a live **52-node** AA failure: `--color-muted-foreground` (`#64748b`) on `--color-muted` (`#f1f5f9`) = **4.34:1** at 10–11px — the conventional shadcn value, checked against white (4.76:1) but never against its own surface. Fixed to `#475569` (6.92:1 on `--color-muted`, 7.58:1 on white) | AAA contrast pass not run; the wallet-gated `/dashboard` and `/vendors` are still unscanned (TD-12) |
| Reproducibility | PASS | `_code_splits(seed=42)` reproduced bit-identically (30/8 repos); `pack_graph_cboms` seeded+deterministic; dvc pipeline honest-failure verified | Deterministic-kernel re-run of full LOO (needs 4×GPU) |
| MLOps | PARTIAL | dvc.yaml stages with leakage-safe splits; experiment artifacts carry config+seed+metrics | Central experiment tracker (dvc experiments push) unused |
| DevOps | PASS | Both Docker images build + run (planner probed live; backend through fail-closed gates to healthy `/health`); CI 32 checks green on each PR | Images built locally; GHCR publish workflow exists but needs a release tag |
| Documentation | PASS | README claims traced to artifacts (clean F1 **0.9205** → `eval_dedup_v4.json`; legacy 0.9395 → `benchmark_comparison.json`); SDK quick-start fixed + docs-contract test prevents drift; mkdocs strict + docs-v2 build pass | None blocking |
| Dependencies | PASS | npm audits clean (both packages); pip audit in CI green (one transient network failure re-run green); no unused-dependency removal needed | Quarterly review cadence |
| Deployment | PASS | `scripts/verify_all.sh` 12 steps pass; go-live preflight passes; compose config supplies all fail-closed env vars via `.env.example` | Production TLS/Basescan checks skip by design (need prod secrets) |
| Competitive Differentiation | PASS | Differentiators verified: on-chain evidence anchoring (EIP-712 gasless), CycloneDX-native scanner, hash-only privacy model. **Honest correction 2026-10-23:** the "GNN-ranked migration ordering" is validated out-of-sample but at **parity with the heuristic** on real data (τ-b 0.7168 vs 0.7210), so it is claimed as an *engineering* asset (learned, retrainable, feature-attributable) — NOT as measured accuracy superiority. The defensible edge is the certification fabric (validity-gated attestation + Merkle-proof revocation), not ranking accuracy. Formal head-to-head vs named external systems measured 2026-09-18 (`benchmarks/external/HEAD-TO-HEAD.md`, E-08: CryptoAPI-Bench usage recall 0.877, Apache F1 0.688 — usage-discovery framing, no superiority claim) | Re-baseline GNN vs heuristic once real org-level migration-outcome labels exist |
| Research / Paper | PASS | 16-page paper (`paper/`) with original results: tie-aware Kendall τ_b, ceiling theorem τ_b ≤ √(d/n₀), tie-decomposition identity τ_b = γ·√(d/n₀) (Goodman–Kruskal γ), metric taxonomy by tie-sensitivity, power analysis, costed benchmark spec, and a labelling-efficiency theorem (bisecting a tied group of size m yields ≈m²/4 new distinguishable pairs). Every headline claim wired to a 53/53 reproducible claims harness | Peer review / external venue submission not yet done |
| IP / Patentability | PASS | Prior-art + patentability search completed; *Alice*/*Mayo* 101 memo drafted. **Patentable cluster:** validity-gated certification method, tie-aware labelling scheduler, and the attestation fabric (Merkle-proof revocation). **Not patentable (disclosed as such):** the ceiling theorem (abstract math). Provisional patent application drafted — **18 claims** | File the provisional with a patent attorney; formal FTO/prior-art opinion |
| Monetization | PARTIAL | Strategy + financial model drafted (tiered certification SaaS + on-chain attestation fabric + benchmark data licensing). Not yet validated with real customers/pricing | Customer discovery, pricing validation, and a paying design partner |
| Metric Integrity | PASS | CI gate `scripts/verify_metric_consistency.py` pins **both** the legacy v1 benchmark F1 = **0.9395** (historical record; 87.6 % eval-path leakage) **and** the clean v4 headline F1 = **0.9205** at the selected 0.50 gate (`eval_dedup_v4.json`), and forbids the stale pre-reanalysis value (correction: 0.9525 is not a result) and any "outperform" overclaim across all docs/artifacts; wired into `.github/workflows/ci.yml` | None blocking |

## Follow-up audit — 2026-09-12

An independent pass re-verified the gates above rather than re-reading this table, then
cross-checked the shipped UI against the proxy authorization policy. Gates re-measured on
the working tree: frontend `tsc`/`eslint` clean, frontend vitest **103 → 137 passed**,
backend `tsc` + **104 passed**, planner+inspector pytest green, `next build` clean (with
the documented `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, see F-2).

Two defects were found and fixed; both are now regression-locked (TD-07):

1. **Privileged UI surface unreachable (HIGH, functional).** The proxy is default-deny
   (correct, S-1), but the UI called routes it denies, so the scanner's scan/roadmap/evidence
   actions, the planner panel, four GPU panels and the vendor attestation relay always
   returned 403 in any deployment using the same-origin proxy. The frontend suite passed
   because component tests stub `fetch`; the proxy suite passed because it asserts exactly
   those denials. Fixed by extracting one policy module both sides consume, adding a
   caller-key path, and adding a contract test that scans UI source for unclassified
   endpoints. Security posture is unchanged for anonymous callers.
2. **Dead dashboard control (LOW, UX).** The sample-verification button refetched and
   discarded its result, leaving the label permanently at "Verify on-chain". It now
   reports verifying/active/inactive/failed states.
3. **e2e suite could test the wrong application (HIGH for test trust).** With
   `reuseExistingServer: true` on port 3000, a stray app on that port was silently adopted:
   six smoke specs reported false failures against an unrelated service, and specs asserting
   only generic properties (axe, overflow, LCP) could have reported false passes. Fixed with
   a dedicated port, an explicit `localhost` baseURL, and an app-identity guard.
4. **Flaky a11y gate (MEDIUM for test trust).** The home-page axe scan failed roughly half
   the time with up to 58 `color-contrast` nodes, because it sampled elements mid
   `hero-enter` animation (axe folds opacity/filter into sampled colours). Now audits the
   reduced-motion rendering and waits out finite animations: 5/5 stable. `/scanner` a11y
   coverage added (it had none, including for the new operator-access panel).

Still open from this pass: TD-01 (scanner-dashboard decomposition, 1.2k lines), TD-08
(browser-held operator key — accepted with rationale), and everything previously listed
as PARTIAL.

## Third pass — 2026-09-12 (design system + populated-surface auditing)

Gates re-measured on the working tree after this pass: frontend `tsc` clean, `eslint`
clean over `src` **and** `e2e`, frontend vitest **143 passed**, `next build` clean,
Playwright **43 passed + 1 skipped**, backend `tsc` + vitest **104 passed**,
planner+inspector pytest **309 passed + 1 skipped**, `mkdocs build --strict` clean.

1. **Application layer was a third visual language (MEDIUM, consistency + a real AA
   failure).** Status colours were invented per file, and the compliance chips rendered a
   600-level foreground on a 15% tint of its own hue — about **2.8:1**. Unified onto a
   measured semantic state palette plus `StatusPill`/`Panel`/`State` primitives; the
   marketing layer keeps its own identity on purpose (TD-10 closed).
2. **The a11y gate could not see the populated UI (HIGH for test trust).** Every scanner
   panel is empty on arrival, so the tables, pills, score bars, roadmap and evidence ledger
   had never been scanned. A mocked-backend spec now drives a scan and audits all five tabs
   at both viewports — and immediately found a **52-node** AA failure
   (`text-muted-foreground` on `bg-muted` = **4.34:1**), live since the token layer was
   written and invisible to every previous run because the failing state was never rendered
   (TD-09 closed, residual moved to TD-12).
3. **Navigation smoke test had an unreproduced flake (LOW for test trust).** One failure in
   roughly eleven full-suite runs, not reproducible in isolation, reported as a locator
   timeout. It now asserts the response status per route and uses a budget appropriate to a
   structural assertion rather than a 5s default, so a slow on-demand compile and a missing
   navigation are distinguishable instead of both appearing as the same red.

Still open after this pass: TD-01 (scanner-dashboard decomposition), TD-08 (browser-held
operator key — accepted with rationale), TD-11 (no theme system — deferred, no requirement),
TD-12 (wallet-gated surfaces outside the a11y gate), and everything previously listed as
PARTIAL.

## Reconciliation pass — 2026-10-23 (gap closure)

Acting on `GAP_ANALYSIS_REPORT.md`, every headline number below was **re-measured on the
working tree** rather than trusted from the table, and every P0/P1 gap was fixed:

1. **F1 metric integrity (P0).** Correction: the canonical benchmark F1 was 0.9525
   and is now **0.9395**, applied across artifacts + 11 docs; new CI gate
   `scripts/verify_metric_consistency.py` (wired into `ci.yml`) forbids the stale
   value and any "outperform" overclaim. Status: PASS.
2. **Planner BatchNorm defect (P0).** `MigrationGNNv3` default `norm` changed `batch → layer`
   (BatchNorm1d leaks cross-graph statistics under PyG batching); legacy checkpoints flagged
   invalid for multi-estate inference; `docs/TRUTH_AUDIT.md` corrected. Status: PASS.
3. **qtrust_ai honesty layer (P1).** `multi_objective_rl.py` "stub random-search" replaced
   with a genuine, verified REINFORCE policy gradient (reward 0.882 → 0.959, deterministic).
   `temporal_gnn.py` reframed as a transparent-heuristic **scenario generator**, not a trained
   forecaster — the untrained torch TGCN is no longer blended into the forecast
   (`torch_model_used_in_forecast` is always `false`); `qtrust_ai/README.md` gained a
   status/honesty section and a metric-scope disambiguation table.
4. **Documentation counts (P1).** `docs/ARCHITECTURE.md` "nine contracts" → **eleven** (added
   EvidenceRegistry + ComplianceAttestation rows) and "2-day" → **7-day** timelock
   (`DEFAULT_DELAY = 7 days`). `deploy/README.md` clarified that "8 UUPS proxy registries" is
   the **app-wired** subset of the 11 source contracts.
5. **On-chain provisioning (P1).** `config.ts` (backend + frontend) `0x0` documented as an
   explicit "not deployed" sentinel (never hardcoded); boot-time warning when contracts are
   unconfigured; `.env.example` points to `deploy-contracts.ps1` and the known-good addresses
   in `deploy/STATUS.md`.
6. **Test truth (P1).** Re-measured and fixed real failures: backend **118** (was 104 — a
   `pool?.on` regression), frontend **150** (was 143), planner+inspector **318 passed + 56
   skipped** (was "309 + 1 skipped"). Fixed 4 genuine test defects: the `pg`-mock EventEmitter
   gap, a **Windows CLI path-validation bug** (missing `\`-separator handling let a mistyped
   path fall through to the network scanner and crash on IDNA), a `/bin/true`-only timing
   test, and a Hypothesis `too_slow` health-check trip.

Re-verified green this pass: backend tsc + vitest 118, frontend tsc + vitest 150,
inspector pytest 242+7, planner pytest 76+49. Playwright e2e and `forge` were not re-run in
this pass and retain their last-measured status.

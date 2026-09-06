# Q-Trust Project Scorecard

Status legend: PASS / PARTIAL / FAIL / NOT TESTED / NOT APPLICABLE.
Every PASS cites executed verification from this engagement (PRs #51–#55, all CI-green and merged to `main`).

| Area | Status | Evidence | Remaining Work |
|---|---|---|---|
| Architecture | PASS | `docs/ARCHITECTURE.md` + 7 ADRs; component boundaries verified by live cross-service test (backend→planner 401/200/422 chain) | None blocking |
| Code Quality | PASS | ruff clean (repo-wide); sdk mypy strict clean; backend tsc + eslint clean; frontend tsc + eslint clean | Large files remain (scanner-dashboard.tsx ~1.2k lines) — tracked in TECHNICAL_DEBT.md |
| ML | PARTIAL | GNN GPU train smoke validated (val τ 0.922→0.927); RL train + CUDA checkpoint load validated; leakage audit recorded (repo-level split integrity holds, 0.4% cross-repo dupes) | Full from-scratch retrain of all models not re-run; metrics rest on shipped artifacts |
| Dataset | PASS | code_corpus.json 13,973 files / 38 repos audited: split reproduced (seed 42 → 30/8 repos, 11,558/2,415 files); vendor dataset 16 records, 0 duplicates | Near-duplicate (fuzzy) scan beyond exact hashes |
| Evaluation | PASS | `benchmark_comparison.json` internally coherent (seed, baselines, n=2415); dvc evaluate stage honestly reports `not_available` on empty splits (verified) | Calibration curve analysis for CodeBERTa confidence |
| Explainability | PASS | Inspector emits evidence-backed findings (exact key sizes from AST); planner returns model provenance in `/health` and `/plan` (variant, path, config, eval metrics) | Per-asset feature attribution for GNN ranking |
| Trustworthiness | PASS | `docs/TRUTH_AUDIT.md` classifies every headline metric (REAL / SYNTHETIC / DEMO); corrected to empirically verified split + honest epoch default | External audit of contracts (see Risks) |
| Security | PASS | Secret scan clean (heuristic git-grep sweep); npm audits clean (backend+frontend); planner SSRF/size-cap/auth defenses verified live; backend fail-closed startup gates verified (CORS, relayer key, scan roots); Slither: no critical/high in project sources; repo threat model with 10 classified threats + evidence anchors (`docs/SECURITY_THREAT_MODEL.md`); IPFS SSRF (TM-FE-01) fixed with CID validation + 8 tests; planner docs exposure fixed; constant-time review clean; external-audit dossier prepared (`docs/audit/DOSSIER.md`) | Slither findings in vendored OpenZeppelin (upstream); external audit itself still pending (R-01) |
| Testing | PASS | forge 213/213; pytest 378 passed + 2 skipped; Hypothesis property tests 15/15; backend 104 vitest; frontend 95 vitest; Playwright 16 (desktop+mobile+a11y); SDK on-chain E2E on anvil | Mutation testing not run (selective-use policy) |
| Performance | PASS | Planner `/plan` measured: p50 28–123ms, p95 43–337ms @ 50–2,000 assets (recorded in `docs/PERFORMANCE.md`); rate limiter verified under load | Frontend Lighthouse CI not automated |
| API | PASS | Planner: malformed `key_size` → 422 with precise message (was 500); CBOM asset cap (`QTRUST_PLANNER_MAX_ASSETS`); backend proxy maps planner 4xx→422, 5xx→503 | None blocking |
| Frontend/UX | PASS | Design-craft pass (PR #55): reduced-motion spinner fix, button press feedback, tx-state bridge, em-dash/version-tell copy hygiene; hallmark + impeccable + taste-skill audits applied | Dark mode is light-only by design (single-theme lock) |
| Accessibility | PASS | Playwright a11y suite passes; skip link, focus rings, aria-labels, semantic headings verified; touch targets ≥ WCAG 2.5.8 (24px) | AAA contrast pass not run |
| Reproducibility | PASS | `_code_splits(seed=42)` reproduced bit-identically (30/8 repos); `pack_graph_cboms` seeded+deterministic; dvc pipeline honest-failure verified | Deterministic-kernel re-run of full LOO (needs 4×GPU) |
| MLOps | PARTIAL | dvc.yaml stages with leakage-safe splits; experiment artifacts carry config+seed+metrics | Central experiment tracker (dvc experiments push) unused |
| DevOps | PASS | Both Docker images build + run (planner probed live; backend through fail-closed gates to healthy `/health`); CI 32 checks green on each PR | Images built locally; GHCR publish workflow exists but needs a release tag |
| Documentation | PASS | README claims traced to artifacts (F1 0.952 → `benchmark_comparison.json`); SDK quick-start fixed + docs-contract test prevents drift; mkdocs strict + docs-v2 build pass | None blocking |
| Dependencies | PASS | npm audits clean (both packages); pip audit in CI green (one transient network failure re-run green); no unused-dependency removal needed | Quarterly review cadence |
| Deployment | PASS | `scripts/verify_all.sh` 12 steps pass; go-live preflight passes; compose config supplies all fail-closed env vars via `.env.example` | Production TLS/Basescan checks skip by design (need prod secrets) |
| Competitive Differentiation | PARTIAL | Differentiators verified: on-chain evidence anchoring (EIP-712 gasless), CycloneDX-native scanner, GNN-ranked migration ordering with LOO out-of-sample validation, hash-only privacy model | Formal competitive benchmark against named external systems |

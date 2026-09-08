# Q-Trust Technical Debt Register

Living document. Priority: P1 (schedule) / P2 (plan) / P3 (opportunistic).

| # | Debt | Impact | Why It Exists | Recommended Resolution | Priority |
|---|---|---|---|---|---|
| TD-01 | `frontend/src/components/scanner-dashboard.tsx` is ~1,200 lines mixing data fetching, layout, and export logic | Slower reviews, higher regression risk on every scanner change | Grew organically with scanner features | Split into `ScannerResults`, `ScannerExportBar`, `ScannerFilters` with tests moved per component | P2 |
| TD-02 | Shipped model checkpoints lack an in-artifact epoch/version manifest (only config.json) | Cannot prove which script version produced a checkpoint | Checkpoint predates the artifact-metadata convention | Add `training_manifest.json` next time any checkpoint is regenerated; record epochs, git SHA, dataset hash | P2 |
| TD-03 | Two documentation systems (mkdocs `docs/` + `docs-v2/` Vite site) | Double maintenance, drift risk | docs-v2 added as a modern site later; mkdocs remains the API/reference home | Long-term: fold mkdocs reference content into docs-v2 or generate one from the other | P3 |
| TD-04 | Contract test suite covers pause/roles/adversarial paths, but no property-based (Echidna/Foundry invariant) fuzzer run is automated | Deep invariant violations could hide beyond hand-written tests | Fuzzing infra not yet wired into CI | Add a nightly Foundry invariant job with the timelock-delay and registry-count invariants already written | P2 |
| TD-05 | `scripts/verify_all.sh` runs ~20 min serially; slows release confidence loops | Release engineering friction | Aggregates every suite into one gate | Shard into a matrix (Python / contracts / Node) like CI already does | P3 |
| TD-06 | Frontend had no automated Lighthouse/CWV budget in CI | Perf regressions would ship silently | Playwright covered function+a11y, not perf | **CLOSED 2026-09-08** — `frontend/e2e/cwv-budget.spec.ts` gates LCP ≤ 2.5 s + CLS ≤ 0.1 (PerformanceObserver) in the existing e2e job; the full Lighthouse toolchain remains an optional manual run | P3 |

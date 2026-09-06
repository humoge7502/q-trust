# Q-Trust Release Checklist

All boxes below reflect the verified state at the merge of PR #55 (2026-09-06).
Re-run each gate before tagging a release; do not check boxes from memory.

## Build
- [x] `forge build` — clean (contracts)
- [x] `cd backend && npm run build` — tsc clean
- [x] `cd frontend && npm run build` — Next.js production build clean
- [x] `cd docs-v2 && npm run docs:build` — clean
- [x] `mkdocs build --strict` — clean

## Tests
- [x] `forge test -C contracts` — 213 passed (incl. invariant + adversarial suites)
- [x] `pytest planner/tests inspector/tests sdk/tests qtrust_ai/tests` — 378 passed, 2 skipped
- [x] Hypothesis property tests (`sdk/tests/test_properties.py`) — 15 passed
- [x] `cd backend && npm test` — 104 passed
- [x] `cd frontend && npm test` — 95 passed
- [x] `cd frontend && npx playwright test` — 16 passed (desktop + mobile + a11y)
- [x] `bash sdk/tests/run_e2e.sh` — full on-chain SDK flow on anvil

## Static analysis & lint
- [x] `ruff check .` — clean
- [x] `cd sdk && python3 -m mypy qtrust` — strict, clean
- [x] `cd backend && npm run typecheck` — clean
- [x] `cd frontend && npm run lint` && `npx tsc --noEmit` — clean
- [x] Slither — no critical/high findings in project sources (vendored OZ triaged)

## Security
- [x] Secret sweep — clean (heuristic git-grep; CI gitleaks job green)
- [x] `npm audit --omit=dev` — backend + frontend clean
- [x] pip-audit CI jobs — green (one transient network failure re-run green)
- [x] Planner defenses probed live — auth, 422 validation, asset cap, rate limit
- [x] Backend fail-closed startup gates verified — CORS, relayer key, scan roots

## Model & data
- [x] Checkpoints load; `/health` reports model provenance (variant, config, eval metrics)
- [x] Dataset split reproduction: seed 42 → 30/8 repos, 11,558/2,415 files, zero overlap
- [x] Leakage audit recorded in `docs/TRUTH_AUDIT.md`
- [ ] Full from-scratch retrain (BLOCKED on 4×GPU reservation — see RISK_REGISTER R-03)

## Performance
- [x] Planner `/plan` p50/p95 measured and recorded (`docs/PERFORMANCE.md`)
- [ ] Lighthouse/CWV budget in CI (TD-06)

## API & UX
- [x] Planner `/health`, `/plan`, `/plan/deadline`, `/rl/plan` probed (happy + malformed + auth paths)
- [x] Backend↔planner chain verified end to end (401/200/422 propagation)
- [x] Playwright a11y + mobile overflow gates green

## Documentation
- [x] README claims traced to artifacts; SDK quick-start locked by `sdk/tests/test_readme_contract.py`
- [x] `docs/TRUTH_AUDIT.md` synchronized with empirical findings
- [x] `mkdocs build --strict` + docs-v2 build pass

## Reproducibility
- [x] `_code_splits(seed=42)` bit-identical reproduction
- [x] dvc evaluate stage honest-failure verified (`not_available` on empty splits)
- [x] `./scripts/verify_all.sh` — all 12 steps pass

## Deployment
- [x] planner image: build + run + live probe
- [x] backend image: build + run through fail-closed gates to healthy `/health`
- [ ] GHCR publish (BLOCKED on release tag — workflow `publish-docker.yml` is tag-triggered)

## Repository hygiene
- [x] No untracked project files committed (`.agents/` skill tooling intentionally uncommitted)
- [x] CHANGELOG entries for every change in this engagement
- [x] `./scripts/check_golive_blockers.sh` — passed

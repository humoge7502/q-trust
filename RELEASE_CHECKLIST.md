# Q-Trust Release Checklist

All boxes below reflect the verified state at the merge of PR #55 (2026-09-06).
Re-run each gate before tagging a release; do not check boxes from memory.

## Build
- [x] `forge build` — clean (contracts)
- [x] `cd backend && npm run build` — tsc clean
- [x] `cd frontend && NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<real id> npm run build` —
      Next.js production build clean. This env var is **required** for the build: the
      fail-closed guard in `frontend/src/lib/wagmi.ts` (audit F-2) throws during
      prerender when it is unset or literally `demo`, so a bare `npm run build` fails by
      design. CI and `scripts/verify_all.sh` supply a placeholder; real deployments must
      supply a real project ID from cloud.walletconnect.com.
- [x] `cd docs-v2 && npm run docs:build` — clean
- [x] `mkdocs build --strict` — clean

## Tests
- [x] `forge test -C contracts` — 213 passed (incl. invariant + adversarial suites)
- [x] `pytest planner/tests inspector/tests sdk/tests qtrust_ai/tests` — 378 passed, 2 skipped
- [x] `pytest planner inspector` re-run 2026-09-12 — 309 passed, 1 skipped
- [x] Hypothesis property tests (`sdk/tests/test_properties.py`) — 15 passed
- [x] `cd backend && npm test` — 104 passed
- [x] `cd frontend && npm test` — 143 passed (was 103 before 2026-09-12; includes the
      UI↔proxy policy contract test that fails if any endpoint the UI calls is not
      classified in `frontend/src/lib/api-route-policy.ts`)
- [x] `cd frontend && npx playwright test` — 43 passed, 1 skipped (desktop + mobile + a11y +
      a11y-app + CWV + layout). Runs on a dedicated port (`QTRUST_E2E_PORT`, default 3020): on
      a shared port with `reuseExistingServer`, a stray app on that port is silently tested
      instead — see CHANGELOG 2026-09-12. Specs that assert only generic properties call
      `e2e/app-identity.ts` first so a wrong-target run cannot report green. The a11y suite
      audits both the as-loaded state (`a11y.spec.ts`) and the populated, operator-authorized
      state (`a11y-app.spec.ts`, mocked backend + seeded operator key, all five scanner tabs
      at both viewports) — see TD-09.
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
- [x] Repo threat model written and reviewed — `docs/SECURITY_THREAT_MODEL.md` (PR #57)
- [x] IPFS metadata fetch SSRF-hardened with strict CID validation + tests (TM-FE-01, PR #57)
- [x] Planner OpenAPI/docs disabled in production (FASTAPI-OPENAPI-001, PR #57)
- [x] Constant-time review of secret comparisons — clean (PR #57)
- [x] External-audit dossier prepared — `docs/audit/DOSSIER.md`
- [x] Pin SHA256 of model checkpoints at deploy (TM-PL-02) — startup verification vs `models.sha256` (image-baked), fail closed under `QTRUST_ENFORCE_MODEL_MANIFEST=1` (2026-09-08)

## Model & data
- [x] Checkpoints load; `/health` reports model provenance (variant, config, eval metrics)
- [x] Dataset split reproduction: seed 42 → 30/8 repos, 11,558/2,415 files, zero overlap
- [x] Leakage audit recorded in `docs/TRUTH_AUDIT.md`
- [ ] Full from-scratch retrain (BLOCKED on 4×GPU reservation — see RISK_REGISTER R-03)

## Performance
- [x] Planner `/plan` p50/p95 measured and recorded (`docs/PERFORMANCE.md`)
- [x] Core Web Vitals budget (LCP ≤ 2.5 s, CLS ≤ 0.1) in the e2e job (TD-06) — Playwright-driven, same metrics/budgets Lighthouse audits (2026-09-08)

## API & UX
- [x] Planner `/health`, `/plan`, `/plan/deadline`, `/rl/plan` probed (happy + malformed + auth paths)
- [x] Same-origin proxy authorization probed live on a production build (2026-09-12):
      anonymous privileged call → 403 `operator_key_required` with zero upstream requests;
      keyed privileged call → upstream saw the caller's key and never the admin key;
      public route with a caller key present → upstream still saw the admin key
- [x] Backend↔planner chain verified end to end (401/200/422 propagation)
- [x] Playwright a11y + mobile overflow gates green, deterministically — the a11y spec
      audits the reduced-motion rendering and waits out finite animations, because axe folds
      opacity/filter into sampled colours and a mid-animation scan reported false contrast
      failures (~50% flake rate before the fix; 5/5 stable after)
- [x] Populated application surface audited (2026-09-12) — `e2e/a11y-app.spec.ts` mocks the
      backend, drives a scan and audits all five tabs at 1280px and 375px, each test asserting
      its panel rendered fixture data first. It found a live 52-node AA failure
      (`--color-muted-foreground` #64748b on `--color-muted` = 4.34:1), now fixed to #475569
      (6.92:1 on `--color-muted`, 7.58:1 on white)
- [ ] Wallet-gated `/dashboard` and `/vendors` a11y audit — **not covered** (TD-12): reaching
      them needs a connected wallet, which the suite does not fake end-to-end

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

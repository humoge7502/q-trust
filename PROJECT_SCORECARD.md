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
| Security | PASS | Secret scan clean (heuristic git-grep sweep); npm audits clean (backend+frontend); planner SSRF/size-cap/auth defenses verified live; backend fail-closed startup gates verified (CORS, relayer key, scan roots); Slither: no critical/high in project sources; repo threat model with 11 classified threats + evidence anchors (`docs/SECURITY_THREAT_MODEL.md`); IPFS SSRF (TM-FE-01) fixed with CID validation + 8 tests; planner docs exposure fixed; constant-time review clean; external-audit dossier prepared (`docs/audit/DOSSIER.md`); checkpoint SHA-256 pin verified at startup, fail-closed (TM-PL-02, 2026-09-08); proxy operator-key boundary (TM-FE-03, 2026-09-12) verified live — anonymous privileged calls 403 with zero upstream requests, the server admin key is never attached to operator routes, caller key is forwarded and its own header name never leaks — with 12 enforcement tests | Slither findings in vendored OpenZeppelin (upstream); external audit itself still pending (R-01); browser-held operator key (TD-08) |
| Testing | PASS | forge 213/213; Hypothesis property tests 15/15; backend 104 vitest; frontend 95 → 137 → **143** vitest across 17 files (2026-09-12); planner+inspector pytest **309 passed + 1 skipped** (2026-09-12 re-run); Playwright **43 passed + 1 skipped** (desktop+mobile+a11y+a11y-app+CWV+layout, on a dedicated port with an app-identity guard, a deterministic a11y gate, `/v/[id]` running unconditionally rather than skipping itself out of existence, and the populated application surface now audited via a mocked backend) — ten consecutive full runs with one unreproduced flake in `every app route exposes navigation`, now given an explicit status assertion and a structural (not latency) budget; SDK on-chain E2E on anvil | Mutation testing not run (selective-use policy) |
| Performance | PASS | Planner `/plan` measured: p50 28–123ms, p95 43–337ms @ 50–2,000 assets (recorded in `docs/PERFORMANCE.md`); rate limiter verified under load; CWV budget (LCP ≤ 2.5 s, CLS ≤ 0.1) automated in the e2e job (TD-06, 2026-09-08). **Measured 2026-09-12:** with the new self-hosted fonts the home page passes the CWV gate with the LCP budget tightened from 2500 ms to **1500 ms** (`QTRUST_CWV_LCP_BUDGET_MS=1500`), i.e. LCP < 1.5 s, and CLS stays inside the 0.1 budget — `next/font` self-hosts and emits metric-adjusted fallbacks, so no third-party font request sits on the critical path | Full Lighthouse toolchain in CI not automated (manual optional run) |
| API | PASS | Planner: malformed `key_size` → 422 with precise message (was 500); CBOM asset cap (`QTRUST_PLANNER_MAX_ASSETS`); backend proxy maps planner 4xx→422, 5xx→503 | None blocking |
| Frontend/UX | PASS | Design-craft pass (PR #55): reduced-motion spinner fix, button press feedback, tx-state bridge, em-dash/version-tell copy hygiene; hallmark + impeccable + taste-skill audits applied. **Correction 2026-09-12:** a follow-up audit found a large part of the interactive surface (scanner scan/roadmap/evidence, planner, four GPU panels, vendor attestation) called privileged endpoints the same-origin proxy denies by default, so those controls were permanently 403 in the documented deployment path. Fixed via the shared policy module + operator-key path (TD-07); the dead sample-verification button on the dashboard is fixed too. **Correction 2026-09-12 (second pass):** three further defects found by auditing rather than by trusting the suite — (1) `/v/[id]` returned a **500 on every request** (server component using the relative `API_BASE_URL`; Node's `fetch` cannot parse it) so the public verification page never rendered; (2) `/v`, the target of the "Verify" nav item on every page, contained **no input at all** and told visitors to edit the address bar; (3) the header/footer existed **only on `/`**, so every other route had no navigation and no skip link, and its one anchor (`/#protocol`) pointed at an id that does not exist.All fixed, plus self-hosted typography (no web font was loaded anywhere), `robots`/`sitemap`/`manifest`/JSON-LD, and per-route metadata. **Third pass 2026-09-12:** the application layer was a *third* visual language — raw Tailwind palette classes plus ad-hoc shadcn tokens, with status colours invented per file ("success" was `emerald-50/700`, `green-500` and `green-600`-on-`green-500/15` in three different files). Unified onto a semantic state palette and a named type scale, with `StatusPill`/`Panel`/`State` primitives replacing per-file colour helpers; `scanner-dashboard.tsx` goes from 101 raw palette utilities to 4. The compliance chips' ~2.8:1 contrast failure went with it (TD-10 closed) | Operator key is browser-held (TD-08); scanner-dashboard.tsx decomposition still open (TD-01); wallet-gated `/dashboard` + `/vendors` still outside the automated a11y gate (TD-12) | Accessibility | PASS | Playwright a11y suite passes; skip link, focus rings, aria-labels, semantic headings verified; touch targets ≥ WCAG 2.5.8 (24px). **Correction 2026-09-12:** the previous PASS was certified by a flaky gate (wrong-target port + mid-animation scans); once made deterministic it exposed seven genuine WCAG 2 AA contrast failures, including a home-page section heading rendered `#ffffff` on `#f4f5f2` (**1.09:1 — effectively invisible**) because its section never reset the inherited `text-white`. All seven fixed and re-verified: `/` and `/scanner` now pass axe (wcag2a + wcag2aa + best-practice) with zero critical/serious violations across four consecutive runs. **Correction 2026-09-12 (second pass):** the same gate also skipped `/v/[id]` on any non-200 response, and its enabling env var was set nowhere in the repository — so that route had **never** been audited, and the one condition that would have exposed the 500 above was also the condition that silenced the test. Running it unconditionally immediately surfaced five unlabelled scrollable code regions (`scrollable-region-focusable`, serious), now a shared `CodeBlock` (`tabIndex={0}` + `role="region"` + `aria-label`). Separately, the scanner's five tabs overflowed 375px and were clipped by `overflow-x: clip`, leaving two panels **unreachable on a phone** with no scrollbar or affordance; the width-only layout assertion could not detect it, so a tab-reachability test with a non-vacuity guard was added. `/`, `/scanner` and `/v/[id]` pass axe (wcag2a + wcag2aa + best-practice) with zero critical/serious violations across four consecutive runs. **Third pass 2026-09-12:** the gate only ever saw *empty* states — every scanner panel fills in after a privileged round trip — so the result tables, status pills, score bars, roadmap timeline and evidence ledger had never been scanned. `e2e/a11y-app.spec.ts` now mocks the backend, seeds an operator key, drives a scan and audits all five tabs at **both** viewports (1280px and 375px; the scanner renders tables above `md` and card lists below, so one viewport alone audits half the UI), asserting each panel rendered fixture data first so it cannot pass vacuously. It immediately found a live **52-node** AA failure: `--color-muted-foreground` (`#64748b`) on `--color-muted` (`#f1f5f9`) = **4.34:1** at 10–11px — the conventional shadcn value, checked against white (4.76:1) but never against its own surface. Fixed to `#475569` (6.92:1 on `--color-muted`, 7.58:1 on white) | AAA contrast pass not run; the wallet-gated `/dashboard` and `/vendors` are still unscanned (TD-12) |
| Reproducibility | PASS | `_code_splits(seed=42)` reproduced bit-identically (30/8 repos); `pack_graph_cboms` seeded+deterministic; dvc pipeline honest-failure verified | Deterministic-kernel re-run of full LOO (needs 4×GPU) |
| MLOps | PARTIAL | dvc.yaml stages with leakage-safe splits; experiment artifacts carry config+seed+metrics | Central experiment tracker (dvc experiments push) unused |
| DevOps | PASS | Both Docker images build + run (planner probed live; backend through fail-closed gates to healthy `/health`); CI 32 checks green on each PR | Images built locally; GHCR publish workflow exists but needs a release tag |
| Documentation | PASS | README claims traced to artifacts (F1 0.952 → `benchmark_comparison.json`); SDK quick-start fixed + docs-contract test prevents drift; mkdocs strict + docs-v2 build pass | None blocking |
| Dependencies | PASS | npm audits clean (both packages); pip audit in CI green (one transient network failure re-run green); no unused-dependency removal needed | Quarterly review cadence |
| Deployment | PASS | `scripts/verify_all.sh` 12 steps pass; go-live preflight passes; compose config supplies all fail-closed env vars via `.env.example` | Production TLS/Basescan checks skip by design (need prod secrets) |
| Competitive Differentiation | PARTIAL | Differentiators verified: on-chain evidence anchoring (EIP-712 gasless), CycloneDX-native scanner, GNN-ranked migration ordering with LOO out-of-sample validation, hash-only privacy model | Formal competitive benchmark against named external systems |

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

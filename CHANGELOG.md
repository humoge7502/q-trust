# Changelog

All notable changes to Q-Trust are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — 42-fold LOO on GPU + side-channel retrain on 54 trace sets (2026-09-18)

- **42-fold LOO (2× A100, 30-epoch fine-tune, seed 42):** model **τ-b 0.7168**
  vs doctrine heuristic **0.7210** (Δ **−0.0042**, medians identical 0.7237) —
  **0 wins / 41 ties / 1 loss**, model top-10 1.0 on all 42 folds, +0.687 vs
  random. Report: `planner/results/real_cbom_loo_42.json` (+2 shard files);
  the 40-fold files stay as historical records.
- **Side-channel retrain** (`train_real_side_channel.py --traces-dir
  /tmp/real_data`, 54 sets, loss 0.178→0.080, anchors 0.000/1.000): clean
  **46 VERIFIED + 8 LOW_RISK (0 false alarms)**; leak-injected **51/54
  HIGH_RISK** (misses: FALCON1024/FALCON512/SLH-256s keygen, n≤200). New
  weights in `inspector/side_channel_model_real.pt` (previous backed up
  before overwriting).

### Added — host-disjoint 42-CBOM real-estate corpus committed (2026-09-18)

- **Replaced** the hand-packed 40-file `planner/data/real_cboms/` (280 assets
  over only 269 unique hosts — 11 cross-CBOM duplicates, i.e. train/eval
  leakage) with the deterministic builder output: **42 CBOMs, 277 unique
  hosts, 0 overlaps**, byte-identical to
  `python scripts/build_real_cboms.py --hosts-per-cbom 7 --seed 42` run
  against the 277-finding TLS scan (verified by regeneration + `diff -rq`).
- **Fixed** the `.gitignore` `data/` pattern that silently swallowed both this
  corpus (making the `!planner/data/real_cboms/` exception dead) and the real
  `qtrust/data/*.py` split-lineage sources; scoped to `/data/` (root runtime
  dir only). Both paths are now tracked — a fresh clone reproduces the
  real-CBOM numbers without re-scanning.
- Historical 40-fold LOO result files (`real_cbom_loo_40.json`, …) are
  untouched records of that campaign; a 42-fold re-run needs GPU time (R-03).

### Fixed — roadmap dropped MEDIUM findings, dead planner lookup, dashboard onboarding unreachable (2026-09-18)

- **Roadmap (R2).** `POST /v1/roadmap/generate` bucketed findings into
  CRITICAL/HIGH/(NONE|LOW) only, so MEDIUM findings (the typical landing zone
  for WEAKENED crypto: penalty 25 + HNDL exposure) were silently dropped while
  `summary.totalFindings` still counted them. They now get their own phase 3
  ("Medium: Review Weakened Cryptography"); every scored finding appears in
  exactly one phase. Locked by `backend/tests/risk-roadmap.test.ts`.
- **Dead planner lookup (R1).** `GET /v1/plans/:did` proxied to
  `GET ${PLANNER_URL}/plans/:did`, an endpoint the stateless planner never
  implemented — the route could never return data. It now returns
  `410 code: plans_lookup_retired` with a `POST /v1/plans` hint, and the
  frontend proxy no longer exposes it (default-deny 403). Proxy + policy
  contract tests updated.
- **Dashboard onboarding (P1).** The outer gate blocked `role === "none"`,
  so every connected-but-new wallet saw "Connect a wallet" instead of the
  onboarding (`DashboardInner`'s "Run your first scan"). The outer gate now
  checks connection only; role stays a UI hint inside, matching `/vendors`.
- **Planner reliability.** `POST /v1/plans` forwards planner 429s with
  `Retry-After` instead of masking backpressure as 422 (R6); the in-memory
  rate-limit fallback drops empty buckets and bounds the table at 10k entries
  (R5); `_build_schedule` clamps window starts at today and reports
  `overflow_days` + per-window `clamped_to_today` instead of emitting past
  dates as actionable work (R7). Covered by `planner/tests/test_reliability.py`.
- **Throttling (R4).** `POST /v1/credentials/verify` (CPU-heavy signature
  verification, previously anonymous and unthrottled) gets the same 30/min
  budget as `/v1/evaluate`.
- **Risk-parity lock.** Backend `/v1/risk/score` golden vectors (RSA-2048 →
  84/CRITICAL, AES-128 → MEDIUM) pin the TS mirror of
  `inspector/qtrust_inspector/risk_engine.py` so the copies cannot drift.
- **Honesty + a11y.** Scanner page states web scans cover server-mounted
  directories (TLS host scans via CLI); signal-strip marquee duplicate is
  `aria-hidden`; product preview badge reads "Preview · sample data".

### Changed — application layer unified onto the design-token layer (2026-09-12)

- **Problem.** The product had three visual languages. The marketing pages used a slate/cyan
  editorial palette; the app layer used raw Tailwind palette classes
  (`text-slate-500`, `border-slate-200`, `bg-slate-50`) alongside ad-hoc shadcn tokens
  (`bg-card`, `border-border`); and the status colours were per-file inventions. "Success" was
  `emerald-50/700` in the dashboard, `green-500` in the compliance score bar, and
  `green-600` on `green-500/15` in the compliance chips — the same meaning rendered three ways
  depending on which file you opened.
- **Fixed:** the compliance chips were not merely inconsistent but a real WCAG AA failure.
  A 600-level foreground on a 15% tint of its own hue measures ~**2.8:1** against the 4.5:1
  minimum. The status palette in `globals.css` now pairs each foreground with a surface that
  was measured **against that surface**, not just against white:
  `success #15803d on #f0fdf4 = 4.79:1`, `danger #b91c1c on #fef2f2 = 5.98:1`,
  `warning #a16207 on #fffbeb = 4.74:1`, `info #1d4ed8 on #eff6ff = 6.23:1`,
  `neutral #475569 on #f1f5f9 = 6.82:1`.
- **Added:** `components/ui/status-pill.tsx` (one chip for every state, with a `data-tone`
  contract so tests assert semantics rather than a hex value), `components/ui/panel.tsx` and
  `components/ui/state.tsx` (shared empty/error states). `severityTone()` / `complianceTone()`
  replace the per-file `severityColor()` / `complianceColor()` helpers that returned raw class
  strings.
- **Migrated:** the scanner dashboard, dashboard, vendor portal, attestation form,
  operator-access, planning panel, and the anomaly / quantum-threat / side-channel / RL-plan /
  compliance panels. `scanner-dashboard.tsx` goes from 101 raw palette utilities to 4 — the
  four that remain are inside a comment describing the old behaviour
- **Added:** a named type scale (`--text-label` 10px, `--text-micro` 11px) replacing 43 raw
  `text-[10px]` / `text-[11px]` literals, so the small-text roles are one definition
- **Unchanged on purpose:** the marketing layer keeps its own slate/cyan palette. The intended
  shape is two complementary layers — expressive in public, dense and focused in the
  application — and the semantic tokens are now what makes the application layer coherent on
  its own terms. Migrating the marketing pages onto the same tokens is *not* done: they still
  use raw palette classes by design, because their colour choices carry the brand identity
  rather than a state meaning

### Fixed — `text-muted-foreground` on `bg-muted` failed WCAG AA (52 nodes) (2026-09-12)

- **Found by:** the new populated-surface a11y gate below. It was not introduced by the token
  migration: the pre-migration pair was `text-slate-500` on `bg-slate-100`, which measures
  **4.35:1** — the same failure, in the same places.
- **Root cause:** `--color-muted-foreground` took the conventional shadcn value `#64748b`,
  which is checked against **white** (4.76:1, a pass). The token is also used as the foreground
  for content sitting on `--color-muted` — metadata chips, table headers, the evidence and
  roadmap detail rows — where it measures **4.34:1**, under the 4.5:1 minimum at 10–11px.
  This is the identical "check the pair, not just the colour" mistake the status palette was
  written to avoid.
- **Fixed:** `--color-muted-foreground: #475569` — measured 6.92:1 on `--color-muted`,
  7.02:1 on `--color-canvas`, 7.58:1 on white.

### Added — the a11y gate now audits the populated, authorized application surface (2026-09-12)

- **Gap (TD-09):** `a11y.spec.ts` audited each route in the state it renders on arrival. Every
  scanner and dashboard panel is empty on arrival and only fills after a privileged round trip,
  so the gate had never once scanned the result tables, status pills, score bars, roadmap
  timeline or evidence ledger — the densest, most colour-bearing UI in the product, and the
  likeliest place for a contrast regression to land.
- **Added:** `frontend/e2e/a11y-app.spec.ts` mocks the backend, seeds an operator key, drives a
  scan, and audits all five tabs at both configured viewports (1280px and 375px — the scanner
  renders tables above `md` and card lists below it, so one viewport alone audits half the UI).
- **Anti-vacuity:** each test asserts its panel actually rendered the fixture data before
  running axe. Auditing an empty state while claiming to audit the populated one is the same
  false-green class this suite has already been burned by twice.
- **Refactor:** the audit logic is extracted to `frontend/e2e/axe-audit.ts`, so the public and
  app-surface specs cannot drift into scanning different rule sets.
- **Result:** 6 tests (5 tabs × 2 viewports) that immediately found the 52-node AA failure above.

### Fixed — `/v/[id]` returned a 500 on every request (2026-09-12)

- **Root cause:** `frontend/src/lib/api.ts` built every request URL from `API_BASE_URL`,
  which is relative (`/api`) because browser calls must go through the same-origin proxy.
  `v/[id]/page.tsx` is a **server component** and imports the same module; Node's `fetch`
  cannot parse a relative URL and throws `TypeError: Failed to parse URL`. The page rethrew
  anything that was not a 404, so the public verification page — the product's headline
  "anyone can check the record" claim — failed before rendering, in every environment.
- **Why it went unnoticed:** `frontend/e2e/a11y.spec.ts` wrapped this route in
  `test.skip(process.env.QTRUST_E2E_PUBLIC_PAGE !== "1")` and then skipped again whenever the
  response was not `200`. The enabling variable was set nowhere in the repository, so the
  spec never ran; had it run, it would have skipped precisely because the page was broken.
- **Fixed:** `resolveApiRequest()` now resolves per runtime — same-origin `/api` proxy in the
  browser, the backend origin directly on the server (mirroring `backendUrl()` in the proxy
  route, so both paths reach the same upstream). The server-only admin key is attached on the
  server and the caller's operator key in the browser, never swapped.
- **Added:** `VerificationUnavailable` state. An unreachable backend is now distinguished from
  both "no such record" (404) and a crash, and says that it says nothing about validity.
- **Tests:** `lib/__tests__/api-url-resolution.test.ts` pins both branches (server URLs are
  absolute; the admin key never leaves the server); a smoke test asserts `/v/[id]` returns
  `< 500`; the a11y spec now scans the route unconditionally and fails on 5xx.
- **Verified in a production build** (`next start`): `/`, `/scanner`, `/dashboard`,
  `/vendors`, `/v` and `/v/<asset-id>` all return `200`.

### Fixed — the primary navigation did not exist outside the landing page (2026-09-12)

- **Root cause:** `SiteHeader` and the footer were rendered by `app/page.tsx` only. Every
  other route (`/scanner`, `/dashboard`, `/vendors`, `/v`, `/v/[id]`) shipped with no
  navigation, no footer and no skip link, so a visitor who arrived on the landing page and
  clicked through could only get back via the browser button.
- **Fixed:** the shell moved to `app/layout.tsx` (`components/site-header.client.tsx`,
  `components/site-footer.tsx`, `components/skip-link.tsx`), so `#main-content`, the
  `<footer>` landmark and a route back exist on every page by construction. `body` is now
  `flex min-h-screen flex-col` so a short page pins the footer instead of stranding it.
- **Fixed:** the header's "Protocol" item pointed at `/#protocol`, an id that exists nowhere
  on the page (the sections are `#why`, `#product`, `#workflow`) — a dead link. It now points
  at `/#workflow`, the section that actually describes the protocol.
- **Added:** active-route indication (`aria-current="page"`) and a Vendors destination.
- **Tests:** a smoke test walks every route and asserts navigation is present in the form the
  viewport actually uses (inline nav on desktop, menu control on mobile).

### Fixed — the scanner's tabs were unreachable on a phone (2026-09-12)

- **Root cause:** the tab list rendered five labelled tabs in a single `flex` row with no
  wrapping. At 375px the trailing tabs (Evidence, Side channel) overflowed, and the
  document's `overflow-x: clip` cut them off — no scrollbar, no scroll affordance, no way to
  open them. `mobile-layout.spec.ts` asserts `scrollWidth <= viewport`, which cannot detect
  this: `overflow-x: clip` keeps `scrollWidth` equal to the viewport *because* the content is
  clipped.
- **Fixed:** the tab list wraps.
- **Added:** a `mobile layout safety` test asserting every `[role="tab"]` sits inside the
  viewport, with a guard that fails if zero tabs were found (so it cannot pass vacuously).
- **Found because of:** a footer contrast fix. Axe samples rendered pixels, and the clipped
  tabs fell back to the page background — which was light before this change and is dark now.
  The dark shell did not create the defect; it made an existing one measurable.

### Added — self-hosted typography and design tokens (2026-09-12)

- **No web font was loaded anywhere in the product.** Every surface rendered in the OS
  default UI stack, so the editorial typography the design depends on (very tight tracking on
  very large headings) rendered differently on every platform and the intent did not land.
- **Added** `frontend/src/lib/fonts.ts` — `next/font` self-hosted **Inter Tight** (display),
  **Inter** (body/UI) and **JetBrains Mono** (technical labels, hashes, IDs). Fonts are
  downloaded at build time and served from `/_next`, so no request leaves the origin on the
  critical path and the CSP's `font-src 'self'` stays sufficient. `preload` is enabled only
  for the two faces that paint above the fold.
- **Added** design tokens to `@theme` in `globals.css`: `--font-sans` / `--font-display` /
  `--font-mono`, one motion easing family (`--ease-brand`, `--ease-brand-in`), and semantic
  surface colours (`--color-canvas`, `--color-canvas-raised`) so route files stop hardcoding
  `bg-slate-50`. Headings take the display face from a base layer, so hierarchy is a
  property of the document rather than something each section must remember to opt into.
- **Measured:** LCP stays under 1.5 s on the home page with the new fonts (the e2e CWV gate
  passes with `QTRUST_CWV_LCP_BUDGET_MS=1500`); CLS within the existing `0.1` budget.

### Added — SEO surfaces (2026-09-12)

- **Added** `app/robots.ts`, `app/sitemap.ts` and `app/manifest.ts`. Public routes are listed;
  `/dashboard`, `/vendors` and `/v/[id]` are excluded and marked `noindex` at the route level
  (a wallet gate and unbounded per-record URLs are not useful index entries) — the two
  settings are meant to be read together.
- **Added** `components/json-ld.tsx` — `WebSite` + `SoftwareApplication` structured data,
  scope limited to claims the repository can substantiate. `JSON.stringify` output is escaped
  (`<` → `\u003c`) so structured data cannot become a script-injection sink.
- **Added** `lib/site.ts` as the single canonical origin, consumed by `metadataBase`,
  `robots.ts`, `sitemap.ts` and the JSON-LD graph so they cannot drift apart.
- **Fixed:** the dashboard and vendor portal are client components, which cannot export
  `metadata`, so both inherited the site-wide default `<title>` — every app surface shared one
  identical title. Both now have a `layout.tsx` providing their own.
- **Fixed:** titles that already contained the brand rendered it twice, because the root
  layout's `title.template` appends `· Q-Trust` to every child segment
  ("PQC Migration Scanner: Q-Trust · Q-Trust", "Q-Trust — Asset 0x7b52… · Q-Trust").
- **Added** canonical URLs and a title regression test asserting no two routes share a title
  and none repeats the brand suffix.

### Changed — `/v` performs the lookup instead of describing how to (2026-09-12)

- `/v` is the destination of the "Verify" item in the primary navigation and contained no
  input at all; it instructed visitors to paste an asset ID into the browser address bar and
  otherwise linked home. The product's most-advertised capability was a dead end.
- **Added** `components/verify-form.client.tsx` and `hooks/use-verify-asset.ts`. The form uses
  a native `<form>` with `onSubmit` so the browser owns implicit submission and Enter-to-submit;
  the landing page's `VerifyBox` was converted from a click handler plus `onKeyDown` to the
  same pattern. Both surfaces share the hook, so the validation rule (`parseAssetId`'s
  hardened 0x+64-hex check) and the error copy cannot drift apart.

### Fixed — accessibility (2026-09-12)

- **Scrollable code blocks were not keyboard-reachable** (`scrollable-region-focusable`,
  serious): five `<pre>` regions scroll their content, which a mouse user can drag but a
  keyboard-only user cannot. Added `components/ui/code-block.tsx` (`tabIndex={0}`,
  `role="region"`, `aria-label`) and moved all five onto it.
- **Footer contrast:** the new footer's `text-slate-500` on `#020618` measured 4.23:1 against
  the required 4.5:1. Fixed to `text-slate-400` (7.66:1) — caught by the existing gate.
- **Now audited:** `/v/[id]` had never been through the a11y gate (see the 500 above); it is
  scanned on every run and currently clean.

### Fixed — gates that could not fail (2026-09-12)

Three separate cases where a green result did not mean what it appeared to mean.

- **A spec that disabled itself when the page broke.** The `/v/[id]` a11y test skipped on any
  non-200 response, and its enabling env var was set nowhere — so the route was never
  audited, and the one condition that would have revealed the 500 was also the condition that
  silenced the test.
- **An assertion blind to the failure mode.** `mobile-layout.spec.ts` checked `scrollWidth`,
  which cannot see content hidden by `overflow-x: clip`. Added an explicit reachability
  assertion with a non-vacuity guard.
- **A flaky console-error filter.** The smoke test counted any console error whose source URL
  was not a wallet endpoint, so sandbox network noise (`net::ERR_NETWORK_CHANGED`, browser
  COOP probes) failed it intermittently. The filter is now a narrow, documented allowlist.
  Verified stable: 4 consecutive full-suite runs, 33 passed each time.

### Tests — totals after the above

- Frontend unit/integration: **143** (was 137) across 17 files.
- Frontend e2e: **33 passed, 1 skipped** (was 27 passed, 3 skipped) — the skipped test is the
  intentional mobile opt-out in the CWV budget spec. Four consecutive full runs, no flakes.
- Backend: 104 unchanged. Verification gates re-run against a production build.

### Fixed — privileged UI surface was unreachable through the same-origin proxy (2026-09-12)

- **Root cause:** the dashboard proxy (`frontend/src/app/api/[...path]/route.ts`) is
  default-deny after the S-1 fix, but its policy lived inline and the UI had no way to
  consult it. The scanner dashboard, the four GPU panels, the planner panel and the
  vendor attestation form all called privileged routes the proxy refuses, so those
  controls returned `403` in every deployment using the same-origin proxy. Component
  tests stubbed `fetch` and passed; proxy tests asserted the denials and passed; nothing
  compared the two lists.
- **Added:** `frontend/src/lib/api-route-policy.ts` — one exported source of truth
  classifying every endpoint as `public-read`, `public-compute` or `operator`, consumed
  by both the proxy (enforcement) and the UI (honest states).
- **Added:** operator access path. `operator` routes are authorized with the caller's own
  API key sent as `x-qtrust-api-key`, forwarded upstream as `x-api-key`. The proxy never
  attaches the server-side admin key to those routes, and anonymous callers still get
  `403 operator_key_required`. Local development with no server key configured mirrors
  the backend's existing dev-open policy; production does not.
- **Added:** `frontend/src/lib/operator-key.ts` (sessionStorage-scoped key store),
  `frontend/src/hooks/use-operator-key.ts`, and `frontend/src/components/operator-access.tsx`
  (proactive panel + in-context prompt). Wired into the scanner tabs, GPU panels,
  planner panel and attestation form.
- **Added:** `apiPostJson` / `apiGetJson` request helpers plus a typed
  `OperatorKeyRequiredError`, so callers react to an authorization denial instead of
  rendering an opaque error.
- **Changed:** `dashboard/page.tsx` sample-verification button now performs and displays
  the verification (it previously re-fetched and discarded the result, leaving the label
  permanently stuck on "Verify on-chain").
- **Tests:** +34 frontend tests (103 → 137). New `lib/__tests__/api-route-policy.test.ts`
  scans UI source for `/v1/...` literals and fails if any endpoint is unclassified, so the
  UI and the proxy cannot drift apart again; `lib/__tests__/operator-key.test.ts` covers
  the key store and typed error; `app/api/[...path]/route.test.ts` now asserts anonymous
  denial, caller-key forwarding, admin-key isolation and the production/dev distinction.
- **Verified live** against a production build with a stub upstream: anonymous privileged
  call → `403 operator_key_required` with zero upstream requests; keyed privileged call →
  upstream observed the caller's key; public route with a caller key present → upstream
  still observed the admin key; the caller's header never leaked under its own name.
- **Docs:** TM-FE-03 added to `docs/SECURITY_THREAT_MODEL.md` with the new trust boundary
  and its accepted residual risk (a browser-held key is XSS-equivalent, hence per-operator
  keys so one can be revoked independently).

### Fixed — e2e harness could test the wrong app, and its a11y gate was flaky (2026-09-12)

Both were found while validating the change above, and both had been invisible because the
suite reported green.

- **Wrong-target risk (HIGH for test trust).** `playwright.config.ts` ran on port 3000 with
  `reuseExistingServer: true`. On any machine where another app already served 3000,
  Playwright reused it and the suite silently tested *that* app: the smoke specs reported six
  false failures against an unrelated service, and specs asserting only generic properties
  (axe violations, horizontal overflow, an LCP budget) could equally have reported false
  **passes**. The dev server now runs on a dedicated port (`QTRUST_E2E_PORT`, default 3020)
  with an explicit `baseURL` kept on `localhost` (Next 16 blocks cross-origin dev resources,
  so a raw-IP baseURL silently breaks hydration), and `e2e/app-identity.ts` lets any spec
  prove it reached Q-Trust instead of inferring it from a port.
- **Flaky a11y gate (MEDIUM for test trust).** The home-page axe scan intermittently failed
  with up to 58 `color-contrast` nodes, including the hero's `bg-cyan-300 text-slate-950`
  Verify button sampled mid `hero-enter` animation at ~47% opacity (ratio 3.62 against 4.5;
  its settled frame is ~13:1). Axe folds opacity and filter into the colours it samples, so
  any scan landing mid-animation reports a frame no user sees. The spec now audits the
  reduced-motion rendering — which `globals.css` already collapses to its final state — and
  waits for all *finite* animations to settle (infinite decorative motion is ignored, so the
  gate cannot hang). Verified deterministic over five consecutive runs where it previously
  passed roughly half the time.
- **Added:** `/scanner` a11y coverage (desktop + mobile), including the new operator-access
  panel, which had none.
- **e2e result:** 19 passed, 3 skipped (was 16 passed, with the counts above being
  environmental).

### Fixed — real WCAG 2 AA contrast failures the flaky gate had been masking (2026-09-12)

Once the a11y gate above became deterministic it failed immediately, on genuine violations
that the intermittent scans had been skipping: the offending sections reveal below the fold,
so a scan that never settled them excluded them from the audit. Measured against WCAG 2 AA
(4.5:1 for normal text):

| Element | Colours | Ratio | Fix |
|---|---|---|---|
| `#product` `<h2>` "One system for the whole migration." | `#ffffff` on `#f4f5f2` | **1.09** | The section sat inside a wrapper that set `text-white` and never reset it, so its heading inherited white on a near-white background and was **effectively invisible**. The section now sets `text-slate-950` |
| `#why` card index + "Outcome / visible by design" | `slate-400` on `#f4f5f2` | 2.40 | `text-slate-600` |
| `#workflow` step labels (Scan / Plan / Attest) | `slate-600` on `#020618` | 2.65 | `text-slate-400` |
| Product preview "Preview" badge | `slate-500` on `slate-200` | 3.86 | `text-slate-700` |
| Product preview inactive tabs | `slate-500` on `slate-200/70` | 4.08 | `text-slate-700` |
| Product preview dark-panel meta text | `slate-500` on `#0c1424` | 3.86 | `text-slate-400` |
| Scanner/dashboard/vendor secondary notes (post-scan states the gate cannot reach) | `slate-400` on white | 2.64 | `text-slate-500` |

**Verified:** `/` and `/scanner` pass axe (`wcag2a` + `wcag2aa` + `best-practice`) with zero
critical or serious violations across four consecutive runs, where the gate had previously
been roughly 50% flaky and, once made deterministic, failing.

### Security — checkpoint SHA-256 pinning at startup (TM-PL-02) (2026-09-08)

- **Added:** `planner/qtrust_planner/checkpoint_manifest.py` — parses the
  `models.sha256` manifest and verifies a checkpoint's SHA-256 before it is
  deserialized. Contracts: listed basename must match its pinned hash or
  verification raises (callers fail closed); an unlisted operator-selected
  artifact is reported and allowed with a warning; a missing manifest is
  reported (and refused under `QTRUST_ENFORCE_MODEL_MANIFEST=1`).
- **Server:** `planner/server.py` verifies the resolved GNN checkpoint and the
  RL agent at startup, BEFORE `torch.load` — a mismatch aborts boot instead of
  degrading into heuristic mode; `/health` now reports the checkpoint's
  integrity status. `planner/qtrust_planner/predict.py` verifies in
  `_load_trained_model` (the documented control anchor).
- **Image/deploy:** `planner/models.sha256` (planner-relative copy of the
  canonical root manifest) is baked into the planner image
  (`planner/Dockerfile`), and compose sets `QTRUST_ENFORCE_MODEL_MANIFEST=1`
  so a tampered checkpoint fails closed at startup.
- **Tests:** 8 new tests in `planner/tests/test_checkpoint_manifest.py`
  (verified/unlisted/no-manifest resolution, tamper → fail-closed on the real
  server startup path, and a planner↔root manifest drift guard).

### Improved — Core Web Vitals budget in the e2e job (TD-06) (2026-09-08)

- **Added:** `frontend/e2e/cwv-budget.spec.ts` — Playwright-driven regression
  gate measuring Largest Contentful Paint (≤ 2.5 s) and Cumulative Layout
  Shift (≤ 0.1) on the home page with PerformanceObserver, in the existing
  e2e job (desktop project; warm-up navigation first so the measured paint is
  runtime, not dev-server first-compile). Budgets overridable via
  `QTRUST_CWV_LCP_BUDGET_MS` / `QTRUST_CWV_CLS_BUDGET`.

### Security — threat model, audit dossier, and SSRF hardening (2026-09-06)

Applied skills curated from VoltAgent/awesome-agent-skills:
`openai/security-threat-model`, `openai/security-best-practices`,
`trailofbits/constant-time-analysis`, `trailofbits/audit-context-building`.

- **Fixed (SSRF, TM-FE-01):** `fetchIpfsJson` fetched the on-chain
  attacker-influenceable `metadata_uri` server-side with only a prefix strip;
  it now validates a strict CIDv0/CIDv1 grammar before any fetch and refuses
  redirects. 8 regression tests added.
- **Fixed (FASTAPI-OPENAPI-001):** planner `/docs`, `/redoc`, `/openapi.json`
  are now disabled in production (available in dev); regression tests added.
- **Added:** `docs/SECURITY_THREAT_MODEL.md` — repo-grounded threat model with
  evidence anchors, 10 classified threats, abuse paths, and focus paths.
- **Added:** `docs/audit/DOSSIER.md` — external-audit prep (R-01): system
  rules, unenforced assumptions, and micro-analyses of the four
  highest-value functions.
- **Constant-time analysis:** no findings — all secret comparisons use vetted
  primitives (`hmac.compare_digest`, hash+`timingSafeEqual`); SDK hashing is
  public-data content addressing.
- **Frontend security checklist verified clean:** strict CSP with
  dev-only `unsafe-eval`/`unsafe-inline`, helmet on backend (HSTS), no
  `dangerouslySetInnerHTML`, no client-exposed secrets.

### Improved — Design-craft pass with impeccable / taste-skill / animation skills (2026-09-06)

Applied three external design-skill collections (pbakaus/impeccable,
Leonxlnx/taste-skill, emilkowalski/skills) as audits against the frontend,
fixing only what survived their gates.

- **Essential feedback under reduced motion:** the global
  `prefers-reduced-motion` kill-switch (0.01ms) also froze loading spinners and
  pending indicators, making a working app look hung. They now run slowed
  (1.5s) instead of frozen; decorative motion stays fully disabled.
- **Button press feedback:** the `Button` primitive had no `:active` state.
  Added `active:scale-[0.98]` at 150ms ease-out with an explicit
  `transition-[...]` property list (no `transition: all`).
- **Transaction status bridge:** `TxStatus` state swaps teleported. State
  changes now crossfade via a 200ms `tx-bridge` animation (repo's own
  `cubic-bezier(0.16, 1, 0.3, 1)` family), remount-keyed on state; reduced
  motion gets the instant swap.
- **Copy hygiene:** removed em-dashes from user-visible strings (page titles,
  meta descriptions, scanner copy) and a version-suffix tell from the hero
  eyebrow ("Q-Trust protocol / 02.0" → "Q-Trust protocol"), per the
  taste-skill pre-flight gates.
- **Deliberately NOT added** (restraint documented by the animation-opportunity
  gate): motion on dashboard data panels, risk gauge, or provenance graph
  (functional data; decoration hinders), toast enter animation (component has
  no render site), nav/hover choreography (frequency tier too high).
- Verified: 95 vitest, 16 Playwright (desktop + mobile + a11y), tsc, lint.

### Added — Deep verification pass (2026-09-06)

Autonomous multi-agent verification cycle: ML validity audit, Docker build/run
validation, and static analysis of the smart contracts.

- **Contracts (hardening):** extracted `IPausable` into
  `src/interfaces/IPausable.sol`; all 10 governable registries now inherit it,
  so the governance↔registry pause contract is checked by the compiler instead
  of by convention (resolves Slither `missing-inheritance` for all project
  sources; remaining Slither findings are in vendored OpenZeppelin or are
  intentional zero-value sentinel patterns). New invariant test
  `PausabilityInvariant.t.sol` pins every governable contract to the interface.
- **Backend (log hygiene):** all five `dotenv.config()` calls now use
  `{ quiet: true }`, removing dotenv v17's promotional "tip" banners from
  production container logs.
- **Docs (evidence):** `docs/TRUTH_AUDIT.md` discovery row corrected to the
  empirically verified split (38 repos → 30 train / 8 eval, seed 42;
  11,558 / 2,415 files — reproduced by re-running `_code_splits`), and the
  unverifiable "4-epoch" qualifier replaced with the script default
  (`--hf-epochs 2`). New recorded leakage audit: repo-level split integrity
  confirmed, zero repo overlap; cross-repo exact duplicates affect 58/13,973
  files (0.4%), full-record train/eval overlap 11 files (0.46% of eval) —
  organic, bounded well below the claimed 0.11 F1 gain.
- **Validation performed (no code change):** planner Docker image built and
  probed live (health, `/plan`, 422 validation, auth); backend Docker image
  built and run through its fail-closed startup gates (CORS, relayer key,
  scan roots) to a healthy `/health`; no critical/high Slither findings in
  project sources; vendor dataset duplicate scan (16 records, 0 dupes).

### Added — Hallmark UX audit pass (2026-09-06)

A design-system audit of the marketing pages against the anti-AI-slop
responsive/a11y gates (no fabricated metrics, no clipped display type, no
horizontal overflow at 320–768 px).

- **Findings**: the existing surface was already disciplined — AA-checked
  token palette, skip link, reduced-motion support, honest preview mockups
  (clearly labelled, internally consistent numbers), roman display type, and
  genuinely ordinal step numbering. Two real gaps found:
- **New mobile layout-safety regression tests** (`frontend/e2e/mobile-layout.spec.ts`):
  real-browser assertions at 320 px and 375 px that the page never scrolls
  horizontally and no element extends past the viewport (elements inside
  deliberately clipped containers such as the marquee track are excluded).
  The detector was red-team validated: it correctly ignores clipped regions
  and was shown *not* to flag the hero (a width probe of the live h1 at
  320 px measured max text rect 238 px — it fits, disproving the
  estimate-based violation).
- **Hero safety net**: `overflow-wrap: anywhere` on the hero `<h1>` so long
  words can never clip on platforms with wider fallback font metrics (the
  hero clamp itself was measured correct and is unchanged).
- **CI now runs the mobile Playwright project** in addition to desktop,
  making the 320/375 px gates blocking.

### Fixed — GPU pipeline validation + scanner detection gap (2026-09-06)

Fourth pass: GPU training smoke tests (GNN: val τ 0.922→0.927 on seeded quick
run; RL PPO: 6-episode vectorized run; both checkpoints load and eval on
CUDA), planner latency benchmarking (p50 28–123 ms / p95 43–337 ms for
50–2000-asset CBOMs, no regression from the new validation gate), and an
end-to-end inspector CLI exercise that surfaced two real detection defects:

- **`import rsa; rsa.newkeys(2048)` was invisible to both scanner layers.**
  The regex layer had no `rsa`-package pattern and the AST layer did not
  treat `rsa` as a crypto root module (same for PyCryptodome `Crypto`), so a
  common Python crypto usage scanned as clean. Both layers now detect it;
  the AST layer resolves the exact key size (`rsa.newkeys(2048)` → RSA-2048).
- **Same call site counted twice.** The regex layer reports the family
  ("RSA") while the AST layer reports the resolved variant ("RSA-2048"); the
  B-11 dedupe kept both because the algorithm strings differ. The merge now
  supersedes a regex family-level finding when a same-family AST finding in
  the same file resolves one of its lines (the stronger claim wins), while
  regex findings remain the sole signal for languages/files the AST layer
  cannot resolve, and distinct algorithms are never collapsed.

### Fixed — deep adversarial pass + docs-contract lock (2026-09-06)

Third verification pass: live probing of the backend API (36 malformed-input,
auth, SSRF, prototype-pollution, path-traversal and oversize-payload probes),
the Python risk heuristics with garbage inputs, and a full on-chain SDK E2E
(anvil → deploy → register/attest/migrate/audit → integrity guards). The
backend surfaced **zero** exploitable defects — every probe returned a clean
400/401/413/422 with a precise message.

- **README SDK quick-start documented a fictional API.** `QTrustClient(base_url=...)`,
  `client.verify(asset_id=...)` and `engine.score("cbom.json")` do not exist
  anywhere in the SDK; the only remaining copy was the top-level README
  (`docs-v2` and `sdk/README.md` were already correct). Replaced with verified
  examples (`verify_asset`, `RiskScoringEngine.calculate`, real constructor
  kwargs) that were executed against the SDK before landing.
- **New: SDK docs-contract test** (`sdk/tests/test_readme_contract.py`) parses
  the README's Python code blocks and asserts every documented constructor
  kwarg, method call, and model field exists on the real SDK objects — docs
  can no longer silently drift from the code.
- **Frontend: `overflow-x: hidden` → `clip`** on html/body (prevents horizontal
  scroll without turning the body into a scroll container, which would break
  `position: sticky` children).

### Fixed — adversarial API surface pass (2026-09-06)

A second verification sweep probed the live HTTP/CLI surfaces with malformed
inputs. Three defects found and fixed, each with a regression test.

- **Planner `/plan` and `/rl/plan` no longer 500 on malformed CBOM assets.**
  A non-numeric `key_size` (or a non-object asset entry) detonated mid-request
  (`int("abc")` in the fallback path; a latent `NameError` on the graph when
  the GNN path raised after a partial parse). Both endpoints now share one
  validation gate and return a precise 422; integer-string `key_size` values
  are still accepted and normalized.
- **Planner CBOM size cap (DoS guard).** `/plan` accepted an arbitrarily
  large CBOM (a 20k-asset / 2.5 MB request produced a 4.6 MB response with
  no limit). Requests above `QTRUST_MAX_CBOM_ASSETS` (default 5000) are now
  rejected with 422 before feature construction or GNN inference.
- **`crypto-inspector scan` fails loudly on a mistyped path.** A directory-
  shaped target that does not exist (or a bare file passed as target) fell
  through to the network scanner and produced a misleading "0 findings"
  clean report with exit 0 — dangerous for a security tool wired into CI.
  Both cases now exit 2 with an explanatory message; real directories and
  CIDR ranges are unaffected.
- **README citation fix.** The code-discovery headline metrics (P 0.952 /
  R 0.953 / F1 0.952 on 2,415 held-out files) are sourced to
  `benchmark_comparison.json`, which actually contains them, instead of the
  run log whose `evaluate` field is null; the unverifiable "4-epoch"
  qualifier was dropped (the epoch count is not recorded in any artifact).

### Fixed — verification sweep (2026-09-06)

Every CI gate was re-run locally on this checkout; the failures below were
found and fixed during that sweep, each with a regression test.

- **Planner checkpoint override is authoritative.** An operator-set
  `QTRUST_MODEL_PATH` now wins over the convenience defaults (real-data v3,
  GPU v3, DDP, RL), making rollback/canary selection deterministic instead of
  silently serving another artifact; a nonexistent explicit path fails loudly.
  The Compose stack and planner image default to the tracked real-data
  checkpoint (`model_real_v3.pt`).
- **Backend list endpoints validate pagination.** `parsePagination` rejects
  malformed, fractional, negative, or unsafe-integer `offset`/`limit` values
  with a 400 instead of `Number()` coercion producing NaN/Infinity or
  silently changing paging semantics (orgs assets/migrations, vendor
  attestations).
- **Scanner memory + evidence-chain verification.** The in-memory scan
  history is bounded (10,000 entries; the JSONL evidence ledger remains the
  durable record), and `verifyEvidenceChain`/ledger verification now handle
  evicted chain prefixes correctly, look up entries by `chainIndex` (not
  array position), and report the true `chainIndex` in `failedIndex`.
- **`/health` is liveness again.** Missing relayer signing credentials no
  longer turn startup probes into 500s; the relayer is reported as `null`
  and transaction routes still fail closed on first use.
- **Frontend proxy allowlist matches path segments.** `/v1/stats-private` no
  longer inherits `/v1/stats` access, and the webhook subscriber listing was
  removed from the public allowlist.
- **Contract tamper tests are deterministic.** The Audit/VendorRegistry
  tampered-signature tests zeroed the signature's `r` word instead of a
  single-bit flip: a flipped `r` still lands on the curve with overwhelming
  probability and recovers to a random address, which made the expected
  revert a per-digest lottery (the AuditRegistry case failed in practice).
  No production contract changes — authorization checks after recovery were
  always enforced.

### Fixed — due-diligence remediation pass (2026-09-03)

All findings below come from the September 2026 due-diligence report; each fix
ships with a regression test, and every IANA value was re-verified against the
registry CSV exports the same day.

- **B-6 — `negotiated_group` no longer mislabels a cipher as a TLS group.**
  `tls_probe.probe_tls_endpoint` now reports `SSLSocket.group()` where the
  interpreter exposes it (Python 3.14+/OpenSSL 3.2+), and otherwise emits an
  explicit `"not captured"` marker instead of `shared_ciphers()[0]` — the
  exact signal a PQC migration tool exists to report is no longer fabricated.
- **B-7 — single IANA-verified TLS registry.** The two conflicting hand-copied
  group/sigalg tables (`tls_probe.py` vs `pcap_scanner.py`) are replaced by
  `qtrust_inspector/tls_registry.py`, checked against the IANA
  `tls-parameters-8.csv` and `tls-signaturescheme.csv` exports: x25519 is
  0x001D (not 0x0012), secp256r1 is 0x0017, pure ML-KEM groups are
  0x0200-0x0202 (not 0x6399-0x639B, which are the obsolete
  X25519Kyber768Draft00/SecP256r1Kyber768Draft00 hybrids), ML-DSA signature
  schemes (0x0904-0x0906) are no longer listed as key-exchange groups, and
  SLH-DSA schemes are included. Both consumers import the shared table; a
  parity test asserts the two modules can never disagree again.
- **B-8 — evidence ledger format v2: metadata is now inside the hash chain.**
  The entry hash covers the full canonical entry (metadata incl. risk_summary
  was previously editable without breaking `verify_chain()`). v1 ledgers load
  and verify under the legacy construction and are transparently re-hashed to
  v2 on the next save; append-after-upgrade stays chained.
- **B-9/B-10 — honest calibration.** `qrisk.QRiskEnsemble.fit` calibrates on
  a seeded random holdout instead of the ordered tail of the training set
  (the old ECE was optimistically biased), and `_ece` closes the last bin so
  p=1.0 samples are counted. Reported ECE is now a conservative estimate.
- **B-11 — cross-layer dedupe actually dedupes.** `merge_findings_dedupe`
  normalizes the line component (explicit `line`, else first of regex-layer
  `lines`) so the same call site found by both the AST and regex layers
  merges into one finding instead of duplicating.
- **B-13 — timing-trace collection drops failed runs.**
  `side_channel.collect_timing_traces` no longer appends 0 ns on errors
  (which skewed z-normalization feeding the leakage detector); failures are
  logged via `logging`, and an all-failed run raises instead of returning a
  zero vector. Training-loop prints converted to structured logging.
- **B-14 — gem archive scanning guards non-regular tar members.**
  `extractfile()` returning None (directories/links) is handled instead of
  raising AttributeError outside the caught exception types.
- **B-15 — capture classification is parse-then-classify.** A file whose head
  starts with `{` is classified as Suricata EVE only when the first line
  parses as a JSON object carrying EVE fields; everything else is `unknown`.
- **Dead CLI surface removed — `auto-remediate --patch/--dry-run/--backup`.**
  Accepted, documented, never referenced (users could believe patches were
  applied when nothing was written). The command still only SUGGESTS
  replacements; automated source rewriting remains out of scope by design.
- **S-1 — frontend proxy is default-deny.** `/api/[...path]` no longer
  forwards the admin API key to every `/v1/*` path. A route policy allowlist
  proxies public GET reads and stateless compute POSTs only; relay, write,
  scan, evidence-create, webhook and GPU routes are rejected at the proxy
  with 403 before any backend call. 40-test auth-matrix regression added.
- **S-5 — HF hub downloads pinned.** `qtrust_ai` base-model downloads pass
  `revision=` (CodeBERTa-small-v1 pinned to its current main commit); bandit
  B615 cleared.
- **S-7 — static webhook deliveries are signed when configured.** Receivers
  on the `QTRUST_WEBHOOKS` list get the same `x-webhook-signature` HMAC as
  per-subscriber endpoints when `QTRUST_STATIC_WEBHOOK_SECRET` (≥16 chars) is
  set; without it a one-time warning makes the gap visible in ops logs.
- **S-8 — CI supply-chain pins.** actionlint downloads a pinned release
  tarball verified against the official checksum (no more `curl | bash` from
  `main`), and release-drafter is pinned by commit SHA with a comment mapping
  SHA → tag.
- **OPS-1 — relayer financial guardrails.** New `backend/src/services/relayer-guard.ts`:
  a minimum-balance circuit breaker, a daily gas-spend cap over a rolling 24 h
  window fed by real receipt costs, and an EIP-1559 base-fee ceiling. Every
  broadcast path in `attestation.ts` funnels through the guard; thresholds
  via `QTRUST_RELAYER_MIN_BALANCE_ETH` / `QTRUST_RELAYER_DAILY_SPEND_CAP_ETH`
  / `QTRUST_RELAYER_MAX_BASE_FEE_GWEI` (unset = disabled, so anvil dev is
  unaffected). A drained relayer now fails loudly, not silently.
- **S-9 — backend `did:web` SSRF and key-binding hardening.** VC issuer
  resolution now resolves DNS once, rejects private/reserved addresses, dials
  the validated IP directly, preserves hostname-based TLS verification, follows
  no redirects, and caps DID documents at 1 MiB. DID documents must match the
  issuer DID and the proof's exact verification method/controller; a proof that
  is not bound to the issuer fails under `invalid_signature`, not
  `did_resolution_failed`. Additionally, the issuer key is resolved once per
  process (stable identity across credentials), and production refuses to
  start VC issuance without a 32-byte hex `QTRUST_VC_ISSUER_KEY`. Regression
  coverage includes DNS-resolved private hosts and malformed authority inputs.
- **D-1 — README PyPI claims corrected.** `qtrust-sdk` / `qtrust-inspector`
  were re-verified as HTTP 404 on the PyPI API (2026-09-03); the fake PyPI
  badges are replaced with an honest "pending publication" badge, and the
  install instructions lead with `pip install -e ./sdk` from source until the
  packages actually publish via `publish-pypi.yml`.
- **D-2 — side-channel real model shipped and disclosed.**
  `inspector/side_channel_model_real.pt` is now tracked (removed from
  `.gitignore`, added to `models.sha256`, verified), and the README row
  discloses that training used real liboqs clean traces with synthetically
  injected leak classes — no claim of real leaking-hardware traces.
- **D-3 — DVC pipeline no longer decorative.** 7 of 8 declared stages invoked
  `python -m` entry points that do not exist. `dvc.yaml` now declares only
  the stage that actually runs (`evaluate`, which itself refuses to fabricate
  metrics when splits are missing), with an explicit policy comment: add a
  stage only when its entry point runs end-to-end.
- **.env.example factual repairs.** Removed the "fallback to deployer key"
  implication (the backend refuses a deployer-key fallback by design) and
  documented the new relayer guardrail variables in both env templates.

### Added
- `inspector/qtrust_inspector/tls_registry.py` — single IANA-verified group +
  signature-scheme registry (B-7).
- `backend/src/services/relayer-guard.ts` + 12 unit tests — relayer financial
  guardrails (OPS-1).
- `inspector/tests/test_audit_remediation.py` — 18 regression tests covering
  B-6/B-7/B-8/B-9/B-10/B-11/B-13/B-14/B-15 and the dead-flag removal.
- `frontend/src/app/api/[...path]/route.test.ts` — 40-test proxy auth-matrix
  regression for the S-1 default-deny allowlist.

### Changed
- **Synthetic benchmark pool corrected → full honest retrain of the v2/v3
- **Synthetic benchmark pool corrected → full honest retrain of the v2/v3
  checkpoints.** The synthetic ML-DSA parameter sets were renamed from the
  draft names (441/659/877) to the final FIPS 204 names (44/65/87) and the
  algorithm encoder was hardened, so every pre-existing checkpoint evaluated
  against current code drifted (v3 0.9746 → 0.9195, v2 0.9607 → 0.9199 on
  the seed=999 held-out suite). Both checkpoints were retrained from scratch
  on the corrected pool on A100s (deterministic, listmle; v3 at 100K graphs /
  200 epochs / LayerNorm / seed 42, best val τ 0.9729; v2 at 1.2K graphs /
  80 epochs). Fresh canonical `planner/results/benchmark_v3.json` (seed=999,
  1000 graphs): **v3 τ 0.9753** (top-5 0.673) and **v2 τ 0.9703** (top-5
  0.713) — the CI promotion gate (v3 must beat canonical v2) now passes
  honestly, and `planner/results/benchmark.json` (3 seeds) re-measures
  gnn-listmle at **τ 0.9637 ± 0.0002**. `models.sha256` refreshed for the
  new binaries; README / WHITEPAPER / showcase / docs numbers updated to the
  fresh measurements. The 400K-graph DDP checkpoint was not retrained and is
  documented as a research artifact (τ 0.864, batch-norm).
- **40-fold host-disjoint LOO re-run on the deterministic-kernel harness**
  (seeded per-run DataLoader shuffle, cudnn deterministic, no torch.compile):
  `planner/results/real_cbom_loo_40.json` now records the reproducible
  out-of-sample **τ-b 0.7263** vs the doctrine heuristic **0.7450**
  (Δ −0.0188), reproducing the doctrine on **38/40** held-out real CBOMs
  (0 wins / 38 ties / 2 losses, both n≤13), +0.503 vs random — folds sharded
  across 4 A100s and merged with `--merge-shards` (a fresh 3-fold run is
  bit-identical to the merged shards). The pre-fix τ-b 0.7377 (39/40) is
  superseded; README/TRUTH_AUDIT/DEVELOPER_ROADMAP/AUDIT_REMEDIATION updated.
- **RL real-CBOM benchmark rebuilt on honest reward semantics.** Audit found
  every real TLS asset carried the CBOM builder's blanket `criticality:
  medium`, which left the migration reward with no order-dependent term — so
  all completing policies scored identically and the archived “RL beats the
  heuristic on real estates” headline (agent 130.20 vs heuristic 112.40) was
  **not reproducible** by any script in the repo. Assets are now re-labelled
  with `risk_criticality_from_scan` (`scripts/train_real_models.py`) — a
  deterministic function of the real certificate attributes (RSA-1024 →
  critical, RSA-2048 → high, expired/self-signed/near-expiry raise the
  class) — and the agent was retrained on those estates. Honest result
  (`planner/results/rl_benchmark_real_cbom.json`): **agent 140.34 ± 8.13 vs
  heuristic 140.62 (Δ −0.28, tie) vs random 136.84 (+2.6%), 100% completion**
  (2/40 wins · 27 ties · 11 losses) — the agent *learns* real risk-priority
  and matches the doctrine, mirroring the GNN planner finding. Also fixed a
  second reproducibility bug: `pack_graph_cboms` built its host list from a
  `set` of scanner hostnames, and Python set iteration order is
  hash-randomized per process (PYTHONHASHSEED), so the same `seed=99`
  produced a *different* packing every run — RL retrain and benchmark now
  share one deterministic packing (hosts sorted before seeded shuffle); two
  independent eval processes return identical numbers.
- Real-data training refreshed 2026-09-02 on A100s (deterministic): all 15
  `qtrust_ai` models train on the real corpora (15/15 trained, anchors 15/15,
  wall 328s); CodeBERTa held-out F1 **0.9525** reproduces bit-for-bit
  (P 0.952 / R 0.953); 6/7 models beat their best naive baseline (mean
  relative gain 1.55×). Anomaly detector re-verified: **162/162 (100%)**
  detection, FPR **2/54 (3.7%)** on real CBOMs.

### Fixed
- `scripts/train_factory.py --phase all` crashed in `phase_risk` on real CBOM
  assets with `"algorithm": null`; `qtrust/models/risk/model.py::featurize`
  now coalesces None/empty algorithms and the factory defaults to RSA-2048.
  The full factory pipeline (discovery → risk → graph) now completes.
- `planner/qtrust_planner/train_gpu.py` + `rl_agent.py`: deterministic
  kernels (seeded shuffle generator, cudnn deterministic/benchmark off,
  skip torch.compile when deterministic) — same seed now yields bit-identical
  weights (verified 0 param diff in `test_train_gpu_deterministic_same_seed_same_weights`).

## [2.2.0] - 2026-08-30

### Added
- Q-Trust ML Factory (qtrust/ + qtrust_bench/ + dvc.yaml, 64-section strategy)
- Truth audit (docs/TRUTH_AUDIT.md) classifying every number REAL/SYNTHETIC/DEMO
- Calibrated What-If engine with intervals and provenance (qtrust/models/what_if.py)
- LayerNorm GNN retrain (planner/model_real_v3_rigorous.pt, tau 0.971/0.80)

### Fixed
- REG-01..08 P0 integrity: CI triggers, model checksums, deep-probe fabrication, torch.load, ML-DSA names, API key, pqc-scan gates

## [2.1.1] - 2026-08-29

### Fixed
- Real TLS CBOM host-disjoint 37 CBOMs, X.509 encoder fix (sha256WithRSAEncryption → RSA), tie-aware tau-b

## [2.1.0] - 2026-08-28

### Added
- Real-data training campaign: 13,058 code files, 277 TLS hosts, 401 NVD CVEs, 37 CBOMs

## [2.0.0] - 2026-08-27

### Added
- 11 UUPS registries, EIP-712 gasless, 7-day timelock governance
- Initial CBOM/SARIF scanner (10 modules), 7 compliance frameworks

## [Unreleased]

### Credential verification is now real cryptography (2026-08-29)

Principal-level audit P0: `/v1/credentials/verify` previously returned
`signature_verification_unavailable_in_backend` (structural checks only) and
`/v1/credentials/issue` produced an UNSIGNED stub.

- **`backend/src/services/vc.ts`** implements full W3C VC v2.0 issuance and
  FAIL-CLOSED cryptographic verification in TypeScript (`@noble/curves` +
  `@scure/base`): Ed25519Signature2020 signing, canonical payload
  byte-compatible with the Python SDK (`sort_keys` + compact separators +
  ensure_ascii — verified byte-identical), did:key (offline) and did:web
  (HTTPS with DNS-pinned SSRF protection) resolution.
- **`/v1/credentials/issue`** now signs a real credential under the backend's
  did:key issuer (`QTRUST_VC_ISSUER_KEY`).
- **`/v1/credentials/verify`** now verifies structure + expiry + signature
  against the issuer DID and returns a structured per-check result.
- Cross-language verified both ways: backend-issued VC verifies in the Python
  SDK (`qtrust.vc.VCVerifier`) and SDK-issued VC verifies in the backend.
- Test coverage: `backend/tests/vc.test.ts` (16 tests — round-trip, tamper,
  forged-key, unsigned, expired, missing fields, pinned did:web transport,
  DNS-resolved SSRF, and malformed-authority guards). The forged-key case
  surfaces as `invalid_signature` under the verificationMethod binding check.

### Security — external codebase audit remediation (2026-08-26)

Remediates the 2026-08-26 Z.ai engineering audit (`docs/Q-Trust_Codebase_Audit.pdf`).
All Critical and High findings are fixed with regression tests; all Medium,
Low, and Informational code findings are fixed unless explicitly noted below.

**Critical**

- **C-1 — deployer retained unilateral governance control.** `Deploy.s.sol` now
  transfers `QTrustGovernance.DEFAULT_ADMIN_ROLE` to the timelock, then the
  deployer renounces timelock admin/proposer/executor/canceller roles and
  governance admin. Regression test
  (`contracts/test/AuditRemediations.t.sol::test_C1_*`) runs the actual deploy
  script and asserts zero residual deployer roles.
- **C-2 — `schedule()` allowed UUPS upgrade bypass.** `_isRoleMutationCall`
  now also rejects `upgradeTo` (0x3659cfe6) and `upgradeToAndCall` (0x4f1ef286)
  selectors, closing implementation-swap-after-delay.

**High**

- **H-1 — `attestProductSigned` skipped the VENDOR_ROLE check** (the only
  signed path in the codebase without a post-recovery role check). Added;
  regression test revokes the role from a still-active vendor and expects
  `NotVendor`.
- **H-2 — missing `whenNotPaused`** on `TrustAnchorRegistry.revokeAccreditation`,
  `reaccreditIssuer`, `SchemaRegistry.addEquivalence`, `deactivateSchema`.
- **H-3 — `/v1/relay/*` gas-griefing.** All four relay POST routes now require
  an API key, and the relayer pre-checks the signer's on-chain role before
  broadcasting (failed txs no longer cost relayer gas). Operators must issue
  API keys to relaying clients (see `.env.example`); dev mode without keys is
  unchanged.
- **H-4 — Sentry could capture secrets.** `beforeSend` scrubs `x-api-key`/
  `authorization`/cookie headers, redacts request bodies, masks any
  64-hex private-key-shaped string anywhere in the event; `sendDefaultPii: false`.
- **H-5 — webhook secrets stored plaintext when `QTRUST_WEBHOOK_ENC_KEY`
  unset.** Production now refuses to store unencrypted subscriber secrets
  (fail-closed); dev fallback retained.
- **H-6 — RPC-pool Proxy broke `watchEvent` unsubscription.** The indexer now
  awaits the pooled `watchEvent` Promise so real unwatch functions are stored;
  new test asserts `stopIndexer` unsubscribes all seven streams.
- **H-7 — `/v/[id]` interpolated server-controlled `asset_id` into copy-paste
  shell commands.** `parseAssetId` enforces strict `^0x[0-9a-fA-F]{64}$`; the
  CLI block renders only for valid IDs, otherwise a warning explains how to
  verify manually.
- **Planner HIGH-1 — inference endpoints unauthenticated.** New
  `ApiKeyMiddleware` enforces `X-Auth… X-Api-Key` (`QTRUST_PLANNER_API_KEY`);
  fail-closed 503 in production when unset. Backend proxies forward the key.
  First-ever planner HTTP tests added (`planner/tests/test_server.py`).

**Medium**

- M-1: count-only + paginated views across Asset/Vendor/Migration/Audit/
  Compliance/Revocation/TrustAnchor registries; `AuditRegistry._postAudit`
  reads a count instead of copying the full per-org array.
- M-2: `MigrationRegistry._recordMigration` uses the `orgDid` already returned
  by `verifyAsset` (one cross-contract call instead of two).
- M-3: operational role grants restricted to the timelock only (proposer-to-
  proposer lateral grants removed).
- M-4: `ComplianceAttestation.getOrgComplianceStatus` is O(1) via a latest-
  attestation pointer; revocation clears it.
- M-5: `PolicyCommitment.commitPolicy` enforces version == 1 for new policies
  and latest+1 afterwards (a v=type(uint256).max brick is impossible).
- M-6/M-7: `/v1/evidence/create` API-key gated with a 5/min route limit and a
  bounded in-memory chain; `/v1/stats` gated and scan targets stored as keyed
  hashes (no absolute paths).
- M-8 (reorg): after a reorg purge the indexer re-runs backfill so re-executed
  events are indexed immediately, not on next restart.
- M-8 (docker): runtime image installs production-only node_modules (dev deps
  no longer shipped); inspector installed into a venv (PEP 668 respected).
- M-9: webhook payloads carry `timestamp` + `expires_at` (5-minute TTL) so
  recipients can reject replays.
- M-10: single shared `requireApiKey` (per-call env read, cached 30s, uniform
  401 semantics); the divergent server.ts copy was deleted.

**Low / Informational**

- L-1: `MigrationVerified` and `IssuerDeactivated` events emitted; deactivateIssuer
  also validates registration and pauses.
- L-2: `EvidenceRegistry` batch IDs use OZ `Strings.toHexString` (batch ID
  format gains `0x` prefixes — off-chain parsers of `batchId` must adjust).
- L-3: address-addressed `scheduleGrantRoleOn/schedulePauseOn/scheduleUnpauseOn`
  wrappers reach all ten registries, not just the core four.
- L-4: redundant contract-level `_initialized` guards removed from all ten
  registries (OZ Initializable suffices). **Storage layout shifted — redeploy
  via Deploy.s.sol rather than upgrading existing staging proxies.**
- L-6: schema equivalences require both endpoints to exist.
- L-7: reaccreditation clears stale `revocationReason`.
- L-8: default RPC endpoint is `https://sepolia.base.org`; production refuses
  plaintext `http://` RPC at boot.
- L-9: Dockerfile creates/chowns `/var/lib/qtrust` so the evidence chain
  persists for the non-root user.
- I-1/I-2/I-4: misleading `NotRegistrar` error split out as
  `NotOwnerOrAdmin`; dead `verifySignature` and unused auth helpers deleted.
- SDK M-3/M-4: loopback-RPC guard parses hostnames properly (userinfo-substring
  bypass blocked); malformed VC `proofValue` returns `invalid_signature`
  instead of raising.
- Inspector pcap DoS bounds documented; MAX_CONNS tightening tracked upstream.

### Added

- `contracts/test/AuditRemediations.t.sol` — C-1/C-2/H-1/H-2/L-6/M-4/M-5
  regressions (contract suite now 211 tests).
- `backend/tests/indexer.test.ts` — H-6 unsubscription regression.
- `backend/tests/secret-box.test.ts` additions — H-5 production fail-closed.
- `frontend/src/components/__tests__/attestation-form.test.tsx` — first tests
  for the signing component: domain pinning, nonce fetch → sign → relay
  round-trip, chain-switch behavior, error surfacing.
- `planner/tests/test_server.py` — first tests for the FastAPI surface:
  health shape, plan happy path/validation, API-key auth matrix, prod fail-closed.
- `models.sha256` + `scripts/verify_models.sh` + CI `model-integrity` job —
  committed `.pt` checkpoints are now tamper-evident.
- CI `abi-drift` job — regenerates `abis.ts`/`contracts.py` from Forge
  artifacts and fails on drift (previously claimed but not implemented).
- CI `golive-preflight` job (release tags only) — fails releases that still
  carry unresolved escalation-contact placeholders. The historical markers
  and the placeholder security email have since been replaced with real
  contacts.
- Pre-commit hooks pinned to commit SHAs (supply-chain parity with CI).

### Changed

- Docs: WHITEPAPER §6.5 benchmark numbers refreshed to the corrected Kendall
  protocol (τ=0.89 → τ=0.961 canonical); PHASE_6/PHASE_7 marked SUPERSEDED;
  QTrust_Implementation_Guide.md marked HISTORICAL and excluded from mkdocs.
- ABIs regenerated from Forge artifacts (new views/events above).

### Known remaining blockers (external — cannot be closed from code)

- Base Sepolia faucet funding, frontend/backend hosting accounts
  (Implementation Gaps #2–#4).
- Real incident-response contacts and security mailbox (CI gate enforces
  replacement before any release).
- `docs/PATENT/` remains tracked pending a legal decision.


### Fixed

- **Benchmark Kendall-tau protocol bug (`benchmark.score_order`)** — tau was
  computed by index-correlating the two *order sequences* (node IDs at each
  list position) instead of comparing per-node ranks. Any imperfect model
  was silently understated; the repo's historical GNN τ ≈ 0.27–0.39 grew to
  **τ ≈ 0.78–0.96** under the corrected per-node-rank protocol while the
  heuristic upper bound stays 1.00. `train_gpu.compute_metrics` already used
  the correct formulation and is now cross-validated by a regression test
  suite (`planner/tests/test_benchmark_protocol.py`). `results/benchmark.json`
  regenerated at canonical scale.
- **RL agent critic/advantage broadcasting bug** — stacked per-step values had
  shape `(T, 1)` against `(T,)` returns, silently broadcasting the advantage
  and critic loss to `(T, T)` and corrupting policy gradients; values are now
  flattened before the loss computation (`planner/qtrust_planner/rl_agent.py`).
- **Anomaly VAE threshold persistence** — training calibrates a data-derived
  decision threshold but checkpoints only stored weights, so reloaded
  detectors silently fell back to the 0.8 default; checkpoints now persist
  `{state_dict, threshold}` with legacy raw state-dict loading still
  supported (`inspector/qtrust_inspector/anomaly_detector.py`).
- **Invariant-handler bugs surfaced by `fail_on_revert = true`** — pause
  toggles in `RegistryHandler` lacked admin roles (silently reverting since
  inception) and bounded salts replayed duplicate content-addressed IDs;
  fixed via role grants and ghost-set dedup.

### Changed

- **Shor factoring no longer depends on `qiskit_algorithms`** — order finding
  is implemented directly via quantum phase estimation on the modular
  multiplication permutation unitary, compatible with qiskit 1.x/2.x and any
  Aer backend (GPU when available, CPU otherwise, classical Pollard's rho as
  labeled last resort). Controlled-U powers are executed natively by Aer as
  block unitaries (no transpilation synthesis), making the demo ~20x faster:
  N=35 factors via the full quantum path in <1s and order finding for
  N=77 completes in ~3s.
- **requirements-gpu.txt** — drop unused gymnasium pin and document that the
  legacy `qiskit-aer-gpu` PyPI package stops at Python 3.12 (use a GPU-built
  Aer on newer Pythons).
- **Invariant testing strengthened** — foundry `[invariant]` raised to
  runs=1000, depth=100 with `fail_on_revert = true`; all 189 contract tests
  pass under the strict config.
- **Rate limiter configurable** — `QTRUST_RATE_LIMIT_MAX` env override
  (`0` disables globally, e.g. behind an edge proxy or for load tests);
  default unchanged at 120/min per IP.
- **k6 stress thresholds scoped per tag** so intentional 404 probes don't
  fail the global budget; measured results published in PERFORMANCE.md
  (147.8 req/s @ 100 VUs, p95 = 11.3 ms).

### Added

- **Frontend GPU panels complete** — `QuantumThreatPanel`, `AnomalyPanel`,
  `RLPlanViewer` join `SideChannelPanel` on the org dashboard's GPU analysis
  grid, with component tests (frontend suite now 44 tests).
- **v2-vs-v3 GNN benchmark** (`planner/qtrust_planner/benchmark_v3.py`) —
  same held-out split and scipy-Kendall protocol as `benchmark.py`;
  writes `results/benchmark_v3.json`.
- **Executable quantum notebook** (`notebooks/02_quantum_threat_gpu.ipynb`)
  generated from the authoritative script and executed with outputs; the
  script is now runnable from any working directory.
- **Publishing pipelines** — PyPI Trusted Publishing workflow
  (`publish-pypi.yml`) and GHCR Docker workflow (`publish-docker.yml`) on
  tags/releases.
- **Documentation site** — `mkdocs.yml` (Material) + GitHub Pages workflow;
  new pages: PERFORMANCE.md, MULTI_CHAIN.md, GO_LIVE_CHECKLIST.md,
  case-studies/CASE_STUDY_EXAMPLE_COM.md (scan → CBOM → on-chain → verify,
  validated end-to-end on a local chain-id-84532 chain).
- **Generated API types** — `frontend/src/lib/generated/api-schema.ts` from
  `backend/openapi.yaml` via openapi-typescript.
- **Halmos formal-verification workflow** (report-only mode pending a
  halmos-clean test setup) plus property-based Hypothesis job in CI with a
  `ci` profile (1000 examples where per-test settings allow).
- **GitHub Release v2.0.0** published with release notes, audit PDF, and
  GPU feature bundle.
- **Trained checkpoints at full scale** — RL agent 10K episodes (best mean
  reward +6.24 vs −8.6 untrained); side-channel detector trained at
  5K+5K traces / 50 epochs; anomaly VAE on 1,000 CBOMs / 100 epochs; GNN v3
  best val τ 0.658 → 0.70+ during the 100K-graph run (checkpoint saved
  continuously; `make -f Makefile.gpu train-gnn` reproduces/resumes).

## [2.0.0] — 2026-08-24

Master-audit remediation release. Breaking changes are pre-deployment
(nothing has shipped to a public chain yet).

### Breaking

- **EIP-712 domain separators are now chainid-defensive** — cached per
  `block.chainid` and recomputed on mismatch (EIP-712 "defensive copies"
  pattern) across all six EIP-712 contracts, enabling safe multi-chain
  redeployment. One extra cold SLOAD on signed paths.
- **Deterministic content-addressed IDs verified contract-wide** —
  `computeAssetId()` / `computeAttestationId()` getters exposed;
  duplicates revert with explicit errors.
- **String-length bounds enforced on all contracts** (URI ≤512,
  DID ≤128, IDs ≤64, reason ≤256) via shared `StringBounds` lib.

### Security

Security-hardening fixes shipped in the current hardening pass:

- **VendorRegistry duplicate-attestation DoS fix** — reject and bound duplicate
  attestations so a single vendor cannot exhaust registry gas/loop capacity.
- **Backend scanner wired to real inspector** — backend no longer serves stubbed
  scan results; it invokes the actual `qtrust-inspector` engine end-to-end.
- **SHA-256 evidence chain** — evidence ledger entries are chained with SHA-256
  hashes, making tampering with historical evidence detectable.
- **Fail-closed VC verification (backend + SDK)** — verifiable-credential
  verification now fails closed on signature, schema, or status-check errors
  instead of degrading to an accept.
- **Risk-engine quantum classification correction** — asymmetric keys (RSA,
  ECC) are classified correctly as quantum-vulnerable rather than being
  mis-scored via symmetric heuristics.
- **Operational-role transfer to timelock** — administrative operations moved
  from deployer EOA control to a timelock-governed operational role.
- **Webhook secret redaction** — webhook signing secrets are redacted from all
  logs, error payloads, and API responses.
- **SSRF DNS pinning** — outbound fetches resolve once and pin the resolved IP
  for the connection lifetime, defeating DNS-rebinding SSRF bypasses.
- **Relayer-key fallback removal** — removed hardcoded/fallback relayer keys;
  relayer credentials must be provided explicitly or operations abort.
- **Indexer reorg handling** — chain reorganizations are detected and replayed
  instead of persisting orphaned events into indexed state.

### Added (2.0.0)

- **AuditRegistry `postAuditSigned`** — EIP-712 gasless path for auditors,
  closing the last trust-model gap; backend relay route `/v1/relay/audit`
  (+ nonce endpoint) with TypeBox schema and tests.
- **Solidity invariant + upgrade tests** — handler-based invariants (nonce
  monotonicity, ID uniqueness, paused-rejects-writes at 256×128 depth) and
  UUPS upgrade state-preservation tests; 189 contract tests total.
- **Configurable `MAX_ATTESTATIONS_PER_PRODUCT`** — governor-settable within
  [16, 4096], default 256, with change event.
- **Frontend wallet gating** — /dashboard and /vendors require a connected
  wallet with a recognized role; real admin detection via on-chain
  `hasRole(DEFAULT_ADMIN_ROLE)` read (UI hint only).
- **Mobile + accessibility E2E** — Playwright desktop/mobile projects,
  axe-core wcag2a/2aa assertions on public pages.
- **Code splitting** — provenance graph client-isolated via `next/dynamic`
  (ssr:false), planning panel lazy-loaded on dashboard.
- **Multi-provider IPFS pinning** — Pinata + Kubo + web3.storage behind
  `QTRUST_IPFS_PROVIDERS`, best-effort replication, CID-mismatch warnings.
- **Property-based tests** — 19 hypothesis tests: CBOM-hash determinism,
  VC round-trip/tamper, DID grammar, risk monotonicity, evidence-chain
  tamper detection (found + fixed a head-truncation bug in `verify_chain`).
- **Alerting** — Prometheus alert rules (API errors/p99, indexer lag,
  RPC-pool health, relay 429 surge) + AlertManager service.
- **Observability gauges** — `indexer_lag_blocks`,
  `rpc_pool_unhealthy_endpoints`.
- **Operations docs** — incident-response runbook (incl. pause + relayer-
  compromise playbooks), backup/restore drill, step-by-step Base Sepolia
  deployment guide, k6 smoke/stress load-test scripts.
- **Engineering hygiene** — CODEOWNERS, PR/issue templates, ADRs 0000–0006,
  CBOM↔CycloneDX conformance mapping doc, inspector dependency graph.

### Added

- **Real AST-based detection** — Python analysis via the stdlib `ast` module
  (scope-aware, key-size/curve refinement, false-positive controls);
  optional tree-sitter upgrade path for JS/TS with honest per-finding
  `detector` labels (`ast-python` / `tree-sitter` / `regex-fallback`).
  Wired into CLI, API, and MCP server.
- **Real PCAP TLS extraction** — pure-stdlib pcap/pcapng reader with TCP
  reassembly-lite and full ClientHello/ServerHello parsing: cipher suites,
  negotiated groups (incl. X25519MLKEM768), SNI. HNDL scoring now derives
  from the actual negotiated suite instead of worst-case defaults.
- **Zeek/Suricata log ingestion** — `analyze_zeek_ssl_log` and
  `analyze_suricata_eve` normalize network TLS telemetry into flow records.
- **Binary artifact scanning** — ELF/PE/Mach-O crypto-library fingerprinting
  (OpenSSL/BoringSSL/liboqs/...), JAR/WAR/APK/wheel/gem inspection,
  embedded PEM detection; wired into CLI/API/MCP.
- **Benchmark corpus + CI gate** — labeled ground-truth fixtures with
  precision/recall thresholds enforced in pytest (first published evaluation
  harness in the PQC-scanning space).
- **EAS schema publication kit** — three PQC-compliance attestation schemas
  (compliance, vendor readiness, migration milestone) with field mappings
  from Q-Trust registries plus a Foundry registration script for EAS on Base.
- **FIPS parameter-set validator** — conformance module now executes real
  spec-table checks (PASS/FAIL) against FIPS 203/204/205 constants,
  reserving SKIP strictly for external KAT/ACVP items; corrected stale
  ML-DSA constants to final FIPS values.

### Fixed

- **Deployment integrity** — docker-compose fail-fast credentials (no more
  empty-password Postgres/Redis), loopback-only DB/Redis ports,
  service healthchecks; backend image bundles Python + inspector so
  `/v1/scan/*` works in containers; evidence chain persists across restarts
  (append-only JSONL store); planner serves explicit heuristic mode instead
  of placeholder model weights.
- **Package honesty** — inspector renamed `qtrust-inspector` v1.1.0 with an
  accurate description; SDK version drift resolved (0.2.0/1.0.0 → 1.1.0);
  python-nmap moved to optional extra.

### Changed — Stack Migration (2026-08)

- **Frontend wallet stack** — replaced custom `dynamic-provider.tsx` with
  wagmi 2 + RainbowKit 2 (30+ wallets, chain-switching, mobile support);
  EIP-712 verifyingContract still pinned to local env config, never API.
- **Backend API surface** — @fastify/helmet security headers (HSTS,
  nosniff, frameguard); @fastify/swagger + swagger-ui serving OpenAPI at
  `/docs` (44 paths); TypeBox JSON-Schema validation on scan/evidence/
  risk/compliance/credential routes replacing manual field checks.
- **SDK** — web3.py 7.x (audited: already v7-clean API usage);
  cryptography pinned `>=43,<45`.
- **Planner** — torch pinned `>=2.5,<3.0`; non-root Dockerfile USER;
  Redis sliding-window rate limiter (ZSET pipeline) with graceful
  in-memory fallback across uvicorn workers.
- **RPC reliability** — multi-endpoint failover pool (`QTRUST_RPC_URLS`)
  with round-robin rotation and 60s health cooldown for attestation +
  indexer viem clients.
- **Component primitives** — Radix UI tabs/dialog/select + cva-based
  Button/Card/Badge primitives; scanner dashboard refactored as proof.
- **Observability** — prom-client `/metrics` endpoint with HTTP request
  duration histogram; Prometheus + Grafana (provisioned datasource) added
  to compose on loopback ports; Sentry (backend, DSN-gated no-op).
- **CI completeness** — Dependabot (6 ecosystems, grouped); gitleaks
  secret scanning; `forge verify-contract` job (guarded, push-to-main);
  coverage reporting (pytest-cov + forge coverage → Codecov).

### Deferred (documented, not forgotten)

- Arweave/Walrus storage migration, full 11→EAS contract consolidation
  (schema kit + registration script shipped), ERC-4337 paymaster,
  WebAuthn/passkey auth, Drizzle migrations, Postgres HA — tracked as
  P2 strategic items in the stack-migration checklist.

### Added — GPU-Accelerated Features (2026-08)

Six CUDA features activated on A100-class hardware (`QTRUST_GPU_ENABLED=true`,
`/v1/gpu/*`; see docs/GPU_FEATURES.md, Makefile.gpu):

- **Large-scale GNN training** — MigrationGNNv3 (256-dim hidden, 8 GAT heads,
  4 layers) with BF16 mixed precision; quick run already reaches val
  Kendall τ 0.66 vs the audit-flagged 0.387 baseline. Fixed ListMLE
  (log-cumsum-exp), vectorized Kendall τ.
- **Timing side-channel analysis** — CNN distribution-shape detector
  (sorted-trace + skew/kurtosis channels) with held-out calibration;
  clean → VERIFIED, leaking ≥0.1σ → HIGH_RISK. Redesigned the provided
  simulator, whose original leakage model was mathematically undetectable
  (sub-σ shift vs within-group width); raw-trace input allowed seed
  memorization — both fixed and documented honestly.
- **Quantum threat estimation** — Shor simulation via qiskit-algorithms when
  available, honest classical fallback otherwise (the provided code used
  qiskit ≤0.x APIs removed in 1.0).
- **RL migration agent** — REINFORCE actor-critic over a DAG migration
  environment (cycle-free fix); `/rl/plan` planner endpoint decodes plans,
  reporting `rl_policy` or `heuristic_fallback` truthfully.
- **Parallel enterprise scanning** — async multi-host scanning with SSRF
  validation and optional GPU-batch risk scoring.
- **CBOM anomaly detection** — VAE with per-CBOM threshold calibration
  (per-asset percentile would flag ~98% of normal CBOMs by construction);
  untrained scoring now raises instead of returning garbage.

Backend: stdin-JSON bridge (`backend/scripts/gpu_bridge.py`) — no shell
interpolation of request data; per-request feature gate; 409 for untrained
detectors; OpenAPI-tagged routes + 15 vitest tests.

## [1.1.0] - 2026-06-30

### Added

- **AST-based analysis** — inspector now parses Python/JavaScript ASTs for
  cryptographic API usage detection beyond regex matching.
- **PCAP scoring** — offline network-capture (pcap) TLS/cipher inventory and
  post-quantum readiness scoring.
- **MCP server** — Model Context Protocol server exposing inspector
  capabilities to AI agents and toolchains.
- **Kubernetes admission policies** — ready-made policies blocking non-PQC
  workloads at cluster admission time.
- **Conformance testing suite** — cross-version conformance harness for SDK,
  backend, and contract interfaces.
- **TLS deep probe** — active handshake probing (protocol negotiation,
  key-share inspection, hybrid X25519MLKEM768 verification).
- **Auto-remediation engine** — generated migration steps with prioritized
  remediation plans per asset.
- **11 compliance frameworks** — CNSA 2.0, NIST FIPS 203/204/205 mapping,
  ETSI, BSI TR-02102, PCI DSS, HIPAA, SOC 2, GDPR, FedRAMP, ISO 27001, and
  CISA PQC guidance coverage in compliance reporting.
- **Official GitHub Action** (`qtrust-inspector-action`) for CI integration.

## [1.0.0] - 2026-03-15

### Added

Enterprise-grade release of the Q-Trust platform.

- **Scanner suite** — multi-language cryptographic asset discovery across
  Python, JavaScript/TypeScript, Go, Java, Rust, and C# codebases.
- **Risk engine** — quantitative post-quantum risk scoring with
  exploitability-weighted prioritization ("harvest-now-decrypt-later" aware).
- **Compliance frameworks** — pluggable framework reporting (CNSA 2.0 gate)
  with machine-readable results.
- **CycloneDX CBOM** — Cryptography Bill of Materials generation per scan.
- **SARIF output** — GitHub Security tab integration via SARIF 2.1.0 uploads.
- **Evidence ledger** — on-chain attested audit-evidence records supporting
  enterprise assurance workflows.
- **Roadmap** — published forward plan covering AST analysis, network probes,
  remediation automation, and expanded governance integrations.

[Unreleased]: https://github.com/humoge7502/q-trust/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/humoge7502/q-trust/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/humoge7502/q-trust/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/humoge7502/q-trust/releases/tag/v1.0.0

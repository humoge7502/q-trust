# Q-Trust — Strategic Analysis & Execution Plan

**Date:** 2026-11-08 · **Scope:** full repo audit + flagship frontend upgrade (branch `devesh/lattice-ui-upgrade`)
**Method:** line-level code audit of `frontend/` (all routes, motion system, UI primitives, CI gates), backend route map, `TECHNICAL_DEBT.md` reconciliation, prior-roadmap inheritance. Every claim below traces to a file/line or an artifact; inherited items cite their source doc. Supersedes nothing; complements `ANALYSIS_AND_ROADMAP_2026-10-27.md` (which proposed product features — this doc adds the UI/motion strategy and the remaining issue catalog).

---

## 1. Project Analysis & Strategic Opportunities

### Where Q-Trust stands
Q-Trust is an evidence-native post-quantum-cryptography (PQC) migration platform: **scan → assess → plan → remediate → attest → publicly verify**, with an on-chain registry, vendor attestation, offline certification bundles, and a public verification page (`/v/[id]`) that requires no account. The frontend is Next.js 16 / React 19 / Tailwind v4 with an unusually strict engineering floor: CI token ratchet, CWV budgets in Playwright, axe a11y gates on five routes (including authenticated states), CSP with frame-ancestors none, and honesty conventions that forbid unverifiable copy.

### The moat (and why it holds)
1. **Verification, not reporting.** Competitor output is a PDF; Q-Trust output is a record a third party can check without trusting the vendor. This is the core differentiator — every strategic move should deepen it.
2. **A regulatory clock.** OMB M-26-15 gives agencies hard deadlines (`/evidence` already counts them down). Demand arrives on a date, not gradually — the first mover with **evidence packs agencies can file** wins the wedge.
3. **On-chain provenance.** EIP-712 gasless attestations + Base L2 = tamper-evident history without wallet friction.
4. **Honesty engineering as brand.** The `/research` page publishes negatives. In a market full of "quantum-safe!" claims, radical verifiability is a positioning weapon.

### Differentiation opportunities (ranked by strategic value)
| # | Move | What to build | Why it wins | Effort | KPI |
|---|------|---------------|-------------|--------|-----|
| S1 | **Compliance-native exports** | SSP/POA&M sections + **OSCAL** evidence packs generated from verified records | Converts the M-26-15 wedge into procurement reality — files agencies actually submit | 2–3 wks | # downloads per org; first agency pilot |
| S2 | **CI crypto gate** | GitHub Action + CLI: fail a PR that introduces weak crypto, link to remediation | Developer distribution flywheel (semgrep/gitleaks playbook); free pipeline into scans | 1–2 wks | installs, scans sourced from CI |
| S3 | **CBOM as a first-class artifact** | CycloneDX CBOM emit + timeline diff (what changed in the crypto estate this month) | Crypto-BOM is nascent; owning the timeline view ahead of tools = category ownership | 1–2 wks | CBOM downloads, timeline views |
| S4 | **Channel/OEM embed** | MSSP/consultancy embed: their brand on the scanner, Q-Trust attestations underneath | Sells through people who already sit in agency security reviews | 2–4 wks | signed partners |
| S5 | **Public trust ledger** | Live transparency page: cumulative attestations, verification uptime, registry stats | Weaponizes the honesty brand; marketing page that is itself evidence | 3–5 days | media/social citations |

**Positioning statement (recommended):** *"Q-Trust is the only PQC migration platform whose output is independently verifiable — every finding, plan, and attestation carries proof a third party can check, without an account."*

---

## 2. Issues & Required Fixes (catalog)

Severity = business impact × likelihood. Effort in focused hours. "Shipped" items are on `devesh/lattice-ui-upgrade` today.

### Shipped this session (verified: token ratchet ✓, lint ✓, 183/183 vitest ✓, production build 18/18 pages ✓)

| ID | Sev | Cat | Problem (pre-fix) | Repro / evidence | Fix |
|----|-----|-----|-------------------|------------------|-----|
| F-01 | High | perf/arch | Landing page fetched `/api/health` live **per visitor** (`stats-panel.client.tsx:50`, `no-store`) — slow backend = permanent "Checking API…" on the flagship page; per-view backend load | Open landing with backend down → pill stuck "Checking API…"; network tab shows fetch on every view | `requestIdleCallback` + 60s sessionStorage TTL; states preserved |
| F-02 | High | bug (progressive enhancement) | `.reveal { opacity:0 }` was unconditional CSS; `reveal-visible` only arrives via hydration+IO. **With JS blocked, every Reveal-wrapped landing section was invisible** (the `lib/motion.ts` comment claiming no-JS support was wrong) | Block JS → landing renders blank between hero and footer | `html.js` gate: 1-line bootstrap script in `layout.tsx` (the app's only inline script; permitted by prod CSP script-src 'unsafe-inline', TD-18), CSS re-gated to `html.js .reveal*` |
| F-03 | High | debt | `lucide-react` declared, zero imports (pages use hand-drawn `icons.tsx`) — pure install cost | `grep -r lucide src/` → only a comment | removed from package.json + lockfile |
| F-04 | High | debt/quality | Two count-up engines on one page (GSAP `CountUp` + hand-rolled rAF); PublicStatsClient hardcoded stale literals duplicating ProofSection claims | Same claim ("Registry contracts 11") rendered twice with different mechanisms on one page | `lib/public-stats.ts` single source (11 / 12+ / Open / 364 — values preserved); stats-panel uses shared CountUp; band keeps only live signals |
| F-05 | Med | quality | Token-drift islands inside `ui/`: `badge.tsx` raw rose/slate, `toast.tsx` raw emerald/rose, `scroll-x`/`code-block` raw cyan ring | grep raw palette classes: 67 → **52** after fix (ratchet baseline untouched, count only decreased) | mapped to semantic state/quantum tokens |
| F-06 | Med | quality | Footer `© {new Date().getFullYear()}` baked at build — stale across New Year | Static prerender inspection | `ui/current-year.tsx` (ref-based DOM correction, no state-in-effect) |
| F-07 | Med | bug | Badge route classified any error message *containing* "404" as NOT_FOUND — a backend 500 whose text mentions 404 misclassified | `api/badge/[id]/route.ts:105-109` (pre-fix) | branch on `ApiError.status`; message fallback only when status unknown; 4 new vitest cases incl. 500-with-"404"→UNREACHABLE |
| F-08 | Low | quality | One-off `text-[clamp(2.6rem,6vw,5.6rem)]` on `/demo` violating the display-token system the CSS comments call for | `demo/page.tsx:75` (pre-fix) | new `--text-display-md` token |

### Open (prioritized queue)

| ID | Sev | Cat | Problem | Location / source | Effort | Dependencies | Timeline |
|----|-----|-----|---------|-------------------|--------|--------------|----------|
| F-09 | Med | security | Production CSP `script-src` keeps `'unsafe-inline'` (Next bootstrap limitation). The new `.js` bootstrap depends on it. Migrate to nonce/strict-dynamic | TD-18; `next.config.mjs:31-33` | 2d | Next upgrade path check | this quarter |
| F-10 | Med | security | Browser-held operator credential residual — **mitigated** by exchange-once session tokens, but branch `feat/operator-session-auth` (commits `10d0a2d`, `bbc6511`) is **not pushed/PR'd** | Session-18 work; TD-08 | push+review ≈ 0.5h | user decision (below) | immediate |
| F-11 | Med | perf | 81 MB of video in `public/media/` served by the app (inherited PERF-03, `COMPREHENSIVE_ANALYSIS_AND_ROADMAP.md`) | repo size + bandwidth | 2–4h + CDN acct | hosting decision | this month |
| F-12 | Med | quality | No unit tests for `motion/*`, `site-header`, `site-footer`, `wallet-gate`, `verify-box`, `stats-panel` (183 tests don't cover them; e2e partially does) | vitest coverage map | ~6h | — | next sprint |
| F-13 | Med | arch | Dashboard + scanner panels re-implement "call proxy → render ApiError/OperatorKeyRequired" states; a `useApiOperation` hook collapses the pattern | `dashboard/page.tsx`, `scanner/*` | 4h | — | next sprint |
| F-14 | Med | a11y | AAA contrast pass never run (scorecard open item); muted-foreground fix landed at AA 6.92:1 but AAA not audited | `PROJECT_SCORECARD.md` | 3h | — | this quarter |
| F-15 | Low | quality | `X-XSS-Protection: 1; mode=block` header is a deprecated no-op | `next.config.mjs:75-80` | 0.1h | — | next PR |
| F-16 | Low | debt | Pricing page publishes a personal Gmail as the sales contact (spam-harvest target, unprofessional surface) | `pricing/page.tsx:18` | 0.5h | **needs a domain alias** (user decision) | this month |
| F-17 | Low | quality | Mobile sheet external-link affordance inconsistent with desktop header/footer | `site-header.client.tsx:123` | 0.5h | — | next PR |
| F-18 | Low | debt | `video-frame.tsx` still carries raw slate classes (ratchet-tolerated pre-existing) | `ui/video-frame.tsx` | 0.5h | — | next PR |

Explicitly audited and clean (no findings): zero TODO/FIXME debt markers in `frontend/src`; the single `dangerouslySetInnerHTML` besides the new bootstrap is JSON-LD with `</script>`-safe escaping; `sanitizeUri` scheme allowlist intact; proxy path-traversal rejection intact; all effects/observers/rAF loops have correct teardown; hydration-safe clock patterns.

---

## 3. Enhancements & Modifications

Shipped today (details in §7):
1. **Reveal system → variant + stagger architecture** (`Reveal` variants `blur|rise|scale|slide-left`, `data-reveal-group` auto-stagger, no-JS-safe). This is now the platform's unified entrance language — *next*: roll onto `/research`, `/compare`, `/pricing` for cross-page cohesion (2h).
2. **Bento system** (`ui/bento.tsx` + `ui/spotlight-card.tsx`) rebuilt the landing "Why" section with existing copy verbatim — asymmetric 3-col bento, pointer-follow spotlight, hover hairline sweep. *Next*: same treatment for `/why-now` threat timeline (3h).
3. **Stat architecture**: `lib/public-stats.ts` is now the single source for public claims — *next*: `/research` numbers should import from it too (1h).
4. **Demo tour → pinned horizontal scroll** on desktop (GSAP ScrollTrigger scrub via the existing lazy `loadGsap()`; mobile/no-JS/reduced-motion get the identical grid — presentation only). *Follow-ups*: keyboard arrow scrub in pinned mode; per-slide anchor deep-links (4h).
5. **Signal strip → dual-row counter-marquee** with edge fade masks, hover pause, aria-hidden echo row (MagicUI marquee pattern adapted).

Maintainability (recommended next):
6. **Split `page.tsx`** (now ~470 lines with sections) into `components/sections/*.tsx` modules — server components, one per landing band (4h). Low risk, pure moves.
7. **CVA-ify `card.tsx`/`panel.tsx`** like `button.tsx`/`badge.tsx` already are — removes ad-hoc className merging and unlocks variants the bento now needs (2h).
8. **Backend TD-15**: assurance report spawns Python per request — precompile/cache the report path (inherited; 1d).

---

## 4. Advanced Features (ranked)

| # | Feature | Value | Effort | Notes |
|---|---------|-------|--------|-------|
| X1 | **CI crypto gate** (S2) | Distribution + daily touchpoint in target repos; the wedge that makes Q-Trust infrastructure rather than a tool | 1–2 wks | Build on existing scanner; GitHub Action + `--gate` CLI mode; emit CBOM + advisory comment |
| X2 | **Evidence timeline** (S3) | Per-asset CBOM diff over time anchored on-chain — no competitor offers cryptographic "what changed" history | 1 wk | Registry already has the data; it's a frontend + index feature |
| X3 | **Pareto planner UI** | Multi-objective frontier (risk ↓ / cost / deadline) in the org dashboard — turns the RL planner from an answer into a decision instrument | 1–2 wks | planner-service outputs exist; needs frontier endpoint + viz |
| X4 | **OSCAL/FedRAMP evidence packs** (S1) | The procurement unlock; converts attestations into submittable artifacts | 2–3 wks | OSCAL serialization layer over existing records; templates for SSP/POA&M sections |
| X5 | **Detector label flywheel** | Human-verified labels feed retraining → pushes F1 beyond the pinned 0.9395 ceiling (metric gate updates only via artifact-gated process — never hand-edited) | ongoing | inherits 2026-10-27 roadmap; requires review UI |
| X6 | **WebAuthn attestation signing** | Lets non-crypto-native auditors sign/review without wallets — removes the last friction on the verify path | 1 wk | complements, does not replace, wallet path |

Recommendation: **X1 first** (distribution compounding), X2 second (pure differentiation, cheapest wow).

---

## 5. New Additions (modules & integrations)

1. **OSCAL (NIST) output module** — pairs with X4; makes Q-Trust legible to GRC tooling.
2. **CycloneDX CBOM emit + SBOM ingest** — read third-party SBOMs to enrich scans; emit CBOMs as the public artifact.
3. **GitHub App packaging** of the CI gate (X1) — marketplace listing = free acquisition channel.
4. **Webhook notifications** (Slack/Teams) for scan completion, deadline proximity (M-26-15 countdowns), attestation events.
5. **Evidence blob redundancy** — IPFS pinning service + S3 mirror for evidence blobs (single-pin failure mode today).
6. **Error monitoring** — self-hosted GlitchTip (Sentry-compatible, CSP-friendly) for frontend + Fastify; today production errors are invisible.
7. **OpenTelemetry traces** on Fastify + planner-service — pairs with the existing health/stats surfaces; enables the S5 trust ledger's uptime claims to be *measured*, not asserted.

---

## 6. Verification & Testing Strategy

**Current floor (verified today):** 183/183 vitest · Playwright suites: smoke, axe a11y on 5 routes + authenticated scanner states + wallet-gated pages, operator-session security flows, CWV budgets (LCP ≤ 2.5s, CLS ≤ 0.1), mobile layout (320/375/414), certify flows · CI token ratchet · backend: Stryker mutation gate, invariant fuzz, CodeQL, semgrep, gitleaks.

Gaps → plan:
1. **Unit** (F-12): motion/*, header/footer, wallet-gate, verify-box, stats-panel; plus render tests for the new primitives (spotlight/border-beam/shimmer attribute behavior, reduced-motion states). ~8h.
2. **Visual regression** — the flagship upgrade needs pixel gates: Playwright `toHaveScreenshot` on landing bands (hero/why/proof/closing) at 375/1280/1440, animated layers frozen via a `data-visual-freeze` test hook (pause marquees/aurora/beam). ~4h setup + baselines. Catches "the animation ate the CTA" regressions that axe and vitest cannot.
3. **Performance**: keep `cwv-budget.spec.ts` as merge gate; add Lighthouse CI (lab) budgets — LCP < 2.5s, TBT < 300ms, CLS < 0.1 — on preview deploys; alert on first-load JS delta > 10KB per PR (Next 16 removed build size columns, so measure from prerendered HTML as this PR did).
4. **Security**: ZAP baseline on preview deploys; CSP report-only endpoint during the TD-18 nonce migration so real-world violations are observed before enforcement; keep gitleaks/CodeQL as-is.
5. **A11y**: extend axe to the rebuilt Why/Closing bands and the pinned tour's desktop mode; add a keyboard-only walkthrough spec for `/demo` (tabs → arrows scrub → focus never lost).
6. **Contract**: snapshot `openapi.json` in CI and fail on undocumented breaking drift between frontend proxy policy tests and backend routes.
7. **UAT**: 5-task moderated script (scan → plan → attest → verify `/v/[id]` → embed badge) with 5 external users on demo data; pass bar: 90% task completion, SUS ≥ 80; findings feed the F-13 hook refactor.
8. **Release path**: preview deploy (automatic) → smoke + CWV + visual gates → **promotion is user-gated** (Vercel dashboard redeploy of `main`, or `vercel login && vercel --prod` from `frontend/`) — production `q-trust-nu.vercel.app` still serves the pre-Lattice build until that button is pressed.

---

## 7. Shipped today — flagship UI/animation upgrade (`devesh/lattice-ui-upgrade`)

Re-authored in-repo (MIT) from the best patterns of the referenced component libraries — **no verbatim code copied, no external assets** (CSP-compatible), every pattern tokenized, reduced-motion-aware, and inside the CI ratchet:

| Source site | Pattern incorporated (adapted) |
|---|---|
| Aceternity UI | SpotlightCard (mouse-follow radial glow), bento grid, border beam |
| Magic UI | border-beam, dual-row counter-marquee + edge fade, aurora backdrop |
| 21st.dev | bento/composable card patterns, stagger choreography |
| ReactBits | shimmer text sweep, reveal variants |
| Motion Primitives / animate-ui / OriginUI / Kibo / reui | stagger-group reveal, magnetic CTA, Radix+token hygiene conventions |
| motion.dev | (principles) compositor-only transforms; implemented via the repo's lazy GSAP loader — zero new deps |
| GSAP + Lenis | ScrollTrigger pin/scrub horizontal tour; existing Lenis smooth scroll retained |
| Auto Animate | list entry already covered by `.grow-in-x` (`@starting-style`) |
| Godly / Awwwards / Mobbin / Dribbble / Refero | direction only: extreme editorial display scale, mono eyebrow register, hairline night surfaces |

New/changed (16 modified, 10 new files): `ui/{spotlight-card,bento,border-beam,shimmer-text,aurora,current-year}.tsx`, `motion/{magnetic-button,horizontal-tour}.client.tsx`, `lib/public-stats.ts`, `api/badge/__tests__/route.test.ts`; plus the fixes in §2. Closing section restaged on the night canvas with aurora + shimmer headline + magnetic CTA; hero eyebrow shimmer; dual marquee; ProofSection border-beam on the lead metric.

**Verification:** token ratchet PASS (67→52 raw classes) · lint clean · 183/183 tests · `next build` 18/18 static pages · no-JS and reduced-motion fallbacks verified in prerendered HTML · Playwright suite = CI gate (not run locally).

---

## 8. Decision points for the owner

1. **Promote production** — the Lattice frontend + this upgrade reach users only after the Vercel promotion (dashboard redeploy of `main` or `vercel --prod` from `frontend/`). Everything else is staged until then.
2. **`feat/operator-session-auth`** (SEC-02/TD-08, commits `10d0a2d`+`bbc6511`) sits unpushed — say the word and it goes up as its own PR.
3. **Sales contact alias** for `/pricing` (F-16) — needs a domain mailbox.
4. **Docs consolidation** (TD-03, docs-v2 vs mkdocs) — pick the survivor.
5. **Next feature bet** — recommendation: **X1 CI crypto gate**, then X2 evidence timeline.

### 30-day sequence
Week 1: merge this PR → promote to production → F-15/F-17/F-18 sweep → F-12 motion tests.
Week 2: X1 CI gate alpha → visual-regression gates (§6.2) → F-11 CDN move.
Week 3: X2 evidence timeline → F-13 hook refactor → F-14 AAA pass.
Week 4: X4 OSCAL spike → F-09 CSP report-only → UAT script execution.

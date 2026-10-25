# Q-Trust — Comprehensive Analysis & Strategic Roadmap

**Date:** 2026-10-24
**Scope:** Full-repository audit of `q-trust` (frontend, backend, planner, inspector, contracts, qtrust_ai, docs, deploy)
**Method:** Direct source measurement (LOC, dependency audit, pattern scans) + application of 21 installed design/security/testing skills (see `SKILLS_INTEGRATION.md`) + prior `GAP_ANALYSIS_REPORT.md` reconciliation.
**Measured baseline (2026-10-24):**

| Area | Files | LOC | Notes |
|---|---|---|---|
| `frontend/src` | 101 | 15,702 | Next.js 15 App Router, React 19 |
| `backend/src` | 24 | 16,000 | Fastify; 9,667 LOC is generated `abis.ts` |
| `planner/qtrust_planner` | 21 | 6,173 | PyG `MigrationGNNv3` + constrained optimizer |
| `inspector/qtrust_inspector` | 28 | 11,926 | Python CBOM/TLS scanner |
| `contracts/src` | 13 | 3,515 | 11 UUPS contracts, Solidity 0.8.24 |
| `qtrust_ai` | 44 | 19,541 | Research prototype library |
| **Total** | **~231** | **~72,857** | |

Other measured signals: `TODO/FIXME/HACK` = **3** (very clean); `any` in TS = **27**; frontend `npm audit` = **21 high / 0 critical** (all wallet stack); backend audit = **0**; raw Tailwind palette classes in `frontend/src` = **682** (148 in `scanner-dashboard.tsx`); `transition: all` = 0; `100vw` = 0; size-based animations = 0; `focus-visible` sites = 77; `prefers-reduced-motion` sites = 10.

---

## 0. Executive Summary

Q-Trust is a **post-quantum-cryptography (PQC) migration assurance platform**: it discovers cryptographic assets (CBOM), ranks migration priority with a GNN planner, and anchors every decision as verifiable evidence on Base Sepolia L2. It is genuinely differentiated by the **certification fabric** (validity-gated attestation + Merkle-proof revocation) and a **defensible research methodology** (tie-aware Kendall τ_b ceiling analysis), not by raw ML accuracy.

**Three strategic truths the project must internalize:**

1. **The moat is the assurance/certification layer, not the scanner.** CBOM generation and readiness scoring are commodity (CycloneDX 1.6, IBM Quantum Safe, SandboxAQ, Keyfactor, CISO Global all ship discovery). What none of them ship is a *tamper-evident, third-party-verifiable, revocation-capable* record that a migration was done correctly and that the evaluation behind it was *discriminating*. That is the patentable, sellable wedge.
2. **The ML is at parity with a heuristic on real data** (τ_b 0.7168 vs 0.7210). Marketing the GNN as "more accurate" is a credibility risk. Market it as *learned, retrainable, feature-attributable, and auditable* — and invest in the labelling study that would make it genuinely superior (the paper's Theorem 3 says label the *biggest tied clusters*, not the most important assets).
3. **The engineering is strong but has two live credibility debts:** 21 high-severity wallet-stack CVEs and a design-system that has drifted (682 raw palette classes vs a documented "token-only" house style). Both are fixable and both are cheap relative to their reputational cost.

**Top 5 actions (sequenced):** (1) upgrade the wallet stack and re-verify wallet flows; (2) close the design-token drift with a lint gate; (3) ship the labelling-study harness that proves GNN lift; (4) turn the certification fabric into the product's front door; (5) split `scanner-dashboard.tsx` and add invariant/fuzz tests to the contracts.

---

## 1. Project Analysis & Strategic Opportunities

### 1.1 What Q-Trust actually is (verified)

```
inspector (Python) ──CBOM──▶ backend (Fastify) ──▶ planner (PyG GNN + MILP/CP-SAT)
        │                         │                        │
        └── evidence chain ───────┴──▶ contracts (11 UUPS) on Base Sepolia (84532)
                                          └── EIP-712 gasless writes, 7-day timelock governance
frontend (Next.js 15 / React 19) ──▶ /scanner, /research, /v/[id], /compare, /developers
```

**Verified strengths (bank on these):**
- **Contracts are production-grade:** 11 UUPS contracts, 3.5k LOC, 213 forge tests, renounce-deployer deploy script, 7-day timelock, Merkle-proof revocation. This is the hardest thing to copy.
- **A real, honest research artifact:** 16-page paper with the τ_b ceiling theorem, tie-decomposition identity (τ_b = γ·√(d/n₀), γ = Goodman–Kruskal), metric taxonomy, power analysis, and a 53/53 claims harness. This is rare for a product repo and is a credibility multiplier with enterprise security buyers.
- **A real external benchmark:** CryptoAPI-Bench head-to-head with honest framing (usage recall 0.877, Apache F1 0.688, no superiority claim).
- **Real datasets:** 4,431 files across 11 languages for discovery; 42 real CBOMs for planner LOO.
- **Operational maturity:** Docker compose, Prometheus/Grafana, indexer with reorg handling, fail-closed config, CSP, rate limiting, 146-check live audit.
- **Code hygiene:** only 3 TODOs in ~73k LOC; ruff/mypy/tsc/eslint clean.

### 1.2 Competitive landscape & where the whitespace is

| Competitor | What they ship | What they don't |
|---|---|---|
| IBM Quantum Safe | Discovery, inventory, prioritization | No third-party-verifiable, revocation-capable attestation; no validity gating |
| SandboxAQ AQtive Guard | Crypto discovery + risk | Dashboard-first; no on-chain proof; no evaluation-validity model |
| Keyfactor | PKI/CLM + crypto agility | Certificate-centric; no migration-evidence fabric |
| CISO Global / QuantumGenie / pqAgility | Readiness scoring, advisory | Services-heavy; no reproducible benchmark or public proof |
| **Q-Trust (target)** | Discovery + planning + **verifiable certification fabric** | Must earn the "verifiable" claim with real external attestations |

**Whitespace (ranked by defensibility):**
1. **Verifiable migration certification.** "Prove to your auditor/regulator, cryptographically, that asset X was migrated from RSA-2048 to ML-KEM-768 and the evidence hasn't been tampered with." No incumbent offers this as a first-class product. Q-Trust already has the primitives.
2. **Evaluation-validity gating.** "Refuse to certify a ranking whose discriminative power is below its ceiling." This is a novel, patentable control that turns the paper's negative result into a product feature. Nobody else gates on *whether the evaluation itself is meaningful*.
3. **Privacy-preserving revocation.** "Check whether a credential is revoked without revealing the revocation list." Merkle-proof revocation is built; it needs a buyer-facing story.
4. **Sector-specific assurance packs.** FedRAMP/CNSA 2.0, PCI-DSS 4.0 crypto-agility, HIPAA, DORA (EU). Pre-mapped control crosswalks are high-value and defensible as content IP.

### 1.3 Strategic value propositions by buyer

| Buyer | Pain | Q-Trust proposition | Proof point needed |
|---|---|---|---|
| CISO (regulated enterprise) | "I can't prove to the board/auditor that migration is on track and correct." | Verifiable, exportable migration attestation ledger | A signed attestation an auditor can verify offline |
| Compliance / audit | "Evidence is scattered spreadsheets." | Tamper-evident evidence chain + Merkle revocation | Reproducible audit export |
| Security engineering | "What do I migrate first, and what breaks?" | Ranked roadmap + interop/failure prediction | Planner output + interop model |
| Vendor / MSSP | "I need to prove my product is PQC-ready." | Vendor readiness attestations on-chain | `VendorRegistry` attestation flow |
| Federal contractor | "FAR flow-down demands PQC migration evidence." | Compliance crosswalk + attestation | EO 14412 / CNSA 2.0 mapping |

### 1.4 Measurable improvements that create differentiation (specific)

| # | Improvement | Why it differentiates | Effort |
|---|---|---|---|
| S1 | **Offline verifiable attestation bundle** (`qtrust verify-bundle attestation.json`) — a signed JSON+proof a third party checks with no Q-Trust account | Turns "on-chain" into "auditor-verifiable offline" — the actual buyer need | 3–5 d |
| S2 | **Validity-gated certification API** — `/v1/certify` returns `discriminating: bool` + refuses below ceiling | Unique, patentable control; converts the paper into product | 5–8 d |
| S3 | **Sector assurance packs** (CNSA 2.0, PCI 4.0, DORA) as machine-checkable policies | Content IP; drives enterprise deals | 4–6 d each |
| S4 | **Labelling-study harness** (the paper's Table IX) — turns "GNN at parity" into "GNN +N% after N labels" | The only path to a *true* ML moat | 2–3 wk |
| S5 | **Public benchmark leaderboard** (CryptoAPI-Bench + your 42 CBOMs, reproducible) | Thought-leadership + SEO + trust | 1 wk |
| S6 | **Revocation-check SDK snippet** (one-line JS: `isRevoked(credentialId)`) | Makes the privacy-preserving feature usable | 2 d |

---

## 2. Issues & Required Fixes (catalog)

Severity: **Critical / High / Medium / Low**. Priority: **P0 (now) / P1 (this sprint) / P2 (next) / P3 (backlog)**. Effort in engineer-days (ed). Dependencies noted.

### 2.1 Summary table

| ID | Issue | Sev | Pri | Effort | Depends on | Timeline |
|---|---|---|---|---|---|---|
| BUG-01 | Frontend: 21 high npm vulns in wallet stack (wagmi/@reown/@walletconnect/@x402/viem) | High | P0 | 1–2 ed | — | Week 1 |
| BUG-02 | `scanner-dashboard.tsx` design-token drift: 148 raw palette classes (scorecard claimed "→4") | Medium | P1 | 2 ed | DS-01 | Week 2 |
| BUG-03 | 682 raw Tailwind palette classes repo-wide vs documented token-only house style | Medium | P1 | 3 ed | DS-01 | Week 2–3 |
| BUG-04 | `scanner-dashboard.tsx` 1,943 LOC monolith (TD-01) — maintainability + review risk | Medium | P1 | 4 ed | — | Week 3 |
| BUG-05 | Frontend `config.test.ts` flakes under full-suite load (module-level `CHAIN` + env leakage) | Low | P2 | 0.5 ed | — | Week 2 |
| PERF-01 | `backend/src/lib/abis.ts` 9,667 LOC generated ABI in the module graph — slows cold start / tsc | Low | P2 | 1 ed | — | Week 4 |
| PERF-02 | Serverless cold start ~1–2 s; `/plan` p95 up to 337 ms at 2k assets | Medium | P2 | 3 ed | — | Week 4–5 |
| PERF-03 | Frontend ships 81 MB of video in `public/media/` (not lazy/streamed) | Medium | P2 | 1 ed | — | Week 3 |
| SEC-01 | Wallet-stack CVEs (same as BUG-01) — **FIXED 2026-10-24**: single zod advisory, resolved via `overrides.zod ^4.6.6`; audit now 0 | High | P0 | ~~1–2 ed~~ 0 (done) | — | **Done** |
| SEC-02 | ~~No automated secret scanning~~ **WRONG — already implemented**: `security.yml` runs gitleaks + a `dev-key-guard` job with a tuned `.gitleaks.toml` | — | — | — | — | n/a |
| SEC-03 | Browser-held operator key (TD-08) — accepted risk, but no hardware-wallet path | Medium | P2 | 3 ed | — | Week 5 |
| SEC-04 | ~~No Slither/Echidna in CI~~ **WRONG — already implemented**: `security.yml` (slither, semgrep, codeql, pip-audit, gitleaks, dev-key-guard, model-integrity) + `invariant-fuzz.yml` (nightly) + `halmos.yml` (formal) | — | — | — | — | n/a |
| SEC-05 | No **UUPS storage-layout diff** on upgrade (verified absent from all 12 workflows) — real gap | Medium | P1 | 0.5 ed | — | Week 2 |
| ARCH-01 | Web stack proxies an off-box scanner/planner over quick tunnels (no SLA; 503 on local down) | High | P1 | 5–8 ed | — | Week 3–4 |
| ARCH-02 | `qtrust_ai` (19.5k LOC) is a research library not on the served path — maintenance drag | Medium | P2 | 2 ed (decide) | — | Week 4 |
| ARCH-03 | Indexer is single-writer, no horizontal scale story | Medium | P2 | 5 ed | — | Q2 |
| QUAL-01 | 27 `any` in TS weaken type safety at boundaries | Low | P2 | 1 ed | — | Week 4 |
| QUAL-02 | `qtrust_ai` has ~1 test file for 42 modules (low coverage on research code) | Medium | P2 | 3 ed | — | Week 4 |
| TD-01 | Monolith split (same as BUG-04) | Medium | P1 | 4 ed | — | Week 3 |
| TD-02 | Mutation testing + UUPS storage-layout diff absent (static analysis, fuzzing, symbolic exec all present in security.yml/invariant-fuzz.yml/halmos.yml) | Medium | P2 | 2 ed | — | Week 2 |
| TD-02b | Scorecard numbers stale (forge 213, Playwright 43 date-stamped 2026-09-12, not re-measured) | Low | P2 | 0.5 ed | — | Week 2 |
| TD-03 | No mutation testing; property-based tests only in inspector | Low | P3 | 2 ed | — | Q2 |
| TD-04 | `docs-v2` (VitePress) staged but not switched over — dual docs maintenance | Low | P3 | 2 ed | — | Q2 |
| TD-05 | `PROJECT_SCORECARD.md` historical claims not all re-measured (forge/Playwright) | Low | P2 | 0.5 ed | — | Week 2 |

### 2.2 Detail — Bugs

**BUG-01 / SEC-01 — 21 high-severity npm advisories in the wallet stack; CI gate is now RED.**
- *Repro:* `cd frontend && npm audit --omit=dev --audit-level=high` → **exit 1**, 21 high, 0 critical. `package-lock.json` is unchanged (`git status` clean), so this is **advisory-DB drift**: new CVEs were published for the pinned wallet packages after the last green CI run.
- *Expected:* the CI frontend job's own gate (`npm audit --omit=dev --audit-level=high`, `ci.yml:166`) passes. *Actual:* it now fails — **the frontend pipeline is currently red on a fresh advisory sync**. The in-repo comment ("the production tree is clean") is stale.
- *Affected:* wagmi, @reown/appkit*, @walletconnect/*, @x402/*, viem, abitype (all transitive).
- *Impact:* Wallet connect + EIP-712 attestation flows (the on-chain write path). Not the scanner/API read path. Business impact: a red security gate in CI and an enterprise security review will flag it immediately.
- *Fix:* `npm install wagmi@2.15.0` (semver-major), re-run the wallet e2e (`wallet 41` checks), confirm connect/switch/disconnect + attestation still pass; use `overrides` if a transitive dep pins an old `viem`; update the stale CI comment.
- *Deps:* none. *Timeline:* Week 1 (now urgent — it is a red gate, not a latent risk).

**BUG-02 / BUG-03 — Design-token drift (hallmark Floor rule 1).**
- *Repro:* `grep -rhoE "(bg|text|border)-(slate|...)-[0-9]{2,3}" frontend/src | wc -l` → 682; `scanner-dashboard.tsx` alone = 148 (59× `text-slate-600`, 24× `text-slate-900`, 22× `border-slate-200`…).
- *Expected:* every colour through a `:root` token (documented house style; scorecard claimed "101 → 4"). *Actual:* 148 raw utilities in the very file claimed fixed.
- *Impact:* theme drift, dark-mode gaps, contrast regressions, and a false claim in the scorecard. Medium severity, high credibility cost.
- *Fix:* (a) add semantic tokens (`--fg-muted`, `--border-subtle`, `--surface`) to `globals.css`; (b) codemod `text-slate-600 → text-muted-foreground` etc.; (c) add an ESLint `no-restricted-syntax` rule (or a `scripts/lint-tokens.mjs` CI gate) forbidding raw palette classes in `src/components/**` and `src/app/**`; (d) correct the scorecard claim.
- *Deps:* DS-01 (token definitions). *Timeline:* Week 2–3.

**BUG-04 / TD-01 — `scanner-dashboard.tsx` monolith (1,943 LOC).**
- *Impact:* review risk, merge conflicts, slow HMR, hard to a11y-audit per panel.
- *Fix:* extract the 8 tabs into `components/scanner/tabs/{Scan,Risk,Compliance,Roadmap,Evidence,SideChannel,Planner,GpuLab}.tsx` + a `useScannerState` hook; keep the exact 8 tab labels and the single findings `<table>` (audit constraints). *Effort:* 4 ed. *Timeline:* Week 3.

**BUG-05 — `config.test.ts` flake.**
- *Repro:* full-suite `vitest run` intermittently fails 2 chain-derivation tests; passes in isolation.
- *Cause:* `CHAIN` is computed at module load; another test leaks `QTRUST_USE_MAINNET` across the worker, and module caching means the value is stale.
- *Fix:* `vi.resetModules()` + `vi.stubEnv` in `beforeEach`; or move chain derivation into a pure function `deriveChain(env)` that tests call directly.
- *Effort:* 0.5 ed. *Timeline:* Week 2.

### 2.3 Detail — Performance

**PERF-01 — 9,667-LOC generated `abis.ts`.**
- *Impact:* adds ~0.5–1 s to `tsc` and to serverless cold start (module parse). Low severity.
- *Fix:* emit only the ABI fragments actually used, or load per-registry ABIs lazily (`await import()`); or move to JSON + `as const` codegen with tree-shaking. *Effort:* 1 ed.

**PERF-02 — Cold start & `/plan` latency.**
- *Measured:* serverless first request 1–2 s; `/plan` p50 28–123 ms, p95 43–337 ms @ 50–2,000 assets.
- *Fix:* keep the Fastify instance warm (Vercel `maxDuration` already 60); pre-warm planner on deploy; cache planner results keyed by CBOM hash; stream large plans. *Effort:* 3 ed.

**PERF-03 — 81 MB of video in `public/media/`.**
- *Impact:* repo bloat, slow CI clones, potential LCP interference if not lazy.
- *Fix:* move to a CDN/object store (Vercel Blob / S3), keep only posters in-repo, `preload="none"` + `loading="lazy"`; add a `poster` attribute. *Effort:* 1 ed.

### 2.4 Detail — Security

**Correction (2026-10-24, verified):** the security CI is far stronger than an earlier draft of this document credited. `security.yml` already runs **Slither, Semgrep, CodeQL, pip-audit, gitleaks, a dev-key-guard, and model-integrity**; `invariant-fuzz.yml` runs nightly Foundry invariant fuzzing; `halmos.yml` runs symbolic execution. Twelve workflow files total. The claims below replace the earlier (wrong) "no secret scanning / no Slither" entries.

**SEC-01 — wallet-stack CVEs: FIXED.** All 21 "high" were a *single* `zod` DoS advisory (GHSA-mrhx-c7xc-m3w5, `zod < 4.6.6`) propagated across 21 packages. Fixed with `"overrides": { "zod": "^4.6.6" }` in `frontend/package.json` (installed 4.6.7). Verified: `npm audit --omit=dev --audit-level=high` → **0 vulnerabilities, exit 0**; `next build` → success; frontend **150/150** tests pass.

**SEC-03 — Browser-held operator key (TD-08).** *Impact:* an XSS that reaches the operator key can sign privileged writes. Mitigations exist (CSP, server-side proxy). *Fix:* offer a hardware-wallet / WalletConnect signing path for operator actions; keep the server key only for `public-compute` routes. *Effort:* 3 ed.

**SEC-05 — No UUPS storage-layout diff on upgrade (real gap).** Contracts are UUPS-upgradeable; an upgrade that reorders storage corrupts state, and nothing in CI checks it. *Fix:* `forge inspect <Contract> storageLayout` snapshot committed + a CI step that diffs it on any `src/` change. *Effort:* 0.5 ed. This is the one genuine contract-CI gap.

### 2.5 Detail — Code quality

**QUAL-01 — 27 `any`.** *Fix:* replace boundary `any` with `unknown` + narrowing or zod schemas (the `vercel-react-best-practices` skill covers this). *Effort:* 1 ed.

**QUAL-02 — Low coverage on `qtrust_ai` (42 modules, ~1 test file).** *Fix:* add property-based tests (`property-based-testing` / Hypothesis) for the risk-decay heuristic invariants and the REINFORCE determinism; mark research modules with a coverage floor. *Effort:* 3 ed.

### 2.6 Detail — Architecture

**ARCH-01 — Off-box scanner/planner over quick tunnels (no SLA).** *Impact:* the hosted API 503s when the local machine sleeps — the single biggest reliability risk for a "live" demo/prod. *Fix:* containerize scanner+planner and deploy to a managed host (Fly.io / Render paid / Cloud Run); or move the scanner into the backend as a worker. *Effort:* 5–8 ed. *This is the #1 architectural risk.*

**ARCH-02 — `qtrust_ai` off the served path.** *Decision:* either (a) wire the genuinely useful modules (risk, cost, interop) into `planner/` and delete the rest, or (b) mark the whole package `experimental/` and stop counting it as product. *Effort:* 2 ed (decision + prune).

**ARCH-03 — Single-writer indexer.** *Impact:* no horizontal scale; reorg handling is per-process. *Fix:* leader-election (Postgres advisory lock) + idempotent upserts; later, a queue. *Effort:* 5 ed.

### 2.7 Detail — Technical debt

**TD-02 — Contract CI is comprehensive; the real gaps are mutation testing and storage-layout diff.** *Correction:* CI already gates Playwright (6 specs), forge (`forge test`, 213), `qtrust_ai`, and — via `security.yml`/`invariant-fuzz.yml`/`halmos.yml` — Slither, Semgrep, CodeQL, pip-audit, gitleaks, dev-key-guard, model-integrity, nightly invariant fuzzing, and Halmos symbolic execution. **Verified absent:** mutation testing (no stryker/mutmut) and a UUPS storage-layout diff. *Fix:* add `stryker` (frontend `src/lib`) + `mutmut` (inspector critical paths) on a weekly schedule, and the storage-layout snapshot/diff from SEC-05. *Effort:* 2 ed.

**TD-02b — Stale scorecard numbers.** `forge 213` and `Playwright 43` are date-stamped 2026-09-12 and were not re-measured in the 2026-10-23 reconciliation. *Fix:* re-run both (CI does) and update, or keep the date-stamp explicit. *Effort:* 0.5 ed.

**TD-03 — No mutation testing.** *Fix:* `stryker` on `frontend/src/lib` + `mutmut` on `inspector` critical paths, weekly. *Effort:* 2 ed.

**TD-04 — Dual docs (mkdocs + docs-v2).** *Fix:* execute the `MIGRATION.md` runbook or freeze docs-v2. *Effort:* 2 ed.

**TD-05 — Scorecard historical claims.** *Fix:* re-run forge + Playwright and update, or explicitly date-stamp as "last measured". *Effort:* 0.5 ed.

---

## 3. Enhancements & Modifications

| Component | Enhancement | Implementation approach | Benefit | Trade-off |
|---|---|---|---|---|
| `scanner-dashboard.tsx` | Split into 8 tab components + `useScannerState` | Move each tab's JSX into `components/scanner/tabs/*`; lift state to a reducer hook; keep audit-required labels/table | 1,943 → ~300 LOC shell; parallel a11y audits; faster HMR | 4 ed; risk of behaviour drift (cover with existing tests) |
| Design system | Token layer + lint gate | Semantic tokens in `globals.css`; codemod 682 classes; `scripts/lint-tokens.mjs` in CI | Theme-consistent, dark-mode-safe, prevents drift | 3 ed; visual QA needed per page |
| `backend/src/lib/abis.ts` | Lazy/per-registry ABI loading | Split into `abis/{asset,vendor,...}.ts`; `await import()` in route handlers | Faster cold start, smaller bundle | 1 ed |
| `config.ts` (frontend) | Pure `deriveChain(env)` + injected env | Extract derivation; unit-test the pure function | Kills the flake; testable | 0.5 ed |
| Planner | **Labelling-study harness** | Implement the paper's Table IX: sample estates, request pairwise labels, measure τ_b lift per label under greedy-bisect vs random | Turns parity into measurable lift; the real ML moat | 2–3 wk; needs label budget |
| Contracts | **Certification API + offline bundle** | `/v1/certify` → signed bundle (EIP-712 + Merkle proof); `qtrust verify-bundle` CLI | Auditor-verifiable offline; productizes the moat | 5–8 ed |
| Inspector | Property-based tests for the evidence chain + parser | Hypothesis strategies for CBOM round-trip, chain tamper detection (Trail of Bits lens) | Catches edge cases regex tests miss | 3 ed |
| Indexer | Leader-election + idempotent upserts | Postgres `pg_advisory_lock`; `ON CONFLICT DO NOTHING` | Horizontal scale, safe restarts | 5 ed |
| `qtrust_ai` | Prune to served modules or mark experimental | Move useful risk/cost/interop into `planner/`; `experimental/` the rest | Removes 19.5k LOC of drag | 2 ed; may delete useful research |
| Frontend perf | CDN video + `preload="none"` + poster | Upload to Vercel Blob; update `demo-section.tsx` | −81 MB repo, better LCP | 1 ed; external dependency |

---

## 4. Advanced Features

| Feature | What it does | Why it's advanced / differentiating | Effort | Risk |
|---|---|---|---|---|
| **Validity-gated certification** | API refuses to certify a ranking whose τ_b is within ε of its ceiling; emits a `non-discriminating` signal | Novel control from the paper; no competitor gates on *evaluation validity*. Patentable (Claim A) | 5–8 ed | Low |
| **Verifiable computation for planner output** | Commit to the plan (hash) and optionally prove the optimizer ran within constraints (zk-SNARK over a small MILP, or a signed TEE attestation) | "Trustless migration planning" — a category no one owns | 4–6 wk | High (zk over MILP is hard; start with TEE + signed transcript) |
| **CRQC-timeline Monte-Carlo** | Model "harvest-now-decrypt-later" exposure against a distribution of cryptographically-relevant quantum computer arrival dates; output $ at-risk per year | Turns a static risk score into a financial time-series the CFO understands | 2 wk | Low |
| **Crypto-agility score (per asset)** | Measure how *swappable* an algorithm is (abstraction layer present? config-driven? test coverage?) — not just "is it PQC" | Predicts migration *cost*, which is the real budget blocker | 2 wk | Medium |
| **Federated benchmarking** | Multiple orgs contribute CBOM statistics (not raw data) to a shared benchmark via differential privacy | Solves the "no labels" problem without leaking; network effect moat | 4–6 wk | High (privacy engineering) |
| **LLM remediation copilot with guardrails** | Explains *why* an asset is critical and drafts a migration PR; never decides, only explains + drafts; every claim cites structured evidence | Differentiates from "LLM chatbot" competitors by grounding + refusal | 3 wk | Medium (hallucination; needs evidence-binding) |
| **Merkle-proof revocation SDK** | `isRevoked(id)` returns one bit + a proof, revealing nothing else | Privacy-preserving compliance check; already have the contract primitive | 1 wk | Low |
| **Signed attestation bundle + offline verifier** | `qtrust verify-bundle` checks a signed JSON offline | The actual auditor workflow; no account needed | 3–5 ed | Low |

---

## 5. New Additions (modules / integrations)

| Addition | Type | Value | Effort |
|---|---|---|---|
| **GitHub Action `qtrust-scan`** | CI integration | Block merges that introduce new RSA/ECDSA; post a PR comment with findings | 3 ed |
| **Terraform provider** (`terraform-provider-qtrust`) | IaC integration | Declare "this KMS key must be ML-KEM" and have Q-Trust verify drift | 2 wk |
| **Kubernetes admission controller** | Runtime guard | Reject pods mounting non-PQC TLS secrets (opt-in) | 2 wk |
| **ServiceNow / Jira connector** | Workflow integration | Auto-create remediation tickets from findings; sync status back | 1 wk |
| **Slack / Teams app** | Notification | Daily migration digest + one-click "open in Q-Trust" | 3 ed |
| **SIEM/SOAR export** (Splunk/Sentinel) | Data integration | Stream attestation + risk events to the SOC | 1 wk |
| **Cloud posture connectors** (AWS KMS/ACM, Azure Key Vault, GCP KMS) | Discovery | Enumerate managed keys + their algorithms; flag non-PQC | 2–3 wk |
| **Venafi / EJBCA connector** | PKI integration | Read certificate inventory; propose PQC re-issuance | 2 wk |
| **OpenTelemetry exporter** | Observability | Trace scanner→planner→attestation spans | 3 ed |
| **CBOM registry sync** (CycloneDX / Dependency-Track) | Interop | Push/pull CBOMs to existing SCA tools | 1 wk |
| **GraphQL API** (alongside REST) | API | Flexible dashboard queries; reduces over-fetching | 2 wk |
| **`qtrust-cli`** (npm + pip) | DX | `qtrust scan .`, `qtrust verify <id>`, `qtrust certify` | 1 wk |
| **Sector assurance packs** (CNSA 2.0, PCI 4.0, DORA, FedRAMP) | Content IP | Machine-checkable control crosswalks | 4–6 ed each |
| **Public benchmark leaderboard** | Trust/SEO | Reproducible CryptoAPI-Bench + 42-CBOM results | 1 wk |
| **Status page + SLO dashboard** | Reliability | Public uptime + error budget (pairs with ARCH-01 fix) | 3 ed |

---

## 6. Verification & Testing Strategy

### 6.1 Current state (measured)
- Backend vitest **118**; frontend vitest **150** (19 files); inspector pytest **242 + 7 skip**; planner pytest **76 + 49 skip**; forge **213** (CI-gated; not re-run locally 2026-10-23); Playwright **43 + 1 skip** (CI-gated, 6 specs; not re-run locally 2026-10-23); `qtrust_ai` **2 test files** (CI-gated).
- CI gates present (12 workflows): `contracts` (forge), `playwright` (6 specs), `qtrust-ai`, `property-tests`, `backend`, `frontend`, `inspector`, `planner`, `lint`, `metric-consistency`, `abi-drift`, `golive-preflight`, plus `security.yml` (slither/semgrep/codeql/pip-audit/gitleaks/dev-key-guard/model-integrity), `invariant-fuzz.yml` (nightly), `halmos.yml` (symbolic).
- Gaps: **no mutation testing** (stryker/mutmut), **no UUPS storage-layout diff**, thin coverage on `qtrust_ai` (2 files / 44 modules).

### 6.2 Target test pyramid

| Layer | Tool | What to test | Gate |
|---|---|---|---|
| Unit | vitest / pytest | Pure functions, reducers, `deriveChain`, token helpers | every PR |
| Property-based | Hypothesis (py) / fast-check (ts) | Evidence-chain tamper detection, CBOM round-trip, planner ordering invariants, τ_b identity | every PR |
| Contract | forge unit + **invariant/fuzz** (`echidna`, `forge fuzz`) | Access control, upgrade safety, revocation proofs, reentrancy | every PR |
| Integration | vitest + supertest | backend routes, planner proxy 4xx→422/5xx→503, indexer idempotency | every PR |
| E2E | Playwright | 8 scanner tabs, wallet connect/switch/disconnect, `/v/[id]`, `/research` | every PR (with identity guard) |
| Visual | Playwright screenshots | design-token regression across 3 widths | nightly |
| Performance | k6 / autocannon | `/plan` p95 < 350 ms @ 2k assets; cold start < 2 s | weekly |
| Security | Slither + Aderyn + Echidna + `npm audit` + gitleaks + Semgrep | contracts, deps, secrets, SAST | every PR |
| A11y | axe (Playwright) | WCAG 2.1 AA, serious/critical = 0 | every PR |
| Chaos | toxiproxy | RPC failure, DB loss, planner timeout → graceful 503 | monthly |
| UAT | scripted scenarios | "CISO exports an attestation and verifies it offline" | per release |

### 6.3 Verification commands (canonical)
```bash
# frontend
cd frontend && npx tsc --noEmit && npx vitest run && npx next build
# backend
cd backend && npx tsc -p tsconfig.json --noEmit && npx vitest run
# python
python -m pytest inspector/tests planner/tests -q
# contracts
cd contracts && forge test -vvv && slither . --sarif results.sarif
# gates
python scripts/verify_metric_consistency.py
```

### 6.4 Definition of done (per change)
1. Unit + (where relevant) property test added. 2. `tsc`/`ruff`/`mypy` clean. 3. CI green incl. the security gates. 4. If UI: axe serious/critical = 0 + no token-lint violations. 5. If contract: invariant test + storage-layout diff. 6. Docs/scorecard updated with measured numbers.

---

## 7. Beyond the requested categories

### 7.1 IP strategy (already drafted — keep it tight)
- **Patentable:** (A) validity-gated certification, (B) tie-aware labelling scheduler (Theorem 3: label the biggest tied clusters), (C) Merkle-proof revocation attestation fabric.
- **Not patentable (disclose):** the τ_b ceiling theorem (abstract math, *Alice*/*Mayo*).
- **Next step:** file the provisional (18 claims drafted) with counsel; 12-month PCT clock.

### 7.2 Monetization (already modelled — validate it)
- SKUs: $15–40k assurance report / $60–250k certification / $250k–1M OEM.
- COGS is labelling, not compute (88–99% GM at scale).
- **The one thing to validate:** will an enterprise pay for *verifiable* certification vs a PDF report? Run 5 design-partner interviews before building more.

### 7.3 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Local-tunnel architecture fails during a demo/sale | High | High | ARCH-01 managed hosting |
| GNN "parity" becomes a public credibility hit | Medium | High | Never claim accuracy superiority; ship the labelling study |
| Wallet CVE flagged in a security review | High | Medium | BUG-01 upgrade now |
| Patent rejected under §101 | Medium | Medium | Lean on Claims A/B/C (machine actions), not the theorem |
| Competitor ships certification first | Medium | High | Move fast on S1/S2 (offline bundle + certify API) |
| No paying design partner | Medium | High | 5 interviews before more build |

### 7.4 90-day execution plan

| Weeks | Focus | Deliverables |
|---|---|---|
| 1 | Security + hygiene | BUG-01/SEC-01 wallet upgrade; SEC-02 gitleaks; TD-02 CI gates (Playwright+forge); scorecard date-stamps |
| 2 | Design system + contracts CI | DS-01 tokens + `lint-tokens`; BUG-02/03 codemod; SEC-04 Slither/Echidna; BUG-05 flake |
| 3 | Monolith split + product wedge | BUG-04 tab split; S1 offline attestation bundle; PERF-03 video CDN |
| 4 | Reliability + perf | ARCH-01 managed scanner/planner; PERF-01/02; QUAL-01 `any` cleanup |
| 5–6 | Certification product | S2 `/v1/certify` + validity gating; S6 revocation SDK; sector pack #1 (CNSA 2.0) |
| 7–9 | ML moat | S4 labelling-study harness; first lift numbers |
| 10–12 | GTM proof | S5 public leaderboard; 5 design-partner interviews; provisional patent filed |

### 7.5 Success metrics (KPIs)

| Metric | Now | 90-day target |
|---|---|---|
| High npm vulns (prod deps) | 21 | 0 |
| Raw palette classes | 682 | < 40 |
| Largest frontend file (LOC) | 1,943 | < 500 |
| Test count (unit/integration) | 586 pass (118 be + 150 fe + 242 insp + 76 planner) | > 700 pass |
| Contract fuzz/invariant tests | 0 | > 20 |
| `/plan` p95 @ 2k assets | 337 ms | < 250 ms |
| Time-to-verify an attestation (auditor) | n/a (account needed) | < 60 s offline |
| Design partners | 0 | 5 |
| GNN lift over heuristic (τ_b) | −0.004 (parity) | > +0.02 after labelling |

---

## Appendix A — Measured metrics (2026-10-24)

| Signal | Value |
|---|---|
| Total LOC (6 subsystems) | ~72,857 |
| TODO/FIXME/HACK | 3 |
| TS `any` | 27 |
| Frontend npm audit | 21 high / 0 critical (wallet stack) |
| Backend npm audit | 0 |
| Raw palette classes | 682 (148 in `scanner-dashboard.tsx`) |
| `transition: all` / `100vw` / size-animations | 0 / 0 / 0 |
| `focus-visible` / `prefers-reduced-motion` | 77 / 10 |
| Largest non-generated file | `scanner-dashboard.tsx` 1,943 LOC |
| Generated files | `abis.ts` 9,667; `api-schema.ts` 2,161 |
| Contracts | 11 UUPS, 3,515 LOC, 213 forge tests |

## Appendix B — Skills applied to produce this analysis

See `SKILLS_INTEGRATION.md`. The audits in §2/§3 draw on: **impeccable** (audit/critique/harden), **hallmark** (Floor rules 1–16), **design-taste-frontend** (anti-slop house style), **emil-design-eng** + **mobile-native** (motion/touch), **solidity-security** (SEC-04/05), **property-based-testing** (QUAL-02), **vercel-react-best-practices** (QUAL-01/PERF), **supabase-postgres-best-practices** (ARCH-03).

---

*This document is a working roadmap, not a claim of completeness. Every number above was measured on the working tree on 2026-10-24; where a figure is inherited from an earlier run it is date-stamped. Nothing here should be cited externally without re-measuring.*

---

## 8. Implementation addendum — certification, assurance, ML v4 (2026-10-24, session 2)

This section records what was **built and measured** after the initial audit, and
updates the catalog in §2 rather than repeating it. It follows the same six
categories so the plan stays comparable.

### 8.1 Delivered (verified on the working tree)

| Capability | What it does | Verification |
|---|---|---|
| **Certification bundles** (`backend/src/services/certification.ts`, `routes/certify.ts`) | Policy-gated snapshot of assets/migrations/attestations/audit; per-record SHA-256, sorted-pair Merkle root, Ed25519Signature2020 proof, validity window, optional chain re-anchor; refuses (409) rather than signs unsupportable claims | 18 service tests + 8 route tests + 6 fixture-contract tests |
| **Offline verifiers** (`backend/scripts/verify-certification.ts`, `sdk/qtrust/bundle.py`) | Fail-closed verification in TypeScript and Python with exit codes 0/1/2; same committed fixture verifies byte-for-byte in both languages | Python 12 tests + 7 Hypothesis properties; TS fixture suite |
| **Assurance bridge** (`backend/scripts/run_assurance.py`, `services/assurance.ts`, `routes/assurance.ts`) | One API (`POST /v1/assurance/report`) exposing crypto-agility grading, CRQC/HNDL Monte-Carlo exposure, and five sector packs; strict input contract, 2,000-finding cap, 60 s timeout, 32 MB stdout cap, `input_digest` | 4 route tests + 19 inspector advanced-risk tests |
| **Sector packs** (`inspector/.../assurance_packs.py`) | CNSA 2.0, PCI DSS 4.0, DORA, HIPAA, FedRAMP Rev. 5; undecidable controls report `MANUAL`, never a false pass | Pack tests in `test_advanced_risk.py` |
| **Proxy integration** (`frontend/src/lib/api-route-policy.ts`) | Issuance is `operator` (platform-identity signature), verification and policy catalogue are public; contract test classifies every UI endpoint | 9 policy tests; full frontend suite 151 |
| **Contract & docs** | OpenAPI (56 paths), `docs/api.md`, `docs/CERTIFICATION_AND_ASSURANCE.md`, README capabilities + 2-minute flow, mkdocs nav | YAML parsed; mkdocs nav updated |
| **CI gates** | Backend regenerates the TS fixture and fails on byte drift (`git diff --exit-code`); Hypothesis bundle-properties job added | `.github/workflows/ci.yml` |

**Measured suites after the changes:** backend **154/154** (18 files), frontend
**151/151** (19 files), SDK `pytest` exit 0 (incl. 12 bundle + 7 property tests),
inspector advanced-risk **19/19**, `tsc` clean (backend + frontend). Offline
verification of the 5-leaf fixture measured **p50 4.21 ms / p95 7.29 ms /
~218 ops/s** (`npm run certify:bench`, Node 24, under CPU load) — cheap enough
for a request path or a CI gate.

### 8.2 Strategic impact (why this is the moat, not another dashboard)

- A bundle is **portable evidence**, not a screenshot: the records travel with
  it, so a customer, auditor or regulator can verify without access to Q-Trust's
  database. This directly answers the "why not just CycloneDX + a spreadsheet?"
  objection.
- **Policy gating is the product**: `default → regulated → strict` turns
  assurance into a repeatable admission decision, and refusal is a feature
  (no signed overclaim).
- **Cross-language verification** removes the single-vendor trust problem that
  blocks procurement: the Python SDK is the reference independent verifier.
- Agility/CRQC/packs give three buyer-specific narratives (engineering, finance,
  compliance) on top of the same CBOM, increasing value per scan.

### 8.3 Issue catalog deltas

| ID | Status | Severity | Priority | Effort | Dependencies | Timeline |
|---|---|---|---|---|---|---|
| NEW-01 inconsistent assurance claims across services | **Fixed** — one issued bundle, one verifier contract, one fixture | High | P0 | 3 d | — | done |
| NEW-02 offline trust gap (server-only verification) | **Fixed** — TS + Python CLIs, fail-closed | High | P0 | 2 d | Ed25519 libs | done |
| NEW-03 one-sided canonicalisation drift | **Fixed** — CI regenerates fixture and diffs bytes; Hypothesis fuzzing | High | P0 | 1 d | CI | done |
| NEW-04 assurance logic duplicated in TS | **Fixed** — Python bridge is the single implementation | Medium | P1 | 2 d | Python runtime on backend host | done |
| NEW-05 bridge resource abuse | **Mitigated** — 30/min, 2,000 findings, 60 s timeout, 32 MB cap | High | P1 | 0.5 d | — | done |
| NEW-06 issuer-key rotation/revocation procedure | **Open** — verification supports a pinned trust anchor, but rotation needs an operational runbook | Medium | P2 | 2 d | Ops decision | 30 d |
| NEW-07 bundles may contain sensitive asset metadata | **Open** — evidence is embedded by design; need a redaction policy/field allowlist | Medium | P2 | 3 d | Legal/product | 60 d |
| NEW-08 assurance endpoint depends on local Python | **Open** — acceptable for single-host deploy; containerize the bridge for horizontal scale | Low | P3 | 2 d | Docker | 90 d |
| ML-V4 | **In progress** — resumable CPU retrain (14,933 × 3 @ 256); result recorded in `EXPERIMENTS.md` E-14 only if measured | — | P1 | — | training time | this session |

### 8.4 New trade-offs introduced (explicit)

1. **Embedded evidence vs privacy.** Bundles are self-contained and therefore
   larger and potentially sensitive. A field allowlist/redaction policy is the
   next hardening step (NEW-07).
2. **Signature scope.** The proof attests what the platform observed at issuance;
   it does not make vendor claims true. Docs state this and include evidence URIs.
3. **Operator gating for issuance.** Anonymous visitors cannot mint platform-signed
   claims; public verification remains open. This is intentional and tested.
4. **Bridge process model.** Spawning Python per request isolates the rule engine
   but adds latency and a runtime dependency; acceptable at 30/min, revisit at scale.

### 8.5 Verification & testing strategy (delta)

- **Contract tests** now cover every public/operator classification the UI uses,
  including the new endpoints (proxy cannot silently 403 them).
- **Cross-language fixture** is a CI-enforced contract, not a demo artifact.
- **Property-based tests** assert that *any* mutation outside `proof` invalidates a
  bundle and that the verifier never raises on arbitrary JSON — the two failure
  modes that matter for a fail-closed verifier.
- **Still missing:** mutation testing (Stryker) for the certification service,
  load test for `/v1/assurance/report`, and a browser E2E that exercises issuance
  with an operator key. Effort 3–5 d; recommended next sprint.

### 8.6 Honest bottom line

The certification + assurance layer is now a real, tested product surface with
independent verification — the strongest differentiator in the repository. The
remaining credibility gaps are operational (key rotation, redaction, bridge
scaling) and evidentiary (the detector must still be re-measured on the harder
v4 split; no improvement is claimed until the same-eval artifact exists).

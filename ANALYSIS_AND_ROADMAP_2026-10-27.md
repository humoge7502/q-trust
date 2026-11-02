# Q-Trust — Comprehensive Analysis & Roadmap (2026-10-27)

Status snapshot: detector clean held-out **F1 0.9205** (de-duplicated pinned split at the
E-16-selected 0.50 gate; 0.9235 native — E-14/E-15/E-16); planner outcome-LOO ratio
**1.0000 vs heuristic 1.0473** (E-09, Wilcoxon p=1.7e-08); 13 open CodeQL alerts
addressed this session (8 fixed in code, 5 dismissed with written justifications);
production promotion in flight via PR #133; live at https://q-trust-nu.vercel.app.

Every claim in this document follows the repo's honesty conventions: figures trace to
artifacts pinned by `scripts/verify_metric_consistency.py`, and anything not yet
measured is labeled as such.

---

## 1. Project Analysis & Strategic Opportunities

### Where Q-Trust actually wins (verified differentiators)

1. **Evidence-native compliance (the wedge).** OMB M-26-15 (June 2026) + Executive
   Order 14409 direct federal agencies to produce *phased migration plans with
   evidence*, aligned to NIST IR 8547 (still a draft; 2030 deprecation / 2035
   disallowance). No commercial vendor ships tamper-evident, chain-anchored evidence
   of a migration plan's execution. Q-Trust's certification fabric (validity-gated
   Ed25519 bundles, Merkle-proof revocation, EIP-712 gasless anchoring on Base) is
   the only productized answer in the survey landscape (IBM Quantum Safe, Keyfactor,
   SandboxAQ, CryptoNext, CBOM Secure all stop at inventory + reporting).
2. **Self-serve migration sequencing.** The market's biggest gap (only IBM QSMO does
   it, consulting-locked). Q-Trust's planner is measured where it matters —
   outcome-based quantum-risk-days (E-09) — and the API
   (`POST /v1/plan/objective`, exact DP ≤14 assets) makes it embeddable rather than
   a consulting engagement.
3. **Honesty as a moat.** TRUTH_AUDIT + metric gate + published negatives
   (E-06 tie, E-13, E-17 series) are unusually strong procurement artifacts for a
   domain (federal/compliance) where vendor claims are audited. The paper's
   labelling-efficiency theorem and tie-aware evaluation are citable IP.
4. **Private-by-default scanning.** Hash-only attestation model + browser WASM
   inference (the HF Space runs the int8 ONNX detector in-page) — no competitor in
   the 2026 survey offers a "scan without sending code anywhere" path.

### Fresh market signals (checked 2026-10-27)

- IBM's quantum-readiness survey (via QDay Summit field report, Jun 2026):
  **62% of organizations expect vendors to handle PQC migration** — i.e. the buyer
  is the *vendor*, not just the end enterprise. OEM/SKU distribution (already priced
  in BUSINESS_MODEL.md from $250k/yr) is the channel this implies; a partner-facing
  "embed the planner in your managed service" narrative is under-told.
- The 2026 cryptographic-inventory vendor comparisons (Encryption Consulting,
  QuantumSequrity surveys) evaluate *inventory depth only* — nobody benchmarks
  migration *sequencing quality* or *evidence*. Q-Trust can define the benchmark
  category (publish the QRD simulator spec + the corpus as the eval) and become the
  measuring stick.
- Strategic implication: the nearest-term wedge is **federal-adjacent primes and
  their vendors** (M-26-15 compliance), not enterprises at large.

### Measurable improvements to pursue (highest leverage first)

| Opportunity | Metric to move | Why it differentiates |
|---|---|---|
| Label-quality program (regex → reviewed labels) | Detector clean F1 beyond 0.9205 (bounded today by regex-label noise, E-14c/E-17 lesson) | Higher recall on real estates = fewer missed crypto assets in the deliverable |
| Per-asset feature attribution for GNN ordering | "Why this order?" explainability coverage (100% of plans) | No competitor explains the ordering; attribution makes the planner auditable |
| Near-duplicate (fuzzy) scan beyond exact hashes | Recall on forked/vendored crypto code | Real estates are full of copied code; exact-hash only is a documented gap |
| SARIF findings surfaced in README/CI recipes | Adoption surface | SARIF export + upload-sarif wiring already ship (inspector `--sarif`, cbom-action) — the gap is discoverability, now fixed in the README hero |
| Public telemetry data asset | Inbound trust/SEO + benchmark authority | The research recommendation still open; makes Q-Trust the reference dataset |

---

## 2. Issues & Required Fixes (catalog)

Severities: Critical = blocks production/claims integrity; High = user/security
impact; Medium = quality/velocity; Low = hygiene. Effort in focused hours.

| # | Issue | Severity | Priority | Effort | Dependencies | Timeline |
|---|---|---|---|---|---|---|
| I-1 | **Production stale**: `main` (late-Sept) lacked /pricing, /evidence, /certify, command palette, v4 artifacts. Fix: PR #133 (launch-video → main) — merge this week | Critical | P0 | 0 (PR open) | CI green on PR head | 2026-10-27/28 |
| I-2 | **CodeQL alerts (13)**: path-injection (backend scanner route), stack-trace exposure (`/health` + `/plan` returned exception text + absolute server paths), API-key compare hash weakness, TLS version floors. 8 fixed in code (commits 3db7fc7, c7b1778), 5 dismissed with justifications (TLS probers, CLI-only flows, stale) | High | P0 | done this session | CodeQL re-analysis on PR head | verify 2026-10-27 |
| I-3 | **E2E gate failed deterministically in CI** (wallet-gated a11y): dev-server cold compile of /dashboard + /vendors exceeded budgets; Reown remote-config 403 loop (placeholder project ID). Fixes: e2e/global-setup.ts pre-warms all routes before tests; webServer forces empty WalletConnect ID | High | P0 | done this session | CI re-run on PR head | verify 2026-10-27 |
| I-4 | **Detector label noise** — regex-derived labels are the binding constraint on F1 (E-14c/E-15 residual: 22 conflicting-label keys in clean eval). NOT a bug; the ceiling | High | P1 | 3–5 d for a reviewed-label pilot (500–1,000 files, dual-annotator on conflicts) | annotation tooling; E-18 result | Nov 2026 |
| I-5 | **TD-01: scanner-dashboard.tsx ~1,950 lines** — maintainability drag on the flagship UI; every craft pass risks regressions in one file | Medium | P1 | 6–10 h | none | this session / this week |
| I-6 | **Backend flaky under machine load**: first vitest run showed 5 transient failures (passed 306/306 on two subsequent full runs). Symptom of shared-resource contention, not product code | Medium | P2 | 2–4 h (isolate port/RPC-dependent specs; add retry policy documentation) | none | Nov 2026 |
| I-7 | **TD-08: operator key browser-held** — accepted risk (documented); real fix is a signing relay with session-bound credentials | Medium | P2 | 3–5 d | backend relay design | Q1 2027 |
| I-8 | **R-01: no external contract audit** — 11 UUPS contracts carry "external audit pending". Pashov pre-pass cached and recommended | High | P1 | 1 d prep + external engagement | budget/engagement | Nov–Dec 2026 |
| I-9 | **Mutation testing absent** for frontend TS (backend has a Stryker gate) | Low | P3 | 1 d + CI budget | CI minutes | Dec 2026 |
| I-10 | **Concurrent-session write hazards**: two agent sessions editing the same working tree overwrote each other's in-flight fixes (recovered this session). Process fix: per-session `git worktree`s + commit early | Medium | P1 (process) | 0.5 h convention + docs | none | immediate convention |
| I-11 | **Storage-layout baseline not seeded** (Foundry host needed for check-storage-layout.sh) | Low | P3 | 2 h | Foundry install | Dec 2026 |
| I-12 | **Central experiment tracker unused** (dvc experiments push; MLOps PARTIAL) | Low | P3 | 1 d | remote storage config | Dec 2026 |

### Deliberately NOT re-opened (with reasons — do not re-litigate without new evidence)

- **More-epochs/more-data detector retrains**: E-14b (overfit), E-14c (v5 corpus
  regression), E-17/E-17b (training-dedupe negatives), E-17c (GPU control exonerates
  environment). The binding constraint is label quality, not data volume. E-18
  (larger base model) is the one live experiment this session.
- **Toolkit rejections** (Magic UI/Aceternity/GSAP/Storybook) and the locked
  DESIGN.md system: rejections are evidence-based and on the record in SKILLS.md.
- **eslint 10 / @noble/curves 2.x / @sentry/node 11 / @types/node 26 majors**:
  breaking for zero product value today.

---

## 3. Enhancements & Modifications (per component)

1. **Frontend (scanner-dashboard.tsx, TD-01)** — decompose into per-tab modules
   (`risk-panel.tsx`, `compliance-panel.tsx`, `roadmap-panel.tsx`, `evidence-panel.tsx`,
   plus a `use-scanner-state` hook) with zero behavior change, verified by the
   existing 168-test vitest + e2e matrix. Benefit: craft/a11y passes stop risking
   unrelated regressions. Trade-off: one large mechanical PR; do it with the tab
   boundaries that already exist in the UI.
2. **Planner** — the objective API (exact DP ≤14 assets) should expose
   **why-explanations per asset** (rule fired + feature attribution) next to the
   order; the scorecard's open "per-asset feature attribution" item. Also: publish
   the QRD simulator spec alongside the OpenAPI schema so integrators can simulate
   before calling.
3. **Detector/qtrust_ai** — ship a **language-stratified report card** artifact per
   eval run (per-language P/R already computed — persist + chart it). This makes
   regressions per-language visible (the Solidity 128-len lesson) without new
   modeling. Add the reviewed-label pilot harness (dual annotation + disagreement
   queue) — the highest-value ML investment available.
4. **Inspector** — SARIF 2.1.1 output already ships (`--sarif` on scan commands,
   `generate_sarif`, tested) and cbom-action documents the upload-sarif wiring.
   Correction to an earlier draft of this analysis: this is DONE, not a gap —
   the work left is discoverability (now in the README hero) and a
   `code-scanning` recipe page in the docs.
5. **Backend** — the fail-closed startup gates are strong; next is an
   **operator-key rotation runbook** (certification open item) and rate-limit
   dashboards from the existing metrics plugin.
6. **Contracts** — before external audit (R-01): run the pashov skills pre-pass
   across the 11 UUPS contracts and pre-clear stylistic/known findings; seed the
   storage-layout baseline.
7. **HF Space** — after E-18 lands (if positive), re-export ONNX from the new
   checkpoint and keep the Space one-click fresh (the export script + Space assets
   are now in-repo).

---

## 4. Advanced Features (differentiation)

1. **Crypto gate for CI (the "Trivy moment")** — `qtrust-inspector scan-source
   --fail-on BROKEN --sarif` wired into the existing GitHub Action: a repo-level
   *policy gate* that blocks merges introducing BROKEN crypto, with the attestation
   bundle as the evidence artifact. Nobody in the 2026 survey ships a merge gate.
2. **Evidence chain timeline** — a public, verifiable page per certification bundle:
   scan → plan → attest → anchor → revoke, each step hash-linked and independently
   verifiable from /certify. Turns the fabric from a feature into a *demonstration*.
3. **Multi-objective planner** — extend `/v1/plan/objective` from QRD minimization
   to a Pareto front (risk-days vs cost vs deadline-violation), exposing the
   trade-off curve. The DP formulation supports it (lexicographic or
   ε-constraint); makes the planner a decision tool, not a ranker.
4. **Label flywheel** — every operator-confirmed finding becomes a reviewed label
   (opt-in, hash-only code snippets). Directly attacks I-4 and compounds: better
   labels → better detector → better findings → more confirmations.
5. **Sector packs 2.0** — the five existing packs (CNSA 2.0, PCI DSS 4.0, DORA,
   HIPAA, FedRAMP Rev 5) extend with EU CRA and NIS2 mappings — the 2026–2027 EU
   regulatory wave is the second demand driver after M-26-15.
6. **Threat-intel feed** — the agent-search pattern (evaluated, not integrated —
   needs a key) points at one future integration: daily PQC-advisory ingestion
   (CVEs affecting crypto libs) joined to CBOM inventory → "your scanned repos
   reference a CVE'd crypto path" alerts.

## 5. New Additions (practical)

1. **GitHub App wrapper around cbom-action** — PR comments with the crypto
   inventory diff ("+2 RSA-2048 instances in this PR"). Lower friction than CI
   YAML for adopters (SARIF export itself already ships).
2. **Public telemetry data asset** — publish the anonymized scan-statistics
   aggregate (languages, algorithms, key sizes observed) as a versioned dataset +
   dashboard page. Authority-building; already recommended in the competitive
   research.
3. **GitHub App wrapper around cbom-action** — PR comments with the crypto
   inventory diff ("+2 RSA-2048 instances in this PR"). Lower friction than CI
   YAML for adopters.
4. **EAS (Ethereum Attestation Service) bridge** — export Q-Trust bundles as EAS
   attestations on Base so third parties can consume them with existing tooling.
   Interop with the attestation ecosystem, zero protocol change.
5. **planner SDK examples** — qtrust-sdk 2.3.0 ships bundle verification; add
   planner-objective + outcome-simulation recipes to the SDK quick-start.

## 6. Verification & Testing Strategy

**What exists (measured 2026-10-26/27):** backend 306 vitest; frontend 168 vitest;
planner+inspector 318 pytest (+56 optional-dep skips); Playwright 14+ specs incl.
axe a11y (desktop+mobile, populated app states) and a CWV budget gate (LCP ≤1.5s);
12 CI workflows incl. gitleaks, Semgrep, CodeQL, pip-audit, model-integrity,
invariant-fuzz (nightly), halmos (symbolic), Stryker mutation (backend), PQC
readiness scan; metric-consistency gate pinning every headline number; dvc
leakage-safe splits; checkpoint SHA-256 fail-closed verification.

**Gaps and the plan to close them:**

| Layer | Gap | Strategy |
|---|---|---|
| Unit | Backend flake under load (I-6); frontend mutation coverage (I-9) | Quarantine port/time-dependent specs behind a `@slow` tag run serially; add Stryker for the scanner-policy module first (highest logic density) |
| Integration | Contract↔indexer drift not fuzzed | Extend nightly invariant-fuzz with attestation revocation rounds against Anvil fork |
| Model | No drift/monitoring in production; per-language report cards not persisted | Persist per-language P/R per eval run; alert on any language dropping >0.05 F1 between canonical checkpoints; calibration ECE re-fit each release (already automated) |
| E2E | Cold-compile nondeterminism (fixed); no visual regression gate | Keep global-setup warm-up; consider Playwright screenshot diffs only for the hero + scanner (bounded, not whole-site) |
| Security | External contract audit pending (R-01); storage-layout baseline unseeded | Pashov pre-pass this month; seed baseline on a Foundry host (I-11) |
| Performance | Full Lighthouse not in CI (manual only) | Add Lighthouse CI to the nightly workflow with the existing CWV budgets |
| UAT | No paying customer yet (honest, on /pricing) | Design-partner pilot: 2 orgs, success = one M-26-15-shaped evidence pack produced end-to-end; instrument time-to-first-evidence as the UAT metric |
| Data | Corpus eval is repo-disjoint but not time-split | Add a temporal split (train ≤2026-Q2 sources, eval newer snapshots) to measure decay on fresh code |

---

## Beyond the categories

- **Business model** (decided + documented): Open MIT core; Validity Report
  $15–40k; Certification $60–250k/yr; OEM from $250k/yr. The honest "/pricing says
  no organisation pays yet" is an asset in procurement contexts. Nearest revenue:
  2 design partners from the M-26-15 vendor ecosystem (see §1 buyer insight).
- **Investor narrative**: lead with (a) binding-deadline market (2030/2035),
  (b) the only on-chain evidence fabric, (c) measured outcome superiority of the
  planner (E-09), (d) honesty infrastructure as procurement moat. The /evidence +
  /research pages + this repo ARE the diligence pack.
- **Ops**: document the local-stack + tunnel runbook as a first-class page
  (deploy/README.md exists; link it from /docs) so evaluators can run the full
  product locally in one command.
- **Process**: adopt per-session git worktrees for agent sessions (I-10) — this
  session recovered two overwritten fixes; the convention costs 30 minutes.

---

*Prepared 2026-10-27. Sources for the market sweep: [QDay Summit field report](https://postquantum.com/post-quantum/qday-summit-pqc-migration-field-report),
[Encryption Consulting vendor survey](https://www.encryptionconsulting.com/cryptographic-inventory-vendors),
[QuantumSequrity inventory survey](https://quantumsequrity.com/blog/crypto-inventory-tools),
[OMB M-26-15](https://www.whitehouse.gov/wp-content/uploads/2026/06/M-26-15-Execution-of-the-Migration-to-Post-Quantum-Cryptography.pdf),
[NIST IR 8547 ipd](https://csrc.nist.gov/pubs/ir/8547/ipd),
[Wiz EO 14409 analysis](https://www.wiz.io/blog/white-house-post-quantum-cryptography-executive-order).*

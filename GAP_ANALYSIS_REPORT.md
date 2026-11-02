# Q-Trust — Full Codebase Gap Analysis

**Date:** 2026-10-23 · **Scope:** entire `q-trust` repo + siblings (`q-trust-datasets`, `q-trust-codebert`)
**Method:** 5 parallel subsystem audits (contracts, ML/planner/AI, web-stack, docs/infra/data, metrics reconciliation) + direct source verification of every headline claim. Claims were checked against code, not against the project's own scorecard.

---

## 0. TL;DR — where it stands

The project is **engineering-mature** but **narrative-misaligned**. It is *not* lagging in effort or architecture. It is lagging in three specific, fixable things:

1. **A factual metric error that contradicts its own paper** (F1 0.9525 vs the corrected 0.9395) — present in 9 files and the source-of-truth artifact.
2. **The "AI intelligence layer" (`qtrust_ai`) is largely theater** — the GNN and RL are hard-coded/stub, with 1 test file for 42 modules. This is the *most over-claimed* part of the project.
3. **Documentation that is factually wrong** about the contract count and timelock, plus a stale self-assessment scorecard.

The genuinely valuable, defensible assets — the **on-chain attestation fabric**, the **validity/evaluation methodology** (the paper), and the **real datasets** — are under-leveraged, while the weakest part (stub "AI") is over-sold.

| Area | Verdict | Evidence |
|---|---|---|
| Smart contracts | **Strong** | 13 real contracts, 212 tests, testnet-deployed |
| Datasets / benchmarks / SDK | **Strong** | 1,387-file LFS corpus, real academic benchmarks, tested SDK |
| Inspector / scanner | **Strong** | GradientBoosting ensemble + ACVP vectors, real detection |
| Planner GNN (the real ML) | **Strong-but-flawed** | real PyG model, but documented BatchNorm leakage unresolved |
| Web stack (backend/frontend) | **Real, operationally hollow** | proxy shell over off-box services; on-chain unprovisioned |
| `qtrust_ai` "AI layer" | **Lagging — stubs** | GNN=hardcoded anchors, RL=random search, 1 test / 42 modules |
| Metric integrity | **Lagging — wrong numbers** | F1 0.9525 vs 0.9395 in 9 places |
| Documentation accuracy | **Lagging — wrong facts** | 9 vs 11 contracts; 2-day vs 7-day timelock; 3 docs, 3 counts |
| Self-assessment (scorecard) | **Lagging — inflated** | claims "0 FAIL"; ML "PASS" is false; predates paper + IP work |

---

## 1. What is genuinely strong — bank on this

These are the assets a reviewer, auditor, or investor should be pointed at.

- **Smart contracts (`contracts/src`, 13 files, ~3,500 LOC).** Fully implemented: UUPS + `TimelockController` governance, EIP-712 typed attestation with `chainId`+`verifyingContract` domain separators and per-signer nonces (replay protection), `nonReentrant` on state changes, governance blocks upgrade/role selectors at schedule time, and a deployment script that **renounces all deployer roles** post-deploy. **212 substantive `function test…`** across 23 files including an adversarial `Attack.t.sol` and invariant suites. A real `broadcast/` exists on **Base Sepolia (chain 84532)**. **This is production-grade Solidity.** No `TODO`/stubs in `src/`.
- **Data (`qtrust-datasets`, 1,387 files, Git-LFS).** A real medallion (`bronze/silver/gold/raw`) corpus, `real_cboms/` (finance/government/education estates), `traces_real_54`, parquet. Not toy data.
- **Benchmarks (`benchmarks/external`).** Cloned `CryptoAPI-Bench` (203 files) and `ApacheCryptoAPI-Bench` with an **honest** `HEAD-TO-HEAD.md` that explicitly states *"no superiority claim."*
- **SDK (`sdk/`).** Real, tested package (`qtrust-sdk` 2.2.0): client, DID, IPFS, trust, VC, and an on-chain E2E against anvil.
- **Inspector (`inspector/`).** Real crypto detection — a `GradientBoosting` ensemble, AST/binary/pcap scanners, ACVP test vectors. 14 substantial test files.
- **Monitoring (`ops/` + `backend/src/plugins/metrics.ts`).** Real Prometheus/Alertmanager/Grafana config mounted in `docker-compose.yml`; real `prom-client` instrumentation (`/metrics`, request histograms, `indexer_lag`, `rpc_pool`). Not templates.
- **The research methodology (the paper).** The ceiling theorem, tie-decomposition identity, metric taxonomy, and the labelling theorem are the *real* intellectual contribution — and unlike the ML, they are mathematically sound and artifact-backed (53/53 verified).

---

## 2. Where the project is lagging

### P0 — Credibility landmines (will sink a paper, an audit, or a raise)

**2.1 Metric-integrity crisis: F1 0.9525 vs the corrected 0.9395.**
`qtrust_ai/artifacts/benchmark_comparison.json:12` — the source-of-truth artifact — still reports `"f1": 0.9525`. Meanwhile `paper/REANALYSIS.md` proves the true held-out F1 is **0.9395** and that *"no threshold reaches 0.9525."* The wrong number is repeated in **9 places**: `README.md`, `EXPERIMENTS.md`, `CHANGELOG.md`, `FINAL_ENGINEERING_REPORT.md`, `PROJECT_SCORECARD.md`, `RELEASE_CHECKLIST.md`, `RISK_REGISTER.md`, `docs/DEVELOPER_ROADMAP.md`, `docs/essays/why-we-published-a-tie.md`, `cbom-action/README.md`. There is **no CI gate** that reconciles the artifact against the reanalysis, so the error is invisible to the build. A reviewer who reads the paper and the README back-to-back sees an internal contradiction **on the single most important number the project owns.** This is the highest-ROI fix in the repo.

**2.2 The "AI intelligence layer" (`qtrust_ai/`) is largely theater.**
- `qtrust_ai/graph/temporal_gnn.py:11,17,27,89` — the "GNN" is a **CPU stub** that *"reproduces the 73→61→42 anchor without requiring torch,"* blending **75% hard-coded anchors** (`anchor_t0=73, anchor_30=61, anchor_180=42`) with 15–25% "learned" weights. No graph structure is learned.
- `qtrust_ai/migration/multi_objective_rl.py:406` — the "RL" is literally commented **`# Stub REINFORCE: random-search policy head`**. It is random search, not gradient-based RL.
- **Test coverage:** `qtrust_ai/tests/` contains **one** real test file (`test_intelligence_layer.py`) for **42 modules**; its own docstring admits *"the layer shipped with zero coverage."*
- The shipped planner does **not** use `qtrust_ai` at all — it uses `planner/`'s own (real) `model_v3.py`/`rl_agent.py`. So `qtrust_ai` is a parallel, disconnected, mostly-stub silo that the marketing leans on.

**2.3 The planner GNN has a self-documented, unresolved correctness defect.**
`planner/qtrust_planner/model_v3.py:22-66` carries an **`AUDIT NOTE — BatchNorm correctness`**: under PyG batching, `BatchNorm1d` *"leaks cross-graph stats."* The shipped checkpoints (`model_gpu_v3.pt`) were trained with BatchNorm, the default is still BatchNorm, and the **promotion gate to LayerNorm is not done** (`model_v3.py:46,66`). The canonical `model.pt` **does not exist on disk** (`ls` → not found). So the headline out-of-sample LOO result (τ-b 0.7168) was produced by a model the authors themselves flag as statistically leaky. The result may still hold, but it is currently *unverifiable as clean*.

### P1 — Documentation accuracy (factually wrong)

**2.4 `docs/ARCHITECTURE.md` is wrong about the system it documents.**
- Line 9: *"All **nine** contracts"* — there are **11** (`src/` has 11 `.sol` files; `docs/adr/0003` confirms).
- Line 163: *"2-day `TimelockController`"* — the ADR and `foundry.toml`/deploy use a **7-day** timelock.

**2.5 `deploy/README.md` adds a third, different number.**
- Lines 20, 73: *"**8** UUPS proxy registries"* — there are 11. Three docs, three contract counts (9 / 8 / 11).

**2.6 `docs-v2/` is an incomplete skeleton.** Real VitePress scaffold, but `MIGRATION.md` lists WHITEPAPER, GPU_FEATURES, PERFORMANCE, 7 ADRs, runbooks, and PATENT as **unported**; `public/` hero/logo/OG images are *"intentionally not committed"* → broken assets. `docs/` (mkdocs) and `docs-v2/` are two overlapping systems (known debt TD-03) with the mkdocs one being the inaccurate one.

### P1 — Deployment / provisioning

**2.7 The on-chain layer is wired but unprovisioned in-repo.** `backend/src/config.ts:57-64` defaults every contract address to `0x0`; the only sample addresses are localhost Hardhat (`0x5FbDB…`). **No live Base-Sepolia addresses ship**, so an unconfigured deploy returns `{configured:false}` everywhere. The contract tests pass on anvil, but production on-chain write/verify is inert without manual env setup.

**2.8 The web stack is a thin proxy shell over off-box services.** `backend/src/routes/scanner.ts` shells out to a Python inspector that is **proxied, not run, on Vercel** (`server.ts:166-222` → `QTRUST_SCANNER_PROXY_URL`; down ⇒ `503`). The planner is a separate service (`routes/read.ts:121-158` → `PLANNER_URL`); down ⇒ `503`. `deploy/logs/` shows this is **real but scrappy**: Cloudflare quick tunnels, Docker restarts, an SSL *"Could not establish trust relationship"* failure, API `unhealthy` entries. Live, but no uptime guarantee and no mainnet.

### P2 — Self-assessment is inflated / stale

**2.9 `PROJECT_SCORECARD.md` claims "17 PASS, 3 PARTIAL, 0 FAIL."** This is false on its face:
- **ML "PASS"** is contradicted by §2.2 (stub GNN/RL, 1 test/42 modules) and §2.3 (BatchNorm defect).
- **F1 "PASS"** is contradicted by §2.1.
- The scorecard predates both the paper's honesty correction (2026-10-23) and the IP/patent/monetization work (also 2026-10-23), so it neither reflects the corrected metrics nor the new defensible assets.

**2.10 Test-score inflation.** Claimed 143 frontend vitest + 43 Playwright; actual counts are **104 frontend** (17 files) and **21 Playwright** (5 files). Backend's 122 cases exceed its 104 claim, so the inflation is concentrated in the UI/e2e layer. (Tests are *meaningful*, not `assert true` padding — the gap is in the headline number, not the quality.)

### P2 — Minor

**2.11 Dead components:** `frontend/src/components/tx-status.tsx` and `EvidenceVerified.tsx` have zero importers.
**2.12 `backend/vercel.json` `includeFiles: "package.json"`** only bundles `package.json`, not `dist/`/`node_modules` — fragile for the serverless function.
**2.13 Governance strictness quirk (`contracts/src/QTrustGovernance.sol:117-118,143`):** `scheduleGrantRole*` forces `account == timelock` and `schedule` blocks `grantRole` selectors, so operational roles can *never* be delegated to an EOA post-deploy — there is no human operator path without timelock scheduling. Likely intentional, but worth confirming it's the desired operating model.

---

## 3. The strategic misallocation (the big picture)

The project spends its narrative capital on **"AI / GNN / RL / multi-objective optimization"** — the part that is mostly stub (§2.2) and scientifically compromised (§2.3). Meanwhile it *under-sells* the parts that are actually defensible and rare:

- A **real, audited, testnet-deployed on-chain attestation fabric** (the genuinely patentable system asset).
- A **validity/evaluation methodology** that is mathematically novel and artifact-backed (the paper's ceiling theorem, tie-decomposition, and the labelling theorem).
- **Real, licensed-scale datasets** and a honest head-to-head benchmark.

A patent examiner, an acquirer, or a program committee will probe the AI claims first — and find anchors and random search. That single discovery can delegitimize the stronger claims by association. The fix is not to *build* more fake AI; it is to **re-narrate around assurance and validity**, demote or honestly reframe the "intelligence layer," and let the contracts + methodology + data carry the story.

> Note: the patentability and monetization packages produced this session (`docs/patent/`, `docs/business/`) already point the narrative at the right assets (validity-gated certification, the labelling scheduler, the attestation fabric). They are not yet reflected in the scorecard or README.

---

## 4. Concrete remediation plan (ordered by ROI)

| # | Action | Effort | Why |
|---|---|---|---|
| 1 | **Fix F1 0.9525 → 0.9395** in `benchmark_comparison.json` + the 9 docs; add a CI gate that diffs the artifact against `paper/REANALYSIS.md` | **Low** | Removes the single most damaging contradiction; highest ROI |
| 2 | **Resolve the planner BatchNorm defect**: promote LayerNorm, re-run LOO, ship the corrected checkpoint, or at minimum document the caveat prominently next to every LOO number | Med | Restores the one real-ML claim to defensible status |
| 3 | **Either build or reframe `qtrust_ai`**: delete/mark the stub GNN+RL as research prototypes, or implement them for real; add tests | Med–High | Stops the over-claim; aligns narrative with reality |
| 4 | **Correct `docs/ARCHITECTURE.md` (11 contracts, 7-day timelock) and `deploy/README.md` (11 registries)**; finish or retire `docs-v2` | Low | Kills the three-counts contradiction |
| 5 | **Provision real Base-Sepolia addresses** + a 1-click deploy script; document the proxy/off-box dependency honestly in README | Low–Med | Makes "deployed" actually demonstrable |
| 6 | **Reconcile `PROJECT_SCORECARD.md`**: downgrade ML to PARTIAL/honest, fold in the IP work, date it | Low | Restores trust in the governance artifacts |
| 7 | **De-duplicate docs** (fold mkdocs reference into `docs-v2` or generate one from the other) | Med | Closes TD-03; removes future drift |

---

## 5. Bottom line

This is **not** a weak or half-built project. The contracts, data, SDK, benchmarks, monitoring, scanner, and the research methodology are real and credible. The lag is **not engineering maturity — it is honesty and alignment**:

- One wrong number (F1) that contradicts its own paper.
- An "AI layer" that is stub wearing the costume of ML.
- Docs and a scorecard that describe a system slightly more impressive and slightly different from the one that exists.

Fix items **1, 3, 4** and the project stops contradicting itself. Fix **2** and the remaining ML claim becomes defensible. After that, the defensible story is genuinely strong: *a real on-chain assurance fabric + a novel validity methodology + real datasets* — which is exactly the combination the patent and monetization packages are built to exploit.

# Q-Trust — Competitive Positioning (critical, evidence-based)

**Date:** 2026-10-25
**Question answered:** *"Is each capability actually best-in-class versus competitors, or are we telling ourselves a story?"*

**Method & honesty rules**
- Q-Trust cells cite a **verified artifact** in this repo (test counts, JSON reports, measured runs).
- Competitor cells are **publicly documented capabilities as of 2026**, marked `~` where uncertain. They are **not** benchmarked head-to-head here; treat them as directional, not audited.
- Verdicts are deliberately conservative: `AHEAD` = a capability incumbents do not ship as a first-class product; `PARITY` = comparable and commodity; `BEHIND` = a gap we should close; `?` = unknown/unverified.
- **No "we beat X" accuracy claim is made** — see `benchmarks/external/HEAD-TO-HEAD.md` (usage-discovery framing, not misuse SOTA).

---

## 1. Capability matrix

| Capability | Q-Trust (evidence) | IBM Quantum Safe | SandboxAQ AQtive Guard | Keyfactor | CBOMkit (open source) | Verdict |
|---|---|---|---|---|---|---|
| Crypto asset discovery / CBOM | ✅ Python inspector, 12 languages, CycloneDX 1.6 (`inspector/`) | ✅ mature | ✅ | ~ cert-centric | ✅ | **PARITY** (commodity) |
| CycloneDX-native output | ✅ first-class (`cyclonedx` schema) | ✅ | ~ | ~ | ✅ | **PARITY** |
| Migration prioritization | ✅ GNN + MILP/CP-SAT, but **τ-b 0.7168 vs heuristic 0.7210 = parity** (E-06) | ✅ advisory | ✅ | ~ | ✗ | **PARITY** (honest: not accuracy-superior) |
| Interop / failure prediction | ✅ models + tests (`qtrust_ai/migration/`) | ~ | ~ | ✗ | ✗ | **AHEAD** (few ship this) |
| PQC readiness scoring | ✅ sector packs (CNSA 2.0, PCI-DSS 4.0, DORA, HIPAA, FedRAMP) | ✅ | ✅ | ~ | ✗ | **PARITY** (content depth TBD) |
| **Tamper-evident evidence chain** | ✅ per-record SHA-256 + sorted-pair Merkle root + Ed25519 proof (`backend/src/services/certification.ts`, 19+9 tests) | ✗ (dashboards) | ✗ | ✗ | ✗ | **AHEAD** |
| **Third-party offline verification** | ✅ TS + Python verifiers over one committed fixture, CI byte-diffs it | ✗ | ✗ | ✗ | ✗ | **AHEAD** |
| **Merkle-proof revocation** | ✅ built; buyer story thin | ✗ | ✗ | ~ PKI CRL | ✗ | **AHEAD** (needs GTM) |
| On-chain anchoring (Base L2) | ✅ 11 UUPS contracts, 213 forge tests, 7-day timelock | ✗ | ✗ | ✗ | ✗ | **AHEAD** |
| **Evaluation-validity gating** | ✅ novel control (refuse to certify below ceiling) | ✗ | ✗ | ✗ | ✗ | **AHEAD** (patentable) |
| Reproducible external benchmark | ✅ CryptoAPI-Bench + Apache, honest framing | ~ internal | ✗ | ✗ | ✗ | **AHEAD** (rare) |
| Open research artifact | ✅ 16-page paper, ceiling theorem, 53/53 claims harness | ✗ | ✗ | ✗ | ✗ | **AHEAD** |
| Privacy (hash-only) | ✅ hash-only evidence model | ~ | ~ | ~ | ~ | **PARITY/AHEAD** |
| Self-hostable / open | ✅ Docker compose, self-host | ✗ SaaS | ✗ SaaS | ✗ | ✅ | **AHEAD vs SaaS** |
| Detector accuracy (clean eval) | ✅ F1 **0.8966** digest / **0.9077** native, **0 % train overlap**, +0.24 over TF-IDF baseline (E-14) | ? | ? | ? | ? | **UNKNOWN vs them** (no shared benchmark) |

---

## 2. Where Q-Trust is genuinely ahead (defensible)

1. **The certification fabric** — validity-gated, tamper-evident, third-party-verifiable, revocation-capable attestation. No incumbent ships this as a product. This is the moat.
2. **Evaluation-validity gating** — refusing to certify a ranking whose discriminative power is below its statistical ceiling. Novel and patentable; turns a research negative into a product control.
3. **On-chain evidence anchoring** on Base L2 — verifiable, gasless (EIP-712), 7-day timelock. Hard to copy, and a real audit trail.
4. **Open, reproducible research** — the ceiling theorem + claims harness is a credibility multiplier with enterprise security buyers that closed competitors cannot match.

## 3. Where it is only at parity (do not overclaim)

- **Discovery / CBOM**: commodity. IBM, SandboxAQ, Keyfactor, CBOMkit all ship it.
- **Prioritization accuracy**: the GNN is at **parity** with the heuristic on real data (τ-b 0.7168 vs 0.7210). It is a *learned, retrainable, feature-attributable* asset — **not** a measured-accuracy win. Marketing it as "more accurate" is a credibility risk.
- **Readiness scoring**: parity on capability; the sector packs are the differentiator only if their control crosswalks are deeper than rivals'.

## 4. Where it is behind (honest gaps)

- **No clean cross-model head-to-head.** E-14 proved v1/v3 trained on 87.6 %/92.2 % of the eval files, so "v4 beats v1" is **unproven**. Fix: retrain v1 on the v4 corpus with the identical split (GPU job).
- **No external security audit** (R-01) — a procurement blocker for regulated buyers.
- **No paying design partner** — pricing and product-market fit unvalidated.
- **Browser-held operator key** (TD-08) — accepted risk, but a real UX/security trade-off.
- **Mutation testing absent**; storage-layout baseline needs a Foundry host.
- **Detector accuracy vs incumbents is unknown** — no shared benchmark exists; a misuse-discrimination head-to-head is open.

## 5. What would make it genuinely unmatched (concrete, not aspirational)

| Move | Why it creates distance | Effort |
|---|---|---|
| Ship a **signed attestation an auditor verifies offline** as the front-door demo | Nobody else offers verifiable migration proof | S (primitives exist) |
| Publish a **clean v1-vs-v4 head-to-head** on one split | Converts the leakage negative into a defensible claim | M (GPU retrain) |
| Land **1 paying regulated design partner** + a reference attestation | Turns capability into market proof | L (GTM) |
| External contract audit + FTO opinion | Unblocks enterprise procurement | L (external) |
| Sector-pack depth (control-by-control crosswalk) | Content IP competitors can't copy fast | M |
| Misuse-discrimination head-to-head vs CryptoGuard/CogniCrypt | Answers the "is it SOTA?" question honestly | M |

## 6. Bottom line

Q-Trust is **not** "best at everything" — discovery and prioritization accuracy are commodity/parity. It **is** genuinely ahead on the **assurance/certification fabric, on-chain evidence, evaluation-validity gating, and open reproducible research** — and those are the hardest things to copy. The honest path to "no one close" is to **make the certification fabric the product's front door**, prove one clean accuracy claim, and land one regulated design partner — not to claim superiority the artifacts don't yet support.

# Q-Trust — Research Landscape & What the State of the Art Could Not Do

**Date:** 2026-10-25
**Purpose:** Ground the "are we actually ahead?" question in the published literature and the
commercial landscape — and identify the specific open problems Q-Trust is positioned to solve.

**Method & honesty:** citations below are to real, located papers/products (verified by search and,
for the Zhang et al. study, by reading its abstract). Numbers are quoted only where verified. Where a
claim is directional (competitor capability), it is marked `~`.

---

## 1. The published research, and what each achieved

| Work | What it is | What it achieved | What it could NOT do |
|---|---|---|---|
| **Afrose, Rahaman, Yao — CryptoAPI-Bench** (2019) | Benchmark of 203 Java files (187 misuse, 16 secure) | First comprehensive crypto-API *misuse* benchmark; evaluated SpotBugs, CryptoGuard, CrySL, Coverity | Misuse-only; no PQC migration, no evidence/certification, no prioritization |
| **Zhang, Kabir, Xiao, Yao, Meng — "Automatic Detection of Java Cryptographic API Misuses: Are We There Yet?"** | Empirical study, 6 tools, 3 benchmarks, 200 Apache projects, 57 reports to devs | Showed **no tool is universally best**; CogniCrypt/CogniGuard/Xanitizer > SonarQube; measured real developer acceptance | **Developers REJECTED 30 reports vs accepted 9** — the paper's own conclusion is "a significant gap between SOTA tools and developers' expectations." Detection ≠ trust. |
| **Torres et al. — "Runtime Verification of Crypto APIs" (TSE 2023)** | RVSec vs CogniCrypt/CryptoGuard/CryLogger | Runtime-verification approach beats static analyzers on precision/recall on the same benchmarks | Still misuse-scoped; requires instrumented execution; no migration/assurance layer |
| **IEEE 2025 — "An AI-Assisted Framework for PQC Bill of Materials Discovery"** (doc 11732324) | AI-assisted CBOM discovery | Frames PQC migration as *first a discovery problem*; CBOM (CycloneDX 1.6) as the object model | Discovery only — no prioritization, no verifiable attestation, no revocation |
| **ScienceDirect 2025 — "A performance evaluation framework for post-quantum TLS"** | PQC-TLS perf framework | Quantifies PQC handshake/handshake-size costs | Performance only; no assurance/certification |

**The pattern:** the literature has solved *discovery* and *misuse detection* reasonably well, and
*performance measurement* of PQC. **Nobody has solved "prove, verifiably, that a migration was done
correctly — and that the evaluation behind it was statistically meaningful."** The Zhang et al. result
(30 rejections vs 9 acceptances) is the empirical proof that raw detection output is not trusted by the
people who must act on it.

---

## 2. The commercial landscape

| Product | Core offering | Gap Q-Trust targets |
|---|---|---|
| IBM Quantum Safe / CBOMkit (open source) | Code/object-code scan → CBOM; crypto-agility governance | No third-party-verifiable, revocation-capable attestation; no validity gating |
| SandboxAQ AQtive Guard `~` | Discovery + risk dashboards | Dashboard-first; no on-chain proof |
| Keyfactor `~` | PKI/CLM + crypto agility | Certificate-centric; no migration-evidence fabric |
| ExeQuantum / PQCArchitect (2025 entrants) | CBOM-driven remediation planning; "attest" marketing `~` | Planning/attestation claims are not cryptographically verifiable by a third party offline |
| CryptoGuard / CogniCrypt / CrySL (research tools) | Static misuse detection | Misuse-scoped; the Zhang et al. trust gap applies |

---

## 3. What Q-Trust does that the above could not (and the evidence)

1. **Turn detection into *verifiable* assurance.** Q-Trust's certification bundle (per-record SHA-256,
   sorted-pair Merkle root, Ed25519 proof, validity window) is verifiable offline in **both TypeScript
   and Python** over one committed fixture, CI byte-diffed (`backend/src/services/certification.ts`,
   19+9 backend tests, 12+7 Python). This directly answers the Zhang et al. "developers don't trust
   reports" gap: the report is *cryptographically checkable*, not just asserted.
2. **Gate certification on evaluation validity.** Refuse to certify a ranking whose discriminative
   power is below its statistical ceiling — a control no incumbent ships. This is the product form of
   the project's own ceiling theorem.
3. **Privacy-preserving revocation** via Merkle proofs — check revocation without revealing the list.
4. **On-chain anchoring** (11 UUPS contracts, 209 forge test functions, 7-day timelock) — an immutable audit
   trail no dashboard competitor offers.
5. **Honest, clean ML.** The v4 detector is evaluated with **0 % train/eval file overlap** (E-14,
   `eval_leakage_audit.json`): F1 **0.9205** on the de-duplicated digest eval (1,779 files; P 0.9264 /
   R 0.9146; E-15/E-16) / **0.9235** (native), +0.24 over a TF-IDF
   baseline. (The legacy hand-set 0.85 ML gate scored 0.9039/0.9077; the 0.50 gate was selected on the
   independent native split, not on the pinned eval.) Note this is **usage discovery**, a different task
   from CryptoAPI-Bench misuse detection, so no cross-task SOTA claim is made.

---

## 4. Where Q-Trust is honestly behind the literature

- **Misuse-detection rigor:** CryptoGuard/CogniCrypt/RVSec are evaluated on misuse-labeled benchmarks;
  Q-Trust's detector is *usage* discovery. A misuse-discrimination head-to-head is open
  (`benchmarks/external/HEAD-TO-HEAD.md` states this explicitly).
- **No clean cross-model accuracy claim:** v1/v3 trained on 87.6 %/92.2 % of the current eval files
  (E-14). Fix = retrain v1 on the v4 corpus with the identical split (GPU job).
- **No external security audit; no paying design partner** — the two things that convert capability
  into market trust.

---

## 5. The "what they couldn't achieve" thesis (defensible)

The literature and the market have each solved a *slice*: discovery (CBOM), misuse detection (static/
runtime analyzers), and PQC performance. The **unsolved, high-value problem** — proven unsolved by the
Zhang et al. 30-vs-9 developer-rejection result — is **making the output trustworthy and verifiable to a
third party**. Q-Trust is the only system in this landscape that couples discovery + prioritization with
a **tamper-evident, offline-verifiable, revocation-capable, validity-gated certification fabric anchored
on-chain**. That is the defensible claim — not "our detector is more accurate than theirs."

**To make it unmatched (concrete):** ship the auditor-verifiable attestation as the front door; publish
one clean accuracy claim (retrain v1 on v4); land one regulated design partner; get the external audit.

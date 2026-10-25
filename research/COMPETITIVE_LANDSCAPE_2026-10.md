# PQC Platform Competitive Landscape — research findings (2026-10-23)

Method: ~30 web searches + primary-source fetches across vendor sites, NIST/NSA/OMB
publications, and open-source repos. Key sources linked inline. Implications for
Q-Trust are marked **→**.

## 1. Commercial feature landscape

| Vendor | Flagship | Migration planning? | On-chain attestation? | AI/ML? |
|---|---|---|---|---|
| IBM | Quantum Safe Explorer (code scan), Guardium Cryptography Manager (discovery/CLM, superseded Advisor), Remediator (proxy agility), **QSMO** (Dec 2025: AI migration orchestration — **consulting-led only**) | QSMO — the only serious sequencing product, services-locked | none | marketing-grade ("AI-powered" risk scoring) |
| SandboxAQ | AQtive Guard (broadest discovery: code, filesystem, passive network, certs, NHI; accepts third-party CBOMs). **OpenCryptography.com** (Oct 2025): free public database, ~1B entries, 60K Docker images | no | none | research-grade detection claims |
| Keyfactor | Trust Control Plane; cert lifecycle; Aug 2026 "PQC to the silicon" preview | no | none | no |
| Cryptomathic | CrystalKey 360 crypto-agility, DORA content | no | none | no |
| Thales | CipherTrust + Luna HSM 8 (Aug 2026, ML-KEM/ML-DSA) | no | none | no |
| Venafi/CyberArk | ML-DSA/SLH-DSA experimental in TPP 24.1+ (upgrade invalidates PQ keys) | no | none | no |
| Startups | QIZ Security ($17M seed Jul 2026), QuSecure QuProtect (runtime remediation), Qinsight, pQCee, LuxQuanta, QCEcuring | no self-serve sequencing | none | claims, thin evidence |

**→ The three unclaimed differentiators:** (1) **self-serve dependency-aware
migration sequencing** — only consulting-locked IBM QSMO exists; Q-Trust's
outcome-optimized GNN planner (E-09) is the only self-serve, measured,
published version of this. (2) **tamper-evident/on-chain attestation** — zero
commercial vendors; only academic work (arXiv blockchain SBOM, TU Berlin
TrustBOM STARK receipts, IETF draft Sentinel). Q-Trust's 11-contract
attestation fabric is alone in the market. (3) **SNDL data-lifetime
prioritization** — almost nobody models data shelf-life vs Q-day; Q-Trust's
inspector already computes HNDL scores.

## 2. UI/UX patterns (FuseLab Oct 2026 dashboard guide; Cloudflare PQ visibility)

- Best-in-class UX right now: **Cloudflare's per-domain "is your domain
  PQ-encrypted?" dashboard + Radar PQC telemetry** (Sep 2026).
- Dashboard craft rules: 30-second decision test (work-next vs fund-next);
  ≤8 fixed modules; severity encoded twice (colour + text); linked modules;
  medians/p95 not means; AI-confidence shown as a band with audit trail;
  anti-patterns: decorative threat maps, severity by colour alone, volume
  metrics standing in for outcomes.
- **Differentiating UI patterns:** deadline-countdown framing per asset class
  (poorly executed everywhere — implemented on `/why-now` 2026-10-23);
  migration roadmap with dependency-aware sequencing; SNDL risk model;
  attested evidence trail; public telemetry.

## 3. Standards / regulatory (verified current as of Oct 2026)

- FIPS 203/204/205 effective Aug 2024; **FIPS 206 (Falcon/FN-DSA) still draft**;
  **HQC selected Mar 2025** (5th algorithm; backup KEM; final ~2027).
- **NIST IR 8547 still an initial public draft** (Nov 2024): deprecate 2030,
  disallow 2035. CNSA 2.0: NSS acquisitions CNSA-2.0-capable by 2027-01-01;
  classical exclusivity 2030 (signing/networking) and 2033 (OS/browsers/cloud).
- **Biggest demand catalyst: EO + OMB M-26-15 (June 2026)** — federal agencies
  must maintain cryptographic inventories and submit **phased migration plans
  with evidence**. **→ Q-Trust is an evidence machine**; lead the narrative here.
- TLS hybrid: **RFC 10024 (Aug 2026)** X25519MLKEM768; adoption ~70% of browser
  traffic (Cloudflare, Sept 2026). Client side done; **server/signature side is
  the remaining work — that's Q-Trust's scanning target market.**

## 4. Open-source competitors

CBOMkit (IBM→PQCA; source-scan via Sonar plugin, Java/Python/Go only, C# WIP,
no network/cert/SSH scan, PoC-grade compliance); CryptoBOM Forge (CodeQL-only);
QRAMM/CSNP toolkit (educational); OQS (algorithms, not discovery). Trivy CBOM
is still only a GitHub discussion. **Nobody has had the "Trivy moment" for PQC**
— no single-tool, cross-surface (code+manifests+binaries+network+SSH+PKI) CBOM
scanner with polished UX. **→ Q-Trust's inspector already scans more surfaces
than CBOMkit; the gap is polish and distribution, not capability.**

## 5. What makes OSS security projects famous (Trivy/Semgrep/TruffleHog)

One-command install + zero-config first run in the hero; headline = breadth +
social-proof wall; radical openness (Trivy publishes OSS-vs-commercial
comparison); free public data assets earn authority (OpenCryptography,
Cloudflare Radar); verified-findings hook (TruffleHog's "verified findings
only"); docs-first; live playground (Semgrep editor).
**→** Q-Trust has: PyPI packages + GitHub Action + live demo + honest metrics
page. Missing: the one-command hero demo on the README (single `pip install
qtrust-inspector && crypto-inspector scan-source .` block at the very top),
a public telemetry/data asset, and a wall of named users.

## Positioning synthesis

Lead with the two things literally no competitor has — **self-serve
outcome-optimized migration sequencing** (now visually proven by the Migration
Race, backed by E-09) and **on-chain attested migration evidence** (M-26-15's
"plans with evidence" is the wedge). Follow with cross-surface scanning
breadth vs CBOMkit, deadline-countdown UX, and the honesty brand.

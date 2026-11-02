# Competitive Landscape Update — 2026-10-27 (delta vs 2026-10 baseline)

Method: ~25 web searches + primary-source fetches (NIST CSRC, DigiCert PR, Trivy
release discussion, IBM docs). This is a delta on
`COMPETITIVE_LANDSCAPE_2026-10.md` (2026-10-23); only changes are listed.

## What changed since the October baseline

Four structural shifts in four weeks:

1. **NIST IR 8547 went FINAL — published today, 2026-10-27.** Verified directly
   on [NIST CSRC](https://csrc.nist.gov/pubs/ir/8547/final): document history
   shows draft 11/12/2024 → **Final 10/27/2026**. The 2030-deprecate /
   2035-disallow timeline for RSA/ECDSA/EdDSA/DH/ECDH is now official NIST
   guidance, not a draft proposal (context:
   [Keyfactor](https://www.keyfactor.com/blog/nist-drops-new-deadline-for-pqc-transition)).
   The baseline line "still an initial public draft" is dead.
2. **The "Trivy moment" started.** Baseline said Trivy CBOM was "still only a
   GitHub discussion." No longer: **Trivy v0.76.0 (Oct 2026)** shipped
   experimental crypto scanning with **classical security level and NIST
   quantum security category (0–5) per algorithm**, emitted in CycloneDX
   `algorithmProperties` ([release discussion](https://github.com/aquasecurity/trivy/discussions/11409),
   fetched and verified; feature is flagged experimental with no backward-compat
   promise). One mainstream scanner now reports quantum-weakness natively.
3. **OMB M-26-15 hit its first execution deadline this month.** The June 22 EO
   ([whitehouse.gov](https://www.whitehouse.gov/presidential-actions/2026/06/securing-the-nation-against-advanced-cryptographic-attacks))
   required agency PQC migration plans within 120 days → **due ~Oct 20, 2026**
   ([MeriTalk](https://www.meritalk.com/articles/omb-issues-marching-orders-to-agencies-for-pqc-migration),
   [Cloudflare analysis](https://blog.cloudflare.com/post-quantum-eo-2026)).
   Hard dates now codified: **2030-12-31** key establishment, **2031-12-31**
   signatures on high-value systems, **2035** full migration. Agencies just
   filed evidence-bearing plans — the buyer moment Q-Trust is built for is now.
4. **DigiCert entered planning territory.** **DigiCert Quantum Central went GA
   2026-09-24** — unified crypto inventory (accepts network scans, CLM, key
   vaults, CSV, and SBOM/CBOM imports), policy-driven prioritization, Jira
   remediation workflows, an "inventory-aware AI assistant," CBOM export for
   audits ([press release](https://www.digicert.com/news/digicert-quantum-central-now-available-to-help-organizations-turn-pqc-plans-into-action),
   fetched and verified). It does **not** advertise outcome-optimized migration
   sequencing or formal risk quantification — prioritization is policy-violation
   driven — but it is the first big-PKI vendor shipping a "plans into action"
   management layer. The baseline's "only serious sequencing product is QSMO"
   needs an asterisk.

## New entrants & moves (with dates + URLs)

- **DigiCert** — Quantum Central GA 2026-09-24 (above). Its 2026 Quantum
  Readiness Outlook: **87% of orgs planning/testing/implementing PQC, only 7%
  deployed** ([VARIndia coverage](https://www.varindia.com/news/digicert-turns-pqc-plans-into-action)).
- **IBM** — Quantum Safe Explorer **2.3.2 released 2026-06-26**; 2.x now
  supports configuring **FIPS 140-3 validated crypto modules**
  ([What's New](https://www.ibm.com/docs/en/quantum-safe/quantum-safe-explorer/2.x?topic=whats-new)).
  Timely: remaining FIPS 140-2 validations moved to Historical on **2026-09-21**.
  CBOMkit (now PQCA) added **Go support 2026-04-15**
  ([PQCA blog](https://pqca.org/blog/2026/cbomkit-now-supports-go)); its
  quantum-safe compliance check is still a labeled PoC
  ([repo](https://github.com/cbomkit/cbomkit)); Linux Foundation ran
  "Operationalizing CBOM" webinar 2026-10-20
  ([LF](https://www.linuxfoundation.org/webinars/pqca-ibm-cbom)). CBOMkit remains
  code-surface-only; still no network/cert/SSH coverage.
- **SandboxAQ** — continuing federal push (5-yr DoW CIO deal, Dec 2025:
  [quantumway.org](https://www.quantumway.org/post/sandboxaq-strikes-5-year-pentagon-deal-to-shield-u-s-networks-from-ai-and-quantum-q-day-threats));
  a **SoftBank AQtive Guard deployment** is reported ~Oct 2026 (blog-level
  source, **UNVERIFIED**); press pegs valuation at $5.75B
  (secondary, **UNVERIFIED** — [directory coverage](https://www.aqtiveguard.com/resources)).
- **ISARA** — leaning into "**crypto posture management**" positioning
  (2026-06-08 blog: [isara.com](https://www.isara.com/blog-posts/tags/post-quantum-cryptography));
  opened a European office. Messaging convergence risk: everyone now says
  "posture."
- **CryptoNext Security** — offering "**CryptoNext Discovery On Demand**," a
  two-week fixed-scope crypto view (Sep 2026 datasheet:
  [info.cryptonext-security.com](https://info.cryptonext-security.com)) —
  consulting-shaped, the opposite of self-serve.
- **Keyfactor** — no major Sep–Oct product news; partner-ecosystem expansion
  2026-07-22 ([Yahoo Finance/PRNewswire](https://finance.yahoo.com/technology/ai/articles/keyfactor-expands-global-partner-ecosystem-130000979.html)).
- **Funding:** Project Eleven **$20M Series A** (Castle Island) 2026-01-14 for
  Bitcoin post-quantum infrastructure
  ([projecteleven.com](https://www.projecteleven.com/press/axios-project-eleven-raises-20m-to-tackle-quantum-threat-against-crypto))
  — adjacent, not enterprise PQC. TigerByte Cyber **$3M seed 2026-09-18**
  (secondary, **UNVERIFIED**). QNu Labs new round ~2026-09-09 (Tracxn listing,
  **UNVERIFIED**). No 2026 mega-round changed the enterprise PQC order of battle.
- **Adoption:** PQ key exchange >60% of Cloudflare traffic by Feb 2026
  ([Cloudflare Radar](https://blog.cloudflare.com/radar-origin-pq-key-transparency-aspa)),
  Norway at 81.3% by Aug 2026 ([Radar](https://radar.cloudflare.com/post-quantum/no?dateStart=2026-08-12));
  a June 2026 measurement study found **49.3% of domains** support hybrid
  ML-KEM-768 ([arXiv](https://arxiv.org/html/2606.16473v1)). Key exchange is
  winning; **signature/server-side lag persists** — Q-Trust's scan target stands.

## Regulatory deltas

- **NIST IR 8547 Final, 2026-10-27** (above) — the single biggest change; cite
  the final, not the draft, everywhere.
- **OMB/EO execution:** agency plans filed ~Oct 20, 2026; 2030/2031/2035 dates
  codified ([quantanaut tracker](https://quantanaut.io/quantum-deadlines/united-states)).
- **NSA, 2026-10-01/02:** under **CNSS Policy 15**, from **2027 all new
  commercial National Security Systems must be PQC-capable** — a procurement
  gate, not just guidance (nsa.gov blocked fetch; via
  [Vista Security analysis](https://vistasecurity.io/nsa-2027-pqc-capable-procurement-test)
  and [Govly signal](https://app.govly.com/public/signals/208728) — **date UNVERIFIED
  to the exact day**). Baseline CNSA 2.0 dates (2027/2030/2033) unchanged.
- **EU CRA:** **Article 14 reporting obligations live since 2026-09-11**
  (24-hour early warning for exploited vulnerabilities/severe incidents); full
  conformity + CE marking **2027-12-11**
  ([Lexology](https://www.lexology.com/library/detail.aspx?g=d44fa04c-dd33-4c70-99d0-619f5402fdbe),
  [Exterro](https://www.exterro.com/resources/eu-cyber-resilience-act-reporting-obligations-begin-september-2026)).
  CRA is crypto-relevant (secure-by-design) but still contains **no PQC mandate** —
  don't overclaim.
- **Canada:** OSFI issued quantum-readiness phased guidance ~Jul 2026
  (inventory → risk assessment → migration; secondary source, **UNVERIFIED** to
  primary). **G7/CISA "Call to Action" was Sep 2025**, not 2026 — earlier search
  results conflating the date were wrong; verified via
  [Reg4Tech](https://reg4tech.com/preparing-for-the-post-quantum-era-a-call-to-action).
- **CISA 2026 SBOM Minimum Elements update** published (w/ NSA/FBI); commentators
  note SBOM alone is insufficient for quantum readiness → CBOM needed
  ([Plexicus](https://www.plexicus.ai/fi/blog/application-security/quantum-readiness-software-supply-chain-cbom-xbom-2026) — secondary).
- **No new national PQC mandates in Sep–Oct 2026** beyond the NSA action were found.

## Implications for Q-Trust

**Differentiators that held:** (1) **On-chain attestation — still zero commercial
vendors.** Even Quantum Central's GA feature list stops at CBOM export for
audits; nobody anchors evidence to a chain. (2) **Self-serve outcome-optimized
sequencing — holds, with a caveat:** DigiCert prioritizes by policy violations,
IBM QSMO by consultants; nobody publishes a measured planner (E-09 remains
unique). (3) **Honesty infrastructure** — newly *more* valuable as marketing
noise grows ("AI assistant" claims from DigiCert, "crypto posture" from ISARA).

**Needs sharpening:** the "nobody has had the Trivy moment" line is now wrong —
Trivy ships experimental CBOM with quantum security levels, and CBOMkit keeps
adding languages. Q-Trust's inspector edge is now **breadth and action**, not
existence: Trivy reports crypto in dependencies; it does not scan network/PKI/SSH
surfaces, does not sequence migrations, and does not attest.

**Three concrete positioning updates:**

1. **Re-date every compliance claim to the IR 8547 Final (2026-10-27) and the
   just-passed M-26-15 plan deadline.** Copy shift: "Plans were due. Evidence
   isn't." The 2030-12-31 / 2031-12-31 codified dates give the `/why-now`
   countdown page hard, citable anchors — swap "proposed 2030/2035" for the
   final IR dates and add an M-26-15 execution-tracking angle (what agencies
   filed, what's next).
2. **Race Trivy to CI-gate parity within weeks, then reframe.** Ship SARIF
   output + a `crypto-inspector` GitHub Action gate for quantum-weak findings
   (Trivy's CBOM is explicitly experimental, no-compat-promise). Position: "Trivy
   tells you what crypto you have — CBOM is an inventory, not a migration plan."
   Keep the cross-surface claim (network, certs, SSH) front and center; it is
   still true against Trivy and CBOMkit.
3. **Name DigiCert Quantum Central as the management-layer foil.** New one-liner
   for the homepage and sales deck: "Quantum Central prioritizes by policy
   violation; Q-Trust sequences by outcome — measured (E-09: 1.0000 vs 1.0473,
   p=1.7e-08) and attested on-chain." Publish a short public comparison page
   (Trivy-style radical openness) before DigiCert's sales motion hardens the
   "single policy-tied view" narrative IDC amplified at its Sept 2026 launch.

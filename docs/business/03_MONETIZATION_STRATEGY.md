# Monetization Strategy — Q-Trust

**Prepared:** 23 October 2026
**Basis:** Public market data (sourced below), the measured results in
`paper/analysis/`, and the IP position in `docs/patent/`.

---

## 1. The thesis in one paragraph

Every vendor now sells a post-quantum migration *scanner* and a *readiness score*.
That layer is commoditising fast: IBM, SandboxAQ, Keyfactor, SEALSQ, QuantumGenie,
pqAgility and QuantumGuard all ship discovery plus prioritisation, and CycloneDX 1.6
made the underlying inventory format an open standard. **The defensible position is
not the scanner. It is the assurance layer above it** — the party that certifies
whether a readiness claim is *falsifiable*. Q-Trust's research result is precisely
that most readiness scores on real estates are structurally capped and cannot
distinguish a good migration plan from a bad one. Sold as a product, that finding
becomes a **certification and audit business**, which is higher-margin, stickier,
and far less crowded than the tooling layer.

This is the commercial translation of the paper's negative result: *"your score
can't tell you anything"* is a research finding; *"we certify which scores can"* is
a business.

---

## 2. Why now — the demand is legally dated

| Driver | Date | Commercial consequence |
|---|---|---|
| **EO 14412** "Securing the Nation Against Advanced Cryptographic Attacks" | Signed 22 Jun 2026 | Federal agencies must designate a PQC migration lead and maintain cryptographic inventory; deadlines set for covered systems |
| **OMB implementing guidance** | 24 Jun 2026 | Operationalises the EO across agencies |
| **FAR flow-down** | In effect | Contractors inherit the obligation *contractually* — non-compliance risks award eligibility, not just a finding |
| **CNSA 2.0** | 2025 → 2033 → 2035 | Staged algorithm deadlines; 2030 for network devices, 2033 full adoption, 2035 completion for NSS |
| **NIST FIPS 203/204/205** | Aug 2024 | The "migrate to what" question is settled; only "how do we prove progress" remains |

The critical shift: **migration is now a compliance artifact problem.** A CISO does
not need another dashboard; they need something they can hand an auditor or a
contracting officer. That is what a certificate is.

**Market size (two independent estimates, different scopes):**

- MarketsandMarkets (Oct 2025): PQC market **$0.42B (2025) → $2.84B (2030)**,
  CAGR **46.2%**
- Grand View Research (Jun 2026): **$1.6B (2025) → $2.2B (2026) → $20.5B (2033)**,
  CAGR **37.8%**

The spread reflects scope differences (PQC products vs. broader quantum-safe
services). Both agree on the shape: a market compounding at 38–46% through 2030.

**Bottom-up sanity check.** A federal contractor with 1,000–10,000 hosts will spend
$0.5–5M on migration over three years. Compliance evidence is typically 5–10% of
programme spend → **$25k–500k per organisation per year** for the assurance layer.
With roughly 3,000–5,000 materially affected contractors in the US alone, plus
financial services under DORA and critical infrastructure, the **serviceable
addressable market is on the order of $300M–800M ARR** at maturity. That is the
number to build against — not the $2.84B headline, most of which is algorithm
licensing, HSMs, and professional services we do not sell.

---

## 3. Who pays, and for what

### ICP-1: Federal contractors under EO 14412 / FAR (beachhead)

- **Profile:** 500–10,000 employees, $50M–$2B revenue, holds DoD/civil agency
  contracts, has a CISO but no dedicated PQC programme.
- **Trigger:** contract clause requiring cryptographic inventory and migration
  evidence; prime contractor flow-down pressure.
- **Pain:** cannot prove progress to a contracting officer; the readiness score from
  their scanner is a number with no defensible interpretation.
- **Budget holder:** CISO / VP Compliance.
- **Why us:** we issue a certificate that states what the score *could* have
  discriminated, signed and independently verifiable.

### ICP-2: Regulated financial infrastructure (expansion)

- **Profile:** banks, payment processors, clearing houses; DORA and PCI obligations;
  long data-retention horizons (harvest-now-decrypt-later exposure).
- **Pain:** board reporting requires a defensible metric; internal audit rejects
  vendor scores as unverifiable.
- **Budget holder:** CISO + Head of Operational Resilience.

### ICP-3: PQC tooling vendors (OEM — the margin engine)

- **Profile:** scanner/readiness vendors who need a validity layer they cannot build
  without the research.
- **What they buy:** a licence to the labelling-scheduling algorithm and the validity
  gate, embedded in their product.
- **Why they buy:** it lets them say "our score is validated," which is a sales
  differentiator against competitors whose scores are not.
- **This is the patented element** (Invention B) and carries the highest margin.

---

## 4. Product and pricing architecture

Three SKUs, deliberately layered so the low end creates the data that makes the high
end credible.

| SKU | What it is | Price | Margin |
|---|---|---|---|
| **Validity Report** | One-off audit of an estate: ceiling analysis, metric verdict, labelling plan, PDF + verifiable JSON | **$15k–40k** per engagement | ~85% |
| **Certification** (annual) | Continuous validity-gated certification; on-chain attestation with revocation; auditor-verifiable badge | **$60k–250k / yr**, scaled by estate size | ~80% |
| **OEM Licence** | SDK/API for the validity gate + labelling scheduler, embedded in a partner product | **$250k–1M / yr** + per-certificate royalty | ~95% |

**Pricing logic.** The certificate is priced against the *cost of a failed audit*,
not against the cost of the software. A contractor losing award eligibility on a
$50M vehicle is the reference loss. That anchors a $60k–250k price without
difficulty. The Validity Report is priced to be a no-approval-needed expense that
lands the account.

**Why the on-chain component is not a gimmick.** It converts the certificate from a
PDF (forgeable, unverifiable, unrevocable) into a record that a third party — an
auditor, a contracting officer, a customer — can verify without trusting us. That is
what makes it an *assurance* product rather than a *reporting* product, and it is
why the registry, not the scanner, is the asset.

---

## 5. Unit economics

**Cost of goods is expert labelling.** From the measured results
(`paper/analysis/labelling_efficiency.json`):

| Estate | Ceiling before | Labels to reach 0.90 | Cost @ $3/label | Cert price | Gross margin |
|---|---|---|---|---|---|
| 100 assets, 90% mono | 0.435 | 203 | $609 | $60k | 99% |
| 1,000 assets, 90% mono | 0.431 | 2,025 | $6,075 | $150k | 96% |
| 5,000 assets, 90% mono | 0.432 | 10,125 | $30,375 | $250k | 88% |

Even at the largest estate, labelling is **~12% of price**. Compute is negligible
(the full 42-fold re-analysis runs on two CPU cores in minutes; the zero-synthetic
variant takes minutes). **Gross margin 88–99%** is achievable, and the binding
constraint is sales, not delivery.

The greedy scheduler is a direct margin lever: it uses **24–42% fewer labels** than
random selection at n ≥ 100, which is 24–42% off COGS and, more importantly, a
faster time-to-certificate (a sales-cycle lever).

---

## 6. Three-year model (base case)

Assumptions: 9-month sales cycle for ICP-1; $3/label; 3 FTE delivery by Y2;
no OEM revenue until Y2.

| | Y1 (2027) | Y2 (2028) | Y3 (2029) |
|---|---|---|---|
| Validity Reports | 12 × $25k = **$300k** | 30 × $30k = **$900k** | 50 × $35k = **$1.75M** |
| Certifications (new) | 6 × $80k = **$480k** | 22 × $100k = **$2.2M** | 55 × $120k = **$6.6M** |
| Certifications (renewal) | — | 5 × $90k = **$450k** | 24 × $110k = **$2.64M** |
| OEM licences | — | 1 × $300k = **$300k** | 3 × $450k = **$1.35M** |
| **Revenue** | **$780k** | **$3.85M** | **$12.34M** |
| COGS (labelling + delivery) | $95k | $520k | $1.85M |
| **Gross profit** | **$685k (88%)** | **$3.33M (86%)** | **$10.49M (85%)** |
| Headcount | 4 | 11 | 24 |

**Renewal is the whole model.** Certification is annual and the on-chain history is
non-portable, so switching means abandoning a verifiable record. Target net revenue
retention ≥115% through estate growth and tier upgrades.

---

## 7. Moat — ranked by durability

1. **The patent on the labelling scheduler (Invention B).** The only element a
   competitor cannot simply re-implement. Narrow, but real, and detectable
   (a competitor's labelling plan either bisects large groups or it does not).
2. **Accumulated labelled estates.** Every engagement produces a labelled corpus.
   That corpus is what lets us state ceilings for a new customer's *sector* on day
   one. It compounds and cannot be bought quickly.
3. **Registry network effects.** Auditors who have verified 200 Q-Trust
   certificates will ask for Q-Trust certificates. Verification ubiquity is the moat
   that certificate authorities have always had.
4. **Standards position.** If the eight-mode validity audit becomes what auditors
   expect, we wrote the checklist. Publish it; own it.
5. **Research credibility.** A peer-reviewed paper documenting the flaw is a
   marketing asset no competitor can copy without doing the work. It is also the
   reason a CISO believes the claim.

**What is *not* a moat:** the scanner (commodity), the GNN (reproducible in a week),
the UI, the chain choice (Base is cheap and interchangeable).

---

## 8. Go-to-market sequence

**Phase 1 (months 0–9) — Credibility, not revenue.**
Publish the paper. File the provisional. Mark "Patent Pending." Ship the free
`/research` page and the public verifier. Goal: when a CISO googles "is my PQC
readiness score meaningful," we are the answer. Revenue: 3–5 paid Validity Reports
from design partners at a discount.

**Phase 2 (months 9–24) — Land federal contractors.**
Partner with one boutique federal compliance consultancy (they have the
relationships, we have the artifact). Target 6 certifications. Attend one
GovCon/compliance event. The EO 14412 deadlines do the selling.

**Phase 3 (months 18–36) — OEM and expansion.**
License the scheduler to two or three scanner vendors who need a validity story.
Enter financial services via DORA. This is where gross margin crosses 90% and
revenue becomes less sales-linear.

---

## 9. Risks, honestly

| Risk | Severity | Mitigation |
|---|---|---|
| **"Who audits the auditor?"** Our own ceiling analysis must be beyond reproach | High | The 35/35 claims harness and public re-analysis page exist precisely for this. Publish the method; let anyone re-run it. |
| Scanner vendors bundle a crude validity check for free | High | They will. That is why the moat is the *labelling scheduler* and the *registry*, not the ceiling formula. Lead the patent with B. |
| Long federal sales cycles (9–18 months) | High | Validity Reports as a fast-entry SKU; OEM for non-linear growth |
| Market is crowded on discovery | High | Do not compete there. We are the layer above. |
| The research is a negative result — harder to market | Medium | It is a *trust* asset, not a product. Frame as "we found the flaw in everyone's scores, including ours." |
| Regulatory timelines slip | Medium | Financial services (DORA) provides an independent demand driver |
| Single-founder technical concentration | Medium | Document everything; the paper and patent *are* the documentation |

---

## 10. What would have to be true

For this to be a **strong** outcome rather than a modest one:

1. **The validity gate must become expected in procurement.** If auditors start
   asking "is this score discriminating?", we are the default answer. That is a
   standards and marketing problem, not a technical one — and it is the highest-
   leverage thing to work on.
2. **At least one OEM licence must close.** That validates the IP as licensable and
   is what makes the patent worth defending.
3. **Renewal must exceed 110%.** Without it this is a services business, not a
   software business, and the multiple collapses.

If all three hold, a $12M ARR business at 85% gross margin with a narrow patent and
a category-defining research paper is a credible acquisition target for IBM,
SandboxAQ, Keyfactor, Thales, or a Big-4 assurance practice — which is the most
likely exit, and a good one.

If none hold, this is a respected research artifact and a boutique consultancy. That
is not a failure, but it is not "monetized strongly," and it would be dishonest to
pretend otherwise.

# Q-Trust — Business Model (research-locked, 2026-10-24)

Decision document. The model described here is the one **already shipped** on
the `/pricing` page (assurance-led); this document records the evidence that
supports it, the alternatives rejected, and what must be true for each tier
to convert. Every strategic claim cites a source or a repo artifact.

## 1. Market evidence

- **Size & growth**: published PQC forecasts disagree on the 2025 base
  ($0.42B–$1.9B depending on definition) but agree on trajectory —
  [MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/post-quantum-cryptography-market-126986626.html):
  $0.42B (2025) → **$2.84B by 2030, 46.2% CAGR**; Mordor ~$0.88B → $4.60B
  (~39%); Juniper ~$1B (2026) → $13B by 2035. Investor framing: a sub-$1B
  market today compounding at 30–46% through the mandatory-transition decade.
- **Regulatory forcing function**: EO + OMB M-26-15 (June 2026) requires
  federal agencies to maintain cryptographic inventories and submit phased
  migration plans **with evidence**; NIST IR 8547 (draft) deprecates
  quantum-vulnerable crypto by 2030, disallows by 2035; CNSA 2.0 binds NSS
  acquisitions from 2027-01-01. A compliance-purchased market.
- **Competitive structure (verified 2026-10)**: IBM's QSMO is consulting-
  locked; [SandboxAQ AQtive Guard](https://aws.amazon.com/marketplace/pp/prodview-ccwrhqfeekqwk)
  sells custom unit-billed enterprise contracts; **no major player publishes
  pricing at any tier**. Open-source tooling (CBOMkit, CryptoBOM Forge,
  QRAMM) is fragmented and cross-surface-weak
  (`research/COMPETITIVE_LANDSCAPE_2026-10.md`).
- **Q-Trust's verified moats**: (1) self-serve outcome-optimized migration
  sequencing — the only measured, published version (E-09/E-12); (2) the
  validity-gated certification fabric (refuses unsupported claims, on-chain
  Merkle-revocable) — zero commercial competitors; (3) the honest-metrics
  brand — the pricing page's "No organisation pays for Q-Trust yet" is the
  brand in action, and it survives diligence.

## 2. The shipped model (on `/pricing`)

**Open core → assurance engagements → annual certification → OEM licensing.**
The deliberate position: discovery is commoditising; the defensible layer is
*assurance a counterparty can verify without trusting the vendor*.

| Tier (as shipped) | Price | What | Conversion hypothesis |
|---|---|---|---|
| **Open** | Free, MIT | Full scanner, CBOM/SARIF, planner, public + offline verification | Adoption + trust surface; permanently complete, not a trial |
| **Validity Report** | $15k–40k per engagement | Ceiling analysis of the customer's readiness score + expert-labelling plan (the paper's method, productised) | Bought by security leads whose boards demand a defensible number; design-partner discounted |
| **Certification** (flagship) | $60k–250k / yr by estate | Validity-gated issuance, signed bundles, on-chain anchor, revocation | Annual renewal is the model — the on-chain record is not portable, so switching means abandoning verified history |
| **OEM licence** | from $250k / yr + royalty | Embed the validity gate + tie-aware labelling scheduler (24–42% fewer expert labels, measured) | For readiness-scanner vendors who need the research layer |

**Why this beats the seat-SaaS alternative I initially drafted**: assurance
is a property of an *estate*, not a login (the page's own FAQ) — per-seat
pricing would put the price where the value isn't. The engagement + annual
certification structure prices against the reference loss (a failed audit on
a $50M award vehicle), not against a dashboard subscription. Cost of goods is
expert labelling (~12% of certificate price at the largest estate in the
October model) — the margin lever is the labelling scheduler, which is
exactly E-09/E-12's measured capability.

## 3. Go-to-market

1. **Wedge**: M-26-15's "plans with evidence" — `/evidence` maps agency
   requirements to capabilities; Validity Reports are the first paid step.
2. **Motion**: one-command OSS scan → CI action → validity report (first
   invoice) → certification (annual) → OEM for ecosystem players.
3. **Investor narrative**: 46%-CAGR market + regulatory forcing + two
   verified moats + a pricing page that states "no paying customer yet"
   *because the honesty is the product*. Live demos: Migration Race,
   `/evidence`, `/pricing`.

## 4. Validation obligations (the honest to-do list)

- Pricing is a published hypothesis: the first design partner validates the
  Validity Report band; the first renewal validates Certification.
- Usage-based metering deferred until a real tenant shows which unit grows.
- Market-size figures above are third-party forecasts, not our own model —
  cite them as such in any deck.

## 5. Alternatives considered and rejected

- **Per-seat SaaS ($29/seat)**: rejected — misprices assurance, competes
  head-on with opaque incumbents' strongest habit (big logos, big contracts)
  instead of inverting it.
- **Pure services firm**: rejected — no compounding asset; the on-chain
  record and the scheduler are the moats, and both need product.
- **Usage-metered platform from day one**: rejected — no tenant data yet to
  pick the unit honestly.

# Q-Trust — Product Context (PRODUCT.md)

Durable product context for design and engineering work. Captured 2026-10-24
after the E-09/outcome-evaluation engagement, the competitive-landscape
research (see `research/COMPETITIVE_LANDSCAPE_2026-10.md`), and the craft
audits (hallmark / impeccable / taste-skill / Emil Kowalski's animation suite /
Vercel Web Interface Guidelines).

## What it is

Q-Trust is a post-quantum cryptography migration and attestation protocol:
scan a cryptographic estate (TLS, SSH, source, manifests, binaries), score it
against NIST IR 8547 / CNSA 2.0 / FIPS / NIS2 / FISMA / FedRAMP / CMMC, plan
the migration with a measured outcome-based model, and anchor tamper-proof
evidence of progress on Base L2. Packages: `qtrust-inspector` and `qtrust-sdk`
on PyPI, the `cbom-action` GitHub Action, a Fastify backend + Next.js
frontend, 11 UUPS contracts.

## Who it is for

1. **Security engineers** running discovery (scan → CBOM → CI gate).
2. **CISOs / compliance leads** who must show phased migration plans *with
   evidence* (OMB M-26-15 framing) to auditors and boards.
3. **Auditors / third parties** verifying claims independently (public `/v`
   page, no wallet needed).
4. **Researchers** evaluating the methodology (paper, `/research` page).

## The claims that differentiate (all artifact-backed)

- **Self-serve outcome-optimized migration sequencing** — the only measured,
  published version of this in the market (E-09: QRD ratio 1.0000 vs 1.0473
  for the priority formula across 42 real estates, Wilcoxon p=1.7e-08).
  IBM's QSMO is the only commercial analogue and it is consulting-locked.
- **On-chain / tamper-evident attestation** — zero commercial competitors
  (verified Oct 2026). The certification fabric (validity-gated attestation,
  Merkle-proof revocation) is the moat.
- **Honest metrics** — every headline number traces to an artifact; errors are
  self-corrected in public (TRUTH_AUDIT.md, metric-consistency CI gate).
  This is brand, not hygiene.

Claim discipline: any new metric in UI/docs must cite its artifact and carry
its protocol framing (simulation-grounded vs observed; synthetic vs real).
The τ 0.975 figure is synthetic-only and must always be labeled as such.

## Surfaces and their modes (impeccable modes)

| Surface | Mode | Note |
|---|---|---|
| `/` home, `/why-now`, `/research`, `/compare`, `/demo` | **Persuade** | editorial dark chrome + light bands; the Migration Race is the signature moment |
| `/scanner` (+ its 8 tabs) | **Operate** | precision and restraint; semantic state palette; data-density earns its place |
| `/v`, `/v/[id]` | **Persuade → Read** | the public trust surface; must work with no wallet, no JS-dependent content |
| `/dashboard`, `/vendors` | **Operate** | wallet-gated working surfaces |
| `/developers` | **Read** | docs-first |

## Non-goals / constraints

- No dark patterns, no invented metrics/testimonials/logo walls (hallmark
  floor). Hash-only privacy model on-chain.
- WCAG 2.1 AA minimum everywhere (axe-gated in CI at two viewports);
  prefers-reduced-motion honored by a global kill-switch.
- CWV budget enforced (LCP ≤ 1.5 s on the home page, CLS ≤ 0.1).
- Deploy path: Vercel (frontend + serverless API) + Neon Postgres; scanner
  and planner behind Cloudflare quick tunnels (operator machine).

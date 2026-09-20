# Q-Trust launch kit (post when ready — one day, all channels)

## Show HN draft (title + body)

Title: `Q-Trust – open-source PQC migration scanner (CBOM + GNN planning + on-chain proof)`

Body:
> NIST IR 8547 disallows RSA/ECC from 2030–2035, but most orgs can't even
> enumerate their crypto estate. Q-Trust is an end-to-end open system:
> `pip install qtrust-inspector` → CBOM inventory with NIST/CNSA scoring →
> GNN-ranked migration plan → tamper-proof attestation on Base L2.
>
> The part I'm proudest of: our GNN *ties* our own heuristic (τ 0.7168 vs
> 0.7210, 42-fold LOO, leakage-audited) and we published the tie instead of
> metric-hacking it: [why we published a benchmark we tied](https://github.com/humoge7502/q-trust/blob/main/docs/essays/why-we-published-a-tie.md).
>
> Live demo (runs in your browser): https://huggingface.co/spaces/KRISHNAPURI/q-trust-scanner
> 60-second Colab: in the repo showcase. Happy to answer hard questions —
> especially about the eval.

Post Tue–Thu morning PT. Reply to every comment within hours.

## r/netsec (text post)

Title: `After 2 years of PQC talk, I built the migration scanner I wanted: CBOM inventory + GNN planning + on-chain proof (open source)`

Body: threat framing (harvest-now-decrypt-later) → what it does → install
command → honest-tie paragraph → ask for estate war stories, not stars.

## NIST pqc-forum (plain-text email)

Subject: `[ANNOUNCE] Q-Trust: open CBOM scanner + migration planner (NIST/CNSA scoring)`
Body: 10 lines, no marketing: what, install, eval numbers, TRUTH_AUDIT link,
request for expert pairwise labels for RiskBench v1.

## Newsletter pitches (one paragraph each)

- TLDR InfoSec / Risky Biz: lead with the tie + 60-second install.
- PQCA (Linux Foundation): propose Q-Trust as contributed CBOM tooling;
  ask for the contribution process link first.

## Directory applications (open in browser, 10 min each)

- CycloneDX tool matrix (CycloneDX 1.7 CBOM output — qualifies now)
- OWASP project list
- Papers With Code: dataset `KRISHNAPURI/q-trust-datasets` + method note
  (needs the arXiv paper first for the method page)

## Pre-flight checklist (maintainer)

- [ ] Social preview uploaded (assets/og-github.png, 1280×640, repo Settings)
- [ ] Marketplace checkbox ticked on the next release (cbom-action/)
- [ ] HF org created, repos transferred, cards re-linked
- [ ] arXiv submitted, CITATION.cff + cards updated with the ID
- [ ] Release Drafter draft reviewed → publish notes with the launch

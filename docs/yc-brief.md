# Q-Trust — YC application brief (founder working doc)

> Status: pre-application. Every number below is measured (see
> `docs/TRUTH_AUDIT.md`); nothing here is projected revenue or hired team.

## One-liner

Open-source scanner that inventories enterprise cryptography (CBOM), ranks
PQC migration with a GNN, and seals tamper-proof attestations on-chain —
`pip install qtrust-inspector`, 60 seconds to first scan.

## Why now

NIST IR 8547 disallows RSA/ECC 2030–2035; harvest-now-decrypt-later makes
waiting the risky option. Compliance (CNSA 2.0, PCI DSS 4.0 PQC guidance)
forces CISOs to produce crypto inventories they do not have. Deadline +
mandate = budget.

## Product (live today)

- `crypto-inspector scan example.com -c nist,cnsa` (PyPI 2.2.0, Docker, GH Action)
- In-browser demo (ONNX, no upload), Colab quickstart, HF model + 10-config dataset
- 11 UUPS registries on Base Sepolia, EIP-712 gasless attestations, 7-day timelock

## Traction plan (not traction yet — stated honestly)

1. GitHub Action installs (= orgs using it per release) — instrumented via
   release download counts + upload-sarif adoption
2. PyPI/HF download curves (baselines: 0 → targets in growth/launch-kit.md)
3. 3 design-partner pilots: free scan + roadmap in exchange for a logo quote
   and blinded RiskBench labels (this also unblocks the GNN science gap)

## Business model (open core, standard for the category)

- Free: scanner, CBOMs, community planner
- Paid: hosted continuous scanning + drift alerts, compliance API/SOC2
  evidence packs, enterprise estate dashboard with SSO/audit log
- Comparable motions: Semgrep, Snyk, Socket (all OSS-led, usage-priced)

## Why we win vs incumbents

Crypto-misuse tools (Semgrep rules, CodeQL queries) detect bugs in known
crypto; nobody owns *inventory → prioritized plan → proof*. Our moat is the
measurement loop: every pilot estate improves the public RiskBench, which
improves ranking for everyone — a data flywheel competitors cannot copy
without the open corpus.

## Honest gaps (YC will ask; answer first)

- No external contract audit yet (dossier ready; budget-gated)
- GNN ties the heuristic until expert labels arrive (pilot quid-pro-quo)
- Single founder + contributors (hiring: cryptographer, GTM)
- No revenue yet; design partners are the path, stated above

## Demo script (60 seconds, works today)

1. `pip install qtrust-inspector` → scan example.com (real findings)
2. Paste RSA snippet in the Space demo (in-browser classification)
3. `load_dataset RichBench` → 10,000 expert-schema pairs
4. Show the tie essay: "this is what honest eval looks like"

## Links

Repo · PyPI · Space · Datasets · Model · Paper draft (`paper/main.tex`)

# Why we published a benchmark we tied

*The GNN at the heart of Q-Trust does not beat our own doctrine heuristic.
We are publishing that sentence on purpose.*

Every ML-for-security project eventually meets the same fork in the road: the
model ties the baseline, and the team quietly re-frames the metric until it
wins. We chose the other path, and this post explains why — with numbers.

## What we measured

Our migration planner ranks which crypto assets to migrate first. Against the
doctrine heuristic on 42 host-disjoint enterprise CBOMs (277 unique hosts,
zero cross-CBOM overlap, leave-one-out):

- GNN τ-b **0.7168** vs heuristic **0.7210** (Δ −0.0042, medians identical)
- 0 wins / 41 ties / 1 loss; top-10 accuracy 1.0 on all 42 folds

The RL agent tells the same story: reward 140.34 ± 8.13 vs heuristic 140.62.
A tie, twice, with independent methods.

## Why a tie is the honest headline

The heuristic encodes decades of operator doctrine — migrate the
internet-facing RSA-2048 before the internal test Jenkins. A model trained on
280-host estates *should* converge to the same ranking unless the data
contains a genuinely new signal. Claiming victory here would mean one of two
things: leakage (the model memorized the answer) or metric-hacking. We audited
for both: the split reproduces bit-identically at seed 42, cross-repo
duplication is 0.4%, and the eval harness reports `not_available` instead of
inventing numbers for unwired suites.

A tie with a strong baseline, proven leakage-free, is a *result*. It says the
doctrine is already near-optimal on today's estates — and it tells us exactly
what would break the tie: 5,000–10,000 blinded human expert pairwise labels
(`qtrust_data/gold/riskbench-v1/` ships the schema today, with synthetic demo
data explicitly marked as such until the experts arrive).

## What we claim instead

- Discovery: F1 **0.9525** finding crypto usage in held-out repos (usage
  recall 0.877 on CryptoAPI-Bench) — a different, winnable task, stated as such.
- Side-channel: 51/54 leak-injected trace sets caught, with the 3 misses
  (FALCON keygen, n≤200) recorded, not hidden.
- Provenance: every artifact carries config + seed + metrics; every demo data
  file carries a `SYNTHETIC_DEMO` manifest.

## The ask

If you run a crypto estate, the missing ingredient is expert judgment, not
another architecture. That is the contribution we are openly recruiting:
blinded pairwise labels, 10 minutes each, schema ready. The GNN tie is not a
failure to hide — it is a measurement waiting for better data.

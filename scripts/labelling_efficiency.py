"""
Validity-maximizing labelling policy — empirical evaluation on the 42 real estates.

MOTIVATION
----------
The ceiling theorem says a rank metric on a tie-saturated target can never exceed
    ceiling = sqrt(d / n0),      d = distinguishable pairs, n0 = total pairs.
Ties are therefore a *resource constraint* on evaluation. If an organisation is
willing to buy expert labels, the question becomes: which assets should be
labelled to raise the ceiling the fastest per label?

THEORY (bisection policy)
-------------------------
Consider one tied group of size m. An expert re-scores its m assets individually
(one label per asset). Suppose the re-scoring partitions the group into subgroups
of sizes a_1..a_k (sum = m). The pairs that become distinguishable are exactly the
cross-subgroup pairs:

    delta_d = sum_{i<j} a_i * a_j  =  (m^2 - sum a_i^2) / 2

For a two-way split this is maximised at a = b = m/2, giving delta_d = m^2/4.
Efficiency per label is then

    delta_d / m  =  m / 4

which is *increasing in m*. Large tie clusters are therefore the cheapest source
of validity per label — the opposite of the intuitive "label the important
assets first" heuristic. n0 is invariant under relabelling (it depends only on
the number of assets), so the ceiling moves monotonically with d.

This script verifies that claim empirically and compares the greedy
largest-group-first policy against three baselines on all 42 real estates.

COST UNIT
---------
One "label" = one asset inspected and re-scored by an expert (item-level
annotation, not a pairwise comparison). This matches how criticality labelling is
actually performed in practice and is the conservative choice: a pairwise model
would make large groups look even cheaper.

Output: paper/analysis/labelling_efficiency.json
"""
from __future__ import annotations

import json
import math
import os
import random
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CBOM_DIR = os.path.join(ROOT, "q-trust-datasets", "planner", "data", "real_cboms")
OUT = os.path.join(ROOT, "q-trust", "paper", "analysis", "labelling_efficiency.json")
DEFAULT_KEY = 2048


# ----------------------------------------------------------------------------- data
def load_estates():
    estates = []
    for fn in sorted(os.listdir(CBOM_DIR)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(CBOM_DIR, fn), encoding="utf-8") as f:
            d = json.load(f)
        ks = [int(a.get("key_size") if a.get("key_size") is not None else DEFAULT_KEY)
              for a in d.get("assets", [])]
        if ks:
            estates.append((fn, ks))
    return estates


def group_sizes(ks):
    """Tied-group sizes of the target preorder (descending key size)."""
    c = Counter(ks)
    return [c[k] for k in sorted(c.keys(), reverse=True)]


def stats(groups):
    n = sum(groups)
    n0 = n * (n - 1) // 2
    tied = sum(g * (g - 1) // 2 for g in groups)
    d = n0 - tied
    ceiling = math.sqrt(d / n0) if n0 > 0 and d > 0 else 1.0
    # d == 0 means the target has no distinguishable pairs: the rank metric is
    # undefined and the "ceiling 1.0" convention is vacuous, not evidence of a
    # perfect evaluation. Flag it so it is never reported as saturation.
    return dict(n=n, n0=n0, d=d, tied=tied, ceiling=ceiling,
                groups=list(groups), degenerate=(d == 0))


# ------------------------------------------------------------------- label policies
def split_delta(m):
    """delta_d from a balanced two-way split of a group of size m."""
    a = m // 2
    b = m - a
    return a * b


def policy_greedy_largest(groups, target_ceiling):
    """Bisect the largest tied group repeatedly until the target ceiling is met."""
    g = list(groups)
    base = stats(g)
    labels = 0
    steps = []
    while True:
        s = stats(g)
        if s["ceiling"] >= target_ceiling - 1e-12:
            break
        idx = max(range(len(g)), key=lambda i: g[i])
        m = g[idx]
        if m < 2:
            break
        dd = split_delta(m)
        a, b = m // 2, m - (m // 2)
        g[idx:idx + 1] = [a, b]
        labels += m
        steps.append(dict(group_size=m, delta_d=dd, labels=m,
                          efficiency=dd / m if m else 0.0))
    return dict(labels=labels, ceiling=stats(g)["ceiling"], d=stats(g)["d"],
                steps=steps, reached=stats(g)["ceiling"] >= target_ceiling - 1e-12,
                base_ceiling=base["ceiling"])


def policy_smallest_first(groups, target_ceiling):
    g = list(groups)
    labels = 0
    while True:
        s = stats(g)
        if s["ceiling"] >= target_ceiling - 1e-12:
            break
        cand = [i for i in range(len(g)) if g[i] >= 2]
        if not cand:
            break
        idx = min(cand, key=lambda i: g[i])
        m = g[idx]
        a, b = m // 2, m - (m // 2)
        g[idx:idx + 1] = [a, b]
        labels += m
    return dict(labels=labels, ceiling=stats(g)["ceiling"],
                reached=stats(g)["ceiling"] >= target_ceiling - 1e-12)


def policy_random(groups, target_ceiling, trials=200, seed=7):
    """Average labels needed when the group to re-score is chosen at random."""
    rng = random.Random(seed)
    totals = []
    for _ in range(trials):
        g = list(groups)
        labels = 0
        guard = 0
        while stats(g)["ceiling"] < target_ceiling - 1e-12 and guard < 10000:
            guard += 1
            cand = [i for i in range(len(g)) if g[i] >= 2]
            if not cand:
                break
            idx = rng.choice(cand)
            m = g[idx]
            a, b = m // 2, m - (m // 2)
            g[idx:idx + 1] = [a, b]
            labels += m
        totals.append(labels)
    return dict(labels=sum(totals) / len(totals),
                labels_best=min(totals), labels_worst=max(totals))


# ------------------------------------------------------------- theorem verification
def verify_bisection_optimality(max_m=24):
    """For each m, confirm the balanced split maximises delta_d = sum_{i<j} a_i a_j."""
    rows = []
    for m in range(2, max_m + 1):
        best, best_split = -1, None
        # exhaustive over two-way splits
        for a in range(1, m):
            b = m - a
            if a * b > best:
                best, best_split = a * b, (a, b)
        balanced = (m // 2, m - (m // 2))
        rows.append(dict(m=m, optimal_delta_d=best, optimal_split=best_split,
                         balanced_delta_d=balanced[0] * balanced[1],
                         balanced_is_optimal=balanced[0] * balanced[1] == best,
                         efficiency=best / m))
    return rows


# ------------------------------------------------------------ designed-space sweep
def simulate_estate(n, dominant_frac, n_tail=6, seed=11):
    """Synthetic-but-realistic enterprise estate.

    A fraction `dominant_frac` of assets share one key size (the RSA-2048
    monoculture that dominates real enterprises); the remainder is spread over
    `n_tail` distinct key sizes. Returns tied-group sizes.
    """
    rng = random.Random(seed)
    n_dom = int(round(n * dominant_frac))
    rest = n - n_dom
    if rest <= 0:
        return [n]
    groups = [n_dom] if n_dom > 0 else []
    # spread the remainder over n_tail groups, at least 1 each
    k = min(n_tail, rest)
    cuts = sorted(rng.sample(range(1, rest), k - 1)) if k > 1 else []
    prev = 0
    for c in cuts + [rest]:
        groups.append(c - prev)
        prev = c
    return sorted([g for g in groups if g > 0], reverse=True)


def designed_space_sweep():
    """Sweep estate size x tie concentration; report ceiling and labelling cost."""
    rows = []
    for n in (10, 25, 50, 100, 500, 1000, 5000):
        for frac in (0.50, 0.70, 0.90, 0.98):
            gs = simulate_estate(n, frac)
            base = stats(gs)
            row = dict(n=n, dominant_frac=frac, max_group=max(gs),
                       n_groups=len(gs), n0=base["n0"], d=base["d"],
                       ceiling=base["ceiling"], degenerate=base["degenerate"])
            for t in (0.85, 0.90):
                gr = policy_greedy_largest(gs, t)
                rd = policy_random(gs, t, trials=60)
                sm = policy_smallest_first(gs, t)
                row[f"target_{t}"] = dict(
                    greedy_labels=gr["labels"], greedy_reached=gr["reached"],
                    random_labels=rd["labels"], smallest_labels=sm["labels"],
                    greedy_vs_random_ratio=(rd["labels"] / gr["labels"])
                    if gr["labels"] else None,
                    labels_per_asset=(gr["labels"] / n) if n else None,
                )
            rows.append(row)
    return rows


def main():
    estates = load_estates()
    targets = [0.85, 0.90, 0.95]

    per_estate = []
    for fn, ks in estates:
        gs = group_sizes(ks)
        base = stats(gs)
        row = dict(estate=fn, **{k: base[k] for k in ("n", "n0", "d", "tied", "ceiling")},
                   max_group=max(gs), n_groups=len(gs))
        for t in targets:
            gr = policy_greedy_largest(gs, t)
            sm = policy_smallest_first(gs, t)
            rd = policy_random(gs, t)
            row[f"target_{t}"] = dict(
                greedy_labels=gr["labels"], greedy_reached=gr["reached"],
                greedy_final_ceiling=gr["ceiling"],
                smallest_labels=sm["labels"], smallest_reached=sm["reached"],
                random_labels=rd["labels"],
            )
        # marginal efficiency of the very first bisection
        g_largest = max(gs)
        row["first_bisection"] = dict(
            group_size=g_largest,
            delta_d=split_delta(g_largest),
            labels=g_largest,
            efficiency=split_delta(g_largest) / g_largest if g_largest else 0.0,
            ceiling_before=base["ceiling"],
            ceiling_after=math.sqrt((base["d"] + split_delta(g_largest)) / base["n0"])
            if base["n0"] else 1.0,
        )
        per_estate.append(row)

    # ---- aggregate
    def agg(key, field):
        vals = [r[key][field] for r in per_estate]
        return dict(mean=sum(vals) / len(vals), min=min(vals), max=max(vals),
                    total=sum(vals))

    summary = dict(
        n_estates=len(per_estate),
        mean_ceiling_before=sum(r["ceiling"] for r in per_estate) / len(per_estate),
        mean_n0=sum(r["n0"] for r in per_estate) / len(per_estate),
        mean_d=sum(r["d"] for r in per_estate) / len(per_estate),
        mean_max_group=sum(r["max_group"] for r in per_estate) / len(per_estate),
        targets={},
    )
    for t in targets:
        k = f"target_{t}"
        gl = [r[k]["greedy_labels"] for r in per_estate]
        rl = [r[k]["random_labels"] for r in per_estate]
        sl = [r[k]["smallest_labels"] for r in per_estate]
        summary["targets"][str(t)] = dict(
            greedy_mean_labels=sum(gl) / len(gl),
            random_mean_labels=sum(rl) / len(rl),
            smallest_mean_labels=sum(sl) / len(sl),
            greedy_reached=sum(1 for r in per_estate if r[k]["greedy_reached"]),
            greedy_vs_random_ratio=(sum(rl) / len(rl)) / (sum(gl) / len(gl))
            if sum(gl) else None,
            greedy_vs_smallest_ratio=(sum(sl) / len(sl)) / (sum(gl) / len(gl))
            if sum(gl) else None,
        )

    # efficiency-vs-group-size curve (the theorem's empirical signature)
    eff_curve = []
    for m in range(2, 21):
        eff_curve.append(dict(group_size=m, delta_d=m * m // 4,
                              labels=m, efficiency=(m * m // 4) / m))

    out = dict(
        summary=summary,
        theorem_verification=verify_bisection_optimality(),
        efficiency_curve=eff_curve,
        designed_space=designed_space_sweep(),
        per_estate=per_estate,
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    # ---- report
    print(f"estates: {summary['n_estates']}")
    print(f"mean ceiling before: {summary['mean_ceiling_before']:.4f}")
    print(f"mean n0 {summary['mean_n0']:.1f}  mean d {summary['mean_d']:.1f}  "
          f"mean max tie-group {summary['mean_max_group']:.2f}")
    print()
    for t in targets:
        s = summary["targets"][str(t)]
        print(f"target ceiling {t}:")
        print(f"  greedy   {s['greedy_mean_labels']:7.1f} labels  "
              f"(reached on {s['greedy_reached']}/{summary['n_estates']} estates)")
        print(f"  random   {s['random_mean_labels']:7.1f} labels  "
              f"({s['greedy_vs_random_ratio']:.2f}x greedy)")
        print(f"  smallest {s['smallest_mean_labels']:7.1f} labels  "
              f"({s['greedy_vs_smallest_ratio']:.2f}x greedy)")
    print()
    tv = out["theorem_verification"]
    print(f"balanced split optimal for all m in 2..{tv[-1]['m']}: "
          f"{all(r['balanced_is_optimal'] for r in tv)}")
    print(f"efficiency at m=2: {eff_curve[0]['efficiency']:.2f}, "
          f"m=10: {eff_curve[8]['efficiency']:.2f}, "
          f"m=20: {eff_curve[18]['efficiency']:.2f}")

    print("\n--- designed space: ceiling and labels-to-0.90 ---")
    print(f"{'n':>6} {'dom%':>6} {'maxgrp':>7} {'ceiling':>8} "
          f"{'greedy':>7} {'random':>7} {'ratio':>6} {'lab/asset':>10}")
    for r in out["designed_space"]:
        t = r["target_0.9"]
        flag = "  (vacuous: d=0)" if r["degenerate"] else ""
        print(f"{r['n']:>6} {r['dominant_frac']:>6.2f} {r['max_group']:>7} "
              f"{r['ceiling']:>8.3f} {t['greedy_labels']:>7} {t['random_labels']:>7.1f} "
              f"{(t['greedy_vs_random_ratio'] or 0):>6.2f} {t['labels_per_asset']:>10.2f}{flag}")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()

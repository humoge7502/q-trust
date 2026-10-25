"""
Metric taxonomy analysis for the Q-Trust ceiling paper.

Reads the 42 real CBOM estates, reconstructs the doctrine ordering (which the
paper proves equals descending key size on this corpus), and computes, per
estate, the value and the attainable ceiling of four rank metrics:

    tau_a  (Kendall tau-a)          ceiling = d / n0
    tau_b  (Kendall tau-b)          ceiling = sqrt(d / n0)
    gamma  (Goodman-Kruskal gamma)  ceiling = 1
    rho    (Spearman rho)           ceiling = max over strict tie-breaks

It also verifies the identity tau_b = gamma * sqrt(d/n0) on random orderings,
and emits bootstrap CIs on the mean ceiling / attainment.

Output: paper/analysis/metric_taxonomy.json
"""
import json
import math
import os
import random
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CBOM_DIR = os.path.join(ROOT, "q-trust-datasets", "planner", "data", "real_cboms")
OUT = os.path.join(ROOT, "q-trust", "paper", "analysis", "metric_taxonomy.json")
DEFAULT_KEY = 2048  # loader default for missing key size (RSA family)


def load_estates():
    estates = []
    for fn in sorted(os.listdir(CBOM_DIR)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(CBOM_DIR, fn), encoding="utf-8") as f:
            d = json.load(f)
        ks = []
        for a in d.get("assets", []):
            k = a.get("key_size")
            if k is None:
                k = DEFAULT_KEY
            ks.append(int(k))
        estates.append((fn, ks))
    return estates


def groups_from_keys(ks):
    """Target preorder: descending key size. Returns list of group sizes."""
    from collections import Counter
    c = Counter(ks)
    return [c[k] for k in sorted(c.keys(), reverse=True)]


def pairs(ks):
    n = len(ks)
    n0 = n * (n - 1) // 2
    d = sum(1 for i in range(n) for j in range(i + 1, n) if ks[i] != ks[j])
    return n, n0, d


def spearman(pred_ranks, target_ranks):
    """Spearman rho with average ranks. pred_ranks/target_ranks are 1-based."""
    n = len(pred_ranks)
    if n < 2:
        return 1.0
    mp = sum(pred_ranks) / n
    mt = sum(target_ranks) / n
    cov = sum((p - mp) * (t - mt) for p, t in zip(pred_ranks, target_ranks))
    vp = sum((p - mp) ** 2 for p in pred_ranks)
    vt = sum((t - mt) ** 2 for t in target_ranks)
    if vp == 0 or vt == 0:
        return 1.0
    return cov / math.sqrt(vp * vt)


def target_avg_ranks(ks):
    """Average rank (1-based) of each asset under the tied target."""
    n = len(ks)
    order = sorted(range(n), key=lambda i: -ks[i])
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and ks[order[j + 1]] == ks[order[i]]:
            j += 1
        avg = (i + 1 + j + 1) / 2.0
        for t in range(i, j + 1):
            ranks[order[t]] = avg
        i = j + 1
    return ranks


def doctrine_pred_ranks(ks):
    """Strict ranking: descending key size, stable by asset index."""
    n = len(ks)
    order = sorted(range(n), key=lambda i: (-ks[i], i))
    ranks = [0] * n
    for r, idx in enumerate(order, 1):
        ranks[idx] = r
    return ranks


def rho_ceiling(ks):
    """Max Spearman rho over strict tie-breaks: contiguous group blocks."""
    n = len(ks)
    order = sorted(range(n), key=lambda i: -ks[i])
    ranks = [0] * n
    i = 0
    r = 1
    while i < n:
        j = i
        while j + 1 < n and ks[order[j + 1]] == ks[order[i]]:
            j += 1
        for t in range(i, j + 1):
            ranks[order[t]] = r
            r += 1
        i = j + 1
    return spearman(ranks, target_avg_ranks(ks))


def tau_from_order(ks, pred_ranks):
    """Return (C, D, ties_pred, ties_target)."""
    n = len(ks)
    C = D = Tx = Ty = 0
    for i in range(n):
        for j in range(i + 1, n):
            dp = pred_ranks[i] - pred_ranks[j]
            dt = ks[i] - ks[j]
            if dt == 0:
                Ty += 1
            elif (dp > 0) != (dt > 0):
                C += 1
            else:
                D += 1
            if dp == 0:
                Tx += 1
    return C, D, Tx, Ty


def main():
    estates = load_estates()
    rows = []
    for fn, ks in estates:
        n, n0, d = pairs(ks)
        if n < 2:
            continue
        C, D, Tx, Ty = tau_from_order(ks, doctrine_pred_ranks(ks))
        gamma = (C - D) / d if d else 1.0
        ta = (C - D) / n0 if d else 1.0
        tb = (C - D) / math.sqrt(n0 * d) if d else 1.0
        rho = spearman(doctrine_pred_ranks(ks), target_avg_ranks(ks))
        rows.append({
            "estate": fn, "n": n, "n0": n0, "d": d,
            "tau_a": ta, "tau_a_ceil": (d / n0) if d else 1.0,
            "tau_b": tb, "tau_b_ceil": math.sqrt(d / n0) if d else 1.0,
            "gamma": gamma, "gamma_ceil": 1.0,
            "rho": rho, "rho_ceil": rho_ceiling(ks),
        })

    def mean(key):
        return sum(r[key] for r in rows) / len(rows)

    # Verify tau_b = gamma * sqrt(d/n0) on random orderings.
    rng = random.Random(42)
    max_err = 0.0
    for fn, ks in estates[:10]:
        n, n0, d = pairs(ks)
        if n < 3 or d == 0:
            continue
        for _ in range(50):
            perm = list(range(n))
            rng.shuffle(perm)
            ranks = [0] * n
            for r, idx in enumerate(perm, 1):
                ranks[idx] = r
            C, D, _, _ = tau_from_order(ks, ranks)
            g = (C - D) / d
            tb = (C - D) / math.sqrt(n0 * d)
            max_err = max(max_err, abs(tb - g * math.sqrt(d / n0)))

    # Bootstrap CI on the mean ceiling (resample estates).
    def boot(key, B=20000):
        vals = [r[key] for r in rows]
        n = len(vals)
        means = []
        for _ in range(B):
            s = sum(vals[rng.randrange(n)] for _ in range(n)) / n
            means.append(s)
        means.sort()
        return means[int(0.025 * B)], means[int(0.975 * B)]

    summary = {
        "n_estates": len(rows),
        "mean_n": mean("n"),
        "mean_d": mean("d"),
        "mean_tau_a": mean("tau_a"),
        "mean_tau_a_ceil": mean("tau_a_ceil"),
        "mean_tau_b": mean("tau_b"),
        "mean_tau_b_ceil": mean("tau_b_ceil"),
        "mean_gamma": mean("gamma"),
        "mean_gamma_ceil": mean("gamma_ceil"),
        "mean_rho": mean("rho"),
        "mean_rho_ceil": mean("rho_ceil"),
        "identity_max_abs_err": max_err,
        "boot_tau_b_ceil": boot("tau_b_ceil"),
        "boot_tau_a_ceil": boot("tau_a_ceil"),
        "boot_rho_ceil": boot("rho_ceil"),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "folds": rows}, f, indent=1)

    print(json.dumps(summary, indent=1))
    print("\nwrote", OUT)


if __name__ == "__main__":
    main()

"""Consolidate every number used in the manuscript into one audited artifact.

Reads only released/regenerated artifacts; performs no new model fitting.
Output: paper/analysis/final_stats.json
"""
from __future__ import annotations
import json
import math
import statistics
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
A = ROOT / "paper" / "analysis"
DATA = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets\planner\data")


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def mean(xs):
    return float(statistics.mean(xs))


def sd(xs):
    return float(statistics.stdev(xs)) if len(xs) > 1 else 0.0


def boot_ci(xs, n=20000, seed=42):
    rng = np.random.default_rng(seed)
    x = np.asarray(xs, dtype=float)
    m = np.array([rng.choice(x, len(x), replace=True).mean() for _ in range(n)])
    return [float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))]


def signflip_p(xs, n=20000, seed=42):
    rng = np.random.default_rng(seed)
    x = np.asarray(xs, dtype=float)
    obs = abs(x.mean())
    cnt = 0
    for _ in range(n):
        s = rng.choice([-1.0, 1.0], len(x))
        if abs((x * s).mean()) >= obs - 1e-15:
            cnt += 1
    return (cnt + 1) / (n + 1)


def paired(model, doctrine):
    d = [m - h for m, h in zip(model, doctrine)]
    return {
        "mean_diff": mean(d),
        "sd_diff": sd(d),
        "ci95": boot_ci(d),
        "perm_p": signflip_p(d),
        "wins": sum(1 for x in d if x > 1e-9),
        "ties": sum(1 for x in d if abs(x) <= 1e-9),
        "losses": sum(1 for x in d if x < -1e-9),
        "cohen_dz": mean(d) / sd(d) if sd(d) else 0.0,
        "mde_80": 2.802 * sd(d) / math.sqrt(len(d)) if d else 0.0,
    }


def ranking_block(loo_path, audit_key):
    loo = load(loo_path)
    load(A / "ceiling_audit.json")[audit_key]
    folds = loo["fold_metrics"]
    names = sorted(folds)
    model = [folds[n]["model"]["kendall"] for n in names]
    heur = [folds[n]["heuristic"]["kendall"] for n in names]
    rand = [folds[n]["random"]["kendall"] for n in names]
    sizes = [folds[n]["n_assets"] for n in names]
    ceilings = {r["name"]: r["ceiling"] for r in load(A / "ceiling_audit.json")["folds_" + audit_key.split("_")[1]]}
    # exact ceiling from audit; fall back to heuristic score
    ceils = [ceilings.get(n, folds[n]["heuristic"]["kendall"]) for n in names]
    distinct = {r["name"]: r["distinct"] for r in load(A / "ceiling_audit.json")["folds_" + audit_key.split("_")[1]]}
    n0 = {r["name"]: r["n0"] for r in load(A / "ceiling_audit.json")["folds_" + audit_key.split("_")[1]]}
    # inversion counts: strict prediction vs tied target
    inv = []
    for n in names:
        d = distinct[n]
        t = folds[n]["model"]["kendall"]
        denom = math.sqrt(n0[n] * d) if d and n0[n] else 0.0
        inv.append((d - t * denom) / 2.0 if denom else 0.0)
    # exclude degenerate folds (n<=2) from a sensitivity mean
    keep = [i for i, s in enumerate(sizes) if s > 2]
    return {
        "n_folds": len(names),
        "n_hosts": loo["n_hosts"],
        "sizes": dict(Counter(sizes)),
        "mean_model": mean(model), "mean_doctrine": mean(heur), "mean_random": mean(rand),
        "sd_model": sd(model), "sd_doctrine": sd(heur),
        "median_model": float(statistics.median(model)),
        "median_doctrine": float(statistics.median(heur)),
        "mean_ceiling": mean(ceils),
        "folds_at_ceiling": sum(1 for m, c in zip(model, ceils) if m >= c - 1e-6),
        "total_pairs": int(sum(n0[n] for n in names)),
        "tied_pairs": int(sum(n0[n] - distinct[n] for n in names)),
        "distinct_pairs": int(sum(distinct[n] for n in names)),
        "total_inversions": float(sum(inv)),
        "pooled_pair_accuracy": float((sum(distinct[n] for n in names) - sum(inv)) / sum(distinct[n] for n in names)),
        "attainment": float(mean([m / c if c else 1.0 for m, c in zip(model, ceils)])),
        "mean_tau_excl_small": mean([model[i] for i in keep]),
        "mean_ceiling_excl_small": mean([ceils[i] for i in keep]),
        "model_vs_doctrine": paired(model, heur),
        "model_vs_random": paired(model, rand),
        "per_fold": {
            n: {"n": sizes[i], "model": model[i], "doctrine": heur[i], "ceiling": ceils[i],
                "distinct": distinct[n], "inversions": inv[i]}
            for i, n in enumerate(names)
        },
    }


def main():
    out = {}

    # ---- ranking ---------------------------------------------------------
    r42 = ranking_block(A / "loo42_zerosyn.json", "cohort_42")
    r38 = ranking_block(A / "loo38_zerosyn.json", "cohort_38")
    out["ranking_42"] = r42
    out["ranking_38"] = r38

    # baseline methods on the 42 folds
    tb = load(A / "transparent_baselines.json")
    lg = {f["name"]: f["logit_tau"] for f in tb["folds"]}
    rg = {f["name"]: f["ridge_tau"] for f in tb["folds"]}
    names = sorted(r42["per_fold"])
    out["transparent_42"] = {
        "logit_mean": mean([lg[n] for n in names]),
        "ridge_mean": mean([rg[n] for n in names]),
        "logit_folds_at_ceiling": sum(1 for n in names if lg[n] >= r42["per_fold"][n]["ceiling"] - 1e-6),
        "ridge_folds_at_ceiling": sum(1 for n in names if rg[n] >= r42["per_fold"][n]["ceiling"] - 1e-6),
        "ridge_exact_gnn_folds": sum(1 for n in names if abs(rg[n] - r42["per_fold"][n]["model"]) < 1e-6),
        "logit_exact_doctrine_folds": sum(1 for n in names if abs(lg[n] - r42["per_fold"][n]["doctrine"]) < 1e-6),
        "ridge_fail_fold": [n for n in names if rg[n] < r42["per_fold"][n]["ceiling"] - 1e-6],
    }
    zs = load(A / "zeroshot_baseline.json")
    out["zeroshot"] = {k: {"model_mean": v["model_mean"], "doctrine_mean": v["doctrine_mean"],
                           "keysize_mean": v["keysize_mean"],
                           "folds_model_equals_doctrine": v["folds_model_equals_doctrine"],
                           "n": v["n_estates"]} for k, v in zs["cohorts"].items()}

    # ---- field audit -----------------------------------------------------
    audit = load(A / "ceiling_audit.json")
    out["field_audit"] = {
        "cohort_42": audit["cohort_42"],
        "cohort_38": audit["cohort_38"],
    }
    # raw composition / constant-field values
    comp = Counter()
    crit = Counter()
    vendor = Counter()
    days = Counter()
    sizes = Counter()
    hosts = Counter()
    est_sizes = []
    for cdir in [DATA / "real_cboms", DATA / "real_cboms_v2_2026_09_18"]:
        Counter() 
        for p in sorted(cdir.glob("*.json")):
            d = load(p)
            assets = d.get("assets") or []
            est_sizes.append(len(assets))
            for a in assets:
                alg = str(a.get("algorithm") or "UNKNOWN").upper()
                comp[alg] += 1
                crit[str(a.get("criticality"))] += 1
                vendor[str(a.get("pqc_ready"))] += 1
                days[str(a.get("not_after"))[:10]] += 1
                hosts[str(a.get("host") or a.get("location") or "")] += 1
        sizes[cdir.name] = len(list(cdir.glob("*.json")))
    out["raw_composition"] = {
        "algorithms": dict(comp.most_common()),
        "criticality": dict(crit),
        "pqc_ready": dict(vendor),
        "not_after_dates": dict(days.most_common(10)),
        "unique_hosts": len(hosts),
        "duplicate_host_records": int(sum(v - 1 for v in hosts.values() if v > 1)),
        "estate_sizes": dict(Counter(est_sizes)),
    }

    # ---- discovery -------------------------------------------------------
    cb = load(A / "codebert_eval.json")
    split = load(ROOT / "paper" / "analysis_split_audit.json")
    nd = load(A / "near_dup_full.json")
    out["discovery"] = {
        "n_files": split["n_files"], "n_repos": split["n_repos"],
        "n_train": split["n_train"], "n_eval": split["n_eval"],
        "eval_prevalence": split["eval_prevalence"],
        "corpus_prevalence": 7632 / 13973,
        "majority_f1": 2 * split["eval_prevalence"] / (1 + split["eval_prevalence"]),
        "precision": cb["precision"], "recall": cb["recall"], "f1": cb["f1"],
        "accuracy": cb["accuracy"], "roc_auc": cb["roc_auc"],
        "average_precision": cb["average_precision"], "brier": cb["brier"],
        "ece_10bin": cb["ece_10bin"],
        "macro_f1_lang_ge10": cb["macro_f1_lang_n_ge_10"],
        "macro_f1_all_lang": cb["macro_f1_all_lang"],
        "per_language": cb["per_language"],
        "risk_coverage": cb["risk_coverage"],
        "contamination_corrected": cb["contamination_corrected"],
        "exact_dup_eval_count": split["exact_dup_eval_count"],
        "near_dup_counts": nd["counts"],
        "near_dup_p99": nd["p99"],
        "confusion": cb["confusion"],
    }
    # bootstrap CI for micro F1, stratified by repository
    preds = [json.loads(l) for l in (A / "codebert_predictions.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    y = np.array([r["label"] for r in preds]); p = np.array([r["prob_crypto"] for r in preds])
    pred = (p >= 0.5).astype(int)
    repos = np.array([r["source"] for r in preds])
    rng = np.random.default_rng(42)
    f1s = []
    for _ in range(5000):
        idx = np.concatenate([np.where(repos == r)[0] for r in rng.choice(np.unique(repos), len(np.unique(repos)), replace=True)])
        yy, pp = y[idx], pred[idx]
        tp = int(((yy == 1) & (pp == 1)).sum()); fp = int(((yy == 0) & (pp == 1)).sum()); fn = int(((yy == 1) & (pp == 0)).sum())
        f1s.append(2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else 0.0)
    out["discovery"]["f1_cluster_bootstrap_95"] = [float(np.percentile(f1s, 2.5)), float(np.percentile(f1s, 97.5))]

    # ---- positive control / RL ------------------------------------------
    out["positive_control"] = load(A / "positive_control.json")["summary"]
    rl = load(ROOT / "planner" / "results" / "rl_benchmark_real_cbom.json")
    out["rl"] = rl

    (A / "final_stats.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({
        "ranking_42": {k: v for k, v in r42.items() if k != "per_fold"},
        "ranking_38": {k: v for k, v in r38.items() if k != "per_fold"},
        "transparent": out["transparent_42"],
        "zeroshot": out["zeroshot"],
        "discovery": {k: v for k, v in out["discovery"].items() if k not in ("per_language", "risk_coverage", "contamination_corrected")},
        "raw": out["raw_composition"],
    }, indent=1))


if __name__ == "__main__":
    main()

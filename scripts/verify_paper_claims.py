"""
Verify every headline claim in the ceiling paper against the committed JSON
artifacts. Prints PASS/FAIL per claim and a final count.

Run from q-trust/:  python scripts/verify_paper_claims.py
"""
import json
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
A = os.path.join(ROOT, "paper", "analysis")

results = []


def check(name, got, want, tol=1e-6):
    ok = abs(float(got) - float(want)) <= tol
    results.append((name, ok, got, want))
    print(f"{'PASS' if ok else 'FAIL'}  {name}: got {got} want {want}")
    return ok


def load(fn):
    with open(os.path.join(A, fn), encoding="utf-8") as f:
        return json.load(f)


def main():
    ceil = load("ceiling_audit.json")
    base = load("transparent_baselines.json")
    pc = load("positive_control.json")
    disc = load("codebert_eval.json")
    tax = load("metric_taxonomy.json")
    clean = load("clean_warmstart_loo.json")
    lab = load("labelling_efficiency.json")

    c42 = ceil["cohort_42"]
    check("ceiling mean (42)", c42["mean_ceiling"], 0.721024)
    check("model tau_b mean", c42["mean_model_tau"], 0.716782)
    check("doctrine tau_b mean", c42["mean_doctrine_tau"], 0.721024)
    check("total pairs", c42["total_pairs"], 803, 0)
    check("tied pairs", c42["total_tied_pairs"], 401, 0)
    check("distinct pairs", c42["total_distinct_pairs"], 402, 0)
    check("folds model at ceiling", c42["folds_model_at_ceiling"], 41, 0)
    check("model inversions", c42["total_model_inversions"], 1, 0)
    check("key-size matches doctrine (42)", c42["key_size_matches_doctrine"], 42, 0)
    check("zero-edge estates", c42["estates_with_zero_edges"], 42, 0)

    c38 = ceil["cohort_38"]
    check("ceiling mean (38)", c38["mean_ceiling"], 0.726632, 1e-5)
    check("distinct pairs (38)", c38["total_distinct_pairs"], 461, 0)

    agg = base["aggregate"]
    check("logit mean tau", agg["logit"]["mean_tau"], 0.721024)
    check("logit folds at ceiling", agg["logit"]["folds_at_ceiling"], 42, 0)
    check("ridge mean tau", agg["ridge"]["mean_tau"], 0.716781)
    check("ridge folds at ceiling", agg["ridge"]["folds_at_ceiling"], 41, 0)

    s = pc["summary"]
    check("positive control gnn", s["gnn"]["mean"], 0.880263, 1e-5)
    check("positive control doctrine", s["doctrine"]["mean"], 0.917330, 1e-5)
    check("positive control keysize", s["keysize"]["mean"], 0.189682, 1e-5)
    check("positive control p", s["gnn_minus_doctrine"]["wilcoxon_p"], 5.232e-10, 1e-12)

    check("discovery F1", disc["f1"], 0.939515, 1e-5)
    check("discovery precision", disc["precision"], 0.927895, 1e-5)
    check("discovery recall", disc["recall"], 0.951430, 1e-5)
    check("discovery eval base rate", disc["base_rate_eval"], 0.767288, 1e-5)

    ts = tax["summary"]
    check("taxonomy gamma mean", ts["mean_gamma"], 1.0, 1e-9)
    check("taxonomy tau_b mean", ts["mean_tau_b"], 0.721024, 1e-6)
    check("taxonomy tau_a mean", ts["mean_tau_a"], 0.532993, 1e-5)
    check("taxonomy rho mean", ts["mean_rho"], 0.806549, 1e-5)
    check("identity tau_b = gamma*sqrt(d/n0) max err", ts["identity_max_abs_err"], 0.0, 1e-12)

    check("clean warmstart tau", clean["metrics_clean"]["kendall"], 0.600887, 1e-5)
    check("clean warmstart delta", clean["paired_clean"]["mean"], -0.120136, 1e-5)
    check("clean warmstart p", clean["paired_clean"]["p"], 0.001789, 1e-5)
    check("clean n_real_graphs", clean["clean_base_n_real_graphs"], 0, 0)
    check("contaminated n_real_graphs", clean["contaminated_base_n_real_graphs"], 40, 0)

    # Identity re-derivation from pooled counts.
    gamma = (c42["total_distinct_pairs"] - 0) / c42["total_distinct_pairs"]
    tau_b_pooled = gamma * math.sqrt(c42["total_distinct_pairs"] / c42["total_pairs"])
    check("pooled identity tau_b", tau_b_pooled, 0.707547, 1e-5)

    # ---- Labelling efficiency (Section "marginal cost of validity") ----
    ls = lab["summary"]
    check("labelling mean ceiling (42)", ls["mean_ceiling_before"], 0.721024, 1e-5)
    check("labelling mean n0 (42)", ls["mean_n0"], 19.1, 0.05)
    check("labelling mean d (42)", ls["mean_d"], 9.6, 0.05)
    check("labelling mean max group (42)", ls["mean_max_group"], 4.50, 0.01)
    t90 = ls["targets"]["0.9"]
    check("labels to 0.90 greedy (42)", t90["greedy_mean_labels"], 7.2, 0.05)
    check("labels to 0.90 random (42)", t90["random_mean_labels"], 7.7, 0.05)
    check("labels to 0.90 smallest (42)", t90["smallest_mean_labels"], 7.8, 0.05)
    check("greedy reached 0.90 on all estates", t90["greedy_reached"], 42, 0)

    # Theorem: balanced split is optimal for every m in [2, 24].
    tv = lab["theorem_verification"]
    check("bisection optimal for all m<=24",
          sum(1 for r in tv if r["balanced_is_optimal"]), len(tv), 0)

    # Efficiency m/4 signature.
    ec = {r["group_size"]: r["efficiency"] for r in lab["efficiency_curve"]}
    check("efficiency at m=2", ec[2], 0.5)
    check("efficiency at m=20", ec[20], 5.0)

    # Designed space: ceiling governed by concentration, not size.
    ds = {(r["n"], round(r["dominant_frac"], 2)): r for r in lab["designed_space"]}
    check("ceiling n=10 dom=0.90", ds[(10, 0.90)]["ceiling"], 0.447, 0.001)
    check("ceiling n=100 dom=0.90", ds[(100, 0.90)]["ceiling"], 0.435, 0.001)
    check("ceiling n=1000 dom=0.90", ds[(1000, 0.90)]["ceiling"], 0.431, 0.001)
    check("ceiling n=5000 dom=0.90", ds[(5000, 0.90)]["ceiling"], 0.432, 0.001)
    check("labels to 0.90 n=1000 dom=0.90",
          ds[(1000, 0.90)]["target_0.9"]["greedy_labels"], 2025, 0)
    check("labels to 0.90 n=5000 dom=0.90",
          ds[(5000, 0.90)]["target_0.9"]["greedy_labels"], 10125, 0)
    check("labels/asset n=1000 dom=0.90",
          ds[(1000, 0.90)]["target_0.9"]["labels_per_asset"], 2.025, 1e-3)

    n = len(results)
    ok = sum(1 for r in results if r[1])
    print(f"\n=== {ok}/{n} claims verified ===")
    if ok != n:
        print("FAILURES:")
        for name, good, got, want in results:
            if not good:
                print(f"  - {name}: got {got} want {want}")
        sys.exit(1)


if __name__ == "__main__":
    main()

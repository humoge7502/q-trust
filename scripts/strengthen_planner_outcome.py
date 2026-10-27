#!/usr/bin/env python3
"""Planner strengthening experiment (E-12): does more synthetic data +
longer training improve dependency-dense (precedence) sequencing?

E-09 established the outcome-LOO result (GNN 1.0000 on the 42 real estates,
optimum) and a precedence probe (GNN 1.049 vs Smith 1.065 vs heuristic 1.128)
using 200 synthetic training estates / 40 epochs. This experiment holds the
42-estate real corpus fixed and varies ONLY the synthetic budget and epoch
count, measuring each config on:

  (a) a FIXED, never-trained probe set of 60 dependency-dense synthetic
      estates (seed 999_999, disjoint from every training seed), and
  (b) the 42 real estates (regression check: must stay at the optimum).

Each config trains R models with different seeds; report mean ± stdev of the
probe QRD ratio. All CPU. Honest framing: simulation-grounded objective
(qrd-sim/1.0); synthetic-baseline probe, not real estates.

Run:  python scripts/strengthen_planner_outcome.py --seeds 2
      python scripts/strengthen_planner_outcome.py            # default 5 seeds
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "planner"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

RESULT_PATH = REPO_ROOT / "planner" / "results" / "planner_strengthening.json"

CONFIGS = [
    {"name": "A-e09-baseline", "n_synthetic": 200, "epochs": 40, "real_repeat": 6},
    {"name": "B-4x-data", "n_synthetic": 800, "epochs": 70, "real_repeat": 6},
]

PROBE_SEED = 999_999
PROBE_N = 40


def main() -> None:

    import torch

    from eval_outcome_loo import _gnn_scores, _train_fold
    from qtrust_planner.outcome_sim import (
        build_outcome_graph, feasible_projection, generate_synthetic_estates,
        heuristic_priority_scores, load_estates, optimal_order)

    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--device", type=str, default="cpu")
    args = ap.parse_args()

    device = torch.device(args.device)
    estates = load_estates(REPO_ROOT / "planner" / "data" / "real_cboms")

    # Fixed probe set: dependency-dense, never used in training (training
    # synthetic seeds derive from Random(42) fold seeds; 999_999 is disjoint).
    probe = generate_synthetic_estates(PROBE_N, seed=PROBE_SEED,
                                       min_n=8, max_n=12)
    probe_graphs = [build_outcome_graph(e) for e in probe]
    # build_outcome_graph already ran the exact DP for its labels — read the
    # optimal order back out of y_order instead of re-solving.
    def _order_from_graph(g):
        rank = g.y_order.tolist()
        return sorted(range(len(rank)), key=lambda i: rank[i])
    probe_opt = [e.total_quantum_risk_days(_order_from_graph(g))
                 for g, e in zip(probe_graphs, probe)]
    # Static baselines on the probe (deterministic, seed-independent).
    probe_static = {"heuristic": [], "smith": []}
    for e in probe:
        for m, scores in (
            ("heuristic", heuristic_priority_scores(e)),
            ("smith", [e.assets[i].exposure_weight / e.assets[i].duration_days
                       for i in range(e.n)]),
        ):
            order = feasible_projection(scores, e)
            probe_static[m].append(
                e.total_quantum_risk_days(order) / probe_opt[probe.index(e)])
    probe_static = {m: statistics.mean(v) for m, v in probe_static.items()}
    print(f"probe baselines: heuristic {probe_static['heuristic']:.4f} | "
          f"smith {probe_static['smith']:.4f}")

    results = {"probe_spec": {"seed": PROBE_SEED, "n": PROBE_N,
                              "min_n": 8, "max_n": 12},
               "baselines": probe_static, "configs": {}}

    for cfg in CONFIGS:
        rows = []
        t0 = time.time()
        for k in range(args.seeds):
            seed = 42_000 + k * 77
            syn = generate_synthetic_estates(cfg["n_synthetic"], seed=seed)
            graphs = []
            for e in estates:
                g = build_outcome_graph(e)
                graphs.extend([g] * cfg["real_repeat"])
            graphs += [build_outcome_graph(e) for e in syn]
            model = _train_fold(graphs, cfg["epochs"], 32, 1e-3, seed, device)

            # (a) probe evaluation
            ratios = []
            for g, e, opt_qrd in zip(probe_graphs, probe, probe_opt):
                scores = _gnn_scores(model, g, device)
                order = feasible_projection(scores, e)
                ratios.append(e.total_quantum_risk_days(order) / opt_qrd)
            # (b) real-estate regression check
            real_ratios = []
            for e in estates:
                g = build_outcome_graph(e)
                scores = _gnn_scores(model, g, device)
                order = feasible_projection(scores, e)
                o = e.total_quantum_risk_days(optimal_order(e))
                real_ratios.append(
                    e.total_quantum_risk_days(order) / o if o > 0 else 1.0)
            rows.append({
                "seed": seed,
                "probe_ratio_mean": statistics.mean(ratios),
                "probe_ratio_max": max(ratios),
                "real_ratio_mean": statistics.mean(real_ratios),
                "real_at_optimum": sum(
                    1 for r in real_ratios if abs(r - 1.0) < 1e-6),
            })
            print(f"  {cfg['name']} seed {seed}: probe "
                  f"{rows[-1]['probe_ratio_mean']:.4f} real "
                  f"{rows[-1]['real_ratio_mean']:.4f} "
                  f"({time.time()-t0:.0f}s)")
        results["configs"][cfg["name"]] = {
            "n_synthetic": cfg["n_synthetic"], "epochs": cfg["epochs"],
            "real_repeat": cfg["real_repeat"], "runs": rows,
            "probe_ratio_mean_of_means": round(statistics.mean(
                r["probe_ratio_mean"] for r in rows), 6),
            "probe_ratio_stdev": round(statistics.stdev(
                [r["probe_ratio_mean"] for r in rows]), 6) if len(rows) > 1 else 0.0,
            "real_ratio_mean_of_means": round(statistics.mean(
                r["real_ratio_mean"] for r in rows), 6),
            "real_at_optimum_total": sum(r["real_at_optimum"] for r in rows),
            "real_evals": len(rows) * len(estates),
        }
        print(f"{cfg['name']}: probe "
              f"{results['configs'][cfg['name']]['probe_ratio_mean_of_means']:.4f}"
              f" ± {results['configs'][cfg['name']]['probe_ratio_stdev']:.4f}")

    results["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    results["honesty_note"] = (
        "Simulation-grounded objective (qrd-sim/1.0). Probe = synthetic "
        "dependency-dense estates (never trained); real = the 42 host-disjoint "
        "estates. Baselines are deterministic; model rows are mean over seeds.")
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(json.dumps(results, indent=2))
    print(f"wrote {RESULT_PATH}")


if __name__ == "__main__":
    main()

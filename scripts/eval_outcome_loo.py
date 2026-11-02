#!/usr/bin/env python3
"""Leave-one-out OUTCOME-based evaluation: GNN vs heuristic vs Smith vs optimum.

Why (2026-10-23): the shipped LOO protocol scores ranking agreement against
formula-generated labels, which makes the static heuristic the ceiling *by
construction* (it replicates the label formula; its τ-b 0.7210 is exactly the
mean per-fold tie ceiling). This harness re-baselines the comparison on an
**outcome objective** — total quantum-risk-days (QRD) under a transparent,
versioned execution simulation (``qtrust_planner.outcome_sim``):

  QRD(order) = Σ_i (risk_rate_i × criticality_i) × C_i(order)

under sequential execution and dependency constraints, with every ranking
executed through the same dependency-feasible list-scheduling projection a
programme office would use. The heuristic is no longer the label generator:
it ignores durations and exposure weights, so a learned model has genuine
headroom.

Protocol (mirrors scripts/eval_real_cbom_loo.py):
  1. Host-disjoint 42-estate real corpus.
  2. Leave-one-out: per fold, train a fresh MigrationGNNv3 (norm=layer,
     10-dim outcome features) on the other 41 estates (outcome-optimal
     labels, repeated) + a seeded synthetic estate mix with dependency DAGs.
  3. Evaluate the held-out estate: GNN ranking → feasible projection → QRD;
     identical treatment for the static heuristic, Smith's rule, random.
     The exact DP optimum anchors the ratio scale (ratio = QRD/optimal ≤ 1
     impossible; 1.0 = optimal).
  4. Paired statistics across folds (Wilcoxon signed-rank, bootstrap CI).
  5. Precedence generalization probe: each fold model is also scored on a
     fixed seeded set of dependency-dense synthetic estates.

Honesty: labels are simulation-grounded (SIM_SPEC_VERSION pinned), derived
from real CBOM structure + documented assumptions — not observed org
outcomes. Report results with that framing.

Usage:
    python scripts/eval_outcome_loo.py --quick          # 3 folds (smoke)
    python scripts/eval_outcome_loo.py                  # full 42 folds
    python scripts/eval_outcome_loo.py --epochs 40 --n-synthetic 200
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "planner"))

CBOM_DIR = REPO_ROOT / "planner" / "data" / "real_cboms"
RESULT_PATH = REPO_ROOT / "planner" / "results" / "outcome_loo_42.json"


def _train_fold(train_graphs, epochs: int, batch_size: int, lr: float,
                seed: int, device):
    """Train a fresh MigrationGNNv3 on outcome-optimal labels (ListMLE)."""
    import torch
    from torch_geometric.loader import DataLoader
    from qtrust_planner.model_v3 import MigrationGNNv3
    from qtrust_planner.train_gpu import per_graph_listMLE_loss

    torch.manual_seed(seed)
    model = MigrationGNNv3(
        input_features=10, hidden_dim=128, embedding_dim=64, heads=4,
        dropout=0.1, norm="layer",
    ).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)

    gen = torch.Generator().manual_seed(seed)
    loader = DataLoader(train_graphs, batch_size=batch_size, shuffle=True,
                        generator=gen if str(device) == "cpu" else None)
    model.train()
    for _ in range(epochs):
        for batch in loader:
            batch = batch.to(device)
            order_logits, _ = model(batch)
            loss = per_graph_listMLE_loss(order_logits, batch.y_order,
                                          getattr(batch, "batch", None))
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
    return model.eval()


def _gnn_scores(model, graph, device) -> list[float]:
    import torch
    g = graph.to(device)
    with torch.no_grad():
        logits, _ = model(g)
    return logits.float().cpu().tolist()


def _tau_b(order: list[int], estate) -> float:
    """Tie-aware Kendall τ-b of a predicted order vs the outcome-optimal
    order (positions). Optimal orders are generically unique, so the ceiling
    is 1.0 — no tie pathology."""
    from scipy.stats import kendalltau
    from qtrust_planner.outcome_sim import optimal_order
    n = estate.n
    if n < 2:
        return 1.0
    opt = optimal_order(estate)
    opt_rank = [0] * n
    for pos, node in enumerate(opt):
        opt_rank[node] = pos
    pred_rank = [0] * n
    for pos, node in enumerate(order):
        pred_rank[node] = pos
    return float(kendalltau(pred_rank, opt_rank, variant="b").statistic)


def _wilcoxon(deltas: list[float]) -> dict:
    """One-sided Wilcoxon signed-rank on deltas = heuristic − method
    (positive = method better); H1: deltas centred ABOVE zero."""
    try:
        from scipy.stats import wilcoxon
        if len(deltas) < 5 or all(abs(d) < 1e-12 for d in deltas):
            return {"statistic": None, "p_value": None, "n": len(deltas)}
        res = wilcoxon(deltas, alternative="greater")
        return {"statistic": float(res.statistic),
                "p_value": float(res.pvalue), "n": len(deltas)}
    except Exception as exc:  # pragma: no cover - stats nicety only
        return {"error": str(exc)}


def _bootstrap_ci(vals: list[float], seed: int = 0, n_boot: int = 5000):
    rng = random.Random(seed)
    means = []
    for _ in range(n_boot):
        sample = [vals[rng.randrange(len(vals))] for _ in vals]
        means.append(statistics.mean(sample))
    means.sort()
    lo = means[int(0.025 * n_boot)]
    hi = means[int(0.975 * n_boot)]
    return {"mean": statistics.mean(vals), "ci95_lo": lo, "ci95_hi": hi}


def run(args) -> dict:
    import torch
    from qtrust_planner.outcome_sim import (
        SIM_SPEC_VERSION, build_outcome_graph, feasible_projection,
        generate_synthetic_estates, heuristic_priority_scores,
        load_estates, optimal_order,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    estates = load_estates(args.cbom_dir)
    if args.quick:
        estates = estates[:3]
    n_total = len(estates)
    print(f"Outcome LOO over {n_total} estates on {device} "
          f"(sim spec {SIM_SPEC_VERSION})")

    # Fixed precedence-generalization probe set (same for every fold).
    probe_estates = generate_synthetic_estates(args.n_probe, seed=777)

    fold_seeds = random.Random(42)
    seeds = [fold_seeds.randint(0, 1_000_000) for _ in estates]

    methods = ("gnn", "heuristic", "smith", "random")
    ratios: dict[str, list[float]] = {m: [] for m in methods}
    taus: dict[str, list[float]] = {m: [] for m in methods}
    probe_ratios: dict[str, list[float]] = {m: [] for m in methods}
    fold_rows: dict[str, dict] = {}
    t0 = time.time()

    for fold, held in enumerate(estates):
        seed = seeds[fold]
        # ---- training set: 41 held-in real estates (repeated) + synthetic
        train_estates = [e for e in estates if e is not held]
        syn = generate_synthetic_estates(args.n_synthetic, seed=seed)
        train_graphs = []
        for e in train_estates:
            g = build_outcome_graph(e)          # exact optimal labels
            for _ in range(args.real_repeat):
                train_graphs.append(g)
        train_graphs += [build_outcome_graph(e) for e in syn]

        model = _train_fold(train_graphs, args.epochs, args.batch_size,
                            args.lr, seed, device)
        held_graph = build_outcome_graph(held)

        opt = held.total_quantum_risk_days(optimal_order(held))
        rng = random.Random(seed)
        scores = {
            "gnn": _gnn_scores(model, held_graph, device),
            "heuristic": heuristic_priority_scores(held),
            "smith": [held.assets[i].exposure_weight /
                      held.assets[i].duration_days for i in range(held.n)],
            "random": [rng.random() for _ in range(held.n)],
        }
        row: dict = {"n_assets": held.n, "qrd_optimal": round(opt, 4)}
        for m in methods:
            order = feasible_projection(scores[m], held)
            qrd = held.total_quantum_risk_days(order)
            ratio = qrd / opt if opt > 0 else 1.0
            ratios[m].append(ratio)
            taus[m].append(_tau_b(order, held))
            row[m] = {"qrd": round(qrd, 4), "ratio": round(ratio, 6),
                      "tau_b": round(taus[m][-1], 6)}
        fold_rows[held.name] = row

        # ---- precedence probe on fixed synthetic estates
        pg = build_outcome_graph(probe_estates[fold % len(probe_estates)])
        popt = probe_estates[fold % len(probe_estates)]
        po = popt.total_quantum_risk_days(optimal_order(popt))
        prng = random.Random(seed + 1)
        pscores = {
            "gnn": _gnn_scores(model, pg, device),
            "heuristic": heuristic_priority_scores(popt),
            "smith": [popt.assets[i].exposure_weight /
                      popt.assets[i].duration_days for i in range(popt.n)],
            "random": [prng.random() for _ in range(popt.n)],
        }
        for m in methods:
            order = feasible_projection(pscores[m], popt)
            probe_ratios[m].append(
                popt.total_quantum_risk_days(order) / po if po > 0 else 1.0)

        print(f"  fold {fold+1:>2}/{n_total} {held.name}: "
              f"gnn={row['gnn']['ratio']:.4f} heur={row['heuristic']['ratio']:.4f} "
              f"smith={row['smith']['ratio']:.4f} "
              f"({time.time()-t0:.0f}s)")

    def _summary(vals: dict[str, list[float]]) -> dict:
        return {m: {
            "mean": round(statistics.mean(v), 6),
            "median": round(statistics.median(v), 6),
            "stdev": round(statistics.stdev(v), 6) if len(v) > 1 else 0.0,
            "max": round(max(v), 6),
            "bootstrap": {k: round(x, 6) for k, x in
                          _bootstrap_ci(v).items()},
        } for m, v in vals.items()}

    report = {
        "protocol": "leave-one-out outcome evaluation (host-disjoint estates)",
        "objective": "quantum-risk-days (QRD) under qrd-sim execution model",
        "sim_spec_version": SIM_SPEC_VERSION,
        "honesty_note": (
            "Simulation-grounded labels from real CBOM structure + documented "
            "assumptions (SIM_SPEC_VERSION); NOT observed org outcomes. "
            "Every ranking executed via the same dependency-feasible "
            "list-scheduling projection; ratio = QRD / exact-DP optimum."),
        "n_estates": n_total,
        "config": {
            "epochs": args.epochs, "n_synthetic": args.n_synthetic,
            "n_probe": args.n_probe, "real_repeat": args.real_repeat,
            "batch_size": args.batch_size, "lr": args.lr, "seed": 42,
            "model": "MigrationGNNv3(input=10, hidden=128, embed=64, "
                     "heads=4, norm=layer, dropout=0.1)",
            "loss": "per-graph ListMLE on outcome-optimal ranks",
        },
        "aggregate_qrd_ratio": _summary(ratios),
        "aggregate_tau_b_vs_optimal": _summary(taus),
        "precedence_probe_qrd_ratio": _summary(probe_ratios),
        "paired_vs_heuristic": {
            "gnn": {
                "delta_mean": round(statistics.mean(
                    [h - g for g, h in zip(ratios["gnn"], ratios["heuristic"])]), 6),
                "wilcoxon_less": _wilcoxon(
                    [h - g for g, h in zip(ratios["gnn"], ratios["heuristic"])]),
                "wins/ties/losses": _wl(ratios["gnn"], ratios["heuristic"]),
            },
            "smith": {
                "delta_mean": round(statistics.mean(
                    [h - s for s, h in zip(ratios["smith"], ratios["heuristic"])]), 6),
                "wilcoxon_less": _wilcoxon(
                    [h - s for s, h in zip(ratios["smith"], ratios["heuristic"])]),
                "wins/ties/losses": _wl(ratios["smith"], ratios["heuristic"]),
            },
            "random": {
                "delta_mean": round(statistics.mean(
                    [h - r for r, h in zip(ratios["random"], ratios["heuristic"])]), 6),
                "wilcoxon_less": _wilcoxon(
                    [h - r for r, h in zip(ratios["random"], ratios["heuristic"])]),
                "wins/ties/losses": _wl(ratios["random"], ratios["heuristic"]),
            },
        },
        "fold_metrics": fold_rows,
        "device": str(device),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    print(f"\nWrote {out}")
    for m in methods:
        print(f"  {m:<10} mean QRD ratio {report['aggregate_qrd_ratio'][m]['mean']:.4f}"
              f"  (Δ vs heuristic "
              f"{report['paired_vs_heuristic'].get(m, {}).get('delta_mean', 0):+.4f})")
    return report


def _wl(a: list[float], b: list[float]) -> str:
    w = sum(1 for x, y in zip(a, b) if x < y - 1e-9)
    t = sum(1 for x, y in zip(a, b) if abs(x - y) <= 1e-9)
    losses = sum(1 for x, y in zip(a, b) if x > y + 1e-9)
    return f"{w}/{t}/{losses}"


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    p = argparse.ArgumentParser(description="Outcome-based LOO evaluation")
    p.add_argument("--epochs", type=int, default=40)
    p.add_argument("--n-synthetic", type=int, default=200)
    p.add_argument("--n-probe", type=int, default=40)
    p.add_argument("--real-repeat", type=int, default=6)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--cbom-dir", type=Path, default=CBOM_DIR)
    p.add_argument("--out", type=Path, default=RESULT_PATH)
    p.add_argument("--quick", action="store_true")
    run(p.parse_args())

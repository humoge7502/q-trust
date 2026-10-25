#!/usr/bin/env python3
"""Fit and ship the temperature-scaling calibrator for the crypto detector.

Reads the per-file held-out predictions (``paper/analysis/codebert_predictions.jsonl``
produced by ``scripts/paper_codebert_reeval.py``), 5-fold cross-fits a
temperature, and writes ``qtrust_ai/artifacts/calibration.json`` with:

  - the pooled temperature (median of fold temperatures) shipped for
    inference,
  - cross-fitted ECE/Brier before vs after (no leakage, no lucky split),
  - a fixed-threshold note (ranking is unchanged by temperature scaling).

Also prints the reliability deltas. Deterministic (seed 42).

Usage:
    python scripts/calibrate_codebert.py
    python scripts/calibrate_codebert.py --predictions <jsonl> --out <json>
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from qtrust_ai.discovery.calibration import (  # noqa: E402
    PlattScaler,
    TemperatureScaler,
    cross_fitted_calibration,
)

DEFAULT_PREDICTIONS = REPO_ROOT / "paper" / "analysis" / "codebert_predictions.jsonl"
DEFAULT_OUT = REPO_ROOT / "qtrust_ai" / "artifacts" / "calibration.json"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--predictions", type=Path, default=DEFAULT_PREDICTIONS)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = p.parse_args()

    rows = [json.loads(line) for line in
            args.predictions.read_text().splitlines() if line.strip()]
    probs = [float(r["prob_crypto"]) for r in rows]
    labels = [int(r["label"]) for r in rows]
    print(f"Loaded {len(probs)} held-out predictions from {args.predictions}")

    # Cross-fitted comparison of both monotone calibrators; ship the winner
    # by cross-fitted ECE (tie -> Platt for its extra asymmetry capacity).
    cf_by_method = {
        m: cross_fitted_calibration(probs, labels, n_folds=5, seed=42, method=m)
        for m in ("temperature", "platt")
    }
    winner = min(cf_by_method, key=lambda m: cf_by_method[m]["ece_10bin_after"])
    cf = cf_by_method[winner]
    print(f"Cross-fitted ECE — temperature: "
          f"{cf_by_method['temperature']['ece_10bin_after']:.4f} | "
          f"platt: {cf_by_method['platt']['ece_10bin_after']:.4f} "
          f"-> shipping '{winner}'")

    if winner == "temperature":
        pooled = statistics.median(
            [p["temperature"] for p in cf["params_per_fold"]])
        scaler = TemperatureScaler(temperature=round(pooled, 6), fitted=True,
                                   n_calibration=len(probs))
        shipped = {"temperature": round(pooled, 6)}
    else:
        a_pool = statistics.median([p["a"] for p in cf["params_per_fold"]])
        b_pool = statistics.median([p["b"] for p in cf["params_per_fold"]])
        scaler = PlattScaler(a=round(a_pool, 6), b=round(b_pool, 6),
                             fitted=True, n_calibration=len(probs))
        shipped = {"a": round(a_pool, 6), "b": round(b_pool, 6)}
    scaler.save(args.out)

    report = {
        "predictions_source": str(args.predictions.relative_to(REPO_ROOT)),
        "n": cf["n"],
        "model_selection": {
            "cross_fitted_ece_after": {
                m: round(cf_by_method[m]["ece_10bin_after"], 6)
                for m in cf_by_method},
            "selected": winner,
        },
        "cross_fitted": {
            "params_per_fold": cf["params_per_fold"],
            "ece_10bin_before": round(cf["ece_10bin_before"], 6),
            "ece_10bin_after": round(cf["ece_10bin_after"], 6),
            "brier_before": round(cf["brier_before"], 6),
            "brier_after": round(cf["brier_after"], 6),
        },
        "shipped_params": shipped,
        "ece_reduction_pct": round(
            100.0 * (1 - cf["ece_10bin_after"] / cf["ece_10bin_before"]), 2),
        "note": (
            "Calibration is monotone: ranking, ROC-AUC, and "
            "precision/recall/F1 at any fixed threshold ranking are "
            "unchanged. Threshold choice may be revisited on calibrated "
            "values; defaults kept."),
    }
    artifact = json.loads(args.out.read_text())
    artifact["evaluation"] = report
    args.out.write_text(json.dumps(artifact, indent=2))

    print(f"ECE 10-bin: {cf['ece_10bin_before']:.4f} -> "
          f"{cf['ece_10bin_after']:.4f} "
          f"(-{report['ece_reduction_pct']:.1f}%)")
    print(f"Brier:      {cf['brier_before']:.4f} -> "
          f"{cf['brier_after']:.4f}")
    print(f"Shipped params: {shipped}")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()

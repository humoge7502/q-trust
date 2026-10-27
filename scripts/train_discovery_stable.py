#!/usr/bin/env python3
"""Train and honestly evaluate a crypto code detector on a stable split.

Why this script exists
----------------------
The v3 training run used a split that reshuffled every repository whenever the
corpus grew. As a result, v3 and v4 numbers were not comparable, and the old
v3 checkpoint had trained on 9 of the 12 repositories in a stable v4 holdout.
This script uses :mod:`qtrust_ai.discovery.data_split` (keyed SHA-256 source
buckets) so:

* fit / calibration / evaluation repositories are disjoint;
* adding repositories never moves an existing repository between splits;
* the calibration set is never used to train or to select the final model;
* the evaluation set is never used for temperature scaling or threshold
  selection.

It writes a checkpoint, a checkpoint-local calibration + threshold, and a
machine-readable report. A separate comparison script consumes the reports.

Examples
--------
    python scripts/train_discovery_stable.py --corpus-version 4 \
        --name v4-stable --epochs 2 --max-len 192 --batch-size 16
    python scripts/train_discovery_stable.py --corpus-version 3 \
        --name v3-stable --epochs 2 --max-len 192 --batch-size 16
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

DATASETS = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets")
CORPUS_PATHS = {
    3: DATASETS / "code_corpus_v3.json",
    4: DATASETS / "code_corpus_v4.json",
}


def _threshold_sweep(probs: list[float], labels: list[int]) -> dict:
    """Choose the F1-maximising threshold on a calibration split."""
    if not probs:
        return {"threshold": 0.5, "f1": 0.0, "precision": 0.0, "recall": 0.0}
    candidates = sorted({0.5, *[round(p, 4) for p in probs]})
    candidates = [t for t in candidates if 0.02 <= t <= 0.98]
    best = {"threshold": 0.5, "f1": -1.0, "precision": 0.0, "recall": 0.0}
    for threshold in candidates:
        tp = fp = fn = 0
        for p, y in zip(probs, labels):
            pred = p >= threshold
            if y and pred:
                tp += 1
            elif y and not pred:
                fn += 1
            elif not y and pred:
                fp += 1
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        if f1 > best["f1"] + 1e-12:
            best = {
                "threshold": round(float(threshold), 4),
                "f1": round(float(f1), 4),
                "precision": round(float(precision), 4),
                "recall": round(float(recall), 4),
            }
    return best


def _dataset_stats(rows: list[dict]) -> dict:
    return {
        "files": len(rows),
        "crypto": sum(1 for r in rows if r.get("is_crypto")),
        "sources": len({r.get("source", "unknown") for r in rows}),
        "languages": dict(Counter(str(r.get("language", "unknown")) for r in rows).most_common()),
        "labels": dict(Counter(str(r.get("label", "NONE")) for r in rows).most_common(15)),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--corpus-version", type=int, choices=sorted(CORPUS_PATHS), default=4)
    ap.add_argument("--eval-corpus-version", type=int, choices=sorted(CORPUS_PATHS), default=None,
                    help="use another corpus version's stable evaluation split "
                         "(for a fair baseline whose corpus lacks the candidate's new sources)")
    ap.add_argument("--name", default="v4-stable")
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--max-len", type=int, default=192)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--max-chunks", type=int, default=4,
                    help="overlapping inference windows; 1 reproduces the historical "
                         "single-window behaviour")
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--max-train", type=int, default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--skip-ensemble-eval", action="store_true")
    args = ap.parse_args()

    from qtrust_ai.discovery.calibration import (
        TemperatureScaler,
        brier_score,
        expected_calibration_error,
    )
    from qtrust_ai.discovery.code_detector import CryptoCodeDetector
    from qtrust_ai.discovery.data_split import split_corpus

    corpus_path = CORPUS_PATHS[args.corpus_version]
    if not corpus_path.exists():
        raise SystemExit(f"corpus not found: {corpus_path}")
    corpus_doc = json.loads(corpus_path.read_text(encoding="utf-8"))
    corpus = corpus_doc["corpus"]
    fit, calibration, evaluation = split_corpus(corpus, seed=args.seed)
    if args.eval_corpus_version and args.eval_corpus_version != args.corpus_version:
        eval_path = CORPUS_PATHS[args.eval_corpus_version]
        eval_doc = json.loads(eval_path.read_text(encoding="utf-8"))
        _eval_fit, _eval_cal, evaluation = split_corpus(eval_doc["corpus"], seed=args.seed)
        print(f"evaluation split overridden from corpus v{args.eval_corpus_version}: "
              f"{len(evaluation)} files / "
              f"{len({r['source'] for r in evaluation})} sources")
    if args.max_train:
        fit = fit[: args.max_train]
    if not fit or not calibration or not evaluation:
        raise SystemExit("split produced an empty fit/calibration/evaluation partition")
    fit_sources = sorted({r["source"] for r in fit})
    cal_sources = sorted({r["source"] for r in calibration})
    eval_sources = sorted({r["source"] for r in evaluation})
    for left, right, label in (
        (fit_sources, cal_sources, "fit/cal"),
        (fit_sources, eval_sources, "fit/eval"),
        (cal_sources, eval_sources, "cal/eval"),
    ):
        overlap = set(left) & set(right)
        if overlap:
            raise SystemExit(f"source leak in {label}: {sorted(overlap)[:5]}")

    print(f"corpus v{args.corpus_version}: {len(corpus)} files / "
          f"{len({r['source'] for r in corpus})} sources")
    print(f"fit: {len(fit)} files / {len(fit_sources)} sources")
    print(f"cal: {len(calibration)} files / {len(cal_sources)} sources")
    print(f"eval: {len(evaluation)} files / {len(eval_sources)} sources")
    print(f"eval crypto base rate: "
          f"{sum(1 for r in evaluation if r.get('is_crypto')) / len(evaluation):.4f}")

    ckpt = REPO_ROOT / "qtrust_ai" / "artifacts" / f"crypto_codebert_{args.name}"
    det = CryptoCodeDetector(seed=args.seed)
    det.set_max_chunks(args.max_chunks)
    t0 = time.time()
    fit_result = det.fine_tune(
        fit,
        epochs=args.epochs,
        lr=args.lr,
        batch_size=args.batch_size,
        max_len=args.max_len,
        save_dir=str(ckpt),
    )
    train_seconds = round(time.time() - t0, 1)
    print(f"fit complete in {train_seconds / 60:.1f} min: {fit_result}")
    if fit_result.get("status") != "trained":
        raise SystemExit(f"training did not complete: {fit_result}")

    # Calibration and threshold are selected on a source-disjoint split.
    t0 = time.time()
    cal_probs_raw = det.score_codes(calibration, batch_size=args.batch_size,
                                    calibrated=False)
    cal_labels = [1 if r.get("is_crypto") else 0 for r in calibration]
    sweep = _threshold_sweep(cal_probs_raw, cal_labels)
    scaler = TemperatureScaler().fit(cal_probs_raw, cal_labels)
    cal_probs = [scaler.transform(p) for p in cal_probs_raw]
    sweep_calibrated = _threshold_sweep(cal_probs, cal_labels)
    chosen = sweep_calibrated if sweep_calibrated["f1"] >= sweep["f1"] else sweep
    chosen_is_calibrated = chosen is sweep_calibrated
    scaler.save(ckpt / "calibration.json")
    (ckpt / "threshold.json").write_text(
        json.dumps({
            "threshold": chosen["threshold"],
            "selected_on": "source-disjoint calibration split",
            "calibrated_probabilities": chosen_is_calibrated,
            "calibration_f1": chosen["f1"],
            "calibration_precision": chosen["precision"],
            "calibration_recall": chosen["recall"],
            "n_calibration": len(calibration),
        }, indent=2),
        encoding="utf-8",
    )
    calibration_block = {
        "temperature": scaler.temperature,
        "cross_fitted_note": "single temperature fit on the calibration split; "
                             "evaluation is reported on the untouched eval split",
        "n_calibration": len(calibration),
        "calibration_f1_at_0.5_raw": _threshold_sweep(cal_probs_raw, cal_labels)["f1"],
        "calibration_f1_at_0.5_calibrated": _threshold_sweep(cal_probs, cal_labels)["f1"],
        "chosen_threshold": chosen,
        "threshold_uses_calibrated": chosen_is_calibrated,
        "calibration_seconds": round(time.time() - t0, 1),
    }
    print(f"calibration: {json.dumps(calibration_block)}")

    # Reload from disk so the reported numbers exercise the shipped metadata.
    reload_ok = det.load_fine_tuned(str(ckpt))
    print(f"checkpoint reload: {reload_ok} | threshold={det.config.threshold}")

    t0 = time.time()
    eval_probs_raw = det.score_codes(evaluation, batch_size=args.batch_size,
                                     calibrated=False)
    eval_probs_cal = det.score_codes(evaluation, batch_size=args.batch_size,
                                     calibrated=True)
    eval_labels = [1 if r.get("is_crypto") else 0 for r in evaluation]
    eval_ml = det.evaluate_ml(evaluation, threshold=det.config.threshold)
    eval_ml_at_half = det.evaluate_ml(evaluation, threshold=0.5)
    eval_metrics = {
        "ml_at_tuned_threshold": eval_ml,
        "ml_at_0.5": eval_ml_at_half,
        "raw_probability": {
            "brier": round(brier_score(eval_probs_raw, eval_labels), 4),
            "ece_10bin": round(expected_calibration_error(eval_probs_raw, eval_labels), 4),
            "mean": round(statistics.mean(eval_probs_raw), 4),
        },
        "calibrated_probability": {
            "brier": round(brier_score(eval_probs_cal, eval_labels), 4),
            "ece_10bin": round(expected_calibration_error(eval_probs_cal, eval_labels), 4),
            "mean": round(statistics.mean(eval_probs_cal), 4),
        },
        "eval_seconds": round(time.time() - t0, 1),
    }
    print(f"eval ML @ {det.config.threshold}: "
          f"F1={eval_ml['f1']} P={eval_ml['precision']} R={eval_ml['recall']} "
          f"AUC={eval_ml['roc_auc']}")

    if not args.skip_ensemble_eval:
        t0 = time.time()
        ensemble = det.evaluate(evaluation)
        eval_metrics["ensemble_at_tuned_threshold"] = ensemble
        eval_metrics["ensemble_seconds"] = round(time.time() - t0, 1)
        print(f"ensemble F1={ensemble['f1']} P={ensemble['precision']} "
              f"R={ensemble['recall']}")

    report = {
        "name": args.name,
        "corpus_version": args.corpus_version,
        "evaluation_corpus_version": args.eval_corpus_version or args.corpus_version,
        "corpus_path": str(corpus_path),
        "corpus_stats": corpus_doc.get("stats", {}),
        "split": {
            "protocol": "keyed SHA-256 source buckets (stable under corpus growth)",
            "seed": args.seed,
            "fit": _dataset_stats(fit),
            "calibration": _dataset_stats(calibration),
            "evaluation": _dataset_stats(evaluation),
            "fit_sources": fit_sources,
            "calibration_sources": cal_sources,
            "evaluation_sources": eval_sources,
        },
        "training": {
            **fit_result,
            "epochs": args.epochs,
            "max_len": args.max_len,
            "batch_size": args.batch_size,
            "max_chunks": args.max_chunks,
            "lr": args.lr,
            "seconds": train_seconds,
            "checkpoint": str(ckpt.relative_to(REPO_ROOT)),
        },
        "calibration": calibration_block,
        "evaluation": eval_metrics,
        "device": "cpu",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    report_path = REPO_ROOT / "qtrust_ai" / "artifacts" / f"training_report_{args.name}.json"
    report_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"report: {report_path}")


if __name__ == "__main__":
    main()

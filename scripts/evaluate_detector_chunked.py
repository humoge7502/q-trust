#!/usr/bin/env python3
"""Re-evaluate a detector checkpoint with chunked inference and honest calibration.

Training and evaluation are deliberately separate here. The checkpoint was
trained with one window per file; at inference we score up to N overlapping
windows and max-pool them. That changes the probability distribution, so the
temperature and threshold must be re-fitted on the untouched calibration split
before looking at the evaluation split.

Outputs a standalone JSON report; the checkpoint's local calibration.json and
threshold.json are updated unless ``--no-write-metadata`` is passed (use that
for externally hosted baseline checkpoints such as the canonical v1 model).

Examples:
    python scripts/evaluate_detector_chunked.py \
        --checkpoint qtrust_ai/artifacts/crypto_codebert_v4-stable \
        --name v4-stable-chunked --corpus-version 4

    python scripts/evaluate_detector_chunked.py \
        --checkpoint C:\\Users\\Devesh tiwari\\q-trust-projects\\q-trust-codebert \
        --name v1-clean-holdout --corpus-version 4 --no-write-metadata
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

DATASETS = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets")
CORPORA = {3: DATASETS / "code_corpus_v3.json", 4: DATASETS / "code_corpus_v4.json"}
DEFAULT_HOLDOUT = ("gnutls/gnutls", "bitcoin-core/secp256k1")


def _sweep(probs, labels):
    candidates = sorted({0.5, *[round(p, 4) for p in probs]})
    best = {"threshold": 0.5, "f1": -1.0, "precision": 0.0, "recall": 0.0}
    for threshold in candidates:
        if not 0.02 <= threshold <= 0.98:
            continue
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
            best = {"threshold": round(float(threshold), 4),
                    "f1": round(float(f1), 4),
                    "precision": round(float(precision), 4),
                    "recall": round(float(recall), 4)}
    return best


def _metrics(probs, labels, threshold):
    tp = fp = fn = tn = 0
    for prob, truth in zip(probs, labels):
        pred = prob >= threshold
        if truth and pred:
            tp += 1
        elif not truth and pred:
            fp += 1
        elif truth and not pred:
            fn += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": round(precision, 4), "recall": round(recall, 4),
            "f1": round(f1, 4),
            "accuracy": round((tp + tn) / max(1, tp + tn + fp + fn), 4),
            "threshold": threshold, "n": len(labels),
            "positives": sum(labels), "predicted_positives": sum(1 for p in probs if p >= threshold)}


def _per_language(rows, probs, labels, threshold):
    out = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "tn": 0})
    for row, prob, truth in zip(rows, probs, labels):
        key = str(row.get("language", "unknown"))
        pred = prob >= threshold
        if truth and pred:
            out[key]["tp"] += 1
        elif not truth and pred:
            out[key]["fp"] += 1
        elif truth and not pred:
            out[key]["fn"] += 1
        else:
            out[key]["tn"] += 1
    metrics = {}
    for key, row in out.items():
        tp, fp, fn, tn = row["tp"], row["fp"], row["fn"], row["tn"]
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        metrics[key] = {**row, "precision": round(precision, 4),
                        "recall": round(recall, 4), "f1": round(f1, 4)}
    return dict(metrics)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--corpus-version", type=int, choices=sorted(CORPORA), default=4)
    ap.add_argument("--eval-corpus-version", type=int, choices=sorted(CORPORA), default=None)
    ap.add_argument("--max-chunks", type=int, default=4)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--holdout-sources", default=",".join(DEFAULT_HOLDOUT))
    ap.add_argument("--no-write-metadata", action="store_true")
    ap.add_argument("--skip-ensemble", action="store_true")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    from qtrust_ai.discovery.calibration import (
        TemperatureScaler, brier_score, expected_calibration_error,
    )
    from qtrust_ai.discovery.code_detector import CryptoCodeDetector
    from qtrust_ai.discovery.data_split import split_corpus

    corpus_path = CORPORA[args.corpus_version]
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))["corpus"]
    fit, calibration, evaluation = split_corpus(corpus, seed=42)
    if args.eval_corpus_version and args.eval_corpus_version != args.corpus_version:
        eval_corpus = json.loads(CORPORA[args.eval_corpus_version].read_text(encoding="utf-8"))["corpus"]
        _f, _c, evaluation = split_corpus(eval_corpus, seed=42)
    if not calibration or not evaluation:
        raise SystemExit("calibration or evaluation split is empty")

    det = CryptoCodeDetector(seed=42)
    if not det.load_fine_tuned(args.checkpoint):
        raise SystemExit(f"could not load checkpoint: {args.checkpoint}")
    det.set_max_chunks(args.max_chunks)
    ckpt = Path(args.checkpoint)

    t0 = time.time()
    cal_raw = det.score_codes(calibration, batch_size=args.batch_size, calibrated=False)
    cal_labels = [1 if r.get("is_crypto") else 0 for r in calibration]
    raw_sweep = _sweep(cal_raw, cal_labels)
    scaler = TemperatureScaler().fit(cal_raw, cal_labels)
    cal_calibrated = [scaler.transform(p) for p in cal_raw]
    calibrated_sweep = _sweep(cal_calibrated, cal_labels)
    chosen = calibrated_sweep if calibrated_sweep["f1"] >= raw_sweep["f1"] else raw_sweep
    use_calibrated = chosen is calibrated_sweep
    if not args.no_write_metadata:
        scaler.save(ckpt / "calibration.json")
        (ckpt / "threshold.json").write_text(json.dumps({
            "threshold": chosen["threshold"],
            "selected_on": "source-disjoint calibration split, chunked inference",
            "calibrated_probabilities": use_calibrated,
            "max_chunks": args.max_chunks,
            "calibration_f1": chosen["f1"],
            "calibration_precision": chosen["precision"],
            "calibration_recall": chosen["recall"],
            "n_calibration": len(calibration),
        }, indent=2), encoding="utf-8")
        det.set_threshold(chosen["threshold"])
        # Re-load through the public loader so the shipped metadata is exercised.
        det.load_fine_tuned(args.checkpoint)
        det.set_max_chunks(args.max_chunks)

    def score(rows):
        raw = det.score_codes(rows, batch_size=args.batch_size, calibrated=False)
        calibrated = [scaler.transform(p) for p in raw]
        return raw, calibrated

    def block(rows, title):
        raw, cal = score(rows)
        labels = [1 if r.get("is_crypto") else 0 for r in rows]
        probs = cal if use_calibrated else raw
        return {
            "title": title,
            "n": len(rows),
            "sources": sorted({str(r.get("source", "unknown")) for r in rows}),
            "crypto": sum(labels),
            "base_rate": round(sum(labels) / max(1, len(labels)), 4),
            "at_tuned_threshold": _metrics(probs, labels, chosen["threshold"]),
            "at_0.5": _metrics(probs, labels, 0.5),
            "roc_auc": round(float(_auc(labels, probs)), 4),
            "per_language": _per_language(rows, probs, labels, chosen["threshold"]),
            "brier_raw": round(brier_score(raw, labels), 4),
            "brier_calibrated": round(brier_score(cal, labels), 4),
            "ece_raw": round(expected_calibration_error(raw, labels), 4),
            "ece_calibrated": round(expected_calibration_error(cal, labels), 4),
            "mean_probability": round(statistics.mean(probs), 4),
        }

    eval_block = block(evaluation, "full stable evaluation split")
    holdout_sources = {s.strip() for s in args.holdout_sources.split(",") if s.strip()}
    holdout_rows = [r for r in evaluation if r.get("source") in holdout_sources]
    holdout_block = block(holdout_rows, "clean new-source holdout") if holdout_rows else None

    ensemble = None
    if not args.skip_ensemble:
        t0 = time.time()
        # The ensemble path scores each file independently; use the tuned
        # threshold and the checkpoint-local calibration.
        ensemble = det.evaluate(evaluation)
        ensemble["seconds"] = round(time.time() - t0, 1)

    report = {
        "name": args.name,
        "checkpoint": str(ckpt),
        "protocol": {
            "corpus_version": args.corpus_version,
            "evaluation_corpus_version": args.eval_corpus_version or args.corpus_version,
            "split": "keyed SHA-256 source buckets; calibration and evaluation disjoint",
            "inference": f"max-pool over up to {args.max_chunks} overlapping windows",
            "max_chunks": args.max_chunks,
        },
        "calibration": {
            "temperature": scaler.temperature,
            "raw_sweep": raw_sweep,
            "calibrated_sweep": calibrated_sweep,
            "chosen": chosen,
            "uses_calibrated": use_calibrated,
            "n_calibration": len(calibration),
            "seconds": round(time.time() - t0, 1),
            "candidates": dict(Counter(str(r.get("source")) for r in calibration).most_common()),
        },
        "evaluation": eval_block,
        "clean_holdout": holdout_block,
        "ensemble": ensemble,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    out_path = Path(args.out) if args.out else (
        REPO_ROOT / "qtrust_ai" / "artifacts" / f"chunked_eval_{args.name}.json"
    )
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "threshold": chosen,
        "uses_calibrated": use_calibrated,
        "eval": {k: eval_block["at_tuned_threshold"][k]
                 for k in ("precision", "recall", "f1", "roc_auc", "n")},
        "holdout": ({k: holdout_block["at_tuned_threshold"][k]
                     for k in ("precision", "recall", "f1", "roc_auc", "n")}
                    if holdout_block else None),
    }, indent=2))
    print(f"wrote {out_path}")


def _auc(labels, probs) -> float:
    try:
        from sklearn.metrics import roc_auc_score
        return roc_auc_score(labels, probs) if len(set(labels)) > 1 else 0.5
    except Exception:
        return 0.0


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Transparent linear baseline for crypto-code discovery.

Motivation
----------
The fine-tuned CodeBERTa is small (33 M parameters) and the current training
budget is CPU-only. A TF-IDF + linear classifier is a strong, cheap baseline
that makes the transformer's contribution falsifiable: if the linear model is
better on the same source-disjoint split, the headline result is driven by
surface tokens rather than code semantics.

This script is intentionally *not* a replacement for the transformer. It is a
diagnostic + an optional ensemble member, with the same stable split,
calibration split, and evaluation split as ``train_discovery_stable.py``.

Run:
    python scripts/train_linear_code_baseline.py --corpus-version 4
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

DATASETS = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets")
CORPORA = {3: DATASETS / "code_corpus_v3.json", 4: DATASETS / "code_corpus_v4.json"}


def _sweep(probs, labels):
    best = {"threshold": 0.5, "f1": -1.0, "precision": 0.0, "recall": 0.0}
    for threshold in sorted({0.5, *[round(p, 4) for p in probs]}):
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
    for p, y in zip(probs, labels):
        pred = p >= threshold
        if y and pred:
            tp += 1
        elif y and not pred:
            fn += 1
        elif not y and pred:
            fp += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": round(precision, 4), "recall": round(recall, 4),
            "f1": round(f1, 4),
            "accuracy": round((tp + tn) / max(1, tp + tn + fp + fn), 4),
            "n": len(labels)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--corpus-version", type=int, choices=sorted(CORPORA), default=4)
    ap.add_argument("--max-chars", type=int, default=24_000)
    ap.add_argument("--max-features", type=int, default=80_000)
    ap.add_argument("--C", type=float, default=2.0)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    import numpy as np
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score

    from qtrust_ai.discovery.calibration import TemperatureScaler, brier_score, expected_calibration_error
    from qtrust_ai.discovery.data_split import split_corpus

    corpus_path = CORPORA[args.corpus_version]
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))["corpus"]
    fit, cal, ev = split_corpus(corpus, seed=42)
    print(f"corpus v{args.corpus_version}: fit={len(fit)} cal={len(cal)} eval={len(ev)}")
    for name, rows in (("fit", fit), ("cal", cal), ("eval", ev)):
        print(f"  {name}: {len(rows)} files / {len({r['source'] for r in rows})} sources / "
              f"{sum(1 for r in rows if r.get('is_crypto'))} crypto")

    def text(rows):
        return [str(r.get("code", ""))[: args.max_chars] for r in rows]

    t0 = time.time()
    vectorizer = TfidfVectorizer(
        analyzer="word",
        token_pattern=r"(?u)\b[A-Za-z_][A-Za-z0-9_]{1,}\b",
        lowercase=True,
        ngram_range=(1, 2),
        min_df=2,
        max_features=args.max_features,
        sublinear_tf=True,
        strip_accents=None,
        dtype=np.float32,
    )
    X_fit = vectorizer.fit_transform(text(fit))
    X_cal = vectorizer.transform(text(cal))
    X_ev = vectorizer.transform(text(ev))
    y_fit = np.array([1 if r.get("is_crypto") else 0 for r in fit])
    y_cal = np.array([1 if r.get("is_crypto") else 0 for r in cal])
    y_ev = np.array([1 if r.get("is_crypto") else 0 for r in ev])
    clf = LogisticRegression(C=args.C, max_iter=2000, solver="liblinear", random_state=42)
    clf.fit(X_fit, y_fit)
    cal_raw = clf.predict_proba(X_cal)[:, 1].tolist()
    ev_raw = clf.predict_proba(X_ev)[:, 1].tolist()
    fit_seconds = round(time.time() - t0, 1)

    sweep = _sweep(cal_raw, y_cal)
    scaler = TemperatureScaler().fit(cal_raw, y_cal)
    cal_calibrated = [scaler.transform(p) for p in cal_raw]
    sweep_calibrated = _sweep(cal_calibrated, y_cal)
    chosen = sweep_calibrated if sweep_calibrated["f1"] >= sweep["f1"] else sweep
    use_calibrated = chosen is sweep_calibrated
    ev_calibrated = [scaler.transform(p) for p in ev_raw]
    chosen_probs = ev_calibrated if use_calibrated else ev_raw
    metrics = _metrics(chosen_probs, y_ev, chosen["threshold"])
    metrics_half = _metrics(chosen_probs, y_ev, 0.5)
    auc = roc_auc_score(y_ev, chosen_probs) if len(set(y_ev)) > 1 else 0.5

    per_lang = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "tn": 0})
    for row, prob in zip(ev, chosen_probs):
        lang = str(row.get("language", "unknown"))
        pred = prob >= chosen["threshold"]
        truth = bool(row.get("is_crypto"))
        if truth and pred:
            per_lang[lang]["tp"] += 1
        elif not truth and pred:
            per_lang[lang]["fp"] += 1
        elif truth and not pred:
            per_lang[lang]["fn"] += 1
        else:
            per_lang[lang]["tn"] += 1

    out = {
        "protocol": {
            "corpus_version": args.corpus_version,
            "split": "keyed stable SHA-256 source buckets; 70/10/20 fit/cal/eval",
            "vectorizer": "word 1-2 grams, min_df=2, sublinear_tf, max_features=%d" % args.max_features,
            "classifier": "LogisticRegression(liblinear, C=%s)" % args.C,
            "max_chars": args.max_chars,
        },
        "counts": {"fit": len(fit), "calibration": len(cal), "evaluation": len(ev),
                   "features": int(X_fit.shape[1])},
        "fit_seconds": fit_seconds,
        "threshold_selection": {"chosen": chosen, "calibrated": use_calibrated,
                                "raw_sweep": sweep, "calibrated_sweep": sweep_calibrated},
        "calibration": {"temperature": scaler.temperature,
                        "brier_raw": round(brier_score(ev_raw, y_ev), 4),
                        "brier_calibrated": round(brier_score(ev_calibrated, y_ev), 4),
                        "ece_raw": round(expected_calibration_error(ev_raw, y_ev), 4),
                        "ece_calibrated": round(expected_calibration_error(ev_calibrated, y_ev), 4)},
        "evaluation": {
            **metrics,
            "roc_auc": round(float(auc), 4),
            "at_0.5": metrics_half,
            "per_language": {k: dict(v) for k, v in per_lang.items()},
        },
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    out_path = Path(args.out) if args.out else (
        REPO_ROOT / "qtrust_ai" / "artifacts" / f"linear_code_baseline_v{args.corpus_version}.json"
    )
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({k: out[k] for k in ("counts", "fit_seconds", "threshold_selection",
                                          "calibration", "evaluation")}, indent=2)[:4000])
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()

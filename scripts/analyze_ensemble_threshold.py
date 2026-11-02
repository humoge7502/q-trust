#!/usr/bin/env python3
"""Score the deterministic layers and the transformer once per held-out file.

The detector's ensemble has an ML-only gate whose value was hard-coded at 0.85.
That value was never selected on a held-out set. This script records the raw
ingredients — per-file ML probability plus static/AST/dataflow flags — for one
split, then reports precision/recall/F1 across gate values without re-running
inference. The ``native`` split is the source-disjoint v4 split (10 repos,
including the new v4 sources); the ``pinned`` split is the 8-repo digest split
used by the v1/v3 comparison.

Select a gate on ``native``, then report it on ``pinned``. Do not select on the
split whose headline number you intend to quote.

Run:
    python scripts/analyze_ensemble_threshold.py --split native
    python scripts/analyze_ensemble_threshold.py --split pinned
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

DATASETS = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets")
CORPUS_V3 = DATASETS / "code_corpus_v3.json"
CORPUS_V4 = DATASETS / "code_corpus_v4.json"
CHECKPOINT = REPO_ROOT / "qtrust_ai" / "artifacts" / "crypto_codebert_v4"
OUT = REPO_ROOT / "qtrust_ai" / "artifacts"


def metrics(rows: list[dict], predictions: list[int]) -> dict:
    tp = sum(1 for r, p in zip(rows, predictions) if r["truth"] == 1 and p == 1)
    fp = sum(1 for r, p in zip(rows, predictions) if r["truth"] == 0 and p == 1)
    fn = sum(1 for r, p in zip(rows, predictions) if r["truth"] == 1 and p == 0)
    tn = sum(1 for r, p in zip(rows, predictions) if r["truth"] == 0 and p == 0)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "n": len(rows),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
    }


def ensemble_predictions(rows: list[dict], decisive: float, ml_threshold: float = 0.5) -> list[int]:
    predictions = []
    for row in rows:
        static, ast, dataflow, prob = row["static"], row["ast"], row["dataflow"], row["ml_prob"]
        weight = (
            (0.30 if static else 0.0)
            + (0.30 if ast else 0.0)
            + (0.20 if dataflow else 0.0)
            + 0.20 * prob
        )
        ml_crypto = prob >= ml_threshold
        pred = weight >= 0.5 or static
        if sum((static, ast, dataflow, ml_crypto)) >= 2:
            pred = True
        if ml_crypto and not static and not ast and not dataflow and prob >= decisive:
            pred = True
        predictions.append(1 if pred else 0)
    return predictions


def ml_predictions(rows: list[dict], threshold: float) -> list[int]:
    return [1 if row["ml_prob"] >= threshold else 0 for row in rows]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", choices=("native", "pinned"), default="native")
    parser.add_argument("--checkpoint", default=str(CHECKPOINT))
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    from train_qtrust_all import _code_splits
    from qtrust_ai.discovery.code_detector import CryptoCodeDetector
    from qtrust_ai.discovery.corpus_hygiene import dedupe_records

    v4 = json.loads(CORPUS_V4.read_text(encoding="utf-8"))["corpus"]
    if args.split == "pinned":
        v3 = json.loads(CORPUS_V3.read_text(encoding="utf-8"))["corpus"]
        _, evaluation = _code_splits(v3, seed=42)
        rows = [r for r in v4 if r["source"] in {x["source"] for x in evaluation}]
    else:
        _, evaluation = _code_splits(v4, seed=42)
        eval_sources = {x["source"] for x in evaluation}
        rows = [r for r in v4 if r["source"] in eval_sources]

    detector = CryptoCodeDetector(seed=42)
    if not detector.load_fine_tuned(args.checkpoint):
        raise SystemExit(f"could not load checkpoint at {args.checkpoint}")
    print(f"{args.split}: {len(rows)} files, {len({r['source'] for r in rows})} repos")

    started = time.time()
    probs = detector.score_codes(
        [{"code": r["code"], "language": r.get("language", "python")} for r in rows],
        batch_size=32,
    )
    print(f"scored ML in {time.time() - started:.1f}s")
    for row, prob in zip(rows, probs):
        language = row.get("language", "python")
        row["truth"] = 1 if row.get("is_crypto") else 0
        row["ml_prob"] = float(prob)
        row["static"] = bool(detector._static_layer(row["code"], language))
        row["ast"] = bool(detector._ast_layer(row["code"], language))
        row["dataflow"] = bool(detector._dataflow_layer(row["code"], language))

    kept, _ = dedupe_records(rows, "keep_longest")
    gate_grid = [round(0.50 + 0.05 * i, 2) for i in range(10)]
    ml_grid = [round(0.35 + 0.05 * i, 2) for i in range(10)]
    report = {
        "checkpoint": str(Path(args.checkpoint).relative_to(REPO_ROOT)),
        "split": args.split,
        "repos": sorted({r["source"] for r in rows}),
        "raw": {
            "n": len(rows),
            "current_gate_0.85": metrics(rows, ensemble_predictions(rows, 0.85)),
            "by_decisive_gate": {
                f"{gate:.2f}": metrics(rows, ensemble_predictions(rows, gate))
                for gate in gate_grid
            },
            "ml_only_by_threshold": {
                f"{threshold:.2f}": metrics(rows, ml_predictions(rows, threshold))
                for threshold in ml_grid
            },
        },
        "keep_longest": {
            "n": len(kept),
            "current_gate_0.85": metrics(kept, ensemble_predictions(kept, 0.85)),
            "by_decisive_gate": {
                f"{gate:.2f}": metrics(kept, ensemble_predictions(kept, gate))
                for gate in gate_grid
            },
        },
        "scores": [
            {
                "source": r["source"], "path": r["path"], "language": r.get("language"),
                "truth": r["truth"], "ml_prob": round(r["ml_prob"], 6),
                "static": r["static"], "ast": r["ast"], "dataflow": r["dataflow"],
            }
            for r in rows
        ],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    out = Path(args.out) if args.out else OUT / f"ensemble_scores_v4_{args.split}.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("gate 0.85 (current):", report["raw"]["current_gate_0.85"])
    for gate, row in report["raw"]["by_decisive_gate"].items():
        print(f"gate {gate}: P={row['precision']:.4f} R={row['recall']:.4f} "
              f"F1={row['f1']:.4f} FN={row['fn']}")
    print("keep_longest gate 0.50:", report["keep_longest"]["by_decisive_gate"]["0.50"])
    print(f"artifact: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

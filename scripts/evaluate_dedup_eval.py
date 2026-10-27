#!/usr/bin/env python3
"""Re-measure the canonical v4 checkpoint on a de-duplicated held-out set.

Why this exists
---------------
The pinned v4 evaluation set contains 2,238 records but only 1,779 distinct
``(source, path)`` pairs. The extra 459 records are not harmless repetitions:
194 duplicated keys carry *different code*, because successive corpus
expansions appended a newer copy of the same repository path. Evaluating all
of them weights those files more than once and can even score one file as both
crypto and non-crypto under the same path.

The corpus builder should eventually de-duplicate at build time. Until then,
this script measures the size of the problem without retraining:

  1. run the canonical detector once over every raw eval record;
  2. recompute precision / recall / F1 under four de-duplication policies:
     keep-first, keep-last, keep-longest, and unique content;
  3. report label conflicts and code conflicts inside each duplicated key.

The raw-policy row is an assertion target for the canonical checkpoint: at the
legacy 0.85 gate it must reproduce E-15's P 0.9429 / R 0.8546 / F1 0.8966; at
the selected 0.50 gate it must reproduce E-16's P 0.9201 / R 0.9088 / F1 0.9144.
Other gate values are scored without the assertion, as are non-canonical
checkpoints (a candidate model is not expected to reproduce the shipped
numbers), which lets the same script re-check a candidate checkpoint or a
different inference environment. ``raw_reproduces_shipped`` is therefore
``true``/``false`` only for the canonical checkpoint at a known gate and
``null`` otherwise.

Run:
    python scripts/evaluate_dedup_eval.py --gate 0.85
    python scripts/evaluate_dedup_eval.py --checkpoint qtrust_ai/artifacts/crypto_codebert_v4-dedup \
        --out qtrust_ai/artifacts/eval_dedup_v4_dedupmodel.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

DATASETS = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets")
CORPUS_V3 = DATASETS / "code_corpus_v3.json"
CORPUS_V4 = DATASETS / "code_corpus_v4.json"
CHECKPOINT = REPO_ROOT / "qtrust_ai" / "artifacts" / "crypto_codebert_v4"
OUT = REPO_ROOT / "qtrust_ai" / "artifacts" / "eval_dedup_v4.json"

EXPECTED_RAW_BY_GATE = {
    0.85: {"precision": 0.9429, "recall": 0.8546, "f1": 0.8966},
    0.50: {"precision": 0.9201, "recall": 0.9088, "f1": 0.9144},
}


def metrics(rows: list[dict]) -> dict:
    tp = sum(1 for r in rows if r["truth"] == 1 and r["pred"] == 1)
    fp = sum(1 for r in rows if r["truth"] == 0 and r["pred"] == 1)
    fn = sum(1 for r in rows if r["truth"] == 1 and r["pred"] == 0)
    tn = sum(1 for r in rows if r["truth"] == 0 and r["pred"] == 0)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    total = len(rows)
    return {
        "n": total,
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "accuracy": round((tp + tn) / total, 4) if total else 0.0,
        "fn_rate": round(fn / (tp + fn), 4) if tp + fn else 0.0,
    }


def per_language(rows: list[dict]) -> dict:
    buckets: dict[str, dict[str, int]] = defaultdict(
        lambda: {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    )
    for r in rows:
        key = r["language"]
        if r["truth"] == 1 and r["pred"] == 1:
            buckets[key]["tp"] += 1
        elif r["truth"] == 0 and r["pred"] == 1:
            buckets[key]["fp"] += 1
        elif r["truth"] == 1 and r["pred"] == 0:
            buckets[key]["fn"] += 1
        else:
            buckets[key]["tn"] += 1
    return dict(sorted(buckets.items()))


def dedupe(rows: list[dict], policy: str) -> list[dict]:
    """Select one record per (source, path) by the given deterministic policy."""
    if policy == "unique_content":
        seen = set()
        out = []
        for r in rows:
            key = (r["source"], r["path"], r["content_sha256"])
            if key in seen:
                continue
            seen.add(key)
            out.append(r)
        return out

    chosen: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r["source"], r["path"])
        current = chosen.get(key)
        if current is None:
            chosen[key] = r
        elif policy == "keep_last":
            chosen[key] = r
        elif policy == "keep_longest" and len(r["code"]) > len(current["code"]):
            chosen[key] = r
    return list(chosen.values())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=str(CHECKPOINT))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument(
        "--gate",
        type=float,
        default=0.5,
        help="ml_decisive_threshold for the ensemble (default: selected 0.50 gate)",
    )
    args = ap.parse_args()
    checkpoint = Path(args.checkpoint).resolve()
    out_path = Path(args.out).resolve()
    expected = EXPECTED_RAW_BY_GATE.get(round(args.gate, 2))

    from train_qtrust_all import _code_splits
    from qtrust_ai.discovery.code_detector import CryptoCodeDetector

    v3 = json.loads(CORPUS_V3.read_text(encoding="utf-8"))["corpus"]
    v4 = json.loads(CORPUS_V4.read_text(encoding="utf-8"))
    _, pinned_eval = _code_splits(v3, seed=42)
    eval_sources = {r["source"] for r in pinned_eval}
    raw = [r for r in v4["corpus"] if r["source"] in eval_sources]

    for r in raw:
        # content-identity digest for duplicate detection (not a credential)
        r["content_sha256"] = hashlib.sha256(r["code"].encode("utf-8")).hexdigest()

    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in raw:
        groups[(r["source"], r["path"])].append(r)
    duplicated = {k: v for k, v in groups.items() if len(v) > 1}
    conflicting_labels = sum(
        1 for v in duplicated.values() if len({bool(r["is_crypto"]) for r in v}) > 1
    )
    differing_code = sum(1 for v in duplicated.values() if len({r["content_sha256"] for r in v}) > 1)

    print(
        f"raw eval {len(raw)} records / {len(groups)} keys; "
        f"{len(duplicated)} duplicated keys ({differing_code} with different code, "
        f"{conflicting_labels} with conflicting labels)"
    )

    det = CryptoCodeDetector(seed=42)
    if not det.load_fine_tuned(str(checkpoint)):
        raise SystemExit(f"could not load checkpoint at {checkpoint}")
    det.config.ml_decisive_threshold = args.gate
    print(
        f"device={getattr(det, '_hf_device', 'cpu')} "
        f"max_len={getattr(det, '_hf_max_len', '?')} "
        f"threshold={det.config.threshold} gate={args.gate}"
    )

    started = time.time()
    for i, r in enumerate(raw, 1):
        result = det.predict(r["code"], language=r.get("language", "python"))
        r["truth"] = 1 if r.get("is_crypto") else 0
        r["pred"] = 1 if result.is_crypto else 0
        if i % 250 == 0:
            print(f"  scored {i}/{len(raw)} ({time.time() - started:.0f}s)")
    print(f"scored {len(raw)} records in {time.time() - started:.1f}s")

    results = {"raw": metrics(raw)}
    kept = {}
    for policy in ("keep_first", "keep_last", "keep_longest", "unique_content"):
        rows = dedupe(raw, policy)
        kept[policy] = metrics(rows)
        results[policy] = kept[policy]

    longest_rows = dedupe(raw, "keep_longest")
    reproduced = None
    if expected is not None and checkpoint == CHECKPOINT.resolve():
        reproduced = all(
            abs(results["raw"][key] - value) < 1e-4 for key, value in expected.items()
        )
        if reproduced is False:
            raise SystemExit(
                "raw metrics did not reproduce the shipped eval_pinned numbers at "
                f"gate {args.gate}: {results['raw']} vs {expected}"
            )

    artifact = {
        "checkpoint": str(checkpoint.relative_to(REPO_ROOT))
        if checkpoint.is_relative_to(REPO_ROOT) else str(checkpoint),
        "gate": args.gate,
        "corpus": str(CORPUS_V4),
        "split": "pinned digest split of corpus v3 (seed 42), repo-disjoint",
        "duplicates": {
            "raw_records": len(raw),
            "unique_keys": len(groups),
            "duplicated_keys": len(duplicated),
            "extra_records": len(raw) - len(groups),
            "keys_with_different_code": differing_code,
            "keys_with_conflicting_labels": conflicting_labels,
        },
        "policies": results,
        "per_language_keep_longest": per_language(longest_rows),
        "raw_reproduces_shipped": reproduced,
        "notes": (
            "Ensemble detector.predict is used, matching training_report_v4.json's "
            "eval_pinned. The spread across de-duplication policies bounds how much "
            "of the reported metric depends on repeated (source, path) records. "
            "keep_longest is the primary corrected number; it selects the most "
            "complete version of a path without consulting its label."
        ),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    out_path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")

    for name, row in results.items():
        print(
            f"{name:14s} n={row['n']:4d} P={row['precision']:.4f} "
            f"R={row['recall']:.4f} F1={row['f1']:.4f} FN={row['fn']}"
        )
    if reproduced is not None:
        print(f"raw reproduces shipped gate {args.gate} numbers: {reproduced}")
    print(f"artifact: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

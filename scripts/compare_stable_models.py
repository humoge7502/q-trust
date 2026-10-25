#!/usr/bin/env python3
"""Compare two detector training reports produced on the same stable split.

Both reports must come from ``scripts/train_discovery_stable.py``; comparing a
stable-split report with the historical v3 report is invalid because the old
split moved repositories when the corpus grew.

The output records:

* held-out ML F1/P/R at the tuned and fixed-0.5 thresholds;
* ensemble F1/P/R (product behaviour);
* calibration quality (Brier / ECE) before and after temperature scaling;
* per-language deltas, so a headline gain cannot hide a C/Rust regression;
* the near-duplicate audit summary, when available;
* a promotion recommendation that is deliberately conservative.

Run after both trainings finish:

    python scripts/compare_stable_models.py \
        --baseline v3-stable --candidate v4-stable
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = REPO_ROOT / "qtrust_ai" / "artifacts"


def _load_report(name: str) -> dict:
    path = ARTIFACTS / f"training_report_{name}.json"
    if not path.exists():
        raise SystemExit(f"missing report: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _delta(candidate: float, baseline: float) -> float:
    return round(float(candidate) - float(baseline), 4)


def _per_language_delta(candidate: dict, baseline: dict) -> dict:
    out = {}
    for lang in sorted(set(candidate) | set(baseline)):
        c = candidate.get(lang, {})
        b = baseline.get(lang, {})
        c_f1 = c.get("f1")
        b_f1 = b.get("f1")
        out[lang] = {
            "baseline_f1": b_f1,
            "candidate_f1": c_f1,
            "delta_f1": _delta(c_f1, b_f1) if c_f1 is not None and b_f1 is not None else None,
            "baseline_n": b.get("n"),
            "candidate_n": c.get("n"),
        }
    return out


def _f1_from_confusion(row: dict) -> float | None:
    tp, fp, fn = row.get("tp", 0), row.get("fp", 0), row.get("fn", 0)
    if not (tp or fp or fn):
        return None
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0


def _per_language_f1(per_language: dict) -> dict:
    out = {}
    for lang, row in per_language.items():
        f1 = _f1_from_confusion(row)
        if f1 is not None:
            out[lang] = {"f1": f1, "n": sum(row.values())}
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline", default="v3-stable")
    ap.add_argument("--candidate", default="v4-stable")
    ap.add_argument("--minimum-f1-gain", type=float, default=0.002,
                    help="minimum held-out ML F1 gain to recommend promotion")
    args = ap.parse_args()

    base = _load_report(args.baseline)
    cand = _load_report(args.candidate)
    b_eval = base["evaluation"]
    c_eval = cand["evaluation"]
    b_ml = b_eval["ml_at_tuned_threshold"]
    c_ml = c_eval["ml_at_tuned_threshold"]
    b_half = b_eval.get("ml_at_0.5", {})
    c_half = c_eval.get("ml_at_0.5", {})

    b_lang = _per_language_f1(b_ml.get("per_language", {}))
    c_lang = _per_language_f1(c_ml.get("per_language", {}))
    language_delta = _per_language_delta(c_lang, b_lang)
    regressions = sorted(
        lang for lang, row in language_delta.items()
        if row["delta_f1"] is not None and row["delta_f1"] <= -0.02
        and (row["candidate_n"] or 0) >= 10
    )

    b_ensemble = b_eval.get("ensemble_at_tuned_threshold", {})
    c_ensemble = c_eval.get("ensemble_at_tuned_threshold", {})
    gain = _delta(c_ml["f1"], b_ml["f1"])
    ensemble_gain = (
        _delta(c_ensemble["f1"], b_ensemble["f1"])
        if b_ensemble and c_ensemble else None
    )

    near_dup_path = REPO_ROOT / "paper" / "analysis" / "near_dup_v4_stable.json"
    near_dup = None
    if near_dup_path.exists():
        nd = json.loads(near_dup_path.read_text(encoding="utf-8"))
        near_dup = {
            "n_eval": nd.get("n_eval"),
            "median": nd.get("median"),
            "p90": nd.get("p90"),
            "p99": nd.get("p99"),
            "max": nd.get("max"),
            "counts_at_or_above": nd.get("counts"),
        }

    reasons = []
    if gain < args.minimum_f1_gain:
        reasons.append(
            f"held-out ML F1 gain {gain:+.4f} is below the {args.minimum_f1_gain:+.4f} gate"
        )
    if ensemble_gain is not None and ensemble_gain < -0.002:
        reasons.append(f"ensemble F1 regressed by {ensemble_gain:+.4f}")
    if regressions:
        reasons.append("per-language regressions: " + ", ".join(regressions))
    promote = not reasons
    recommendation = (
        "promote candidate checkpoint for the research detector"
        if promote else
        "retain baseline checkpoint; candidate is an experimental lineage"
    )

    comparison = {
        "protocol": {
            "baseline": args.baseline,
            "candidate": args.candidate,
            "baseline_corpus_version": base.get("corpus_version"),
            "candidate_corpus_version": cand.get("corpus_version"),
            "same_eval_sources": (
                set(base["split"]["evaluation_sources"])
                == set(cand["split"]["evaluation_sources"])
            ),
            "baseline_eval_sources": base["split"]["evaluation_sources"],
            "candidate_eval_sources": cand["split"]["evaluation_sources"],
            "note": (
                "Both checkpoints were trained on the keyed stable split. The "
                "candidate corpus adds repositories, so it sees more fit data; "
                "the evaluation repositories are identical and never trained on."
            ),
        },
        "baseline": {
            "checkpoint": base["training"].get("checkpoint"),
            "train_examples": base["split"]["fit"]["files"],
            "eval_examples": base["split"]["evaluation"]["files"],
            "ml_f1": b_ml["f1"],
            "ml_precision": b_ml["precision"],
            "ml_recall": b_ml["recall"],
            "ml_f1_at_0.5": b_half.get("f1"),
            "ensemble_f1": b_ensemble.get("f1"),
            "threshold": b_ml.get("threshold"),
            "roc_auc": b_ml.get("roc_auc"),
            "calibration": b_eval.get("calibrated_probability"),
        },
        "candidate": {
            "checkpoint": cand["training"].get("checkpoint"),
            "train_examples": cand["split"]["fit"]["files"],
            "eval_examples": cand["split"]["evaluation"]["files"],
            "ml_f1": c_ml["f1"],
            "ml_precision": c_ml["precision"],
            "ml_recall": c_ml["recall"],
            "ml_f1_at_0.5": c_half.get("f1"),
            "ensemble_f1": c_ensemble.get("f1"),
            "threshold": c_ml.get("threshold"),
            "roc_auc": c_ml.get("roc_auc"),
            "calibration": c_eval.get("calibrated_probability"),
        },
        "delta": {
            "ml_f1": gain,
            "ml_precision": _delta(c_ml["precision"], b_ml["precision"]),
            "ml_recall": _delta(c_ml["recall"], b_ml["recall"]),
            "ml_f1_at_0.5": (
                _delta(c_half["f1"], b_half["f1"]) if b_half and c_half else None
            ),
            "ensemble_f1": ensemble_gain,
            "roc_auc": _delta(c_ml.get("roc_auc", 0), b_ml.get("roc_auc", 0)),
        },
        "per_language": language_delta,
        "near_duplicate_audit": near_dup,
        "promotion": {
            "recommended": promote,
            "minimum_f1_gain": args.minimum_f1_gain,
            "blocked_by": reasons,
            "decision": recommendation,
        },
    }
    out_path = ARTIFACTS / "model_comparison_stable.json"
    out_path.write_text(json.dumps(comparison, indent=2), encoding="utf-8")

    md = _to_markdown(comparison)
    md_path = ARTIFACTS / "model_comparison_stable.md"
    md_path.write_text(md, encoding="utf-8")
    print(md)
    print(f"\nwrote {out_path}")
    print(f"wrote {md_path}")


def _to_markdown(c: dict) -> str:
    d = c["delta"]
    b = c["baseline"]
    q = c["candidate"]
    lines = [
        "# Stable-split detector comparison",
        "",
        f"**Baseline:** `{c['protocol']['baseline']}`  ",
        f"**Candidate:** `{c['protocol']['candidate']}`  ",
        f"**Same evaluation repositories:** {c['protocol']['same_eval_sources']}",
        "",
        "| Metric | Baseline | Candidate | Δ |",
        "|---|---:|---:|---:|",
        f"| ML F1 (tuned threshold) | {b['ml_f1']:.4f} | {q['ml_f1']:.4f} | {d['ml_f1']:+.4f} |",
        f"| ML F1 @ 0.5 | {b['ml_f1_at_0.5'] if b['ml_f1_at_0.5'] is not None else '—'} | "
        f"{q['ml_f1_at_0.5'] if q['ml_f1_at_0.5'] is not None else '—'} | "
        f"{d['ml_f1_at_0.5'] if d['ml_f1_at_0.5'] is not None else '—'} |",
        f"| ML precision | {b['ml_precision']:.4f} | {q['ml_precision']:.4f} | {d['ml_precision']:+.4f} |",
        f"| ML recall | {b['ml_recall']:.4f} | {q['ml_recall']:.4f} | {d['ml_recall']:+.4f} |",
        f"| Ensemble F1 | {b['ensemble_f1'] if b['ensemble_f1'] is not None else '—'} | "
        f"{q['ensemble_f1'] if q['ensemble_f1'] is not None else '—'} | "
        f"{d['ensemble_f1'] if d['ensemble_f1'] is not None else '—'} |",
        f"| ROC-AUC | {b['roc_auc']} | {q['roc_auc']} | {d['roc_auc']:+.4f} |",
        "",
        f"**Train examples:** {b['train_examples']:,} → {q['train_examples']:,}  ",
        f"**Decision:** {c['promotion']['decision']}",
    ]
    if c["promotion"]["blocked_by"]:
        lines += ["", "Blocked by:", *[f"- {reason}" for reason in c["promotion"]["blocked_by"]]]
    if c["per_language"]:
        lines += ["", "## Per-language F1", "", "| Language | Baseline | Candidate | Δ | n (candidate) |",
                  "|---|---:|---:|---:|---:|"]
        for lang, row in c["per_language"].items():
            lines.append(
                f"| {lang} | {row['baseline_f1']} | {row['candidate_f1']} | "
                f"{row['delta_f1'] if row['delta_f1'] is not None else '—'} | "
                f"{row['candidate_n']} |"
            )
    if c.get("near_duplicate_audit"):
        nd = c["near_duplicate_audit"]
        lines += [
            "", "## Near-duplicate audit (v4 eval vs fit)", "",
            f"- eval files: {nd['n_eval']}",
            f"- median max-Jaccard: {nd['median']}",
            f"- p90 / p99 / max: {nd['p90']} / {nd['p99']} / {nd['max']}",
            f"- pairs ≥ 0.80: {nd['counts_at_or_above'].get('0.8')}",
            f"- pairs ≥ 0.95: {nd['counts_at_or_above'].get('0.95')}",
        ]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Compare two chunked detector evaluations and make a promotion decision.

Inputs are the ``chunked_eval_<name>.json`` files produced by
``scripts/evaluate_detector_chunked.py``. Both models must have been evaluated
on the same stable evaluation split (and, for a fair baseline, with
``--eval-corpus-version 4`` when the baseline corpus lacks the candidate's new
sources).

The transformer's tuned-threshold F1 is the promotion gate. Ensemble F1 and the
clean new-source holdout are reported as secondary evidence and can block a
promotion, but cannot rescue a regression on the primary metric.

Run:
    python scripts/compare_chunked_evals.py \
        --baseline v3-stable-chunked --candidate v4-stable-chunked
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = REPO_ROOT / "qtrust_ai" / "artifacts"


def _load(name: str) -> dict:
    path = ARTIFACTS / f"chunked_eval_{name}.json"
    if not path.exists():
        raise SystemExit(f"missing chunked evaluation: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _score_block(report: dict, key: str = "evaluation") -> dict:
    block = report.get(key) or {}
    tuned = block.get("at_tuned_threshold") or {}
    half = block.get("at_0.5") or {}
    return {
        "n": block.get("n"),
        "crypto": block.get("crypto"),
        "base_rate": block.get("base_rate"),
        "sources": block.get("sources", []),
        "f1": tuned.get("f1"),
        "precision": tuned.get("precision"),
        "recall": tuned.get("recall"),
        "f1_at_0.5": half.get("f1"),
        "roc_auc": block.get("roc_auc"),
        "threshold": report.get("calibration", {}).get("chosen", {}).get("threshold"),
        "temperature": report.get("calibration", {}).get("temperature"),
        "ece_raw": block.get("ece_raw"),
        "ece_calibrated": block.get("ece_calibrated"),
    }


def _delta(candidate, baseline, digits: int = 4):
    if candidate is None or baseline is None:
        return None
    return round(float(candidate) - float(baseline), digits)


def _language_delta(candidate: dict, baseline: dict) -> dict:
    out = {}
    for language in sorted(set(candidate) | set(baseline)):
        c = candidate.get(language, {})
        b = baseline.get(language, {})
        out[language] = {
            "baseline_f1": b.get("f1"),
            "candidate_f1": c.get("f1"),
            "delta_f1": _delta(c.get("f1"), b.get("f1")),
            "baseline_n": sum(b.get(k, 0) for k in ("tp", "fp", "fn", "tn")) or None,
            "candidate_n": sum(c.get(k, 0) for k in ("tp", "fp", "fn", "tn")) or None,
        }
    return out


def _near_dup() -> dict | None:
    path = REPO_ROOT / "paper" / "analysis" / "near_dup_v4_stable.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "n_eval": data.get("n_eval"),
        "n_train": data.get("n_train"),
        "median": data.get("median"),
        "p90": data.get("p90"),
        "p99": data.get("p99"),
        "max": data.get("max"),
        "counts": data.get("counts"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline", default="v3-stable-chunked")
    ap.add_argument("--candidate", default="v4-stable-chunked")
    ap.add_argument("--minimum-f1-gain", type=float, default=0.002)
    args = ap.parse_args()

    base = _load(args.baseline)
    cand = _load(args.candidate)
    b_eval = _score_block(base)
    c_eval = _score_block(cand)
    b_hold = _score_block(base, "clean_holdout") if base.get("clean_holdout") else None
    c_hold = _score_block(cand, "clean_holdout") if cand.get("clean_holdout") else None

    b_lang = (base.get("evaluation") or {}).get("per_language", {})
    c_lang = (cand.get("evaluation") or {}).get("per_language", {})
    languages = _language_delta(c_lang, b_lang)
    regressions = sorted(
        language for language, row in languages.items()
        if row["delta_f1"] is not None
        and row["delta_f1"] <= -0.03
        and (row["candidate_n"] or 0) >= 10
    )

    gain = _delta(c_eval["f1"], b_eval["f1"])
    hold_gain = _delta(c_hold["f1"], b_hold["f1"]) if b_hold and c_hold else None
    b_ensemble = (base.get("ensemble") or {}).get("f1")
    c_ensemble = (cand.get("ensemble") or {}).get("f1")
    ensemble_gain = _delta(c_ensemble, b_ensemble)

    same_eval_sources = (
        (base.get("evaluation") or {}).get("sources", [])
        == (cand.get("evaluation") or {}).get("sources", [])
    )

    blockers = []
    if gain is None or gain < args.minimum_f1_gain:
        blockers.append(
            f"primary held-out F1 gain {gain if gain is not None else 'n/a'} "
            f"is below the {args.minimum_f1_gain:+.4f} gate"
        )
    if not same_eval_sources:
        blockers.append("evaluation source lists differ; the comparison is not apples-to-apples")
    if hold_gain is not None and hold_gain < -0.01:
        blockers.append(f"clean new-source holdout regressed by {hold_gain:+.4f} F1")
    if ensemble_gain is not None and ensemble_gain < -0.002:
        blockers.append(f"ensemble F1 regressed by {ensemble_gain:+.4f}")
    if regressions:
        blockers.append("per-language regressions: " + ", ".join(regressions))

    promote = not blockers
    comparison = {
        "protocol": {
            "baseline": args.baseline,
            "candidate": args.candidate,
            "same_eval_sources": same_eval_sources,
            "evaluation_sources": (cand.get("evaluation") or {}).get("sources", []),
            "note": (
                "Both checkpoints use the keyed source split and chunked inference. "
                "The baseline was evaluated on the candidate's evaluation split, "
                "including repositories its corpus did not contain."
            ),
        },
        "baseline": b_eval,
        "candidate": c_eval,
        "clean_holdout": {"baseline": b_hold, "candidate": c_hold},
        "delta": {
            "f1": gain,
            "precision": _delta(c_eval["precision"], b_eval["precision"]),
            "recall": _delta(c_eval["recall"], b_eval["recall"]),
            "f1_at_0.5": _delta(c_eval["f1_at_0.5"], b_eval["f1_at_0.5"]),
            "roc_auc": _delta(c_eval["roc_auc"], b_eval["roc_auc"]),
            "clean_holdout_f1": hold_gain,
            "ensemble_f1": ensemble_gain,
        },
        "per_language": languages,
        "near_duplicate_audit": _near_dup(),
        "promotion": {
            "recommended": promote,
            "minimum_f1_gain": args.minimum_f1_gain,
            "blocked_by": blockers,
            "decision": (
                "promote the candidate for the research detector"
                if promote else
                "retain the baseline; the candidate remains an experimental lineage"
            ),
        },
        "ensemble": {
            "baseline_f1": b_ensemble,
            "candidate_f1": c_ensemble,
            "delta": ensemble_gain,
        },
    }

    out_json = ARTIFACTS / "model_comparison_stable.json"
    out_md = ARTIFACTS / "model_comparison_stable.md"
    out_json.write_text(json.dumps(comparison, indent=2), encoding="utf-8")
    out_md.write_text(_markdown(comparison), encoding="utf-8")
    print(out_md.read_text(encoding="utf-8"))
    print(f"wrote {out_json}")
    print(f"wrote {out_md}")


def _markdown(c: dict) -> str:
    b, q, d = c["baseline"], c["candidate"], c["delta"]
    lines = [
        "# Stable-split detector comparison (chunked inference)",
        "",
        f"**Baseline:** `{c['protocol']['baseline']}`  ",
        f"**Candidate:** `{c['protocol']['candidate']}`  ",
        f"**Same evaluation sources:** {c['protocol']['same_eval_sources']}",
        "",
        "| Metric | Baseline | Candidate | Δ |",
        "|---|---:|---:|---:|",
        f"| ML F1 (tuned threshold) | {b['f1']:.4f} | {q['f1']:.4f} | {d['f1']:+.4f} |",
        f"| ML F1 @ 0.5 | {b['f1_at_0.5']:.4f} | {q['f1_at_0.5']:.4f} | {d['f1_at_0.5']:+.4f} |",
        f"| Precision | {b['precision']:.4f} | {q['precision']:.4f} | {d['precision']:+.4f} |",
        f"| Recall | {b['recall']:.4f} | {q['recall']:.4f} | {d['recall']:+.4f} |",
        f"| ROC-AUC | {b['roc_auc']:.4f} | {q['roc_auc']:.4f} | {d['roc_auc']:+.4f} |",
        f"| ECE (calibrated) | {b['ece_calibrated']} | {q['ece_calibrated']} | — |",
        "",
        f"**Decision:** {c['promotion']['decision']}",
    ]
    if c["promotion"]["blocked_by"]:
        lines += ["", "Blocked by:", *[f"- {reason}" for reason in c["promotion"]["blocked_by"]]]
    hold = c.get("clean_holdout") or {}
    if hold.get("baseline") and hold.get("candidate"):
        hb, hq = hold["baseline"], hold["candidate"]
        lines += [
            "", "## Clean new-source holdout", "",
            f"Sources: {', '.join(hq['sources'])}; "
            f"n={hq['n']} ({hq['crypto']} crypto).",
            "",
            "| Metric | Baseline | Candidate | Δ |",
            "|---|---:|---:|---:|",
            f"| F1 | {hb['f1']:.4f} | {hq['f1']:.4f} | {d['clean_holdout_f1']:+.4f} |",
            f"| Precision | {hb['precision']:.4f} | {hq['precision']:.4f} | {_delta(hq['precision'], hb['precision']):+.4f} |",
            f"| Recall | {hb['recall']:.4f} | {hq['recall']:.4f} | {_delta(hq['recall'], hb['recall']):+.4f} |",
            f"| ROC-AUC | {hb['roc_auc']:.4f} | {hq['roc_auc']:.4f} | {_delta(hq['roc_auc'], hb['roc_auc']):+.4f} |",
        ]
    if c.get("per_language"):
        lines += [
            "", "## Per-language F1", "",
            "| Language | Baseline | Candidate | Δ | n (candidate) |",
            "|---|---:|---:|---:|---:|",
        ]
        for language, row in c["per_language"].items():
            lines.append(
                f"| {language} | {row['baseline_f1']} | {row['candidate_f1']} | "
                f"{row['delta_f1'] if row['delta_f1'] is not None else '—'} | "
                f"{row['candidate_n']} |"
            )
    if c.get("near_duplicate_audit"):
        nd = c["near_duplicate_audit"]
        lines += [
            "", "## Near-duplicate audit", "",
            f"- evaluation/fit pairs audited: {nd['n_eval']} × {nd['n_train']}",
            f"- max Jaccard: {nd['max']}; p99: {nd['p99']}",
            f"- pairs ≥ 0.80: {nd['counts'].get('0.8')}; pairs ≥ 0.95: {nd['counts'].get('0.95')}",
        ]
    if c.get("ensemble", {}).get("baseline_f1") is not None:
        e = c["ensemble"]
        lines += [
            "", "## Ensemble (rules + AST + ML)", "",
            f"Baseline {e['baseline_f1']:.4f} → candidate {e['candidate_f1']:.4f} "
            f"({e['delta']:+.4f}).",
        ]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""E-19 — vintage-split decay measurement for the canonical v4 detector.

Question (ANALYSIS_AND_ROADMAP §6, "Data" row): does the detector decay on
code that entered the corpus LATER — a proxy for freshness? The corpus has no
per-file commit dates, so the vintage is defined data-driven: a source is
"v1" if it already appears in the original code_corpus.json, "post-v1"
otherwise (i.e., it was added by the v2/v3/v4 expansions). The pinned eval
split (predictions_v4.jsonl, 2,238 files, repo-disjoint) is scored at the
E-16 canonical gate 0.50, overall and per vintage.

This is a SOURCE-VINTAGE proxy, not a time split: sources added later are
usually younger projects, but a source's inclusion date is not a code date.
Recorded in EXPERIMENTS.md as E-19 with that caveat.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4),
            "tp": tp, "fp": fp, "fn": fn}


def score(rows: list[dict], gate: float) -> dict:
    def positive(r: dict) -> bool:
        return int(r["label"]) == 1

    tp = sum(1 for r in rows if positive(r) and r["prob_crypto"] >= gate)
    fp = sum(1 for r in rows if not positive(r) and r["prob_crypto"] >= gate)
    fn = sum(1 for r in rows if positive(r) and r["prob_crypto"] < gate)
    out = prf(tp, fp, fn)
    out["n"] = len(rows)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--v1-corpus", default="../q-trust-datasets/code_corpus.json")
    ap.add_argument("--predictions",
                    default="qtrust_ai/artifacts/crypto_codebert_v4/predictions_v4.jsonl")
    ap.add_argument("--gate", type=float, default=0.5)
    ap.add_argument("--out", default="qtrust_ai/artifacts/vintage_eval_v4.json")
    args = ap.parse_args()

    v1 = json.loads(Path(args.v1_corpus).read_text(encoding="utf-8"))
    v1_files = v1.get("corpus") if isinstance(v1, dict) else v1
    v1_sources = {e["source"] for e in v1_files}

    rows = [json.loads(line)
            for line in Path(args.predictions).read_text(encoding="utf-8").splitlines()
            if line.strip()]
    for r in rows:
        r["vintage"] = "v1" if r["source"] in v1_sources else "post-v1"

    per_source: dict[str, set[str]] = {}
    for r in rows:
        per_source.setdefault(r["source"], set()).add(r["vintage"])
    mixed = [s for s, v in per_source.items() if len(v) > 1]

    v1_rows = [r for r in rows if r["vintage"] == "v1"]
    new_rows = [r for r in rows if r["vintage"] == "post-v1"]

    result = {
        "experiment": "E-19",
        "definition": ("source-vintage proxy: 'v1' = source present in the "
                       "original code_corpus.json; 'post-v1' = added by the "
                       "v2/v3/v4 expansions. NOT a code-time split."),
        "checkpoint": "crypto_codebert_v4 (canonical)",
        "gate": args.gate,
        "overall": score(rows, args.gate),
        "v1_vintage": score(v1_rows, args.gate),
        "post_v1_vintage": score(new_rows, args.gate),
        "post_v1_sources": sorted({r["source"] for r in new_rows}),
        "mixed_vintage_sources": sorted(mixed),
        "generated_at": "2026-10-27",
    }
    Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: result[k] for k in
                      ("overall", "v1_vintage", "post_v1_vintage")}, indent=1))
    print(f"artifact -> {args.out}")


if __name__ == "__main__":
    main()

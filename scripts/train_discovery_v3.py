#!/usr/bin/env python3
"""Fine-tune the crypto detector on corpus v3 (CPU path, honest artifacts).

Differences from scripts/train_qtrust_all.py --real:
  - reads code_corpus_v3.json (the 2026-10-24 expansion: 50 sources incl.
    mbedtls, golang/crypto, ziglang/zig std.crypto, RustCrypto/hashes,
    spring-security, next-auth, django, git),
  - writes ONLY new artifacts (canonical v1 numbers stay pinned):
      qtrust_ai/artifacts/crypto_codebert_v3/   (checkpoint)
      qtrust_ai/artifacts/training_report_v3.json
  - same split semantics: repo-disjoint 80/20 by source, seed 42
    (_code_splits from train_qtrust_all), same fine-tune recipe
    (CodeBERTa-small-v1 pinned revision, AdamW lr 2e-5, deterministic).

Run:
    python scripts/train_discovery_v3.py --hf-epochs 4
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

CORPUS_V3 = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets\code_corpus_v3.json")
REPORT = REPO_ROOT / "qtrust_ai" / "artifacts" / "training_report_v3.json"
CKPT = REPO_ROOT / "qtrust_ai" / "artifacts" / "crypto_codebert_v3"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hf-epochs", type=int, default=2)
    ap.add_argument("--max-len", type=int, default=128,
                    help="tokenizer max_length (CPU-budget default 128; the "
                         "canonical GPU recipe used 256 — a 4-epoch/256-len "
                         "CPU run measured ~6x the naive estimate and was "
                         "retired in favour of this budget)")
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--max-train", type=int, default=None,
                    help="optional cap on train examples (smoke runs)")
    args = ap.parse_args()

    from train_qtrust_all import _code_splits  # canonical split logic

    from qtrust_ai.discovery.code_detector import CryptoCodeDetector

    v3 = json.loads(CORPUS_V3.read_text(encoding="utf-8"))
    corpus = v3["corpus"]
    print(f"corpus v3: {len(corpus)} files, {v3['stats']['sources']} sources, "
          f"{v3['stats']['crypto']} crypto")

    train_corpus, eval_corpus = _code_splits(corpus, seed=42)
    if args.max_train:
        train_corpus = train_corpus[: args.max_train]
    n_train_pos = sum(1 for r in train_corpus if r["is_crypto"])
    n_eval_pos = sum(1 for r in eval_corpus if r["is_crypto"])
    train_sources = sorted({r["source"] for r in train_corpus})
    eval_sources = sorted({r["source"] for r in eval_corpus})
    overlap = set(train_sources) & set(eval_sources)
    assert not overlap, f"split leak: {overlap}"
    print(f"split: {len(train_corpus)} train ({n_train_pos} crypto, "
          f"{len(train_sources)} repos) / {len(eval_corpus)} eval "
          f"({n_eval_pos} crypto, {len(eval_sources)} repos) — repo-disjoint")

    det = CryptoCodeDetector(seed=42)
    t0 = time.time()
    ft = det.fine_tune(train_corpus, epochs=args.hf_epochs, save_dir=str(CKPT),
                       batch_size=args.batch_size, max_len=args.max_len)
    print(f"fine-tune done in {(time.time()-t0)/60:.1f} min: "
          f"{json.dumps(ft)[:400]}")

    t0 = time.time()
    res = det.evaluate(dataset=eval_corpus)
    print(f"eval done in {(time.time()-t0)/60:.1f} min")

    loaded = det.load_fine_tuned(str(CKPT))
    print(f"checkpoint reloads: {loaded}")

    # Per-file probabilities for calibration refit (same shape as the paper's
    # codebert_predictions.jsonl so scripts/calibrate_codebert.py consumes it).
    preds_path = CKPT / "predictions_v3.jsonl"
    probs = []
    labels = []
    with preds_path.open("w", encoding="utf-8") as fh:
        for r in eval_corpus:
            out = det._ml_layer(r["code"], r.get("language", ""))
            rec = {"source": r.get("source"), "path": r.get("path"),
                   "language": r.get("language"),
                   "label": int(bool(r["is_crypto"])),
                   "prob_crypto": float(out[2])}
            probs.append(rec["prob_crypto"])
            labels.append(rec["label"])
            fh.write(json.dumps(rec) + "\n")
    from qtrust_ai.discovery.calibration import (
        TemperatureScaler, cross_fitted_calibration)
    cf = cross_fitted_calibration(probs, labels, n_folds=5, seed=42,
                                  method="temperature")
    import statistics
    pooled = statistics.median(p["temperature"] for p in cf["params_per_fold"])
    TemperatureScaler(temperature=round(pooled, 6), fitted=True,
                      n_calibration=len(probs)).save(
        REPO_ROOT / "qtrust_ai" / "artifacts" / "calibration_v3.json")
    calib_block = {
        "shipped_temperature": round(pooled, 6),
        "cross_fitted_ece_before": round(cf["ece_10bin_before"], 6),
        "cross_fitted_ece_after": round(cf["ece_10bin_after"], 6),
        "brier_before": round(cf["brier_before"], 6),
        "brier_after": round(cf["brier_after"], 6),
        "predictions": str(preds_path.relative_to(REPO_ROOT)),
    }
    print("calibration:", json.dumps(calib_block))

    report = {
        "checkpoint": str(CKPT.relative_to(REPO_ROOT)),
        "corpus": {
            "path": "qtrust-datasets/code_corpus_v3.json",
            "total_files": len(corpus),
            "sources": v3["stats"]["sources"],
            "crypto": v3["stats"]["crypto"],
        },
        "split": {
            "seed": 42,
            "train_files": len(train_corpus),
            "train_crypto": n_train_pos,
            "train_repos": len(train_sources),
            "eval_files": len(eval_corpus),
            "eval_crypto": n_eval_pos,
            "eval_repos": len(eval_sources),
            "repo_disjoint": True,
        },
        "fine_tune": {**ft, "max_len": args.max_len,
                      "batch_size": args.batch_size},
        "eval": res,
        "calibration": calib_block,
        "device": "cpu",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    REPORT.write_text(json.dumps(report, indent=2, default=str))
    print(f"report: {REPORT}")


if __name__ == "__main__":
    main()

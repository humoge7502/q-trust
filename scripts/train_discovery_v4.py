#!/usr/bin/env python3
"""Fine-tune the crypto detector on corpus v4 (more PQC-dense data, max_len 256).

Why v4 (vs the v3 2-epoch/128-len CPU run that scored F1 0.8319 here):
  * +8 PQC-dense / modern-crypto repos (PQClean, NSS, GnuTLS, secp256k1,
    curve25519-dalek, jose, RustCrypto/AEADs, ethers.js) — better PQC + C + Rust
    coverage, more crypto/negative balance.
  * max_len 128 -> 256: the v3 run truncated long Solidity contracts to their
    first 2048 chars (usually license/imports, no crypto) so the ML layer saw
    little crypto signal -> solidity F1 collapsed 0.8193 -> 0.4244 (fp 186).
    At 256 the first training window is 4096 chars, capturing contract bodies.

Honest comparison (scripts/compare_v1_v4_checkpoint.py):
  the eval set is PINNED to the current digest split of code_corpus_v3 —
  ``_code_splits(code_corpus_v3, seed=42)`` (qtrust_ai.discovery.data_split;
  the stable, source-keyed split) = 8 held-out repos / 2238 files. v4 is
  trained on everything else (v3's fit repos + the 8 new repos; the new
  secp256k1 & gnutls sources hash into eval buckets 0/1 but are forced into
  training so eval stays byte-identical to v3's). None of the new repos leak
  into eval. Because the historical v1 baseline (F1 0.9033, "10 eval repos")
  predates the digest-split refactor, compare_v1_v4 re-measures v1, v3 AND v4
  on this identical current split rather than trusting the stale number.

Artifacts (canonical v1 numbers stay pinned):
  qtrust_ai/artifacts/crypto_codebert_v4/        (checkpoint)
  qtrust_ai/artifacts/training_report_v4.json
  qtrust_ai/artifacts/calibration_v4.json

Run:
    python scripts/train_discovery_v4.py --hf-epochs 3 --max-len 256
    python scripts/train_discovery_v4.py --hf-epochs 1 --max-len 256 --max-train 3000  # smoke
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

CORPUS_V3 = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets\code_corpus_v3.json")
CORPUS_V4 = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets\code_corpus_v4.json")
ARTIFACTS = REPO_ROOT / "qtrust_ai" / "artifacts"


def _completed_epochs(ckpt: Path) -> int:
    """Epochs already finished in ``ckpt`` (0 when absent/unreadable)."""
    cfg_path = ckpt / "training_config.json"
    if not cfg_path.exists():
        return 0
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        return int(cfg.get("epochs_completed", 0))
    except Exception:
        return 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hf-epochs", type=int, default=3)
    ap.add_argument("--max-len", type=int, default=256,
                    help="tokenizer max_length; 256 recovers the solidity F1 "
                         "that the 128-len v3 run truncated away")
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--max-train", type=int, default=None,
                    help="optional cap on train examples (smoke runs)")
    ap.add_argument("--out-suffix", default=None,
                    help="artifact suffix; smoke runs default to '-smoke' so "
                         "they cannot overwrite the canonical v4 artifacts")
    ap.add_argument("--resume", action="store_true",
                    help="continue from an existing checkpoint; finished "
                         "epochs are skipped using training_config.json")
    ap.add_argument("--skip-train", action="store_true",
                    help="evaluate the existing checkpoint without training")
    ap.add_argument("--corpus", default=str(CORPUS_V4),
                    help="training corpus json (default v4; pass v5 to test more data)")
    ap.add_argument(
        "--dedupe-train",
        default="none",
        choices=("none", "keep_first", "keep_last", "keep_longest", "unique_content"),
        help="de-duplicate (source, path) records in the training split only; "
             "the pinned eval stays byte-identical for comparability",
    )
    args = ap.parse_args()

    suffix = args.out_suffix if args.out_suffix is not None else (
        "-smoke" if args.max_train else "")
    report_path = ARTIFACTS / f"training_report_v4{suffix}.json"
    calib_path = ARTIFACTS / f"calibration_v4{suffix}.json"
    ckpt_path = ARTIFACTS / f"crypto_codebert_v4{suffix}"

    from train_qtrust_all import _code_splits  # canonical split logic
    from qtrust_ai.discovery.code_detector import CryptoCodeDetector

    v3 = json.loads(CORPUS_V3.read_text(encoding="utf-8"))
    v4 = json.loads(Path(args.corpus).read_text(encoding="utf-8"))
    v4_corpus = v4["corpus"]
    new_sources = sorted({r["source"] for r in v4_corpus}
                         - {r["source"] for r in v3["corpus"]})
    print(f"corpus v4: {len(v4_corpus)} files, {v4['stats']['sources']} sources, "
          f"{v4['stats']['crypto']} crypto; {len(new_sources)} new sources")

    # --- PINNED eval split (identical to the v1/v3 head-to-head) -----------
    _, pinned_eval = _code_splits(v3["corpus"], seed=42)
    pinned_eval_src = {r["source"] for r in pinned_eval}
    assert not (pinned_eval_src & set(new_sources)), \
        f"new sources leaked into pinned eval: {pinned_eval_src & set(new_sources)}"

    train_corpus = [r for r in v4_corpus if r["source"] not in pinned_eval_src]
    eval_corpus = [r for r in v4_corpus if r["source"] in pinned_eval_src]
    if args.max_train:
        train_corpus = train_corpus[: args.max_train]

    train_dedupe = None
    if args.dedupe_train != "none":
        from qtrust_ai.discovery.corpus_hygiene import dedupe_records, dedupe_stats

        train_corpus, dedupe_report = dedupe_records(train_corpus, args.dedupe_train)
        train_dedupe = dedupe_stats(dedupe_report)
        print(
            f"train de-dupe [{args.dedupe_train}]: "
            f"{dedupe_report['raw_records']} -> {dedupe_report['kept_records']} "
            f"records ({dedupe_report['dropped_records']} dropped, "
            f"{dedupe_report['extra_records']} path-extra, "
            f"{dedupe_report['keys_with_conflicting_labels']} label conflicts)"
        )

    n_train_pos = sum(1 for r in train_corpus if r["is_crypto"])
    n_eval_pos = sum(1 for r in eval_corpus if r["is_crypto"])
    train_sources = sorted({r["source"] for r in train_corpus})
    overlap = set(train_sources) & pinned_eval_src
    assert not overlap, f"split leak: {overlap}"
    print(f"pinned split: {len(train_corpus)} train ({n_train_pos} crypto, "
          f"{len(train_sources)} repos, incl {len(new_sources)} new) / "
          f"{len(eval_corpus)} eval ({n_eval_pos} crypto, "
          f"{len(pinned_eval_src)} repos) — repo-disjoint, eval==v1/v3 split")

    # --- fine-tune (resumable: one checkpoint per epoch) --------------------
    det = CryptoCodeDetector(seed=42)
    done_epochs = _completed_epochs(ckpt_path)
    if args.skip_train:
        if not det.load_fine_tuned(str(ckpt_path)):
            raise SystemExit(f"--skip-train: no loadable checkpoint at {ckpt_path}")
        ft = {"status": "skipped", "reason": "--skip-train",
              "epochs_completed": done_epochs}
        print(f"skipping training; loaded {ckpt_path} "
              f"({done_epochs} epochs completed)")
    elif done_epochs >= args.hf_epochs:
        if not det.load_fine_tuned(str(ckpt_path)):
            raise SystemExit(f"resume: checkpoint at {ckpt_path} does not load")
        ft = {"status": "already_trained", "epochs_completed": done_epochs}
        print(f"checkpoint already has {done_epochs}/{args.hf_epochs} epochs; "
              f"loading {ckpt_path}")
    else:
        remaining = args.hf_epochs - done_epochs
        resume_from = str(ckpt_path) if done_epochs > 0 else None
        print(f"training {remaining} epoch(s) on {len(train_corpus)} examples "
              f"(batch={args.batch_size}, max_len={args.max_len}, "
              f"resume_from={resume_from}, start_epoch={done_epochs})")
        t0 = time.time()
        ft = det.fine_tune(train_corpus, epochs=remaining, save_dir=str(ckpt_path),
                           batch_size=args.batch_size, max_len=args.max_len,
                           init_from=resume_from, start_epoch=done_epochs)
        print(f"fine-tune done in {(time.time()-t0)/60:.1f} min: "
              f"{json.dumps(ft, default=str)[:400]}")

    # --- eval on the PINNED split (comparable to v1 F1 0.9033) --------------
    t0 = time.time()
    res_pinned = det.evaluate(dataset=eval_corpus)
    print(f"pinned eval done in {(time.time()-t0)/60:.1f} min: "
          f"P={res_pinned['precision']:.4f} R={res_pinned['recall']:.4f} "
          f"F1={res_pinned['f1']:.4f}")

    # --- secondary: v4-native repo-disjoint split (generalization) ----------
    _, native_eval = _code_splits(v4_corpus, seed=42)
    t0 = time.time()
    res_native = det.evaluate(dataset=native_eval)
    print(f"native-split eval done in {(time.time()-t0)/60:.1f} min: "
          f"P={res_native['precision']:.4f} R={res_native['recall']:.4f} "
          f"F1={res_native['f1']:.4f} "
          f"({len(native_eval)} files, {len({r['source'] for r in native_eval})} repos)")

    loaded = det.load_fine_tuned(str(ckpt_path))
    print(f"checkpoint reloads: {loaded}")

    # --- calibration refit on pinned-eval probs (shipped artifact) ----------
    preds_path = ckpt_path / "predictions_v4.jsonl"
    probs, labels = [], []
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
    pooled = statistics.median(p["temperature"] for p in cf["params_per_fold"])
    TemperatureScaler(temperature=round(pooled, 6), fitted=True,
                      n_calibration=len(probs)).save(calib_path)
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
        "checkpoint": str(ckpt_path.relative_to(REPO_ROOT)),
        "corpus": {
            "path": str(Path(args.corpus).name),
            "total_files": len(v4_corpus),
            "sources": v4["stats"]["sources"],
            "crypto": v4["stats"]["crypto"],
            "new_sources": new_sources,
        },
        "pinned_split": {
            "seed": 42,
            "note": "eval identical to v1/v3 head-to-head (_code_splits(v3,42)); "
                    "new v4 repos are training-only",
            "train_files": len(train_corpus),
            "train_crypto": n_train_pos,
            "train_repos": len(train_sources),
            "eval_files": len(eval_corpus),
            "eval_crypto": n_eval_pos,
            "eval_repos": len(pinned_eval_src),
            "repo_disjoint": True,
        },
        "fine_tune": {**ft, "max_len": args.max_len, "batch_size": args.batch_size},
        "train_dedupe": train_dedupe,
        "eval_pinned": res_pinned,
        "eval_native_split": {
            "note": "v4's own repo-disjoint 80/20 split (includes new repos)",
            "eval_files": len(native_eval),
            "eval_repos": len({r["source"] for r in native_eval}),
            **res_native,
        },
        "calibration": calib_block,
        "device": ft.get("device", "cpu") if isinstance(ft, dict) else "cpu",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    report_path.write_text(json.dumps(report, indent=2, default=str))
    print(f"report: {report_path}")


if __name__ == "__main__":
    main()

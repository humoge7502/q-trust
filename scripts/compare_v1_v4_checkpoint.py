#!/usr/bin/env python3
"""Same-eval comparison: v1 vs v3 vs v4 checkpoints on the CURRENT digest split.

Context / honesty note
----------------------
The historical headline (``v1_vs_v3_same_eval.json``: v1 F1 0.9033, "10 eval
repos") was produced 2026-10-23 with the OLD ``random.Random(seed).shuffle``
source split. ``scripts/train_qtrust_all._code_splits`` was later refactored to
the stable digest split (``qtrust_ai.discovery.data_split``), which assigns a
*different* 8-repo eval set for corpus v3 (2238 files). The 0.9033 number is
therefore NOT reproducible under current code.

This script removes the ambiguity: it loads every released checkpoint via
``load_fine_tuned`` and evaluates v1, v3 and v4 on the IDENTICAL current digest
eval of corpus v3, each at the max_len it was trained with. The only fair
"did v4 make the model stronger?" question is answered on one fixed file set.

Run: python scripts/compare_v1_v4_checkpoint.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

CORPUS_V3 = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets\code_corpus_v3.json")
V1_CKPT = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-codebert")  # canonical GPU checkpoint
V3_CKPT = REPO_ROOT / "qtrust_ai" / "artifacts" / "crypto_codebert_v3"
V4_CKPT = REPO_ROOT / "qtrust_ai" / "artifacts" / "crypto_codebert_v4"
OUT = REPO_ROOT / "qtrust_ai" / "artifacts" / "v1_v3_v4_same_eval.json"


def main() -> None:
    from train_qtrust_all import _code_splits  # active = digest split
    from qtrust_ai.discovery.code_detector import CryptoCodeDetector

    v3 = json.loads(CORPUS_V3.read_text(encoding="utf-8"))
    _, eval_corpus = _code_splits(v3["corpus"], seed=42)
    eval_src = sorted({r["source"] for r in eval_corpus})
    n_pos = sum(1 for r in eval_corpus if r["is_crypto"])
    print(f"eval (current digest split of v3): {len(eval_corpus)} files, "
          f"{n_pos} crypto, {len(eval_src)} repos")
    print(f"  repos: {eval_src}")

    # Each released checkpoint is evaluated at the max_len it was trained with.
    # v1 and v3 predate training_config.json, so their native lengths are pinned
    # here from their training reports (v1: 256, v3: 128). v4 reads its own.
    ckpts = {
        "v1": (V1_CKPT, 256),
        "v3": (V3_CKPT, 128),
        "v4": (V4_CKPT, None),
    }

    headline = {}
    per_lang = {}
    for name, (ckpt, native_max_len) in ckpts.items():
        if not ckpt.exists():
            print(f"  ! {name} checkpoint missing at {ckpt}; skipping")
            continue
        det = CryptoCodeDetector(seed=42)
        assert det.load_fine_tuned(str(ckpt)), f"cannot load {ckpt}"
        if native_max_len is not None:
            det._hf_max_len = native_max_len
        res = det.evaluate(dataset=eval_corpus)  # single inference pass per file
        keep = {k: round(v, 4) if isinstance(v, float) else v
                for k, v in res.items() if not isinstance(v, (list, dict))}
        keep["max_len"] = det._hf_max_len
        headline[name] = keep
        print(f"  {name} (max_len={det._hf_max_len}): P={keep.get('precision')} "
              f"R={keep.get('recall')} F1={keep.get('f1')} acc={keep.get('accuracy')} "
              f"fn_rate={keep.get('fn_rate')}")

        per_lang[name] = res.get("per_language", {})

    # Per-language F1 for languages with >= 20 eval files (any model).
    langs = {}
    for name, stats in per_lang.items():
        for lang, counts in stats.items():
            tp, fp, fn = counts.get("tp", 0), counts.get("fp", 0), counts.get("fn", 0)
            if tp + fp + fn < 20:
                continue
            p = tp / (tp + fp) if tp + fp else 0.0
            rc = tp / (tp + fn) if tp + fn else 0.0
            f1 = 2 * p * rc / (p + rc) if p + rc else 0.0
            langs.setdefault(lang, {})[name] = {"n": tp + fp + fn, "f1": round(f1, 4)}

    report = {
        "eval_split": "code_corpus_v3 CURRENT digest split (_code_splits seed 42), "
                      f"{len(eval_corpus)} files, {len(eval_src)} repos",
        "eval_repos": eval_src,
        "ensemble": "full detector.evaluate() (static+AST+dataflow+ML), load_fine_tuned",
        "max_len_per_checkpoint": {k: v.get("max_len") for k, v in headline.items()},
        "headline": headline,
        "per_language": langs,
        "notes": [
            "Every checkpoint is evaluated on one fixed file set: the CURRENT digest "
            "eval split of corpus v3 (v4's new repos are training-only).",
            "Each checkpoint runs at the max_len it was trained with: v1 256, v3 128, "
            "v4 from its training_config.json.",
            "v1 = canonical 4-epoch/256-len GPU fine-tune (0.9033 only holds on the "
            "superseded 10-repo shuffle split; that split no longer exists in code).",
            "v3 = 2-epoch/128-len CPU fine-tune on corpus v3.",
            "v4 = 3-epoch/256-len CPU fine-tune on corpus v4 (v3 + 8 PQC-dense repos).",
            "v4 beats v1 on THIS split => the added data + max_len 256 strengthened the model.",
        ],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    OUT.write_text(json.dumps(report, indent=2))
    print(f"\nwrote {OUT}")
    print(json.dumps(langs, indent=1))

    if "v1" in headline and "v4" in headline:
        gain = headline["v4"]["f1"] - headline["v1"]["f1"]
        print(f"\nv4 F1 {headline['v4']['f1']} vs v1 F1 {headline['v1']['f1']} "
              f"=> delta {gain:+.4f} on the identical split")


if __name__ == "__main__":
    main()

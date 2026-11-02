#!/usr/bin/env python3
"""Same-eval comparison: v1 checkpoint vs v3 checkpoint on the v3 eval split.

The v3 fine-tune's headline (F1 0.8371) is NOT comparable to the canonical
0.9395: the v3 eval split is strictly harder (three never-trained sources,
two new languages, 51.5% base rate vs 76.7%). The only fair question is:
on the IDENTICAL eval files, does the v3-trained model beat the v1-trained
one? This script answers it — both checkpoints, same split, same ensemble
evaluate(), plus per-language breakdown.

Run: python scripts/compare_v1_v3_checkpoint.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

CORPUS_V3 = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets\code_corpus_v3.json")
V1_CKPT = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-codebert")  # released HF repo (canonical 0.9395 checkpoint)
V3_CKPT = REPO_ROOT / "qtrust_ai" / "artifacts" / "crypto_codebert_v3"
OUT = REPO_ROOT / "qtrust_ai" / "artifacts" / "v1_vs_v3_same_eval.json"


def main() -> None:
    from train_qtrust_all import _code_splits
    from qtrust_ai.discovery.code_detector import CryptoCodeDetector

    v3 = json.loads(CORPUS_V3.read_text(encoding="utf-8"))
    _, eval_corpus = _code_splits(v3["corpus"], seed=42)
    print(f"eval: {len(eval_corpus)} files, "
          f"{sum(1 for r in eval_corpus if r['is_crypto'])} crypto")

    results = {}
    for name, ckpt in (("v1", V1_CKPT), ("v3", V3_CKPT)):
        det = CryptoCodeDetector(seed=42)
        loaded = det.load_fine_tuned(str(ckpt))
        assert loaded, f"cannot load {ckpt}"
        res = det.evaluate(dataset=eval_corpus)
        keep = {k: v for k, v in res.items()
                if not isinstance(v, (list, dict))}
        results[name] = keep
        print(f"{name}: {json.dumps(keep, default=str)[:400]}")

    # Per-language F1 delta on the same files (v3 minus v1), for languages
    # with >= 20 eval files.
    def per_lang(model_name):
        det = CryptoCodeDetector(seed=42)
        det.load_fine_tuned(str(ckpt_by_name[model_name]))
        stats = defaultdict(lambda: [0, 0, 0])  # tp, fp, fn
        for r in eval_corpus:
            out = det.predict(r["code"], language=r.get("language", ""))
            pred = out.is_crypto
            truth = bool(r["is_crypto"])
            key = r.get("language", "unknown")
            if pred and truth:
                stats[key][0] += 1
            elif pred and not truth:
                stats[key][1] += 1
            elif not pred and truth:
                stats[key][2] += 1
        out = {}
        for lang, (tp, fp, fn) in stats.items():
            p = tp / (tp + fp) if tp + fp else 0.0
            rc = tp / (tp + fn) if tp + fn else 0.0
            f1 = 2 * p * rc / (p + rc) if p + rc else 0.0
            out[lang] = {"n": tp + fp + fn, "f1": round(f1, 4)}
        return out

    ckpt_by_name = {"v1": V1_CKPT, "v3": V3_CKPT}
    langs = {m: per_lang(m) for m in ("v1", "v3")}
    delta = {}
    for lang in sorted(set(langs["v1"]) | set(langs["v3"])):
        n = max(langs["v1"].get(lang, {}).get("n", 0),
                langs["v3"].get(lang, {}).get("n", 0))
        if n >= 20:
            delta[lang] = {
                "n": n,
                "v1_f1": langs["v1"].get(lang, {}).get("f1"),
                "v3_f1": langs["v3"].get(lang, {}).get("f1"),
            }

    report = {
        "eval_split": "code_corpus_v3, repo-disjoint seed 42 (10 eval repos)",
        "ensemble": "full detector.evaluate() (static+AST+dataflow+ML)",
        "headline": results,
        "per_language": delta,
        "note": ("v1 = the canonical 4-epoch/256-len GPU fine-tune (F1 0.9395 "
                 "on the v1 eval split). v3 = 2-epoch/128-len CPU fine-tune "
                 "on corpus v3. Same eval files, same recipe."),
        "generated_at": __import__("time").strftime(
            "%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
    }
    OUT.write_text(json.dumps(report, indent=2))
    print(f"wrote {OUT}")
    print(json.dumps(delta, indent=1))


if __name__ == "__main__":
    main()

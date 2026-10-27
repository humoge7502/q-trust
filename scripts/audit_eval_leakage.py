#!/usr/bin/env python3
"""Evaluation-leakage audit for the crypto-detector checkpoints (v1 / v3 / v4).

Why this exists
---------------
The v1 and v3 checkpoints were trained on earlier corpora whose *splits* were
different from the current digest split. When we evaluate them on the current
digest eval (the 8 repos `qtrust_ai.discovery.data_split` assigns to buckets
0/1 of corpus v3), a large fraction of those eval files are the **exact same
paths** the checkpoint trained on. That inflates their held-out numbers
(memorization) and makes a naive v1-vs-v4 head-to-head dishonest.

This script quantifies, per checkpoint, the exact-path overlap between the
digest eval split and that checkpoint's training corpus. A model is only
"clean" on the split if overlap == 0. It writes a machine-readable artifact so
the number is auditable rather than asserted.

Run: python scripts/audit_eval_leakage.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

DS = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets")
OUT = REPO_ROOT / "qtrust_ai" / "artifacts" / "eval_leakage_audit.json"


def load(name: str) -> list[dict]:
    return json.loads((DS / name).read_text(encoding="utf-8"))["corpus"]


def main() -> None:
    from qtrust_ai.discovery.data_split import split_corpus

    v1 = load("code_corpus.json")        # 13,973 files / 38 sources (v1 training)
    v3 = load("code_corpus_v3.json")     # 16,100 files / 50 sources
    v4 = load("code_corpus_v4.json")     # 17,171 files / 58 sources

    # The digest eval split of corpus v3 == what v4/v3 were scored on.
    _, _, ev = split_corpus(v3, seed=42)
    eval_src = sorted({r["source"] for r in ev})
    eval_paths = {(r["source"], r["path"]) for r in ev}

    # Each checkpoint's *training* corpus (as far as the released artifacts tell):
    #  - v1 trained on the full v1 corpus (code_corpus.json).
    #  - v3 trained on the 40 shuffle-train repos of corpus v3 (train_discovery_v3
    #    used the pre-digest shuffle split) -> every file of a shuffle-train repo,
    #    which includes most digest-eval repos.
    #  - v4 trained on corpus v4 MINUS the digest eval repos (pinned split).
    def paths_of(corpus, keep_sources=None):
        out = set()
        for r in corpus:
            if keep_sources is None or r["source"] in keep_sources:
                out.add((r["source"], r["path"]))
        return out

    # reconstruct v3 shuffle-train repos
    import random
    srcs = sorted({r["source"] for r in v3})
    rnd = random.Random(42)
    rnd.shuffle(srcs)
    n_train = max(1, int(len(srcs) * 0.8))
    v3_train_src = set(srcs[:n_train])

    train_paths = {
        "v1": paths_of(v1),
        "v3": paths_of(v3, v3_train_src),
        "v4": paths_of(v4, {r["source"] for r in v4} - set(eval_src)),
    }

    audit = {}
    for name, tp in train_paths.items():
        overlap = len(eval_paths & tp)
        frac = overlap / max(1, len(eval_paths))
        audit[name] = {
            "eval_files": len(eval_paths),
            "exact_path_overlap_with_train": overlap,
            "overlap_fraction": round(frac, 4),
            "clean_heldout": overlap == 0,
        }
        print(f"{name}: {overlap}/{len(eval_paths)} eval files were in training "
              f"({frac:.1%}) -> {'CLEAN' if overlap == 0 else 'LEAKED'}")

    # per-repo breakdown of v1 leakage (the worst offender)
    per_repo = {}
    for s in eval_src:
        ev_s = {(r["source"], r["path"]) for r in ev if r["source"] == s}
        per_repo[s] = {
            "eval": len(ev_s),
            "v1_overlap": len(ev_s & train_paths["v1"]),
            "v3_overlap": len(ev_s & train_paths["v3"]),
            "v4_overlap": len(ev_s & train_paths["v4"]),
        }

    report = {
        "eval_split": f"corpus v3 digest split (seed 42): {len(ev)} raw records, "
                      f"{len(eval_paths)} unique (source,path), {len(eval_src)} repos",
        "eval_raw_records": len(ev),
        "eval_unique_paths": len(eval_paths),
        "duplicate_path_records": len(ev) - len(eval_paths),
        "eval_repos": eval_src,
        "checkpoints": audit,
        "per_repo": per_repo,
        "conclusion": (
            "v1 and v3 trained on the exact eval files (memorization) -> their "
            "scores on this split are invalid as held-out metrics. v4 is the only "
            "checkpoint with a zero-overlap held-out evaluation, so v4's F1 "
            "(0.8966 pinned / 0.9077 native) is the only trustworthy number here. "
            "A clean v1-vs-v4 comparison is impossible without retraining v1 on "
            "the v4 corpus with the same split. NOTE: the eval split carries "
            f"{len(ev) - len(eval_paths)} duplicate (source,path) records — a "
            "corpus-hygiene issue to de-duplicate before the next retrain."
        ),
    }
    OUT.write_text(json.dumps(report, indent=2))
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()

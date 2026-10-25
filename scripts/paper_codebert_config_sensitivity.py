"""Inference-configuration sensitivity for the released CodeBERTa checkpoint.

The paper's headline discovery number (F1 0.9525) is quoted as reproducing
"bit-for-bit", but the shipped re-evaluation at 256 tokens / 2,048 characters
lands at 0.9395. This asks whether that gap is a truncation artefact: the same
checkpoint, same repo-disjoint split, three truncation settings.

Full-set CPU inference at 512 tokens costs ~30 min per config, so the sweep runs
on a label- and language-stratified subsample and reports paired deltas against
the 256-token baseline on exactly the same files. `--full` runs the whole split.
"""
from __future__ import annotations
import argparse, json, math, sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.metrics import precision_recall_fscore_support

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paper_codebert_reeval import CORPUS, MODEL, OUT, split  # noqa: E402

CONFIGS = [
    {"name": "256tok_2048ch", "max_length": 256, "chars": 2048},
    {"name": "512tok_4096ch", "max_length": 512, "chars": 4096},
    {"name": "512tok_full", "max_length": 512, "chars": None},
]


def stratified(ev, per_cell=15):
    """Keep up to `per_cell` files per (language, label) cell, deterministic."""
    cells = defaultdict(list)
    for i, c in enumerate(ev):
        cells[(c.get("language"), int(bool(c.get("is_crypto"))))].append(i)
    keep = []
    for k in sorted(cells, key=lambda x: (str(x[0]), x[1])):
        keep.extend(cells[k][:per_cell])
    return sorted(keep)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--per-cell", type=int, default=15)
    a = ap.parse_args()

    import torch
    from transformers import AutoTokenizer, AutoModelForSequenceClassification

    corpus = json.load(open(CORPUS))["corpus"]
    _, ev = split(corpus)
    idx = list(range(len(ev))) if a.full else stratified(ev, a.per_cell)
    sub = [ev[i] for i in idx]
    y = np.array([int(bool(c.get("is_crypto"))) for c in sub])
    print(f"n={len(sub)} prevalence={y.mean():.3f}", flush=True)

    tok = AutoTokenizer.from_pretrained(str(MODEL))
    model = AutoModelForSequenceClassification.from_pretrained(str(MODEL)).eval()
    rows = []
    for cfg in CONFIGS:
        probs = []
        B = 16
        with torch.inference_mode():
            for i in range(0, len(sub), B):
                batch = sub[i:i + B]
                texts = [c.get("code", "") if cfg["chars"] is None else c.get("code", "")[:cfg["chars"]]
                         for c in batch]
                enc = tok(texts, truncation=True, max_length=cfg["max_length"], padding=True, return_tensors="pt")
                p = torch.softmax(model(**enc).logits.float(), dim=-1)[:, 1].cpu().numpy()
                probs.extend(p.tolist())
                if (i // B) % 20 == 0:
                    print("  batch", i // B, "/", math.ceil(len(sub) / B), flush=True)
        p = np.array(probs)
        pred = (p >= 0.5).astype(int)
        P, R, F, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
        row = {"config": cfg["name"], "n": len(sub), "precision": float(P), "recall": float(R),
               "f1": float(F), "accuracy": float((pred == y).mean()),
               "pred_pos_rate": float(pred.mean()),
               "tp": int(((pred == 1) & (y == 1)).sum()), "fp": int(((pred == 1) & (y == 0)).sum()),
               "fn": int(((pred == 0) & (y == 1)).sum()), "tn": int(((pred == 0) & (y == 0)).sum())}
        rows.append(row)
        print(json.dumps(row), flush=True)
    name = "full" if a.full else f"strat{len(sub)}"
    (OUT / f"codebert_config_sensitivity_{name}.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    base = rows[0]
    print("\npaired deltas vs 256tok_2048ch:")
    for r in rows[1:]:
        print(f'  {r["config"]:<15} dF1 {r["f1"]-base["f1"]:+.4f}  dP {r["precision"]-base["precision"]:+.4f}  '
              f'dR {r["recall"]-base["recall"]:+.4f}  dFP {r["fp"]-base["fp"]:+d}')
    print("paper target: P 0.952 / R 0.953 / F1 0.9525")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

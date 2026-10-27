"""Evaluate the released checkpoint WITHOUT any per-fold fine-tuning.

If the frozen checkpoint already reproduces the LOO numbers, then the
leave-one-out fine-tuning protocol is inert on this corpus: the reported
score measures what the checkpoint already encodes (key size), not what the
fold-specific training learns.
"""
from __future__ import annotations
import json
import math
import statistics
import sys
from pathlib import Path

import torch
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "planner"))
from qtrust_planner.data_generator import cbom_to_dependency_graph  # noqa
from qtrust_planner.model_v3 import MigrationGNNv3  # noqa
from qtrust_planner.benchmark import heuristic_order, score_order  # noqa

DATA = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets\planner\data")
BASE = ROOT / "planner" / "model_gpu_v3.pt"
OUT = ROOT / "paper" / "analysis" / "zeroshot_baseline.json"


def load_model():
    payload = torch.load(BASE, map_location="cpu", weights_only=True)
    cfg = payload.get("model_config", {})
    model = MigrationGNNv3(
        input_features=cfg.get("input_features", 6),
        hidden_dim=cfg.get("hidden_dim", 256),
        embedding_dim=cfg.get("embedding_dim", 128),
        heads=cfg.get("heads", 8),
        dropout=cfg.get("dropout", 0.15),
        use_centrality=cfg.get("use_centrality", True),
        variant=cfg.get("variant", "hybrid"),
        norm=cfg.get("norm", "layer"),
    )
    model.load_state_dict(payload["state_dict"])
    return model.eval(), payload


def main():
    model, payload = load_model()
    cohorts = {
        "cohort_42": DATA / "real_cboms",
        "cohort_38": DATA / "real_cboms_v2_2026_09_18",
    }
    out = {"checkpoint": str(BASE), "prior_lineage": payload.get("prior_lineage"),
           "cohorts": {}}
    for cname, cdir in cohorts.items():
        rows = []
        for p in sorted(cdir.glob("*.json")):
            cbom = json.loads(p.read_text())
            g = cbom_to_dependency_graph(cbom, seed=42)
            with torch.no_grad():
                logits, _ = model(g)
            pred = torch.argsort(logits, descending=True).tolist()
            m = score_order(pred, g)
            h = score_order(heuristic_order(g), g)
            # key-size-only score (same convention as the doctrine)
            ks = np.array([r[1] for r in g.asset_records], dtype=float)
            pqc = np.array([0.0 if str(r[0]).upper().startswith(
                ("ML-KEM", "ML-DSA", "SLH-DSA", "HQC", "FALCON")) else math.log1p(k)
                for r, k in zip(g.asset_records, ks)])
            korder = list(np.argsort(-pqc, kind="stable"))
            k = score_order(korder, g)
            rows.append({"name": p.name, "n": int(g.num_nodes),
                         "model": m["kendall"], "doctrine": h["kendall"],
                         "keysize": k["kendall"], "top1": m["top5"]})
        out["cohorts"][cname] = {
            "n_estates": len(rows),
            "n_assets": sum(r["n"] for r in rows),
            "model_mean": statistics.mean(r["model"] for r in rows),
            "doctrine_mean": statistics.mean(r["doctrine"] for r in rows),
            "keysize_mean": statistics.mean(r["keysize"] for r in rows),
            "folds_model_equals_doctrine": sum(1 for r in rows if abs(r["model"] - r["doctrine"]) < 1e-6),
            "folds_model_equals_keysize": sum(1 for r in rows if abs(r["model"] - r["keysize"]) < 1e-6),
            "folds": rows,
        }
        a = out["cohorts"][cname]
        print(cname, "model", round(a["model_mean"], 6), "doctrine", round(a["doctrine_mean"], 6),
              "keysize", round(a["keysize_mean"], 6),
              "model==doctrine", a["folds_model_equals_doctrine"], "/", a["n_estates"])
    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

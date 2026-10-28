"""Export the canonical planner checkpoints to single-file ONNX for the
torch-free planner service.

Run from the repository root with the planner's Python environment (torch +
torch-geometric + onnx installed):

    python planner-service/scripts/export_onnx.py

Writes:
    planner-service/lib/model_real_v3.onnx   (GNN: order + risk logits)
    planner-service/lib/rl_agent.onnx        (RL policy logits)
    planner-service/lib/manifest.json        (SHA-256 pins + config + eval metrics)

The planner service verifies the SHA-256 of each ONNX file against the
manifest at cold start, mirroring the TM-PL-02 fail-closed checkpoint rule.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

import onnx
import torch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "planner"))

from qtrust_planner.model_v3 import MigrationGNNv3  # noqa: E402
from qtrust_planner.rl_agent import MigrationAgent  # noqa: E402

OUT = ROOT / "planner-service" / "lib"
PLANNER = ROOT / "planner"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _embed(src: Path, dst: Path) -> Path:
    model = onnx.load(str(src))
    onnx.save(model, str(dst), save_as_external_data=False)
    return dst


def _export_gnn(work: Path) -> tuple[Path, dict]:
    ck = torch.load(PLANNER / "model_real_v3.pt", map_location="cpu", weights_only=True)
    model = MigrationGNNv3(**ck["model_config"])
    model.load_state_dict(ck["model_state_dict"])
    model.eval()

    class Wrapper(torch.nn.Module):
        def __init__(self, m: torch.nn.Module) -> None:
            super().__init__()
            self.m = m

        def forward(self, x: torch.Tensor, edge_index: torch.Tensor):
            from torch_geometric.data import Data

            return self.m(Data(x=x, edge_index=edge_index))

    wrapper = Wrapper(model).eval()
    x = torch.randn(8, 6)
    edge_index = torch.randint(0, 8, (2, 12))
    raw = work / "gnn_raw.onnx"
    torch.onnx.export(
        wrapper,
        (x, edge_index),
        str(raw),
        input_names=["x", "edge_index"],
        output_names=["order_logits", "risk_logits"],
        dynamic_axes={
            "x": {0: "num_nodes"},
            "edge_index": {1: "num_edges"},
            "order_logits": {0: "num_nodes"},
            "risk_logits": {0: "num_nodes"},
        },
        opset_version=18,
    )
    out = _embed(raw, OUT / "model_real_v3.onnx")
    return out, {
        "source_checkpoint": "model_real_v3.pt",
        "cfg": ck["model_config"],
        "eval_metrics": ck.get("eval_metrics", {}),
        "epochs": ck.get("epochs"),
        "seed": ck.get("seed"),
    }


def _export_rl(work: Path) -> Path:
    state = torch.load(PLANNER / "rl_agent.pt", map_location="cpu", weights_only=True)
    agent = MigrationAgent(n_features=6, hidden_dim=128)
    agent.load_state_dict(state)
    agent.eval()

    class Wrapper(torch.nn.Module):
        def __init__(self, m: torch.nn.Module) -> None:
            super().__init__()
            self.m = m

        def forward(self, x: torch.Tensor, edge_index: torch.Tensor):
            logits, _ = self.m(x, edge_index)
            return logits

    wrapper = Wrapper(agent).eval()
    x = torch.randn(8, 6)
    edge_index = torch.randint(0, 8, (2, 12))
    raw = work / "rl_raw.onnx"
    torch.onnx.export(
        wrapper,
        (x, edge_index),
        str(raw),
        input_names=["x", "edge_index"],
        output_names=["policy_logits"],
        dynamic_axes={
            "x": {0: "num_nodes"},
            "edge_index": {1: "num_edges"},
            "policy_logits": {0: "num_nodes"},
        },
        opset_version=18,
    )
    return _embed(raw, OUT / "rl_agent.onnx")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="qtrust-onnx-"))
    gnn_path, meta = _export_gnn(work)
    rl_path = _export_rl(work)
    manifest = {
        "model_file": gnn_path.name,
        "sha256": _sha256(gnn_path),
        "bytes": gnn_path.stat().st_size,
        **meta,
        "rl": {
            "model_file": rl_path.name,
            "sha256": _sha256(rl_path),
            "bytes": rl_path.stat().st_size,
        },
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

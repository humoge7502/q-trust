#!/usr/bin/env python3
"""Build a lineage manifest for every shipped model checkpoint (TD-02).

Scans the shipped planner checkpoints (``planner/*.pt``), extracts the
lineage metadata each carries (config, seed, data hash, epochs, init_from,
norm variant), hashes the file, and writes ``planner/checkpoint_manifest.json``.

Checkpoints that are *raw state dicts* with no metadata wrapper (historically
``model_ddp_v3.pt``) are flagged ``"lineage": "missing"`` so the gap is
machine-visible instead of silently trusted.

Usage:
    python scripts/build_checkpoint_manifest.py
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PLANNER = REPO_ROOT / "planner"
MANIFEST_PATH = PLANNER / "checkpoint_manifest.json"

LINEAGE_KEYS = (
    "model_config", "seed", "data_hash", "epochs", "total_epochs",
    "init_from", "norm", "n_graphs", "n_real_graphs", "learning_rate",
    "val_split", "best_val_kendall", "lineage",
)


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def describe(path: Path) -> dict:
    import torch
    entry: dict = {
        "file": path.name,
        "bytes": path.stat().st_size,
    }
    try:
        # nosemgrep — weights_only=True: safe deserialization
        payload = torch.load(path, map_location="cpu", weights_only=True)
    except Exception as exc:
        entry["error"] = f"unreadable: {exc}"
        return entry
    if not isinstance(payload, dict) or "state_dict" not in payload and \
            "model_state_dict" not in payload:
        entry["lineage_status"] = "missing"
        entry["note"] = ("raw state dict without a metadata wrapper — "
                         "cannot prove which script/config produced it")
        entry["n_tensors"] = len(payload) if isinstance(payload, dict) else 0
        return entry
    entry["lineage_status"] = "present"
    for k in LINEAGE_KEYS:
        if k in payload:
            v = payload[k]
            entry[k] = v if not isinstance(v, dict) else json.loads(
                json.dumps(v, default=str))
    return entry


def main() -> None:
    ckpts = sorted(p for p in PLANNER.glob("*.pt") if p.is_file())
    if not ckpts:
        print("no checkpoints found under planner/")
        sys.exit(1)
    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "purpose": ("TD-02: machine-checkable lineage for shipped model "
                    "checkpoints; flags any raw-state-dict artifact"),
        "checkpoints": [],
    }
    for p in ckpts:
        entry = describe(p)
        entry["sha256"] = sha256_file(p)
        manifest["checkpoints"].append(entry)
        flag = "OK" if entry.get("lineage_status") == "present" else "NO-LINEAGE"
        print(f"  {p.name:24s} {entry['bytes']:>12,} B  {flag}")

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))
    missing = [c["file"] for c in manifest["checkpoints"]
               if c.get("lineage_status") != "present"]
    print(f"\nWrote {MANIFEST_PATH} ({len(ckpts)} checkpoints, "
          f"{len(missing)} without lineage)")
    if missing:
        print("Lineage missing: " + ", ".join(missing))
        print("Re-run the corresponding training script to regenerate with "
              "full lineage before citing these checkpoints.")


if __name__ == "__main__":
    main()

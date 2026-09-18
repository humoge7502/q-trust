"""
Data lineage — every dataset/model/prediction is hash-anchored for reproducibility
(qtrust strategy §49-50). Produces Merkle-rooted evidence for on-chain anchoring.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Optional


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_json(obj: Any) -> str:
    return sha256_bytes(json.dumps(obj, sort_keys=True, default=str).encode())


@dataclass
class DataLineage:
    dataset: str
    dataset_hash: str
    feature_schema: str
    feature_hash: str
    model: str
    model_hash: Optional[str]
    split: str  # repository | organization | temporal
    created_at: str
    git_commit: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def merkle_leaf(self) -> str:
        return sha256_json(self.to_dict())


def git_commit_hash(repo_root: Path = Path(".")) -> Optional[str]:
    try:
        import subprocess

        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=str(repo_root), text=True
        ).strip()
    except Exception:
        return None


def write_lineage(out_path: Path, lineage: DataLineage) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(lineage.to_dict(), indent=2))


def verify_lineage(path: Path, expected_hash: str) -> bool:
    data = json.loads(path.read_text())
    return sha256_json(data) == expected_hash


__all__ = ["DataLineage", "sha256_bytes", "sha256_json", "git_commit_hash", "write_lineage"]

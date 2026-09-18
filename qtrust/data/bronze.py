"""
Bronze layer — raw ingestion from GitHub, packages, containers, TLS, etc. (§25)
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List


@dataclass
class BronzeRecord:
    source: str  # github | pypi | npm | tls | docker | k8s | ...
    raw: Dict[str, Any]
    ingested_at: str
    sha256: str


def write_bronze(records: List[BronzeRecord], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, rec in enumerate(records):
        (out_dir / f"{rec.source}_{i:06d}.json").write_text(
            json.dumps(rec.raw, indent=2, default=str)
        )

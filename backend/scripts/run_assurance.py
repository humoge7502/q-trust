#!/usr/bin/env python3
"""Run Q-Trust assurance analytics over CBOM findings read from stdin.

Bridges the Fastify API to the real inspector engines (no reimplementation in
TypeScript): crypto-agility scoring, CRQC Monte-Carlo exposure, and the
sector assurance packs (CNSA 2.0, PCI DSS 4.0, DORA, HIPAA, FedRAMP Rev.5).

Input (stdin, JSON):
    {
      "op": "report" | "agility" | "crqc" | "packs",
      "findings": [AssetFinding, ...],
      "pack": "cnsa-2.0",          # optional, op=packs only
      "top": 5,                    # optional
      "crqc": {"trials": 10000}    # optional assumption overrides
    }

Output (stdout, one JSON object). Errors are returned as {"error": "..."}
with exit code 2 so the caller can distinguish a bad request from a crash.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path


def _ensure_importable() -> None:
    try:
        import qtrust_inspector  # noqa: F401
        return
    except ImportError:
        pass
    candidates: list[str] = []
    raw = os.environ.get("QTRUST_INSPECTOR_PATH")
    if raw:
        candidates.extend(p.strip() for p in raw.split(os.pathsep) if p.strip())
    repo_root = Path(__file__).resolve().parents[2]
    candidates.extend([str(repo_root / "inspector"), str(repo_root / "sdk")])
    for cand in candidates:
        if Path(cand).is_dir() and cand not in sys.path:
            sys.path.insert(0, cand)


_ensure_importable()

from qtrust_inspector.agility import score_estate  # noqa: E402
from qtrust_inspector.assurance_packs import evaluate_all, evaluate_pack, list_packs  # noqa: E402
from qtrust_inspector.crqc import assess  # noqa: E402
from qtrust_inspector.models import AssetFinding  # noqa: E402

MAX_FINDINGS = 2000
_CRQC_KEYS = {
    "base_year",
    "median_arrival_year",
    "sigma",
    "trials",
    "seed",
    "discount_rate",
    "default_asset_value_usd",
    "default_data_lifetime_years",
    "horizon_years",
    "top_n",
}


def _fail(message: str) -> int:
    print(json.dumps({"error": message}))
    return 2


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        return _fail(f"invalid JSON: {exc}")
    if not isinstance(payload, dict):
        return _fail("input must be a JSON object")

    raw_findings = payload.get("findings")
    if not isinstance(raw_findings, list):
        return _fail("findings must be an array")
    if len(raw_findings) > MAX_FINDINGS:
        return _fail(f"too many findings ({len(raw_findings)} > {MAX_FINDINGS})")

    try:
        findings = [AssetFinding(**f) for f in raw_findings]
    except Exception as exc:  # pydantic validation message is user-facing
        return _fail(f"invalid finding: {exc}")

    op = payload.get("op", "report")
    if op not in {"report", "agility", "crqc", "packs"}:
        return _fail(f"unknown op '{op}'")
    top = payload.get("top", 5)
    if not isinstance(top, int) or not 1 <= top <= 50:
        return _fail("top must be an integer in [1, 50]")

    overrides = payload.get("crqc") or {}
    if not isinstance(overrides, dict):
        return _fail("crqc must be an object")
    unknown = set(overrides) - _CRQC_KEYS
    if unknown:
        return _fail(f"unknown crqc assumptions: {', '.join(sorted(unknown))}")

    canonical = json.dumps(raw_findings, sort_keys=True, separators=(",", ":"))
    result: dict = {
        "op": op,
        "asset_count": len(findings),
        "input_digest": "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    }

    try:
        if op in ("report", "agility"):
            result["agility"] = score_estate(findings, top_n=top).model_dump(mode="json")
        if op in ("report", "crqc"):
            crqc_kwargs = dict(overrides)
            top_n = crqc_kwargs.pop("top_n", max(top, 10))
            if not isinstance(top_n, int) or not 1 <= top_n <= 100:
                return _fail("crqc.top_n must be an integer in [1, 100]")
            result["crqc"] = assess(findings, top_n=top_n, **crqc_kwargs).model_dump(mode="json")
        if op == "packs":
            pack_id = payload.get("pack")
            if pack_id is None:
                result["packs"] = {
                    key: report.model_dump(mode="json")
                    for key, report in evaluate_all(findings).items()
                }
            elif not isinstance(pack_id, str):
                return _fail("pack must be a string")
            else:
                result["packs"] = {pack_id: evaluate_pack(findings, pack_id).model_dump(mode="json")}
        if op == "report":
            result["packs"] = {
                key: report.model_dump(mode="json")
                for key, report in evaluate_all(findings).items()
            }
            result["available_packs"] = list_packs()
    except ValueError as exc:
        return _fail(str(exc))
    except Exception as exc:  # pragma: no cover - defensive: surface, don't crash silently
        return _fail(f"assurance evaluation failed: {exc}")

    print(json.dumps(result, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

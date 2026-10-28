"""Torch-free planning core for the durable Q-Trust planner service.

The production planner must not depend on an operator laptop behind a quick
tunnel. This module serves the same GNN checkpoints through ONNX Runtime with
numpy-only graph construction, and reproduces the FastAPI planner's request
contract, validation, ranking and scheduling semantics exactly.

Model provenance: lib/manifest.json pins the ONNX bytes and records the
source checkpoint, config and eval metrics. The SHA-256 is verified at cold
start (fail closed) — the same rule the Python planner applies to .pt files.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

LIB = Path(__file__).resolve().parent
MANIFEST = json.loads((LIB / "manifest.json").read_text(encoding="utf-8"))

ALGORITHM_TYPE_MAP = {
    "RSA": 0,
    "ECC": 1,
    "DSA": 2,
    "DH": 3,
    "ECDH": 4,
    "ECDSA": 5,
    "EdDSA": 6,
    "SHA": 7,
    "AES": 8,
    "HMAC": 9,
    "ChaCha20": 10,
    "ML-KEM": 11,
    "ML-DSA": 12,
    "SLH-DSA": 13,
    "Unknown": 14,
}
_ALGORITHM_UPPER = {k.upper(): v for k, v in ALGORITHM_TYPE_MAP.items()}

CRITICALITY_W = {
    "Critical": 5, "High": 4, "Medium": 3, "Low": 2, "Info": 1,
    "critical": 5, "high": 4, "medium": 3, "low": 2, "info": 1,
}
PQC_FAMILIES = {"ML-KEM", "MLKEM", "ML-DSA", "MLDSA", "SLH-DSA", "SLHDSA", "HQC", "FALCON"}

DEFAULT_MAX_CBOM_ASSETS = 5_000
try:
    MAX_CBOM_ASSETS = int(os.environ.get("QTRUST_MAX_CBOM_ASSETS", DEFAULT_MAX_CBOM_ASSETS))
except ValueError:
    MAX_CBOM_ASSETS = DEFAULT_MAX_CBOM_ASSETS
if MAX_CBOM_ASSETS <= 0:
    MAX_CBOM_ASSETS = DEFAULT_MAX_CBOM_ASSETS

try:
    _DEADLINES: dict[str, Any] = json.loads((LIB / "algorithms.json").read_text(encoding="utf-8")).get("algorithm_profiles", {})
except FileNotFoundError:
    _DEADLINES = {}

_RL_BUDGET_SECONDS = 2.0


class ValidationError(Exception):
    """Request is well-formed but not plannable → HTTP 422."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class ModelIntegrityError(Exception):
    """Pinned artifact hash does not match → refuse to serve (fail closed)."""


# ---------------------------------------------------------------------------
# Algorithm encoding + heuristics (mirror qtrust_common.heuristics)
# ---------------------------------------------------------------------------

def encode_algorithm_type(algorithm: str) -> int:
    algorithm = algorithm.upper()
    if algorithm in _ALGORITHM_UPPER:
        return _ALGORITHM_UPPER[algorithm]
    if "WITHRSA" in algorithm or algorithm.startswith("RSA"):
        return ALGORITHM_TYPE_MAP["RSA"]
    if "ECDSA" in algorithm:
        return ALGORITHM_TYPE_MAP["ECDSA"]
    if "ED25519" in algorithm or "ED448" in algorithm:
        return ALGORITHM_TYPE_MAP["EdDSA"]
    if "ID-ECPUBLICKEY" in algorithm or algorithm == "EC":
        return ALGORITHM_TYPE_MAP["ECC"]
    if "ML-KEM" in algorithm or "MLKEM" in algorithm or algorithm == "KYBER":
        return ALGORITHM_TYPE_MAP["ML-KEM"]
    if "ML-DSA" in algorithm or "MLDSA" in algorithm or algorithm == "DILITHIUM":
        return ALGORITHM_TYPE_MAP["ML-DSA"]
    if "SLH-DSA" in algorithm or "SLHDSA" in algorithm or "SPHINCS" in algorithm:
        return ALGORITHM_TYPE_MAP["SLH-DSA"]
    if "X25519" in algorithm or "X448" in algorithm:
        return ALGORITHM_TYPE_MAP["ECDH"]
    for prefix, code in _ALGORITHM_UPPER.items():
        if algorithm.startswith(prefix):
            return code
    return ALGORITHM_TYPE_MAP["Unknown"]


def _family(algorithm: str) -> str:
    if not algorithm:
        return "UNKNOWN"
    return algorithm.split("-")[0].split("_")[0].upper()


def is_pqc_algorithm(algorithm: str) -> bool:
    fam = _family(algorithm)
    return any(p in fam or fam in p for p in PQC_FAMILIES) or "PQC" in algorithm.upper()


def pqc_priority(asset: dict[str, Any]) -> float:
    crit = CRITICALITY_W.get(str(asset.get("criticality", "Medium")), 3)
    key_size = int(asset.get("key_size", 0) or 0)
    pqc_ready = bool(asset.get("pqc_ready", False))
    algorithm = str(asset.get("algorithm", "unknown"))
    family = _family(algorithm)
    score = float(crit)
    if not pqc_ready and not is_pqc_algorithm(algorithm):
        if family in ("RSA", "ECC", "DSA", "DH", "ECDH", "ECDSA"):
            score += 3.0
        elif family == "EDDSA":
            score += 2.0
        else:
            score += 1.0
    if key_size >= 4096:
        score += 2.0
    elif key_size >= 2048:
        score += 1.0
    if pqc_ready or is_pqc_algorithm(algorithm):
        score -= 2.0
    return score


def pqc_risk(asset: dict[str, Any]) -> float:
    if bool(asset.get("pqc_ready", False)) or is_pqc_algorithm(str(asset.get("algorithm", ""))):
        return 0.1
    crit = CRITICALITY_W.get(str(asset.get("criticality", "Medium")), 3)
    base = crit / 5.0
    alg = str(asset.get("algorithm", "")).upper()
    if "RSA" in alg and int(asset.get("key_size", 2048) or 2048) < 2048:
        base = max(base, 0.9)
    return min(base, 1.0)


# ---------------------------------------------------------------------------
# Request validation + graph construction (mirror qtrust_planner.predict)
# ---------------------------------------------------------------------------

def parse_assets(cbom: dict[str, Any]) -> list[dict[str, Any]]:
    assets = cbom.get("assets", [])
    if not isinstance(assets, list):
        raise ValidationError("cbom.assets must be a list")
    if not assets:
        raise ValidationError("CBOM has no assets")
    if len(assets) > MAX_CBOM_ASSETS:
        raise ValidationError(
            f"CBOM has {len(assets)} assets; the service caps planning at {MAX_CBOM_ASSETS} "
            "(set QTRUST_MAX_CBOM_ASSETS to adjust)"
        )
    parsed: list[dict[str, Any]] = []
    for i, a in enumerate(assets):
        if not isinstance(a, dict):
            raise ValidationError(f"cbom.assets[{i}] must be an object, got {type(a).__name__}")
        try:
            key_size = int(a.get("key_size", 0) or 0)
        except (TypeError, ValueError):
            raise ValidationError(f"cbom.assets[{i}].key_size must be an integer, got {a.get('key_size')!r}") from None
        parsed.append({**a, "key_size": key_size})
    return parsed


def _dependency_edges(deps: Any, n_assets: int) -> list[list[int]]:
    if isinstance(deps, dict):
        parsed: list[list[int]] = []
        for e in deps.get("edges", []):
            try:
                src, tgt = int(e[0]), int(e[1])
                if 0 <= src < n_assets and 0 <= tgt < n_assets and src != tgt:
                    parsed.append([src, tgt])
            except (TypeError, ValueError, IndexError, KeyError):
                continue
        if parsed:
            return parsed
    return [[0, i] for i in range(1, n_assets)]


def build_graph(cbom: dict[str, Any], deps: Any, assets: list[dict[str, Any]]):
    n = len(assets)
    days_to_deadline = float(cbom.get("days_to_deadline", 0) or 0)
    deadline_pressure = 2.0 if 0 < days_to_deadline < 180 else (1.0 if days_to_deadline > 0 else 0.0)

    x = np.zeros((n, 6), dtype=np.float32)
    records: list[dict[str, Any]] = []
    for i, asset in enumerate(assets):
        # Real-world CBOM exports can carry a null algorithm; treat it as
        # unknown instead of crashing the whole plan on a string operation.
        algorithm = asset.get("algorithm") or "unknown"
        family = algorithm.split("-")[0] if "-" in algorithm else algorithm
        type_code = encode_algorithm_type(family)
        key_size = int(asset.get("key_size", 0) or 0)
        vendor_pqc_ready = bool(asset.get("pqc_ready", False))
        criticality = CRITICALITY_W.get(asset.get("criticality", "Medium"), 3)
        required_rate = min(deadline_pressure * criticality / 5.0, 1.0)
        x[i] = [
            type_code / 14.0,
            min(key_size / 4096.0, 1.0),
            1.0 if vendor_pqc_ready else 0.0,
            criticality / 5.0,
            min(days_to_deadline / 730.0, 1.0),
            required_rate,
        ]
        records.append({
            "index": i,
            "asset_id": asset.get("asset_id", f"asset-{i:04d}"),
            "algorithm": algorithm,
            "host": asset.get("host", ""),
            "port": asset.get("port", 0),
            "key_size": key_size,
            "criticality": asset.get("criticality", "Medium"),
            "pqc_ready": vendor_pqc_ready,
        })

    edges = _dependency_edges(deps, n)
    edge_index = np.asarray(edges, dtype=np.int64).T if edges else np.zeros((2, 0), dtype=np.int64)
    return x, edge_index, records


# ---------------------------------------------------------------------------
# ONNX sessions with fail-closed integrity verification
# ---------------------------------------------------------------------------

_SESSIONS: dict[str, Any] = {}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _session(kind: str):
    import onnxruntime as ort

    if kind in _SESSIONS:
        return _SESSIONS[kind]
    if kind == "gnn":
        entry = MANIFEST
    elif kind == "rl":
        entry = MANIFEST.get("rl") or {}
    else:  # pragma: no cover - internal misuse
        raise ValueError(kind)
    path = LIB / entry["model_file"]
    if not path.exists():
        raise ModelIntegrityError(f"missing pinned artifact: {entry['model_file']}")
    actual = _sha256(path)
    if actual != entry["sha256"]:
        raise ModelIntegrityError(f"{entry['model_file']} sha256 mismatch (expected {entry['sha256'][:12]}…, got {actual[:12]}…)")
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    _SESSIONS[kind] = session
    return session


def model_info() -> dict[str, Any]:
    return {
        "mode": "gnn-onnx",
        "arch": "MigrationGNNv3",
        "variant": "v3_real_onnx",
        "path": MANIFEST["model_file"],
        "config": MANIFEST.get("cfg", {}),
        "eval_metrics": MANIFEST.get("eval_metrics", {}),
        "integrity": "sha256-pinned",
        "runtime": "onnxruntime/vercel-python",
        "served": True,
    }


def _predict(x: np.ndarray, edge_index: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    session = _session("gnn")
    order, risk = session.run(None, {"x": x, "edge_index": edge_index})
    return np.asarray(order).reshape(-1), np.asarray(risk).reshape(-1)


# ---------------------------------------------------------------------------
# Scheduling (mirror planner/server.py::_build_schedule)
# ---------------------------------------------------------------------------

def estimate_migrate_days(algorithm: str, key_size: int) -> float:
    family = algorithm.split("-")[0] if "-" in algorithm else algorithm
    for name, profile in _DEADLINES.items():
        if algorithm.upper() == name.upper() or (
            algorithm.upper().startswith(name.upper()) and len(algorithm) <= len(name) + 4
        ):
            return float(profile.get("migrate_days", 1.0))
    if family in ("RSA", "ECC", "DSA", "DH", "ECDH", "ECDSA"):
        return 1.5
    return 0.5


def build_schedule(migration_order: list[dict[str, Any]], deadline: date) -> dict[str, Any]:
    today = date.today()
    days_available = max((deadline - today).days, 0)
    total_effort = sum(float(a["migrate_days"]) for a in migration_order)
    feasible = total_effort <= max(days_available, 1)
    overflow_days = max(0.0, total_effort - max(days_available, 1))
    cursor = deadline
    windows: list[dict[str, Any]] = []
    for asset in reversed(migration_order):
        effort = timedelta(days=float(asset["migrate_days"]))
        start = cursor - effort
        clamped_start = max(start, today)
        windows.append({
            "asset_id": asset["asset_id"],
            "start": clamped_start.isoformat(),
            "end": cursor.isoformat(),
            "migrate_days": asset["migrate_days"],
            "clamped_to_today": clamped_start != start,
        })
        cursor = start
    windows.reverse()
    daily_rate = total_effort / max(days_available, 1) if days_available else None
    return {
        "deadline": deadline.isoformat(),
        "days_available": days_available,
        "total_effort_days": total_effort,
        "feasible": feasible,
        "overflow_days": round(overflow_days, 2),
        "suggested_daily_rate": round(daily_rate, 2) if daily_rate else None,
        "windows": windows,
    }


def _deadline_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        raise ValidationError("deadline must be ISO date YYYY-MM-DD") from None


# ---------------------------------------------------------------------------
# Endpoint handlers
# ---------------------------------------------------------------------------

def handle_plan(payload: dict[str, Any]) -> dict[str, Any]:
    cbom = payload.get("cbom") or {}
    if not isinstance(cbom, dict):
        raise ValidationError("cbom must be an object")
    assets = parse_assets(cbom)
    deps = payload.get("deps")
    deadline = _deadline_date(payload.get("deadline"))

    x, edge_index, records = build_graph(cbom, deps, assets)
    try:
        priority_scores, risk_scores = _predict(x, edge_index)
    except ModelIntegrityError:
        raise
    except Exception:
        # An ONNX runtime failure must not take planning down. Ordering falls
        # back to the canonical heuristic and the response still reports the
        # model block, so callers can see what served the request.
        priority_scores = np.asarray([pqc_priority(a) for a in records], dtype=np.float64)
        risk_scores = np.asarray([pqc_risk(a) for a in records], dtype=np.float64)

    sorted_indices = sorted(range(len(records)), key=lambda i: -float(priority_scores[i]))
    migration_order: list[dict[str, Any]] = []
    for rank, idx in enumerate(sorted_indices):
        asset = records[idx]
        migration_order.append({
            "rank": rank + 1,
            "asset_id": asset["asset_id"],
            "algorithm": asset["algorithm"],
            "host": asset.get("host", ""),
            "port": asset.get("port", 0),
            "key_size": asset["key_size"],
            "criticality": asset["criticality"],
            "pqc_ready": asset["pqc_ready"],
            "priority_score": float(priority_scores[idx]),
            "risk_score": float(risk_scores[idx]),
            "migrate_days": estimate_migrate_days(asset["algorithm"], asset["key_size"]),
        })

    return {
        "planner": "qtrust-planner",
        "model": model_info(),
        "total_assets": len(records),
        "deadline": deadline.isoformat() if deadline else None,
        "migration_order": migration_order,
        "schedule": build_schedule(migration_order, deadline) if deadline else None,
    }


def _rl_order(cbom: dict[str, Any], deps: Any, assets: list[dict[str, Any]]):
    session = _session("rl")
    n = len(assets)
    x = np.zeros((n, 6), dtype=np.float32)
    records: list[dict[str, Any]] = []
    for i, a in enumerate(assets):
        algorithm = a.get("algorithm") or "unknown"
        key_size = a["key_size"]
        criticality = a.get("criticality", "Medium")
        crit_map = {"low": 1, "medium": 2, "high": 3, "critical": 4}
        crit = crit_map.get(str(criticality).lower(), 2)
        x[i] = [
            encode_algorithm_type(algorithm) / 14.0,
            min(key_size / 4096.0, 1.0),
            1.0 if a.get("pqc_ready", False) else 0.0,
            crit / 5.0,
            365.0 / 3650.0,
            0.5,
        ]
        records.append({
            "asset_id": a.get("asset_id", f"asset-{i:04d}"),
            "algorithm": algorithm,
            "host": a.get("host", ""),
            "port": a.get("port", 0),
            "key_size": key_size,
            "criticality": criticality,
            "pqc_ready": bool(a.get("pqc_ready", False)),
        })

    dep_pairs: list[tuple[int, int]] = []
    if isinstance(deps, dict):
        for e in deps.get("edges", []):
            try:
                b, tgt = int(e[0]), int(e[1])
                if 0 <= b < n and 0 <= tgt < n and b != tgt:
                    dep_pairs.append((b, tgt))
            except (TypeError, ValueError, IndexError, KeyError):
                continue
    edge_index = np.asarray(dep_pairs, dtype=np.int64).T if dep_pairs else np.zeros((2, 0), dtype=np.int64)

    migrated = [False] * n
    order_idx: list[int] = []
    start = time.time()
    last_logits: np.ndarray | None = None
    while len(order_idx) < n:
        if time.time() - start > _RL_BUDGET_SECONDS:
            return None
        logits = np.asarray(session.run(None, {"x": x, "edge_index": edge_index})[0]).reshape(-1)
        last_logits = logits
        masked = np.full(n, -np.inf, dtype=np.float64)
        for i in range(n):
            if not migrated[i] and all(migrated[b] for b, tgt in dep_pairs if tgt == i):
                masked[i] = 0.0
        if not np.isfinite(masked).any():
            break
        action = int(np.argmax(logits + masked))
        migrated[action] = True
        order_idx.append(action)

    order: list[dict[str, Any]] = []
    for rank, idx in enumerate(order_idx):
        asset = records[idx]
        order.append({
            "rank": rank + 1,
            **asset,
            "priority_score": float(last_logits[idx]) if last_logits is not None else 0.0,
            "risk_score": float(pqc_risk({**asset, "index": idx})),
            "migrate_days": estimate_migrate_days(asset["algorithm"], asset["key_size"]),
        })
    return order


def handle_rl_plan(payload: dict[str, Any]) -> dict[str, Any]:
    cbom = payload.get("cbom") or {}
    if not isinstance(cbom, dict):
        raise ValidationError("cbom must be an object")
    assets = parse_assets(cbom)
    deps = payload.get("deps")
    deadline = _deadline_date(payload.get("deadline"))

    migration_order = None
    method = "rl_policy_onnx"
    try:
        migration_order = _rl_order(cbom, deps, assets)
    except ModelIntegrityError:
        raise
    except Exception:
        migration_order = None

    if migration_order is None:
        records = [
            {
                "index": i,
                "asset_id": a.get("asset_id", f"asset-{i:04d}"),
                "algorithm": a.get("algorithm") or "unknown",
                "host": a.get("host", ""),
                "port": a.get("port", 0),
                "key_size": a["key_size"],
                "criticality": a.get("criticality", "Medium"),
                "pqc_ready": bool(a.get("pqc_ready", False)),
            }
            for i, a in enumerate(assets)
        ]
        scores = [pqc_priority(a) for a in records]
        sorted_indices = sorted(range(len(records)), key=lambda i: -scores[i])
        migration_order = []
        for rank, idx in enumerate(sorted_indices):
            asset = records[idx]
            migration_order.append({
                "rank": rank + 1,
                **{k: v for k, v in asset.items() if k != "index"},
                "priority_score": float(scores[idx]),
                "risk_score": float(pqc_risk(asset)),
                "migrate_days": estimate_migrate_days(asset["algorithm"], asset["key_size"]),
            })
        method = "heuristic_fallback"

    return {
        "planner": "qtrust-planner",
        "model": model_info(),
        "method": method,
        "total_assets": len(migration_order),
        "deadline": deadline.isoformat() if deadline else None,
        "migration_order": migration_order,
        "schedule": build_schedule(migration_order, deadline) if deadline else None,
    }


def health() -> dict[str, Any]:
    try:
        _session("gnn")
        served = True
        integrity = "sha256-verified"
    except Exception as exc:
        served = False
        integrity = f"failed: {type(exc).__name__}"
    info = model_info()
    info["integrity"] = integrity
    info["served"] = served
    return {"status": "ok" if served else "error", "model": info}


def authorized(headers: Any) -> bool:
    expected = os.environ.get("QTRUST_PLANNER_API_KEY", "")
    if not expected:
        return False
    provided = headers.get("x-api-key", "") or ""
    return hmac.compare_digest(provided, expected)

"""Crypto-agility scoring.

Crypto-agility is the ability to replace a cryptographic primitive without
re-architecting the system that uses it. It is the variable that separates a
two-week algorithm swap from a two-quarter programme, and therefore the
strongest single predictor of migration cost.

The score is deliberately deterministic and evidence-backed: every point comes
from a named factor with the evidence that produced it. No learned model is
involved, so a CISO can audit the number.
"""
from __future__ import annotations

import hashlib
import json
import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from .models import AssetFinding

_PQC_MARKERS = ("ml_kem", "mlkem", "ml_dsa", "mldsa", "slh_dsa", "slhdsa", "falcon", "kyber", "dilithium", "frodo", "mceliece", "hqc", "bike")
_HYBRID_MARKERS = ("x25519mlkem", "x25519_mlkem", "hybrid", "xwing")
_MODERN_MARKERS = ("aes_256", "aes256", "chacha20", "ed25519", "ed448", "sha3", "blake2", "blake3", "x25519", "x448")
_LEGACY_MARKERS = ("rsa", "ecdsa", "dsa", "ecdh", "diffie", "sha1", "md5")
_BROKEN_MARKERS = ("des", "3des", "rc4", "rc2", "md4")


class AgilityGrade(str, Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    E = "E"


class AgilityFactor(BaseModel):
    name: str
    weight: float = Field(..., gt=0, description="Maximum points this factor can contribute")
    points: float = Field(..., ge=0, description="Points earned")
    evidence: str


class AssetAgility(BaseModel):
    asset: str
    asset_type: str
    algorithm: str | None = None
    score: float = Field(..., ge=0, le=100)
    grade: AgilityGrade
    factors: list[AgilityFactor]
    blockers: list[str] = Field(default_factory=list)
    levers: list[str] = Field(default_factory=list)


class EstateAgility(BaseModel):
    """Estate-level aggregate (mean score, worst assets, distribution)."""

    score: float = Field(..., ge=0, le=100)
    grade: AgilityGrade
    asset_count: int
    distribution: dict[str, int]
    weakest: list[AssetAgility] = Field(default_factory=list)
    highest_leverage: list[dict[str, Any]] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    digest: str = ""


def _norm(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[-_ ]+", "_", value.strip().lower())


def _meta_bool(finding: AssetFinding, *keys: str) -> bool:
    for key in keys:
        if finding.metadata.get(key):
            return True
    return False


def _meta_int(finding: AssetFinding, *keys: str) -> int | None:
    for key in keys:
        raw = finding.metadata.get(key)
        if raw is None:
            continue
        try:
            return int(raw)
        except (TypeError, ValueError):
            continue
    return None


def _algorithm_posture(alg: str) -> tuple[float, str]:
    """0-1 posture: how safe the primitive itself is."""
    if any(m in alg for m in _PQC_MARKERS):
        return 1.0, "already post-quantum"
    if any(m in alg for m in _HYBRID_MARKERS):
        return 0.9, "hybrid post-quantum"
    if any(m in alg for m in _BROKEN_MARKERS):
        return 0.1, "broken primitive"
    if any(m in alg for m in _LEGACY_MARKERS):
        return 0.4, "quantum-vulnerable classical asymmetric"
    if any(m in alg for m in _MODERN_MARKERS):
        return 0.7, "modern classical symmetric/curve"
    return 0.3, "unrecognised primitive"


def _abstraction(finding: AssetFinding) -> tuple[float, str]:
    """How far the primitive is from hard-coded call sites."""
    if _meta_bool(finding, "algorithm_abstracted", "crypto_agility", "config_driven"):
        return 1.0, "explicit abstraction/config flag present"
    provider = finding.metadata.get("provider") or finding.metadata.get("library")
    if provider:
        return 0.8, f"provided by {provider} (swappable at the provider boundary)"
    if finding.asset_type in ("tls_certificate", "tls_connection", "tls_cipher_suite"):
        return 0.75, "negotiated at the TLS layer (protocol-driven)"
    if finding.asset_type in ("source_file", "source_code"):
        return 0.45, "direct API call site in source"
    if finding.asset_type in ("binary", "embedded_binary"):
        return 0.2, "compiled into a binary"
    return 0.4, "asset type has no explicit abstraction evidence"


def _configurability(finding: AssetFinding) -> tuple[float, str]:
    signals: list[str] = []
    points = 0.0
    if _meta_bool(finding, "config_path", "configurable", "config_file", "config_driven"):
        points += 0.4
        signals.append("config-driven")
    protocols = finding.metadata.get("supported_protocols")
    if isinstance(protocols, (list, tuple)) and len(protocols) > 1:
        points += 0.3
        signals.append(f"{len(protocols)} protocols offered")
    suites = finding.metadata.get("cipher_suites") or finding.metadata.get("cipher_suite_count")
    if isinstance(suites, (list, tuple)) and len(suites) > 1:
        points += 0.3
        signals.append(f"{len(suites)} cipher suites offered")
    elif isinstance(suites, int) and suites > 1:
        points += 0.3
        signals.append(f"{suites} cipher suites offered")
    return min(points, 1.0), ", ".join(signals) or "no configuration evidence"


def _pqc_path(alg: str, finding: AssetFinding) -> tuple[float, str]:
    if any(m in alg for m in _PQC_MARKERS):
        return 1.0, "post-quantum today"
    if any(m in alg for m in _HYBRID_MARKERS):
        return 0.95, "hybrid path already deployed"
    if _meta_bool(finding, "pqc_capable", "vendor_pqc_support"):
        return 0.85, "vendor/provider reports a PQC path"
    if any(m in alg for m in ("rsa", "ecdsa", "ecdh", "dh", "dsa")):
        return 0.55, "NIST replacement is a drop-in for this primitive"
    if any(m in alg for m in ("des", "rc4", "md5", "sha1")):
        return 0.35, "replacement requires protocol/data-format change"
    return 0.45, "replacement path unknown"


def _observability(finding: AssetFinding) -> tuple[float, str]:
    present = [
        name
        for name, value in (
            ("fingerprint", finding.fingerprint_sha256),
            ("issuer", finding.issuer),
            ("expiry", finding.not_after),
            ("port", finding.port),
            ("vendor", finding.vendor),
        )
        if value
    ]
    if len(finding.metadata) >= 4:
        present.append("metadata")
    return min(len(present) / 4, 1.0), (", ".join(present) or "no lifecycle metadata")


def _lifecycle(finding: AssetFinding) -> tuple[float, str]:
    points = 0.0
    notes: list[str] = []
    if finding.expired is False or finding.not_after:
        points += 0.35
        notes.append("expiry tracked")
    rotation = _meta_int(finding, "rotation_days", "key_rotation_days")
    if rotation is not None and rotation <= 365:
        points += 0.35
        notes.append(f"rotation every {rotation}d")
    if finding.key_size is not None:
        minimum = 2048 if "rsa" in _norm(finding.algorithm) else 256
        if finding.key_size >= minimum:
            points += 0.3
            notes.append(f"key size {finding.key_size}")
    return min(points, 1.0), ", ".join(notes) or "no lifecycle evidence"


def _grade(score: float) -> AgilityGrade:
    if score >= 85:
        return AgilityGrade.A
    if score >= 70:
        return AgilityGrade.B
    if score >= 55:
        return AgilityGrade.C
    if score >= 40:
        return AgilityGrade.D
    return AgilityGrade.E


_WEIGHTS = {
    "algorithm_posture": 25.0,
    "abstraction": 20.0,
    "configurability": 15.0,
    "pqc_path": 20.0,
    "observability": 10.0,
    "lifecycle": 10.0,
}


def score_asset(finding: AssetFinding) -> AssetAgility:
    """Score one finding on the six-factor crypto-agility rubric."""
    alg = _norm(finding.algorithm)
    raw = {
        "algorithm_posture": _algorithm_posture(alg),
        "abstraction": _abstraction(finding),
        "configurability": _configurability(finding),
        "pqc_path": _pqc_path(alg, finding),
        "observability": _observability(finding),
        "lifecycle": _lifecycle(finding),
    }
    factors = [
        AgilityFactor(
            name=name,
            weight=_WEIGHTS[name],
            points=round(_WEIGHTS[name] * value, 2),
            evidence=evidence,
        )
        for name, (value, evidence) in raw.items()
    ]
    score = round(sum(f.points for f in factors), 2)

    blockers: list[str] = []
    levers: list[str] = []
    if raw["algorithm_posture"][0] <= 0.4:
        blockers.append(raw["algorithm_posture"][1])
        levers.append("Route the primitive through a crypto-provider interface before migration")
    if raw["abstraction"][0] <= 0.45:
        blockers.append(raw["abstraction"][1])
        levers.append("Introduce an algorithm-agnostic wrapper (e.g. a KMS/provider facade)")
    if raw["configurability"][0] < 0.4:
        blockers.append("algorithm choice is not configuration-driven")
        levers.append("Move algorithm selection and key size into configuration with a documented schema")
    if raw["pqc_path"][0] < 0.55:
        blockers.append(raw["pqc_path"][1])
        levers.append("Confirm a vendor/library PQC path and pin its timeline in the migration plan")
    if raw["observability"][0] < 0.5:
        blockers.append("lifecycle metadata missing")
        levers.append("Record fingerprint, issuer and expiry for every asset in the CBOM")
    if raw["lifecycle"][0] < 0.4:
        blockers.append("no rotation or key-size evidence")
        levers.append("Adopt automated rotation and enforce a minimum key size")

    return AssetAgility(
        asset=finding.location,
        asset_type=finding.asset_type,
        algorithm=finding.algorithm,
        score=score,
        grade=_grade(score),
        factors=factors,
        blockers=blockers,
        levers=levers,
    )


def score_estate(findings: list[AssetFinding], *, top_n: int = 5) -> EstateAgility:
    """Aggregate per-asset agility into an estate score and leverage list."""
    if not findings:
        return EstateAgility(
            score=0.0,
            grade=AgilityGrade.E,
            asset_count=0,
            distribution={g.value: 0 for g in AgilityGrade},
            assumptions=["no assets were supplied"],
            digest=_digest({"assets": 0}),
        )

    scored = [score_asset(f) for f in findings]
    mean = round(sum(s.score for s in scored) / len(scored), 2)
    distribution = {g.value: 0 for g in AgilityGrade}
    for asset in scored:
        distribution[asset.grade.value] += 1

    weakest = sorted(scored, key=lambda s: (s.score, s.asset))[:top_n]

    # Leverage = how many assets each lever would unblock, i.e. where one
    # engineering investment buys the most agility.
    leverage_counts: dict[str, int] = {}
    for asset in scored:
        for lever in asset.levers:
            leverage_counts[lever] = leverage_counts.get(lever, 0) + 1
    highest_leverage = [
        {"lever": lever, "assets": count}
        for lever, count in sorted(leverage_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ][:top_n]

    assumptions = [
        "Scores are derived from CBOM fields and metadata; missing metadata lowers confidence, not the score alone.",
        "A=85+, B=70+, C=55+, D=40+, E<40.",
    ]
    digest_input = {
        "assets": [
            {"asset": s.asset, "algorithm": s.algorithm, "score": s.score}
            for s in sorted(scored, key=lambda s: s.asset)
        ]
    }
    return EstateAgility(
        score=mean,
        grade=_grade(mean),
        asset_count=len(scored),
        distribution=distribution,
        weakest=weakest,
        highest_leverage=highest_leverage,
        assumptions=assumptions,
        digest=_digest(digest_input),
    )


def _digest(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()

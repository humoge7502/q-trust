"""CRQC timeline risk — harvest-now-decrypt-later exposure in financial terms.

A static "quantum-vulnerable: yes" flag does not tell a CFO what to fund. This
module turns the same CBOM into a distribution of financial exposure under an
explicit, auditable model of when a cryptographically-relevant quantum computer
(CRQC) might arrive.

Model (v1, deliberately simple and documented)
----------------------------------------------
* CRQC arrival is lognormal around a configurable median year (default 2032;
  the community consensus range, not a prediction).
* Each asset has a data lifetime L, an exposure value V, and a vulnerability
  factor q in [0, 1] (1 = fully exposed if the CRQC arrives before the data
  expires).
* If the CRQC arrives y years from now, the fraction of the asset still at risk
  is clamp((L - y) / L, 0, 1); the loss is V * q * fraction, discounted to
  present at a configurable rate.
* Assets share one arrival draw per Monte-Carlo trial: CRQC arrival is a
  systemic event, not an independent per-asset one.

The output is a distribution (P10/P50/P90), not a point estimate, so it can be
used for budgeting and risk appetite without pretending precision.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any, Iterable

from pydantic import BaseModel, Field

from .models import AssetFinding

MODEL_VERSION = "crqc-mc/1.0"

_PQC = ("ml_kem", "mlkem", "ml_dsa", "mldsa", "slh_dsa", "slhdsa", "falcon", "kyber", "dilithium", "frodo", "mceliece", "hqc")
_HYBRID = ("x25519mlkem", "x25519_mlkem", "hybrid", "xwing")
_ASYM = ("rsa", "ecdsa", "dsa", "ecdh", "diffie", "dh_")
_BROKEN = ("des", "3des", "rc4", "rc2", "md4", "md5", "sha1")
_SYMM = ("aes", "chacha", "camellia", "aria")

_CRIT_MULT = {"low": 0.25, "medium": 0.5, "high": 1.0, "critical": 2.0}
_LIFETIME_BY_TYPE = {
    "tls_certificate": 3.0,
    "tls_connection": 5.0,
    "tls_cipher_suite": 3.0,
    "ssh_host_key": 10.0,
    "ssh_key": 10.0,
    "file_key": 10.0,
    "source_code": 7.0,
    "source_file": 7.0,
    "binary": 10.0,
    "embedded_binary": 15.0,
    "pcap": 5.0,
    "network_traffic": 5.0,
}


class CRQCAssumptions(BaseModel):
    model_version: str = MODEL_VERSION
    base_year: int
    median_arrival_year: float = Field(..., gt=0)
    sigma: float = Field(..., gt=0, description="Log-space standard deviation of arrival year")
    trials: int = Field(..., ge=100)
    seed: int
    discount_rate: float = Field(..., ge=0, lt=1)
    default_asset_value_usd: float = Field(..., gt=0)
    default_data_lifetime_years: float = Field(..., gt=0)
    horizon_years: int = Field(..., ge=1)


class AssetExposure(BaseModel):
    asset: str
    asset_type: str
    algorithm: str | None = None
    vulnerability: float = Field(..., ge=0, le=1)
    data_lifetime_years: float
    value_usd: float
    p_exposed: float = Field(..., ge=0, le=1)
    expected_loss_usd: float
    rationale: str


class CRQCReport(BaseModel):
    asset_count: int
    expected_loss_usd: float
    loss_p10_usd: float
    loss_p50_usd: float
    loss_p90_usd: float
    p_any_exposure: float = Field(..., ge=0, le=1)
    exposure_by_arrival_year: list[dict[str, Any]] = Field(default_factory=list)
    top_assets: list[AssetExposure] = Field(default_factory=list)
    assumptions: CRQCAssumptions
    limitations: list[str] = Field(default_factory=list)
    digest: str = ""


def _norm(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[-_ ]+", "_", value.strip().lower())


def vulnerability_of(algorithm: str | None) -> tuple[float, str]:
    """Map a primitive to a harvest-now-decrypt-later vulnerability factor."""
    alg = _norm(algorithm)
    if any(m in alg for m in _PQC):
        return 0.02, "post-quantum primitive: negligible HNDL exposure"
    if any(m in alg for m in _HYBRID):
        return 0.05, "hybrid primitive: negligible HNDL exposure"
    if any(m in alg for m in _BROKEN):
        return 0.6, "broken primitive: exposure is immediate, not CRQC-dependent"
    if any(m in alg for m in _ASYM):
        return 0.95, "classical asymmetric: full HNDL exposure"
    if any(m in alg for m in _SYMM):
        return 0.10, "symmetric with adequate key size: exposed only via key establishment"
    if alg:
        return 0.30, "unknown primitive: assigned a conservative default"
    return 0.30, "no algorithm recorded: assigned a conservative default"


def _lifetime(finding: AssetFinding, default: float) -> float:
    for key in ("data_lifetime_years", "retention_years"):
        raw = finding.metadata.get(key)
        if raw is not None:
            try:
                value = float(raw)
                if value > 0:
                    return value
            except (TypeError, ValueError):
                pass
    return _LIFETIME_BY_TYPE.get(finding.asset_type, default)


def _value(finding: AssetFinding, default: float) -> float:
    for key in ("value_usd", "asset_value_usd", "data_value_usd"):
        raw = finding.metadata.get(key)
        if raw is not None:
            try:
                value = float(raw)
                if value >= 0:
                    return value
            except (TypeError, ValueError):
                pass
    multiplier = _CRIT_MULT.get((finding.criticality or "medium").lower(), 0.5)
    return default * multiplier


def _draw_arrival_offsets(assumptions: CRQCAssumptions) -> list[float]:
    """Arrival offsets in years (>=0), one per trial."""
    median_offset = max(assumptions.median_arrival_year - assumptions.base_year, 1e-6)
    mu = math.log(median_offset)
    try:
        import numpy as np  # type: ignore

        rng = np.random.default_rng(assumptions.seed)
        offsets = rng.lognormal(mean=mu, sigma=assumptions.sigma, size=assumptions.trials)
        return [float(min(max(x, 0.0), 60.0)) for x in offsets]
    except ImportError:
        import random

        rnd = random.Random(assumptions.seed)
        return [
            float(min(max(rnd.lognormvariate(mu, assumptions.sigma), 0.0), 60.0))
            for _ in range(assumptions.trials)
        ]


def _percentile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * q
    lower = math.floor(pos)
    upper = math.ceil(pos)
    if lower == upper:
        return sorted_values[lower]
    weight = pos - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def assess(
    findings: Iterable[AssetFinding],
    *,
    base_year: int = 2026,
    median_arrival_year: float = 2032.0,
    sigma: float = 0.35,
    trials: int = 10_000,
    seed: int = 42,
    discount_rate: float = 0.05,
    default_asset_value_usd: float = 1_000_000.0,
    default_data_lifetime_years: float = 10.0,
    horizon_years: int = 30,
    top_n: int = 10,
) -> CRQCReport:
    """Monte-Carlo the financial exposure of an estate to CRQC arrival."""
    assumptions = CRQCAssumptions(
        base_year=base_year,
        median_arrival_year=median_arrival_year,
        sigma=sigma,
        trials=trials,
        seed=seed,
        discount_rate=discount_rate,
        default_asset_value_usd=default_asset_value_usd,
        default_data_lifetime_years=default_data_lifetime_years,
        horizon_years=horizon_years,
    )
    items = list(findings)
    offsets = _draw_arrival_offsets(assumptions)

    exposures: list[AssetExposure] = []
    total_by_trial = [0.0] * trials
    year_conditional: dict[int, list[float]] = {}

    for finding in items:
        vuln, rationale = vulnerability_of(finding.algorithm)
        lifetime = _lifetime(finding, default_data_lifetime_years)
        value = _value(finding, default_asset_value_usd)
        exposed_trials = 0
        expected = 0.0
        for i, offset in enumerate(offsets):
            fraction = min(max((lifetime - offset) / lifetime, 0.0), 1.0)
            if fraction <= 0:
                continue
            loss = value * vuln * fraction / ((1 + discount_rate) ** offset)
            total_by_trial[i] += loss
            expected += loss
            exposed_trials += 1
            year = base_year + int(round(offset))
            if year <= base_year + horizon_years:
                year_conditional.setdefault(year, []).append(loss)
        exposures.append(
            AssetExposure(
                asset=finding.location,
                asset_type=finding.asset_type,
                algorithm=finding.algorithm,
                vulnerability=vuln,
                data_lifetime_years=lifetime,
                value_usd=round(value, 2),
                p_exposed=round(exposed_trials / trials, 6),
                expected_loss_usd=round(expected / trials, 2),
                rationale=rationale,
            )
        )

    ordered = sorted(total_by_trial)
    p_any = sum(1 for x in total_by_trial if x > 0) / trials
    exposure_by_year = [
        {
            "arrival_year": year,
            "p_arrival": round(len(losses) / trials, 6),
            # Conditional expected loss: a budget line for the year the CRQC is
            # assumed to land, not a forecast of the arrival itself.
            "expected_loss_if_arrival_year_usd": round(sum(losses) / len(losses), 2),
        }
        for year, losses in sorted(year_conditional.items())
    ]

    report = CRQCReport(
        asset_count=len(exposures),
        expected_loss_usd=round(sum(total_by_trial) / trials, 2),
        loss_p10_usd=round(_percentile(ordered, 0.10), 2),
        loss_p50_usd=round(_percentile(ordered, 0.50), 2),
        loss_p90_usd=round(_percentile(ordered, 0.90), 2),
        p_any_exposure=round(p_any, 6),
        exposure_by_arrival_year=exposure_by_year,
        top_assets=sorted(exposures, key=lambda e: (-e.expected_loss_usd, e.asset))[:top_n],
        assumptions=assumptions,
        limitations=[
            "Arrival year is a scenario distribution, not a forecast; the default median (2032) is the community consensus range.",
            "Asset values default from criticality and should be replaced with business-unit figures for budgeting.",
            "Loss assumes full compromise once the CRQC arrives before the data expires; partial-compromise paths are out of scope.",
            "Symmetric primitives are scored through their key-establishment dependency, not as directly decryptable.",
            "Discounted to present value; undiscounted exposure is higher for late arrival years.",
        ],
    )
    payload = report.model_dump(mode="json")
    payload.pop("digest", None)
    report.digest = "sha256:" + hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return report

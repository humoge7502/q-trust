"""Outcome-based migration evaluation — the quantum-risk-days (QRD) simulator.

Why this exists (2026-10-23):
    The shipped LOO protocol scores every method with tie-aware Kendall τ-b
    against ``y_priority`` labels that are *produced by the same priority
    formula the heuristic replicates* (``data_generator._assign_labels``).
    On the 42 host-disjoint real estates the heuristic therefore attains the
    per-fold ceiling exactly (its order equals the label order; observed
    τ-b 0.7210 is the mean ceiling imposed by tied priorities, per the
    paper's τ_b ≤ √(d/n₀) theorem). Under those labels a learned model can
    at best tie the heuristic — the comparison cannot be won.

    This module defines a *different, outcome-grounded* ground truth: the
    migration order that minimises total quantum-risk-days (QRD) under a
    transparent simulation of migration execution. The static heuristic is
    NOT the label generator here — it ignores migration effort (durations)
    and dependency ordering entirely, so the learned model has genuine
    headroom. The evaluation that uses this module answers the question a
    CISO actually asks: *which plan exposes the organisation to less
    quantum risk while the migration programme runs?*

Simulation semantics (SIM_SPEC_VERSION below pins all constants):
    - Execution is sequential (one migration work-stream at a time — the
      capacity-1 programme a single platform team can sign off). ``C_i`` is
      the completion day of asset ``i``.
    - Each asset accumulates *quantum risk-days* until its migration
      completes: exposure rate = risk_rate(algorithm) × criticality weight.
      QRD(order) = Σ_i rate_i × crit_i × C_i  — the classic weighted
      completion-time objective 1|prec|Σ w_j C_j with w_j = rate × crit.
    - Dependencies (an asset migrates only after its dependencies) are the
      precedence constraints; infeasible orders are never evaluated — every
      ranking is projected to a feasible schedule via list scheduling, the
      same way a programme office would execute a priority list.
    - Migration durations are deterministic functions of asset features
      (documented below) so labels are exactly reproducible.

Honesty note: these are *simulation-grounded* labels derived from real CBOM
structure and documented assumptions — NOT observed org-level outcomes. Any
result produced with this module must be reported with that framing and the
SIM_SPEC_VERSION.

On the real 42-estate corpus every estate is edgeless (one asset per host),
so the optimum there equals Smith's rule (w/d descending); synthetic estates
add dependency DAGs where no closed-form optimum exists and the exact DP is
required.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from itertools import permutations
from pathlib import Path
from typing import Sequence

from .data_generator import (
    _DEFAULT_KEY_SIZE,
    _is_pqc_algorithm,
    encode_algorithm_type,
)

SIM_SPEC_VERSION = "qrd-sim/1.0"

# Criticality weights — identical to CRITICALITY_SCORES used across the repo.
CRITICALITY_WEIGHTS = {"low": 1, "medium": 2, "high": 3, "critical": 4}

# Quantum exposure rates per algorithm family. Mirrors the classification in
# inspector/qtrust_inspector/risk_engine.py (kept local so the planner stays
# a standalone package): BROKEN (Shor) = 1.0, WEAKENED (Grover) = 0.5,
# SAFE = 0.2, PQC_READY = 0.0.
RISK_RATE_BROKEN = 1.0
RISK_RATE_WEAKENED = 0.5
RISK_RATE_SAFE = 0.2
RISK_RATE_PQC = 0.0

_WEAKENED_PREFIXES = ("AES-128", "3DES", "DES", "RC4", "CHACHA20-128")
_SAFE_PREFIXES = ("AES-256", "SHA-256", "SHA-384", "SHA-512", "SHA3", "SHA-3",
                  "HMAC", "SHAKE256")


def risk_rate(algorithm: str) -> float:
    """Quantum exposure rate for an algorithm name (see module docstring)."""
    alg = str(algorithm or "Unknown").upper()
    if _is_pqc_algorithm(alg):
        return RISK_RATE_PQC
    if any(alg.startswith(p) for p in _WEAKENED_PREFIXES):
        return RISK_RATE_WEAKENED
    if any(alg.startswith(p) for p in _SAFE_PREFIXES):
        return RISK_RATE_SAFE
    if any(f in alg for f in ("RSA", "DSA", "ECDSA", "ECDH", "DH", "ED25519",
                              "ED448", "X25519", "X448", "ECC", "EC")):
        return RISK_RATE_BROKEN
    return RISK_RATE_WEAKENED  # unknown algorithms treated as weakened


def migration_duration_days(algorithm: str, key_size: int,
                            vendor_pqc_ready: bool) -> float:
    """Deterministic migration effort in days (SIM_SPEC assumptions).

    - already-PQC asset: 3 days (validation/attestation paperwork only)
    - base programme overhead: 7 days for every migration
    - vendor not PQC-ready: +21 days (procurement + integration testing)
    - classical→PQC rollout lift: + key_size/512 days, capped at +8
      (bigger key material = bigger ops coordination)
    """
    alg = str(algorithm or "Unknown").upper()
    if _is_pqc_algorithm(alg):
        return 3.0
    base = 7.0
    if not vendor_pqc_ready:
        base += 21.0
    base += min(int(key_size) / 512.0, 8.0)
    return base


@dataclass
class EstateAsset:
    """One migration work item derived from a CBOM asset."""
    idx: int
    algorithm: str
    key_size: int
    criticality_weight: int
    vendor_pqc_ready: bool
    risk_rate: float
    duration_days: float
    host: str = ""
    days_to_expiry: float = 365.0

    @property
    def exposure_weight(self) -> float:
        """w_j for the 1|prec|Σ w_j C_j objective (risk × criticality)."""
        return self.risk_rate * self.criticality_weight


@dataclass
class MigrationEstate:
    """An estate: assets + dependency edges + estate-level deadline."""
    name: str
    assets: list[EstateAsset]
    # (dependency_idx, dependent_idx): dependency must migrate first.
    dependencies: list[tuple[int, int]] = field(default_factory=list)
    industry: str = "unknown"
    days_to_deadline: float = 365.0

    @property
    def n(self) -> int:
        return len(self.assets)

    def predecessors(self) -> list[set[int]]:
        preds: list[set[int]] = [set() for _ in self.assets]
        for dep, dependent in self.dependencies:
            preds[dependent].add(dep)
        return preds

    def makespan_days(self, order: Sequence[int]) -> float:
        return sum(self.assets[i].duration_days for i in order)

    def total_quantum_risk_days(self, order: Sequence[int]) -> float:
        """QRD = Σ exposure_weight_i × C_i under sequential execution."""
        elapsed = 0.0
        total = 0.0
        for i in order:
            elapsed += self.assets[i].duration_days
            total += self.assets[i].exposure_weight * elapsed
        return total


# ---------------------------------------------------------------------------
# Estate construction from CBOMs
# ---------------------------------------------------------------------------

def _days_until_expiry(asset: dict, now: datetime | None = None) -> float:
    not_after = asset.get("not_after")
    if not not_after:
        return 365.0
    try:
        expiry = datetime.fromisoformat(str(not_after).replace("Z", "+00:00"))
    except ValueError:
        return 365.0
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    return max((expiry - now).total_seconds() / 86400.0, 1.0)


def estate_from_cbom(cbom: dict, name: str = "estate") -> MigrationEstate:
    """Build a MigrationEstate from a ``qtrust.cbom.v1`` document.

    Dependency edges mirror ``cbom_to_dependency_graph`` exactly: explicit
    ``depends_on`` lists when present, else the deterministic host-affinity
    fallback (assets sharing a host hang off the host's first asset).
    """
    raw_assets = cbom.get("assets") or []
    if not raw_assets:
        raise ValueError("CBOM contains no assets")

    assets: list[EstateAsset] = []
    for i, asset in enumerate(raw_assets):
        algorithm = str(asset.get("algorithm") or "Unknown").upper()
        key_size = asset.get("key_size")
        if not key_size:
            family = algorithm.split("-")[0]
            key_size = _DEFAULT_KEY_SIZE.get(family, 2048)
        key_size = int(key_size)
        crit = CRITICALITY_WEIGHTS.get(
            str(asset.get("criticality", "medium")).lower(), 2)
        pqc_ready = bool(asset.get("pqc_ready", False)) or _is_pqc_algorithm(algorithm)
        assets.append(EstateAsset(
            idx=i,
            algorithm=algorithm,
            key_size=key_size,
            criticality_weight=crit,
            vendor_pqc_ready=pqc_ready,
            risk_rate=risk_rate(algorithm),
            duration_days=migration_duration_days(algorithm, key_size, pqc_ready),
            host=str(asset.get("host") or asset.get("location") or ""),
            days_to_expiry=_days_until_expiry(asset),
        ))

    dependencies: list[tuple[int, int]] = []
    has_explicit_deps = any(a.get("depends_on") for a in raw_assets)
    first_index_by_host: dict[str, int] = {}
    for i, asset in enumerate(raw_assets):
        if has_explicit_deps:
            for dep in asset.get("depends_on") or []:
                try:
                    dep_idx = int(dep)
                except (TypeError, ValueError):
                    continue
                if dep_idx != i and 0 <= dep_idx < len(assets):
                    dependencies.append((dep_idx, i))
        else:
            host = str(asset.get("host") or asset.get("location") or "")
            anchor = first_index_by_host.setdefault(host, i)
            if anchor != i:
                dependencies.append((anchor, i))

    expiries = [a.days_to_expiry for a in assets]
    days_to_deadline = min(max(min(expiries), 30.0), 730.0)
    return MigrationEstate(
        name=name,
        assets=assets,
        dependencies=dependencies,
        industry=str(cbom.get("industry", "unknown")),
        days_to_deadline=days_to_deadline,
    )


# ---------------------------------------------------------------------------
# Ordering methods
# ---------------------------------------------------------------------------

def heuristic_priority_scores(estate: MigrationEstate) -> list[float]:
    """The shipped static priority formula (benchmark.heuristic_order
    semantics), computed directly on the estate — the deployed baseline.

    priority = criticality*2 + 1.5 if vendor_pqc_ready
             + log1p(key_size)/4 if not PQC else -1
             + deadline_pressure * criticality/5
             - in_degree * 0.3
    """
    deadline_pressure = 2.0 if estate.days_to_deadline < 180 else 1.0
    in_degree = [0] * estate.n
    for _, dependent in estate.dependencies:
        in_degree[dependent] += 1
    scores = []
    for a in estate.assets:
        p = a.criticality_weight * 2.0
        if a.vendor_pqc_ready:
            p += 1.5
        if not _is_pqc_algorithm(a.algorithm):
            p += math.log1p(a.key_size) / 4.0
        else:
            p -= 1.0
        p += deadline_pressure * a.criticality_weight / 5.0
        p -= in_degree[a.idx] * 0.3
        scores.append(p)
    return scores


def feasible_projection(scores: Sequence[float],
                        estate: MigrationEstate) -> list[int]:
    """Project any score vector to a dependency-feasible order.

    List scheduling by descending score (deterministic tie-break on asset
    index) — exactly how a programme office executes a priority list.
    """
    remaining = set(range(estate.n))
    preds = estate.predecessors()
    order: list[int] = []
    while remaining:
        ready = [i for i in remaining if preds[i] <= set(order)]
        if not ready:  # cyclic dependencies — cannot happen with DAG inputs
            raise ValueError("dependency graph has a cycle")
        best = max(ready, key=lambda i: (scores[i], -i))
        order.append(best)
        remaining.remove(best)
    return order


def smith_rule_order(estate: MigrationEstate) -> list[int]:
    """Smith's rule: descending exposure_weight / duration_days.

    Provably optimal for 1||Σ w_j C_j (no precedence). On edgeless estates
    this equals the exact optimum; with precedence it is a strong baseline
    that ignores the constraints.
    """
    ratios = [a.exposure_weight / a.duration_days for a in estate.assets]
    return feasible_projection(ratios, estate)


def optimal_order(estate: MigrationEstate,
                  exact_max_n: int = 14,
                  beam_width: int = 64) -> list[int]:
    """Exact QRD-optimal feasible order.

    Exact DP over subsets for n ≤ exact_max_n (2^n × n transitions,
    reconstructing via parent pointers; deterministic tie-break on lowest
    index). Falls back to beam search for larger estates (documented
    approximation — the real corpus has n ≤ 7).
    """
    n = estate.n
    preds = estate.predecessors()
    durations = [a.duration_days for a in estate.assets]
    weights = [a.exposure_weight for a in estate.assets]
    preds_mask = [sum(1 << p for p in preds[i]) for i in range(n)]

    if n > exact_max_n:
        # Beam search over partial orders (approximate, deterministic).
        beam: list[tuple[float, tuple[int, ...]]] = [(0.0, ())]
        for _ in range(n):
            nxt: dict[tuple[int, ...], tuple[float, tuple[int, ...]]] = {}
            for cost, order in beam:
                done = set(order)
                ready = [i for i in range(n)
                         if i not in done and preds[i] <= done]
                elapsed = sum(durations[i] for i in order)
                for i in ready:
                    c = cost + weights[i] * (elapsed + durations[i])
                    key = tuple(sorted(order + (i,)))
                    if key not in nxt or c < nxt[key][0]:
                        nxt[key] = (c, order + (i,))
            beam = sorted(nxt.values(), key=lambda t: t[0])[:beam_width]
        return list(beam[0][1])

    # Exact DP. dursum[mask] = total duration of assets in mask.
    dursum = [0.0] * (1 << n)
    for mask in range(1, 1 << n):
        low = mask & -mask
        bit = low.bit_length() - 1
        dursum[mask] = dursum[mask ^ low] + durations[bit]

    INF = float("inf")
    dp = [INF] * (1 << n)
    parent = [-1] * (1 << n)
    dp[0] = 0.0
    for mask in range(1, 1 << n):
        for i in range(n):
            bit = 1 << i
            if not (mask & bit):
                continue
            prev = mask ^ bit
            if dp[prev] == INF:
                continue
            if preds_mask[i] & prev != preds_mask[i]:
                continue
            cand = dp[prev] + weights[i] * dursum[mask]
            if cand < dp[mask]:
                dp[mask] = cand
                parent[mask] = i
    # Reconstruct (parent holds the LAST asset scheduled within each mask).
    order: list[int] = []
    mask = (1 << n) - 1
    while mask:
        i = parent[mask]
        order.append(i)
        mask ^= 1 << i
    order.reverse()
    return order


def brute_force_optimal_qrd(estate: MigrationEstate) -> float:
    """Reference optimum via full permutation enumeration (tests only)."""
    preds = estate.predecessors()
    best = float("inf")
    for perm in permutations(range(estate.n)):
        done: set[int] = set()
        ok = True
        for i in perm:
            if not preds[i] <= done:
                ok = False
                break
            done.add(i)
        if ok:
            best = min(best, estate.total_quantum_risk_days(perm))
    return best


def explain_order(estate: MigrationEstate,
                  order: Sequence[int]) -> list[dict]:
    """Per-asset attribution for a dependency-feasible order.

    Every field is computed from the estate and the order alone — no model,
    no learned state — so an explanation is exactly as reproducible as the
    plan it annotates (SIM_SPEC_VERSION applies). Four facts per step:

    - ``qrd_share``: this asset's own objective term (w_i × C_i) as a share
      of the order's total QRD.
    - ``smith_ratio``: exposure_weight / duration_days (Smith's rule key).
      High ratio = short, heavy job; the reason it sits early absent
      precedence.
    - ``unlocks``: number of direct dependents that cannot start until this
      asset migrates (blocking work).
    - ``neighbor_swap_delta_qrd``: total QRD if this asset swapped places
      with the NEXT-ranked asset, minus the order's QRD. Positive means the
      chosen position strictly beats the adjacent alternative; 0 means
      slack/tie; ``None`` when the swap is dependency-infeasible or there is
      no next asset. For a locally-optimal order every feasible swap is >= 0.
    """
    preds = estate.predecessors()
    successors: list[set[int]] = [set() for _ in estate.assets]
    for dep, dependent in estate.dependencies:
        successors[dep].add(dependent)

    base_qrd = estate.total_quantum_risk_days(order)

    out: list[dict] = []
    elapsed = 0.0
    for pos, idx in enumerate(order):
        asset = estate.assets[idx]
        completion = elapsed + asset.duration_days
        swap_delta: float | None = None
        if pos + 1 < len(order):
            nxt = order[pos + 1]
            # Adjacent swap (idx, nxt) -> (nxt, idx) is feasible iff the next
            # asset does not directly depend on this one: only these two
            # positions move, so a direct-edge check is sufficient.
            if idx not in preds[nxt]:
                swapped = list(order)
                swapped[pos], swapped[pos + 1] = swapped[pos + 1], swapped[pos]
                swap_delta = (estate.total_quantum_risk_days(swapped)
                              - estate.total_quantum_risk_days(order))
        out.append({
            "asset_idx": idx,
            "qrd_share": round(asset.exposure_weight * completion / base_qrd, 4)
            if base_qrd > 0 else 0.0,
            "exposure_weight": round(asset.exposure_weight, 4),
            "duration_days": round(asset.duration_days, 2),
            "smith_ratio": round(asset.exposure_weight / asset.duration_days, 6),
            "unlocks": len(successors[idx]),
            "neighbor_swap_delta_qrd": (round(swap_delta, 2)
                                        if swap_delta is not None else None),
        })
        elapsed = completion
    return out


# ---------------------------------------------------------------------------
# Synthetic estates with precedence (training augmentation)
# ---------------------------------------------------------------------------

# Algorithm pool mirroring the real CBOM corpus distribution.
_SYNTH_ALGORITHMS = [
    ("RSA-2048", 2048), ("RSA-4096", 4096), ("RSA-1024", 1024),
    ("ECDSA-P256", 256), ("ECDSA-P384", 384), ("ECDSA-P521", 521),
    ("ED25519", 256), ("X25519", 256), ("ECDH-P256", 256),
    ("AES-128-GCM", 128), ("AES-256-GCM", 256), ("SHA-256", 256),
    ("ML-KEM-768", 1184 // 8), ("ML-DSA-65", 1952 // 8),
    ("SLH-DSA-SHA2-128s", 32), ("FALCON-512", 897 // 8),
]
_SYNTH_CRITICALITIES = ["low", "medium", "high", "critical"]


def generate_synthetic_estate(n: int, seed: int,
                              edge_prob: float = 0.18) -> MigrationEstate:
    """Seeded synthetic estate with a dependency DAG (edges point forward).

    Mirrors real-estate structure: mixed algorithm families, criticality
    tiers, and either host-affinity-like chains or explicit forward DAG
    edges so precedence genuinely constrains the schedule.
    """
    import random
    rng = random.Random(seed)
    assets: list[EstateAsset] = []
    for i in range(n):
        alg, ks = _SYNTH_ALGORITHMS[rng.randrange(len(_SYNTH_ALGORITHMS))]
        crit = CRITICALITY_WEIGHTS[
            rng.choice(_SYNTH_CRITICALITIES)]
        pqc = _is_pqc_algorithm(alg) or rng.random() < 0.15
        assets.append(EstateAsset(
            idx=i, algorithm=alg, key_size=ks, criticality_weight=crit,
            vendor_pqc_ready=pqc, risk_rate=risk_rate(alg),
            duration_days=migration_duration_days(alg, ks, pqc),
            host=f"host-{i}",
            days_to_expiry=rng.uniform(45, 720),
        ))
    dependencies: list[tuple[int, int]] = []
    for i in range(1, n):
        if rng.random() < 0.45:
            # 0-2 forward edges (DAG by construction: dep index < i).
            k = 1 if rng.random() < 0.7 else 2
            for dep in rng.sample(range(i), min(k, i)):
                if rng.random() < edge_prob / 0.18:
                    dependencies.append((dep, i))
    days = min(max(min(a.days_to_expiry for a in assets), 30.0), 730.0)
    return MigrationEstate(
        name=f"synthetic_{seed}",
        assets=assets,
        dependencies=dependencies,
        industry="synthetic",
        days_to_deadline=days,
    )


def generate_synthetic_estates(n_estates: int, seed: int,
                               min_n: int = 3, max_n: int = 12,
                               ) -> list[MigrationEstate]:
    import random
    rng = random.Random(seed)
    return [
        generate_synthetic_estate(rng.randint(min_n, max_n), seed * 10_000 + k)
        for k in range(n_estates)
    ]


# ---------------------------------------------------------------------------
# PyG graph construction for model training
# ---------------------------------------------------------------------------

def build_outcome_graph(estate: MigrationEstate, order: Sequence[int] | None = None):
    """Convert an estate to a PyG Data object with 10-dim node features and
    outcome-optimal labels.

    Features 0-5 replicate ``cbom_to_dependency_graph`` so real and synthetic
    estates stay comparable; features 6-9 add the information the heuristic
    formula cannot see (exposure rate, migration duration, dependency
    structure) — exactly the headroom the outcome task is designed to expose.

    Labels: ``y_order``/``y_priority`` from ``order`` (usually the exact
    optimum). Optimal orders are generically unique, so the tie-ceiling
    pathology of the formula labels disappears.
    """
    import torch
    from torch_geometric.data import Data

    if order is None:
        order = optimal_order(estate)
    n = estate.n
    rank = {node: r for r, node in enumerate(order)}

    deadline_pressure = 2.0 if estate.days_to_deadline < 180 else 1.0
    features = torch.zeros((n, 10), dtype=torch.float32)
    for a in estate.assets:
        required_rate = min(
            deadline_pressure * a.criticality_weight / 5.0, 1.0)
        in_deg = sum(1 for _, d in estate.dependencies if d == a.idx)
        out_deg = sum(1 for s, _ in estate.dependencies if s == a.idx)
        features[a.idx] = torch.tensor([
            encode_algorithm_type(a.algorithm) / 14.0,
            min(a.key_size / 4096.0, 1.0),
            1.0 if a.vendor_pqc_ready else 0.0,
            a.criticality_weight / 5.0,
            estate.days_to_deadline / 730.0,
            required_rate,
            a.risk_rate,
            a.duration_days / 45.0,
            in_deg / 5.0,
            out_deg / 5.0,
        ], dtype=torch.float32)

    y_order = torch.tensor([rank[i] for i in range(n)], dtype=torch.long)
    if n > 1:
        y_priority = 1.0 - y_order.float() / (n - 1)
    else:
        y_priority = torch.ones(1)
    y_risk = torch.tensor(
        [a.risk_rate * a.criticality_weight / 4.0 for a in estate.assets],
        dtype=torch.float32)

    if estate.dependencies:
        edge_index = torch.tensor(list(zip(*estate.dependencies)),
                                  dtype=torch.long)
    else:
        edge_index = torch.zeros((2, 0), dtype=torch.long)

    data = Data(x=features, edge_index=edge_index, y_order=y_order,
                y_risk=y_risk, y_priority=y_priority)
    data.estate_name = estate.name  # type: ignore[attr-defined]
    data.n_assets = n  # type: ignore[attr-defined]
    return data


def load_estates(cbom_dir: str | Path) -> list[MigrationEstate]:
    """Load every CBOM JSON in a directory as a MigrationEstate."""
    estates = []
    for p in sorted(Path(cbom_dir).glob("*.json")):
        cbom = json.loads(p.read_text())
        estates.append(estate_from_cbom(cbom, name=p.stem))
    return estates


def evaluate_order(order: Sequence[int], estate: MigrationEstate) -> dict:
    """Outcome metrics for one executed order on one estate."""
    qrd = estate.total_quantum_risk_days(order)
    opt = estate.total_quantum_risk_days(optimal_order(estate))
    return {
        "qrd": qrd,
        "qrd_optimal": opt,
        # ≥1.0; 1.0 == optimal. Lower is better.
        "qrd_ratio": (qrd / opt) if opt > 0 else 1.0,
        "makespan_days": estate.makespan_days(order),
    }


__all__ = [
    "SIM_SPEC_VERSION",
    "CRITICALITY_WEIGHTS",
    "EstateAsset",
    "MigrationEstate",
    "risk_rate",
    "migration_duration_days",
    "estate_from_cbom",
    "heuristic_priority_scores",
    "feasible_projection",
    "smith_rule_order",
    "optimal_order",
    "brute_force_optimal_qrd",
    "generate_synthetic_estate",
    "generate_synthetic_estates",
    "build_outcome_graph",
    "load_estates",
    "evaluate_order",
]

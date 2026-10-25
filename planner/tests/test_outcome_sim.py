"""Tests for the quantum-risk-days (QRD) outcome simulator.

Covers: risk-rate classification, deterministic durations, the QRD formula
against a hand-computed example, exactness of the subset DP against brute
force, Smith's-rule optimality on edgeless estates, feasibility of the
list-scheduling projection, and PyG graph construction (shapes, label
semantics, determinism).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qtrust_planner.outcome_sim import (  # noqa: E402
    CRITICALITY_WEIGHTS,
    MigrationEstate,
    EstateAsset,
    SIM_SPEC_VERSION,
    build_outcome_graph,
    brute_force_optimal_qrd,
    estate_from_cbom,
    feasible_projection,
    generate_synthetic_estate,
    generate_synthetic_estates,
    heuristic_priority_scores,
    migration_duration_days,
    optimal_order,
    risk_rate,
    smith_rule_order,
)


# ---------------------------------------------------------------------------
# Classification + durations
# ---------------------------------------------------------------------------

class TestRiskRates:
    def test_broken_families(self):
        for alg in ("RSA-2048", "RSA-4096", "ECDSA-P256", "ECDSA-P384",
                    "ED25519", "X25519", "ECDH-P256", "DSA-2048"):
            assert risk_rate(alg) == 1.0

    def test_pqc_families(self):
        for alg in ("ML-KEM-768", "ML-DSA-65", "SLH-DSA-SHA2-128s",
                    "FALCON-512", "HQC-128"):
            assert risk_rate(alg) == 0.0

    def test_weakened_and_safe(self):
        assert risk_rate("AES-128-GCM") == 0.5
        assert risk_rate("3DES") == 0.5
        assert risk_rate("AES-256-GCM") == 0.2
        assert risk_rate("SHA-256") == 0.2
        assert risk_rate("HMAC-SHA-256") == 0.2


class TestDurations:
    def test_deterministic_and_documented(self):
        d1 = migration_duration_days("RSA-2048", 2048, False)
        d2 = migration_duration_days("RSA-2048", 2048, False)
        assert d1 == d2
        # base 7 + vendor-not-ready 21 + key lift 4
        assert d1 == pytest.approx(32.0)

    def test_pqc_is_cheap(self):
        assert migration_duration_days("ML-KEM-768", 0, True) == 3.0

    def test_vendor_ready_shorter(self):
        slow = migration_duration_days("RSA-2048", 2048, False)
        fast = migration_duration_days("RSA-2048", 2048, True)
        assert fast < slow


# ---------------------------------------------------------------------------
# QRD objective
# ---------------------------------------------------------------------------

def _two_asset_estate() -> MigrationEstate:
    """Hand-computable: A = RSA-2048 (w=2*1, d=32), B = ML-DSA (w=0, d=3)."""
    a = EstateAsset(0, "RSA-2048", 2048, 2, False, 1.0, 32.0)
    b = EstateAsset(1, "ML-DSA-65", 244, 4, True, 0.0, 3.0)
    return MigrationEstate("hand", [a, b], dependencies=[],
                           days_to_deadline=365)


class TestQRD:
    def test_hand_computed_value(self):
        e = _two_asset_estate()
        # Order [A, B]: C_A=32, C_B=35 → 2*32 + 0*35 = 64.
        assert e.total_quantum_risk_days([0, 1]) == pytest.approx(64.0)
        # Order [B, A]: C_B=3, C_A=35 → 2*35 = 70 (worse — heavy asset first).
        assert e.total_quantum_risk_days([1, 0]) == pytest.approx(70.0)

    def test_optimal_prefers_heavy_exposure_first(self):
        e = _two_asset_estate()
        assert optimal_order(e) == [0, 1]

    def test_smith_equals_optimal_without_deps(self):
        # Property: on edgeless estates Smith's rule attains the exact optimum.
        for seed in range(20):
            e = generate_synthetic_estate(6, seed=seed)
            e.dependencies = []
            qrd_smith = e.total_quantum_risk_days(smith_rule_order(e))
            assert qrd_smith == pytest.approx(brute_force_optimal_qrd(e))


# ---------------------------------------------------------------------------
# Exactness + feasibility
# ---------------------------------------------------------------------------

class TestOptimalDP:
    def test_dp_matches_bruteforce_with_deps(self):
        estates = [generate_synthetic_estate(6, seed=100 + s) for s in range(15)]
        assert any(e.dependencies for e in estates), "expected DAG estates"
        for e in estates:
            dp_qrd = e.total_quantum_risk_days(optimal_order(e))
            assert dp_qrd == pytest.approx(brute_force_optimal_qrd(e))

    def test_dp_respects_precedence(self):
        for seed in range(10):
            e = generate_synthetic_estate(7, seed=200 + seed)
            preds = e.predecessors()
            done: set[int] = set()
            for i in optimal_order(e):
                assert preds[i] <= done
                done.add(i)

    def test_beam_fallback_smoke(self):
        e = generate_synthetic_estate(16, seed=7)
        order = optimal_order(e, exact_max_n=10)  # force beam path
        assert sorted(order) == list(range(16))


class TestProjection:
    def test_projection_always_feasible(self):
        import random
        rng = random.Random(0)
        for seed in range(15):
            e = generate_synthetic_estate(8, seed=300 + seed)
            scores = [rng.random() for _ in range(e.n)]
            order = feasible_projection(scores, e)
            assert sorted(order) == list(range(e.n))
            preds = e.predecessors()
            done: set[int] = set()
            for i in order:
                assert preds[i] <= done
                done.add(i)

    def test_projection_deterministic(self):
        e = generate_synthetic_estate(7, seed=9)
        s = heuristic_priority_scores(e)
        assert feasible_projection(s, e) == feasible_projection(s, e)

    def test_cycle_raises(self):
        a = EstateAsset(0, "RSA-2048", 2048, 2, False, 1.0, 10.0)
        b = EstateAsset(1, "RSA-2048", 2048, 2, False, 1.0, 10.0)
        e = MigrationEstate("cyc", [a, b], dependencies=[(0, 1), (1, 0)])
        with pytest.raises(ValueError):
            feasible_projection([1.0, 1.0], e)


# ---------------------------------------------------------------------------
# Estates from CBOMs + graphs
# ---------------------------------------------------------------------------

class TestEstateFromCbom:
    def _cbom(self):
        return {
            "schema_version": "qtrust.cbom.v1",
            "target": "example.test",
            "industry": "finance",
            "assets": [
                {"algorithm": "RSA-2048", "key_size": 2048,
                 "criticality": "high", "host": "a.example"},
                {"algorithm": "ML-KEM-768", "key_size": 1184,
                 "criticality": "medium", "host": "b.example"},
                {"algorithm": "ECDSA-P256", "criticality": "medium",
                 "host": "b.example"},
            ],
        }

    def test_build(self):
        e = estate_from_cbom(self._cbom(), name="t")
        assert e.n == 3
        assert e.industry == "finance"
        # Host affinity: two assets on b.example → one edge.
        assert e.dependencies == [(1, 2)]
        assert e.assets[0].risk_rate == 1.0
        assert e.assets[1].risk_rate == 0.0
        assert e.assets[0].criticality_weight == CRITICALITY_WEIGHTS["high"]

    def test_empty_cbom_raises(self):
        with pytest.raises(ValueError):
            estate_from_cbom({"assets": []})


class TestOutcomeGraph:
    def test_shapes_labels_determinism(self):
        e = generate_synthetic_estate(7, seed=42)
        g1 = build_outcome_graph(e)
        g2 = build_outcome_graph(e)
        assert g1.x.shape == (7, 10)
        assert g1.y_order.shape == (7,)
        # y_priority semantics: higher = migrate first, linear in rank.
        assert g1.y_priority.min() >= 0.0 and g1.y_priority.max() <= 1.0
        first = g1.y_order.argmin().item()
        assert g1.y_priority[first].item() == pytest.approx(1.0)
        assert torch_equal(g1.x, g2.x)

    def test_labels_come_from_optimum(self):
        e = _two_asset_estate()
        g = build_outcome_graph(e)
        assert g.y_order.tolist() == [0, 1]  # heavy RSA first


def torch_equal(a, b) -> bool:
    import torch
    return torch.equal(a, b)


class TestHeuristicBaseline:
    def test_heuristic_scores_match_formula(self):
        e = _two_asset_estate()
        # deadline_pressure=1 (365d), no in-degrees.
        # A: 2*2 + log1p(2048)/4 + 1*2/5;  B: 4*2 + 1.5 - 1 + 4/5
        import math
        exp_a = 2 * 2 + math.log1p(2048) / 4 + 1 * 2 / 5
        exp_b = 4 * 2 + 1.5 - 1.0 + 1 * 4 / 5
        s = heuristic_priority_scores(e)
        assert s[0] == pytest.approx(exp_a)
        assert s[1] == pytest.approx(exp_b)


class TestSyntheticGenerator:
    def test_seeded_reproducibility(self):
        a = generate_synthetic_estates(5, seed=7)
        b = generate_synthetic_estates(5, seed=7)
        assert [(x.n, x.dependencies) for x in a] == \
               [(x.n, x.dependencies) for x in b]

    def test_dag_structure(self):
        for seed in range(10):
            e = generate_synthetic_estate(10, seed=seed)
            for dep, dependent in e.dependencies:
                assert dep < dependent  # forward edges → acyclic by construction

    def test_spec_version(self):
        assert SIM_SPEC_VERSION.startswith("qrd-sim/")

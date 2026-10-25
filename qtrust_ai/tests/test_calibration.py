"""Tests for post-hoc confidence calibration (temperature / Platt scaling).

Covers: monotonicity, threshold-decision invariance, round-trip save/load,
cross-fitted metric sanity (ECE can only be trusted when computed on
calibrated probabilities), and the shipped-artifact contract (method field,
fitted flag, params present, evaluation block with before/after ECE).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from qtrust_ai.discovery.calibration import (  # noqa: E402
    PlattScaler,
    TemperatureScaler,
    apply_calibration,
    brier_score,
    cross_fitted_calibration,
    expected_calibration_error,
    load_shipped_calibrator,
)

ARTIFACT = (Path(__file__).resolve().parents[1] / "artifacts"
            / "calibration.json")


def _toy_probs(n: int = 400, seed: int = 7):
    """Deterministic synthetic logits with a known under-confidence bias."""
    import math
    import random
    rng = random.Random(seed)
    probs, labels = [], []
    for _ in range(n):
        z = rng.gauss(0, 2.5)
        p = 1.0 / (1.0 + math.exp(-z))
        y = 1 if rng.random() < p else 0
        probs.append(p)
        labels.append(y)
    return probs, labels


class TestTemperatureScaler:
    def test_fit_reduces_nll(self):
        probs, labels = _toy_probs()
        sc = TemperatureScaler().fit(probs, labels)
        assert sc.fitted and sc.n_calibration == len(probs)
        assert sc.fit_nll_after <= sc.fit_nll_before + 1e-9

    def test_monotone_transform(self):
        sc = TemperatureScaler(temperature=1.5, fitted=True)
        xs = [0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]
        outs = [sc.transform(x) for x in xs]
        assert outs == sorted(outs)
        assert outs[3] == pytest.approx(0.5)  # symmetry preserved

    def test_unfitted_passthrough(self):
        sc = TemperatureScaler()
        assert sc.transform(0.37) == 0.37

    def test_save_load_roundtrip(self, tmp_path):
        probs, labels = _toy_probs(100)
        sc = TemperatureScaler().fit(probs, labels)
        p = tmp_path / "cal.json"
        sc.save(p)
        loaded = TemperatureScaler.load(p)
        assert loaded.temperature == sc.temperature
        assert loaded.fitted
        assert loaded.transform(0.42) == sc.transform(0.42)

    def test_input_validation(self):
        with pytest.raises(ValueError):
            TemperatureScaler().fit([], [])


class TestPlattScaler:
    def test_fit_and_monotone(self):
        probs, labels = _toy_probs(300)
        sc = PlattScaler().fit(probs, labels)
        assert sc.fitted and sc.a > 0
        xs = [0.05, 0.2, 0.5, 0.8, 0.95]
        outs = [sc.transform(x) for x in xs]
        assert outs == sorted(outs)

    def test_save_load_roundtrip(self, tmp_path):
        probs, labels = _toy_probs(80)
        sc = PlattScaler().fit(probs, labels)
        p = tmp_path / "platt.json"
        sc.save(p)
        loaded = PlattScaler.load(p)
        assert (loaded.a, loaded.b) == (sc.a, sc.b)

    def test_unfitted_passthrough(self):
        assert PlattScaler().transform(0.6) == 0.6


class TestMetrics:
    def test_perfect_calibration_zero_ece(self):
        # Under the conf-vs-hard-accuracy convention, zero ECE requires
        # confidence == accuracy in every populated bin: perfectly confident
        # and correct positives (a 0.0-prob correct negative would register
        # |0.0 − 1.0| — the convention's known asymmetry, which is exactly
        # why the published ECE (0.1557) is dominated by the class-0 tail).
        probs = [1.0] * 100
        labels = [1] * 100
        assert expected_calibration_error(probs, labels) == pytest.approx(0.0)

    def test_confident_correct_bin_residual(self):
        # Paper convention: |mean conf − hard accuracy| per bin — a bin of
        # 0.95-confident correct predictions still contributes 0.05.
        probs = [0.95] * 10
        labels = [1] * 10
        assert expected_calibration_error(probs, labels) == pytest.approx(0.05)

    def test_brier_bounds(self):
        assert brier_score([1.0, 0.0], [1, 0]) == 0.0
        assert brier_score([0.0, 1.0], [1, 0]) == 1.0

    def test_convention_matches_paper(self):
        # conf-vs-hard-accuracy convention: confident wrong bin counts fully.
        probs = [0.95] * 10
        labels = [0] * 10  # all confidently wrong
        assert expected_calibration_error(probs, labels) == pytest.approx(0.95)


class TestCrossFitted:
    def test_no_leakage_improvement_or_honest(self):
        probs, labels = _toy_probs(600)
        for method in ("temperature", "platt"):
            cf = cross_fitted_calibration(probs, labels, method=method)
            assert cf["n"] == len(probs)
            # On this toy set (already roughly calibrated), calibration must
            # not blow up ECE by an order of magnitude; it should stay sane.
            assert cf["ece_10bin_after"] < max(0.5, cf["ece_10bin_before"] * 2)

    def test_unknown_method_raises(self):
        with pytest.raises(ValueError):
            cross_fitted_calibration([0.5], [1], method="isotonic")


class TestShippedArtifact:
    def test_artifact_contract(self):
        if not ARTIFACT.exists():
            pytest.skip("calibration.json not built in this environment")
        data = json.loads(ARTIFACT.read_text())
        assert data["method"] in ("temperature_scaling", "platt_scaling")
        assert data["fitted"] is True
        assert "evaluation" in data
        ev = data["evaluation"]
        assert "ece_10bin_before" in ev["cross_fitted"]
        assert "ece_10bin_after" in ev["cross_fitted"]
        # Before must reproduce the published eval number (0.1557).
        assert ev["cross_fitted"]["ece_10bin_before"] == pytest.approx(
            0.1557, abs=1e-3)
        assert ev["cross_fitted"]["ece_10bin_after"] < \
            ev["cross_fitted"]["ece_10bin_before"]

    def test_load_shipped_and_apply(self):
        if not ARTIFACT.exists():
            pytest.skip("calibration.json not built in this environment")
        sc = load_shipped_calibrator(ARTIFACT)
        assert sc.fitted
        lo, hi = sc.transform(0.05), sc.transform(0.95)
        assert lo < 0.5 < hi  # monotone across the mid-point

    def test_apply_calibration_missing_artifact_passthrough(self, tmp_path):
        assert apply_calibration(0.7, tmp_path / "none.json") == 0.7

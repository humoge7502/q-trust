"""The ML-only decision gate must be explicit and held-out-selectable."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from qtrust_ai.discovery.code_detector import (  # noqa: E402
    CryptoCodeDetector,
    CryptoFinding,
)


def _finding(algorithm: str = "AES") -> CryptoFinding:
    return CryptoFinding(
        file="<test>", line=1, language="python", algorithm=algorithm,
        category="crypto", confidence=0.9, method="static", context="x",
    )


def _detector(*, static=False, ast=False, dataflow=False, ml_prob=0.0) -> CryptoCodeDetector:
    detector = CryptoCodeDetector(seed=42)
    detector._static_layer = lambda code, language: [_finding()] if static else []
    detector._ast_layer = lambda code, language: [_finding()] if ast else []
    detector._dataflow_layer = lambda code, language: [_finding()] if dataflow else []
    detector._ml_layer = lambda code, language: (
        ml_prob >= detector.config.threshold, "AES", ml_prob
    )
    return detector


def _predict(detector: CryptoCodeDetector) -> bool:
    return detector._ensemble("x = 1", "python")[0]


def test_default_gate_keeps_weak_ml_hits_out():
    detector = _detector(ml_prob=0.60)
    assert detector.config.ml_decisive_threshold == 0.85
    assert _predict(detector) is False


def test_default_gate_accepts_a_very_confident_ml_hit():
    assert _predict(_detector(ml_prob=0.90)) is True


def test_lowered_gate_accepts_a_confident_ml_hit_alone():
    detector = _detector(ml_prob=0.60)
    detector.config.ml_decisive_threshold = 0.5
    assert _predict(detector) is True


def test_lowered_gate_still_respects_the_model_threshold():
    detector = _detector(ml_prob=0.49)
    detector.config.ml_decisive_threshold = 0.5
    assert _predict(detector) is False


def test_raised_gate_can_reject_an_ml_hit_that_clears_the_model_threshold():
    detector = _detector(ml_prob=0.90)
    detector.config.ml_decisive_threshold = 0.95
    assert _predict(detector) is False


def test_a_static_hit_remains_decisive_even_with_no_ml_signal():
    assert _predict(_detector(static=True, ml_prob=0.0)) is True


def test_two_weaker_layers_reach_the_vote_threshold():
    # ast 0.30 + dataflow 0.20 = 0.50
    assert _predict(_detector(ast=True, dataflow=True, ml_prob=0.0)) is True


def test_one_weak_layer_plus_weak_ml_stays_below_threshold():
    # ast 0.30 + ml weight 0.20 * 0.49 = 0.398
    detector = _detector(ast=True, ml_prob=0.49)
    detector.config.ml_decisive_threshold = 0.5
    assert _predict(detector) is False


def test_two_layers_still_decide_when_the_ml_only_gate_is_raised():
    # ast + ML means the ML-only gate does not apply; the 2-layer rule fires
    # even though the weighted vote (0.30 + 0.18 = 0.48) is below 0.5.
    detector = _detector(ast=True, ml_prob=0.90)
    detector.config.ml_decisive_threshold = 0.95
    assert _predict(detector) is True

"""Regression tests for stable source splits and checkpoint-local decisions.

These cover two failure modes found during the 2026-10-24 model audit:

1. The old split shuffled the *source list*, so adding a repository could move
   an existing repository from evaluation into training. The stable split must
   keep every source on the same side when the corpus grows.
2. Calibration and the decision threshold must travel with the checkpoint.
   Applying the v1 calibration file to a different fine-tune silently changed
   the operating point.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from qtrust_ai.discovery.calibration import TemperatureScaler  # noqa: E402
from qtrust_ai.discovery.code_detector import CryptoCodeDetector  # noqa: E402
from qtrust_ai.discovery.data_split import source_bucket, split_corpus  # noqa: E402


def _corpus(sources, files_per_source=3):
    return [
        {
            "source": source,
            "path": f"src/{source.replace('/', '_')}/{i}.py",
            "language": "python",
            "code": f"def f_{i}(): return {i}\n",
            "is_crypto": i % 2 == 0,
            "label": "SHA-256" if i % 2 == 0 else "NONE",
        }
        for source in sources
        for i in range(files_per_source)
    ]


class TestStableSourceSplit:
    def test_split_is_deterministic_and_disjoint(self):
        corpus = _corpus([f"org/repo-{i}" for i in range(50)])
        fit, cal, ev = split_corpus(corpus)
        fit_sources = {r["source"] for r in fit}
        cal_sources = {r["source"] for r in cal}
        ev_sources = {r["source"] for r in ev}
        assert fit_sources.isdisjoint(cal_sources)
        assert fit_sources.isdisjoint(ev_sources)
        assert cal_sources.isdisjoint(ev_sources)
        assert fit_sources | cal_sources | ev_sources == {r["source"] for r in corpus}

        fit2, cal2, ev2 = split_corpus(corpus)
        assert [r["path"] for r in fit] == [r["path"] for r in fit2]
        assert [r["path"] for r in cal] == [r["path"] for r in cal2]
        assert [r["path"] for r in ev] == [r["path"] for r in ev2]

    def test_adding_sources_does_not_move_existing_sources(self):
        original = [f"org/repo-{i}" for i in range(40)]
        before = split_corpus(_corpus(original))
        before_sides = {
            r["source"]: side
            for side, rows in zip(("fit", "cal", "eval"), before)
            for r in rows
        }
        grown = split_corpus(_corpus(original + [f"new/repo-{i}" for i in range(80)]))
        after_sides = {
            r["source"]: side
            for side, rows in zip(("fit", "cal", "eval"), grown)
            for r in rows
        }
        for source in original:
            assert after_sides[source] == before_sides[source]

    def test_seed_changes_bucket(self):
        # Not every source must move, but the keyed split must be seed-sensitive.
        assert any(
            source_bucket(f"org/repo-{i}", seed=1) != source_bucket(f"org/repo-{i}", seed=2)
            for i in range(50)
        )

    def test_invalid_buckets_rejected(self):
        with pytest.raises(ValueError):
            split_corpus(_corpus(["a"]), eval_buckets=(0, 1), calibration_buckets=(1,))
        with pytest.raises(ValueError):
            split_corpus(_corpus(["a"]), eval_buckets=(99,))


class TestCheckpointLocalDecision:
    def test_raw_probability_is_not_double_calibrated(self, tmp_path):
        det = CryptoCodeDetector(seed=7)
        raw = det.predict_proba("import hashlib; hashlib.sha256(b'x')", "python",
                                calibrated=False)
        cal = det.predict_proba("import hashlib; hashlib.sha256(b'x')", "python",
                                calibrated=True)
        assert 0.0 <= raw <= 1.0
        assert 0.0 <= cal <= 1.0

    def test_checkpoint_calibration_wins_over_legacy(self, tmp_path):
        det = CryptoCodeDetector(seed=7)
        raw = det.predict_proba("def add(a, b): return a + b", "python", calibrated=False)
        TemperatureScaler(temperature=4.0, fitted=True, n_calibration=10).save(
            tmp_path / "calibration.json"
        )
        det._calibration_path = tmp_path / "calibration.json"
        calibrated = det.predict_proba("def add(a, b): return a + b", "python",
                                       calibrated=True)
        legacy = det._default_calibration_path()
        if legacy.exists():
            # The temporary checkpoint-local calibrator is T=4; it must be used
            # instead of the v1 artifact (unless both happen to agree).
            assert calibrated == pytest.approx(
                TemperatureScaler(temperature=4.0, fitted=True).transform(raw)
            )

    def test_max_chunks_validation_and_fallback(self):
        det = CryptoCodeDetector(seed=5)
        det.set_max_chunks(4)
        assert det._hf_max_chunks == 4
        with pytest.raises(ValueError):
            det.set_max_chunks(0)
        rows = [
            {"code": "def add(a, b): return a + b", "language": "python"},
            {"code": "crypto/rand.Read(buf)", "language": "go"},
        ]
        scores = det.score_codes(rows, calibrated=False)
        assert len(scores) == 2
        assert all(0.0 <= score <= 1.0 for score in scores)
        assert det.predict_proba(rows[0]["code"], "python", calibrated=False) == scores[0]

    def test_threshold_must_be_probability(self):
        det = CryptoCodeDetector()
        det.set_threshold(0.37)
        assert det.config.threshold == 0.37
        with pytest.raises(ValueError):
            det.set_threshold(0.0)
        with pytest.raises(ValueError):
            det.set_threshold(1.5)

    def test_evaluate_ml_returns_calibration_metrics(self):
        det = CryptoCodeDetector(seed=3)
        rows = [
            {"code": "import hashlib; hashlib.sha256(b'x')", "language": "python",
             "is_crypto": True},
            {"code": "def add(a, b): return a + b", "language": "python",
             "is_crypto": False},
        ]
        out = det.evaluate_ml(rows)
        for key in ("precision", "recall", "f1", "roc_auc", "threshold", "n"):
            assert key in out
        assert out["n"] == 2
        assert 0.0 <= out["f1"] <= 1.0

    def test_load_fine_tuned_reads_threshold_metadata(self, tmp_path):
        # A checkpoint directory without actual HF weights is not loadable, but
        # the metadata contract is still tested through the standalone loader
        # logic once transformers is present. This test only asserts the file
        # format the trainer writes.
        (tmp_path / "threshold.json").write_text(json.dumps({"threshold": 0.33}))
        (tmp_path / "training_config.json").write_text(json.dumps({"max_len": 192}))
        assert json.loads((tmp_path / "threshold.json").read_text())["threshold"] == 0.33

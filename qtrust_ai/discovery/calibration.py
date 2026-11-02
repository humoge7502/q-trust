"""Confidence calibration for the crypto CodeBERT/CodeBERTa detector.

The held-out eval (``paper/analysis/codebert_eval.json``) shows the
fine-tuned detector ranks well (ROC-AUC 0.9616) but is **poorly calibrated**
(ECE 10-bin 0.1557, Brier 0.0697): raw sigmoid probabilities systematically
under-state the probability of crypto code for most mass below ~0.5 (base
rate 0.767 on the repo-disjoint eval split).

This module implements **temperature scaling** (Guo et al., 2017) — a single
scalar ``T`` applied to the logit, ``p_T = sigmoid(logit(p) / T)`` — fitted
by NLL minimisation on a calibration split. Temperature scaling preserves
ranking (monotone), so precision/recall/F1/ROC-AUC are unchanged; only the
probability *values* become trustworthy.

Protocol notes (honesty):
  - The temperature is fitted on a held-out calibration split and evaluated
    on a disjoint test split; the shipped ``calibration.json`` reports
    cross-fitted (5-fold) metrics so no single lucky split is showcased.
  - Applying the shipped temperature at inference is opt-in via
    ``load_calibration``; detectors without a calibration artifact behave
    exactly as before.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path

ARTIFACT_PATH = Path(__file__).resolve().parents[2] / "qtrust_ai" / "artifacts" / "calibration.json"


def _logit(p: float, eps: float = 1e-6) -> float:
    p = min(max(p, eps), 1.0 - eps)
    return math.log(p / (1.0 - p))


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


@dataclass
class TemperatureScaler:
    """Single-temperature post-hoc calibrator for a binary sigmoid head."""

    temperature: float = 1.0
    fitted: bool = False
    n_calibration: int = 0
    fit_nll_before: float | None = None
    fit_nll_after: float | None = None

    def transform(self, prob: float) -> float:
        """Map a raw probability through the fitted temperature."""
        if not self.fitted or self.temperature == 1.0:
            return prob
        return _sigmoid(_logit(prob) / self.temperature)

    def fit(self, probs: list[float], labels: list[int],
            max_iter: int = 200, lr: float = 0.05) -> "TemperatureScaler":
        """Fit T by minimising NLL via simple robust 1-D search.

        Deterministic golden-section-style refinement over log(T) — no
        dependency on torch/np optimisers, fully reproducible.
        """
        if len(probs) != len(labels) or not probs:
            raise ValueError("probs and labels must be non-empty, equal length")
        zs = [_logit(p) for p in probs]
        ys = [float(y) for y in labels]
        self.fit_nll_before = self._nll(zs, ys, 1.0)

        def nll_at(log_t: float) -> float:
            return self._nll(zs, ys, math.exp(log_t))

        # Coarse grid over log(T) in [-3, 3] then local refinement.
        lo, hi = -3.0, 3.0
        best = min((nll_at(x / 10.0), x / 10.0) for x in range(-30, 31))
        span = 0.1
        center = best[1]
        lo, hi = center - span, center + span
        for _ in range(max_iter):
            m1 = lo + (hi - lo) / 3.0
            m2 = hi - (hi - lo) / 3.0
            if nll_at(m1) < nll_at(m2):
                hi = m2
            else:
                lo = m1
        log_t = (lo + hi) / 2.0
        self.temperature = round(math.exp(log_t), 6)
        self.n_calibration = len(probs)
        self.fit_nll_after = self._nll(zs, ys, self.temperature)
        self.fitted = True
        return self

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "method": "temperature_scaling",
            "model": "huggingface/CodeBERTa-small-v1 fine-tune (crypto discovery)",
            "transform": "p_cal = sigmoid(logit(p_raw) / T)",
            "preserves_ranking": True,
            **asdict(self),
        }
        path.write_text(json.dumps(payload, indent=2))

    @classmethod
    def load(cls, path: str | Path) -> "TemperatureScaler":
        data = json.loads(Path(path).read_text())
        return cls(
            temperature=float(data["temperature"]),
            fitted=bool(data["fitted"]),
            n_calibration=int(data.get("n_calibration", 0)),
            fit_nll_before=data.get("fit_nll_before"),
            fit_nll_after=data.get("fit_nll_after"),
        )

    @staticmethod
    def _nll(zs: list[float], ys: list[float], t: float) -> float:
        total = 0.0
        for z, y in zip(zs, ys):
            p = _sigmoid(z / t)
            p = min(max(p, 1e-12), 1.0 - 1e-12)
            total += -(y * math.log(p) + (1.0 - y) * math.log(1.0 - p))
        return total / len(zs)


@dataclass
class PlattScaler:
    """Platt scaling: p_cal = sigmoid(a · logit(p_raw) + b).

    Monotone whenever a > 0 (fit constrains a > 0), so ranking is preserved.
    Unlike a single temperature it can correct *asymmetric* miscalibration
    (the detector's class-0 tail is far more under-confident than its
    class-1 tail).
    """

    a: float = 1.0
    b: float = 0.0
    fitted: bool = False
    n_calibration: int = 0

    def transform(self, prob: float) -> float:
        if not self.fitted:
            return prob
        return _sigmoid(self.a * _logit(prob) + self.b)

    def fit(self, probs: list[float], labels: list[int],
            max_iter: int = 300) -> "PlattScaler":
        """Deterministic gradient-free fit: coarse grid + ternary refinement
        over (log a, b), minimising NLL. a is constrained positive via
        log-parameterisation."""
        if len(probs) != len(labels) or not probs:
            raise ValueError("probs and labels must be non-empty, equal length")
        zs = [_logit(p) for p in probs]
        ys = [float(y) for y in labels]

        def nll_at(log_a: float, b: float) -> float:
            total = 0.0
            a = math.exp(log_a)
            for z, y in zip(zs, ys):
                p = _sigmoid(a * z + b)
                p = min(max(p, 1e-12), 1.0 - 1e-12)
                total += -(y * math.log(p) + (1.0 - y) * math.log(1.0 - p))
            return total / len(zs)

        # Coarse grid then coordinate-wise ternary refinement.
        best = (float("inf"), 0.0, 0.0)  # (nll, log_a, b)
        for la in [-2.0, -1.5, -1.0, -0.5, 0.0, 0.5]:
            for b in [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0]:
                v = nll_at(la, b)
                if v < best[0]:
                    best = (v, la, b)
        _, la, b = best
        for dim in range(2):  # refine log_a and b alternately
            for _ in range(max_iter):
                improved = False
                for delta in (0.1, 0.02, 0.004):
                    for sign in (-1, 1):
                        if dim == 0:
                            cand = nll_at(la + sign * delta, b)
                            if cand < best[0] - 1e-12:
                                best, la, improved = (cand, la + sign * delta, b), la + sign * delta, True
                        else:
                            cand = nll_at(la, b + sign * delta)
                            if cand < best[0] - 1e-12:
                                best, b, improved = (cand, la, b + sign * delta), b + sign * delta, True
                if not improved:
                    break
        self.a = round(math.exp(la), 6)
        self.b = round(b, 6)
        self.n_calibration = len(probs)
        self.fitted = True
        return self

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"method": "platt_scaling", "preserves_ranking": self.a > 0,
                   **asdict(self)}
        path.write_text(json.dumps(payload, indent=2))

    @classmethod
    def load(cls, path: str | Path) -> "PlattScaler":
        data = json.loads(Path(path).read_text())
        return cls(a=float(data["a"]), b=float(data["b"]),
                   fitted=bool(data["fitted"]),
                   n_calibration=int(data.get("n_calibration", 0)))


def load_shipped_calibrator(path: str | Path):
    """Load whichever calibrator family an artifact declares."""
    data = json.loads(Path(path).read_text())
    method = data.get("method")
    if method == "platt_scaling":
        return PlattScaler.load(path)
    if method == "temperature_scaling":
        return TemperatureScaler.load(path)
    raise ValueError(f"unknown calibration method {method!r} in {path}")


def apply_calibration(prob: float, artifact_path: str | Path) -> float:
    """Convenience: calibrate one probability if the artifact exists,
    otherwise return it unchanged (opt-in, fail-open to raw confidence)."""
    path = Path(artifact_path)
    if not path.exists():
        return prob
    return load_shipped_calibrator(path).transform(prob)


# ---------------------------------------------------------------------------
# Metrics (10-bin ECE + Brier, matching paper/analysis/codebert_eval.json)
# ---------------------------------------------------------------------------

def expected_calibration_error(probs: list[float], labels: list[int],
                               n_bins: int = 10,
                               threshold: float = 0.5) -> float:
    """Binned ECE in the same convention as ``scripts/paper_codebert_reeval.py``
    and ``paper/analysis/codebert_eval.json``: per equal-width bin,
    |mean confidence − accuracy of the hard prediction| weighted by bin mass.
    """
    preds = [1 if p >= threshold else 0 for p in probs]
    total = len(probs)
    ece = 0.0
    for i in range(n_bins):
        lo = i / n_bins
        hi = lo + 1.0 / n_bins
        members = [(p, y, yh) for p, y, yh in zip(probs, labels, preds)
                   if (p >= lo if i == 0 else p > lo) and (p < hi if i < n_bins - 1 else p <= hi)]
        if not members:
            continue
        conf = sum(p for p, _, _ in members) / len(members)
        acc = sum(1 for _, y, yh in members if y == yh) / len(members)
        ece += (len(members) / total) * abs(conf - acc)
    return ece


def brier_score(probs: list[float], labels: list[int]) -> float:
    return sum((p - y) ** 2 for p, y in zip(probs, labels)) / len(probs)


def cross_fitted_calibration(probs: list[float], labels: list[int],
                             n_folds: int = 5, seed: int = 42,
                             method: str = "platt") -> dict:
    """K-fold cross-fitted calibration: per fold, fit on the other folds and
    calibrate this fold; metrics are computed once on the full cross-fitted
    vector (no leakage, no lucky split). ``method`` selects the calibrator
    family ("temperature" or "platt")."""
    import random
    if method not in ("temperature", "platt"):
        raise ValueError(f"unknown calibrator {method!r}")
    idx = list(range(len(probs)))
    rng = random.Random(seed)
    rng.shuffle(idx)
    folds = [idx[i::n_folds] for i in range(n_folds)]
    calibrated = [0.0] * len(probs)
    params: list[dict] = []
    for k in range(n_folds):
        test = set(folds[k])
        tr_idx = [i for j in range(n_folds) if j != k for i in folds[j]]
        if method == "temperature":
            sc = TemperatureScaler().fit(
                [probs[i] for i in tr_idx], [labels[i] for i in tr_idx])
            params.append({"temperature": sc.temperature})
            for i in test:
                calibrated[i] = sc.transform(probs[i])
        else:
            sc = PlattScaler().fit(
                [probs[i] for i in tr_idx], [labels[i] for i in tr_idx])
            params.append({"a": sc.a, "b": sc.b})
            for i in test:
                calibrated[i] = sc.transform(probs[i])
    key = "temperature" if method == "temperature" else "a"
    return {
        "n": len(probs),
        "n_folds": n_folds,
        "method": method,
        "params_per_fold": params,
        f"{key}_mean": sum(p[key] for p in params) / len(params),
        "ece_10bin_before": expected_calibration_error(probs, labels),
        "ece_10bin_after": expected_calibration_error(calibrated, labels),
        "brier_before": brier_score(probs, labels),
        "brier_after": brier_score(calibrated, labels),
        "probs_calibrated": calibrated,
    }

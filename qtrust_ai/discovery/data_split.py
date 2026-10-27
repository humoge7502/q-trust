"""Stable, source-disjoint dataset splits for the crypto code detector.

The original split lived in ``scripts/train_qtrust_all._code_splits`` and
shuffled the *list of sources* with ``random.Random(seed).shuffle`` before
taking the tail 20 %. That is deterministic for a fixed corpus, but it is not
stable under corpus growth: adding one repository changes every later position
and can move a previously-held-out repository into training (and vice versa).
A checkpoint trained on the old split can therefore look better or worse for
reasons unrelated to the model.

This module assigns each repository an independent bucket with a keyed
SHA-256 digest. A source's bucket never changes when other sources are added,
so evaluation sets remain comparable across corpus versions. Buckets are
disjoint by construction and cover every source exactly once.

Buckets (``n_buckets=10`` by default):

* ``0`` and ``1``  -> evaluation (20 %)
* ``2``            -> calibration (10 % of the full corpus)
* ``3`` .. ``9``   -> fit (70 %)

The calibration bucket is carved out of the non-evaluation pool, so the final
test set is never used for temperature scaling or threshold selection.
"""
from __future__ import annotations

import hashlib
from typing import Any, Iterable, Mapping, Sequence


def source_bucket(source: str, seed: int = 42, n_buckets: int = 10) -> int:
    """Return a stable bucket in ``[0, n_buckets)`` for *source*.

    The digest is keyed by ``seed`` and the source string only. It does not
    depend on the corpus size, corpus order, or any global RNG state.
    """
    if n_buckets < 1:
        raise ValueError("n_buckets must be >= 1")
    key = f"qtrust-code-split-v1:{seed}:{source}".encode("utf-8")
    return int(hashlib.sha256(key).hexdigest()[:16], 16) % n_buckets


def split_corpus(
    corpus: Sequence[Mapping[str, Any]],
    seed: int = 42,
    eval_buckets: Iterable[int] = (0, 1),
    calibration_buckets: Iterable[int] = (2,),
    n_buckets: int = 10,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Split *corpus* into ``(fit, calibration, evaluation)`` by source.

    Every record from one source lands in exactly one split. An empty
    calibration list is valid when no source hashes into a calibration
    bucket (callers should then tune on a source-disjoint slice of *fit*).

    Raises:
        ValueError: if the bucket sets overlap or contain invalid indices.
    """
    eval_set = set(eval_buckets)
    cal_set = set(calibration_buckets)
    if eval_set & cal_set:
        raise ValueError("evaluation and calibration buckets must be disjoint")
    if not eval_set:
        raise ValueError("at least one evaluation bucket is required")
    for bucket in eval_set | cal_set:
        if bucket < 0 or bucket >= n_buckets:
            raise ValueError(f"bucket {bucket} outside [0, {n_buckets})")

    fit: list[dict] = []
    calibration: list[dict] = []
    evaluation: list[dict] = []
    for record in corpus:
        source = str(record.get("source", "unknown"))
        bucket = source_bucket(source, seed=seed, n_buckets=n_buckets)
        target = evaluation if bucket in eval_set else calibration if bucket in cal_set else fit
        target.append(dict(record))
    return fit, calibration, evaluation


def split_sources(
    corpus: Sequence[Mapping[str, Any]],
    seed: int = 42,
    eval_buckets: Iterable[int] = (0, 1),
    calibration_buckets: Iterable[int] = (2,),
    n_buckets: int = 10,
) -> dict[str, list[str]]:
    """Return the source lists for each split (useful for audits/logs)."""
    fit, calibration, evaluation = split_corpus(
        corpus,
        seed=seed,
        eval_buckets=eval_buckets,
        calibration_buckets=calibration_buckets,
        n_buckets=n_buckets,
    )
    return {
        "fit": sorted({str(r.get("source", "unknown")) for r in fit}),
        "calibration": sorted({str(r.get("source", "unknown")) for r in calibration}),
        "evaluation": sorted({str(r.get("source", "unknown")) for r in evaluation}),
    }

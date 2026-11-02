"""Unit tests for deterministic corpus de-duplication."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from qtrust_ai.discovery.corpus_hygiene import (  # noqa: E402
    POLICIES,
    content_digest,
    dedupe_records,
    dedupe_stats,
)


def record(path: str, code: str, *, crypto: bool, source: str = "org/repo") -> dict:
    return {
        "source": source,
        "path": path,
        "language": "python",
        "code": code,
        "is_crypto": crypto,
        "label": "SHA-256" if crypto else "NONE",
    }


def test_keep_first_and_keep_last_select_deterministically():
    records = [
        record("a.py", "short", crypto=False),
        record("a.py", "a longer body", crypto=True),
    ]
    first, _ = dedupe_records(records, "keep_first")
    last, _ = dedupe_records(records, "keep_last")
    assert first[0]["code"] == "short"
    assert last[0]["code"] == "a longer body"


def test_keep_longest_does_not_consult_the_label():
    records = [
        record("a.py", "a much longer non-crypto body", crypto=False),
        record("a.py", "crypto", crypto=True),
    ]
    kept, report = dedupe_records(records, "keep_longest")
    assert kept[0]["code"] == "a much longer non-crypto body"
    assert report["keys_with_conflicting_labels"] == 1
    assert report["keys_with_different_code"] == 1


def test_ties_keep_the_first_occurrence():
    records = [
        record("a.py", "same length", crypto=False),
        record("a.py", "other text!", crypto=True),
    ]
    kept, _ = dedupe_records(records, "keep_longest")
    assert kept[0]["is_crypto"] is False


def test_unique_content_keeps_real_revisions_but_drops_exact_copies():
    records = [
        record("a.py", "v1", crypto=False),
        record("a.py", "v1", crypto=False),
        record("a.py", "v2", crypto=True),
    ]
    kept, report = dedupe_records(records, "unique_content")
    assert len(kept) == 2
    assert report["raw_records"] == 3


def test_report_counts_are_exact():
    records = [
        record("a.py", "one", crypto=False),
        record("a.py", "two", crypto=True),
        record("b.py", "three", crypto=True),
        record("b.py", "three", crypto=True),
        record("c.py", "four", crypto=False),
    ]
    _, report = dedupe_records(records, "keep_longest")
    assert report["raw_records"] == 5
    assert report["unique_keys"] == 3
    assert report["duplicated_keys"] == 2
    assert report["extra_records"] == 2
    assert report["keys_with_different_code"] == 1
    assert report["keys_with_conflicting_labels"] == 1
    assert report["kept_records"] == 3
    assert report["dropped_records"] == 2


def test_inputs_are_not_mutated_and_order_is_preserved():
    records = [record("a.py", "one", crypto=False), record("b.py", "two", crypto=True)]
    snapshot = [dict(r) for r in records]
    kept, _ = dedupe_records(records, "keep_longest")
    assert records == snapshot
    assert [r["path"] for r in kept] == ["a.py", "b.py"]


def test_sources_are_part_of_the_identity():
    records = [
        record("a.py", "one", crypto=False, source="org/one"),
        record("a.py", "two", crypto=False, source="org/two"),
    ]
    kept, _ = dedupe_records(records, "keep_longest")
    assert len(kept) == 2


def test_unknown_policy_is_rejected():
    with pytest.raises(ValueError):
        dedupe_records([], "keep_whatever")


def test_every_declared_policy_runs_on_an_empty_corpus():
    for policy in POLICIES:
        kept, report = dedupe_records([], policy)
        assert kept == []
        assert report["kept_records"] == 0


def test_content_digest_is_stable_and_content_sensitive():
    assert content_digest("abc") == content_digest("abc")
    assert content_digest("abc") != content_digest("abd")


def test_dedupe_stats_exposes_only_the_report_fields():
    records = [record("a.py", "one", crypto=False), record("a.py", "two", crypto=True)]
    _, report = dedupe_records(records, "keep_longest")
    stats = dedupe_stats(report)
    assert stats["policy"] == "keep_longest"
    assert stats["dropped_records"] == 1
    assert "codes" not in stats

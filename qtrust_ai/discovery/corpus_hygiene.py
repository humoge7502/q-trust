"""Deterministic de-duplication for the code corpus.

The shipped corpora carry repeated ``(source, path)`` records: successive
builders copied earlier records forward unchanged, while some paths also
appear with different code (a re-fetched file) and, rarely, conflicting
crypto labels. Training on those records silently overweights them; evaluating
on them weights one file more than once and can score the same path as both
crypto and non-crypto.

This module is deliberately independent of any model or split code so the
same policy can be applied at corpus-build time, at training time, and when
re-scoring a held-out set.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

POLICIES = ("keep_first", "keep_last", "keep_longest", "unique_content")


def content_digest(code: str) -> str:
    """Content identity for de-duplication (SHA-256, not a security claim)."""
    return hashlib.sha256(code.encode("utf-8", errors="replace")).hexdigest()


def _record_key(record: Mapping[str, Any]) -> tuple[str, str]:
    return (str(record.get("source", "unknown")), str(record.get("path", "")))


def dedupe_records(
    records: Sequence[Mapping[str, Any]],
    policy: str = "keep_longest",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return ``(kept, report)`` for one record per ``(source, path)``.

    ``keep_longest`` selects the most complete copy of a path without
    consulting its label, which avoids selecting on the target. Ties keep the
    first occurrence. ``unique_content`` instead de-duplicates on
    ``(source, path, content)`` and therefore preserves genuinely different
    revisions of one path.

    The input is never mutated and record order is preserved.
    """
    if policy not in POLICIES:
        raise ValueError(f"unknown policy {policy!r}; expected one of {POLICIES}")

    rows = [dict(r) for r in records]
    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, record in enumerate(rows):
        groups[_record_key(record)].append(index)
    duplicated = {key: indexes for key, indexes in groups.items() if len(indexes) > 1}

    def has_conflicting_labels(indexes: Iterable[int]) -> bool:
        return len({bool(rows[i].get("is_crypto")) for i in indexes}) > 1

    def has_different_code(indexes: Iterable[int]) -> bool:
        return len({content_digest(str(rows[i].get("code", ""))) for i in indexes}) > 1

    report: dict[str, Any] = {
        "policy": policy,
        "raw_records": len(rows),
        "unique_keys": len(groups),
        "duplicated_keys": len(duplicated),
        "extra_records": len(rows) - len(groups),
        "keys_with_different_code": sum(
            1 for indexes in duplicated.values() if has_different_code(indexes)
        ),
        "keys_with_conflicting_labels": sum(
            1 for indexes in duplicated.values() if has_conflicting_labels(indexes)
        ),
    }

    if policy == "unique_content":
        seen: set[tuple[str, str, str]] = set()
        kept_indexes: list[int] = []
        for index, record in enumerate(rows):
            key = (*_record_key(record), content_digest(str(record.get("code", ""))))
            if key not in seen:
                seen.add(key)
                kept_indexes.append(index)
    else:
        chosen: dict[tuple[str, str], int] = {}
        for key, indexes in groups.items():
            if policy == "keep_last":
                chosen[key] = indexes[-1]
            elif policy == "keep_longest":
                chosen[key] = max(
                    indexes,
                    key=lambda i: (len(str(rows[i].get("code", ""))), -i),
                )
            else:
                chosen[key] = indexes[0]
        kept_indexes = sorted(chosen.values())

    kept = [rows[i] for i in kept_indexes]
    report["kept_records"] = len(kept)
    report["dropped_records"] = len(rows) - len(kept)
    return kept, report


def dedupe_stats(report: Mapping[str, Any]) -> dict[str, Any]:
    """Project a report into the subset suitable for a corpus ``stats`` block."""
    return {
        key: report[key]
        for key in (
            "policy",
            "raw_records",
            "unique_keys",
            "duplicated_keys",
            "extra_records",
            "keys_with_different_code",
            "keys_with_conflicting_labels",
            "kept_records",
            "dropped_records",
        )
    }

#!/usr/bin/env python3
"""Build a de-duplicated copy of a code corpus.

Keeps one record per ``(source, path)`` (default: the longest copy, selected
without consulting the label) and records the dropped duplicates in a
``stats.hygiene`` block. The input file is never modified.

Run:
    python scripts/dedupe_code_corpus.py
    python scripts/dedupe_code_corpus.py --input <v5.json> --output <v5-dedup.json>
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

DATASETS = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets")


def build_stats(records: list[dict], original: dict, hygiene: dict) -> dict:
    by_language: dict[str, dict[str, int]] = collections.defaultdict(
        lambda: {"files": 0, "crypto": 0}
    )
    for record in records:
        bucket = by_language[str(record.get("language", "unknown"))]
        bucket["files"] += 1
        bucket["crypto"] += int(bool(record.get("is_crypto")))
    stats = dict(original)
    stats.update(
        {
            "total_files": len(records),
            "crypto": sum(1 for r in records if r.get("is_crypto")),
            "non_crypto": sum(1 for r in records if not r.get("is_crypto")),
            "sources": len({str(r.get("source", "unknown")) for r in records}),
            "by_language": dict(sorted(by_language.items())),
            "hygiene": hygiene,
        }
    )
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(DATASETS / "code_corpus_v4.json"))
    parser.add_argument("--output", default="")
    parser.add_argument(
        "--policy",
        default="keep_longest",
        choices=("keep_first", "keep_last", "keep_longest", "unique_content"),
    )
    args = parser.parse_args()

    from qtrust_ai.discovery.corpus_hygiene import dedupe_records, dedupe_stats

    source = Path(args.input)
    destination = Path(args.output) if args.output else source.with_name(
        f"{source.stem}_dedup{source.suffix}"
    )
    if destination.resolve() == source.resolve():
        raise SystemExit("refusing to overwrite the input corpus")

    payload = json.loads(source.read_text(encoding="utf-8"))
    records = payload["corpus"]
    kept, report = dedupe_records(records, args.policy)
    output = {
        "type": payload.get("type", "code_corpus"),
        "version": f"{payload.get('version', '?')}-dedup",
        "corpus": kept,
        "stats": build_stats(kept, payload.get("stats", {}), dedupe_stats(report)),
    }
    destination.write_text(json.dumps(output, ensure_ascii=False), encoding="utf-8")
    print(
        f"{source.name}: {report['raw_records']} -> {len(kept)} records "
        f"({report['duplicated_keys']} duplicated keys, {report['extra_records']} extra, "
        f"{report['keys_with_conflicting_labels']} label conflicts) "
        f"[{args.policy}]"
    )
    print(f"wrote {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

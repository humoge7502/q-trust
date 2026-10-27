#!/usr/bin/env python3
"""Reviewed-label pilot harness — the repo's label-flywheel entry point.

Why this exists: E-14c/E-17/E-18 exhausted the other levers (more data, more
epochs, larger base model) — the binding constraint on detector F1 is regex-
derived label noise (E-15's residual conflicting-label keys). Real gains need
human-reviewed labels. This tool makes that review process auditable and
private-by-default, consistent with the repo's honesty conventions:

- The review QUEUE carries no code. Entries reference corpus files by hash and
  path only; snippets are shown locally on demand (`show`) and never leave
  the machine with the corpus.
- Dual annotation is enforced by `merge`: a label becomes "reviewed" only when
  two independent reviewer votes agree. Disagreements are quarantined, never
  silently resolved. Inter-annotator agreement is reported as Cohen's kappa.
- Output is a training/eval-ready JSONL of reviewed labels plus a stats block,
  so the E-series log can cite exact agreement numbers for any reviewed set.

Usage:
  python scripts/label_review_pilot.py sample \
      --corpus ../q-trust-datasets/code_corpus_v4.json --n 500 \
      --out review_queue.jsonl [--seed 42] [--predictions preds.jsonl]
  python scripts/label_review_pilot.py show --queue review_queue.jsonl \
      --corpus ../q-trust-datasets/code_corpus_v4.json --id <sample_id>
  python scripts/label_review_pilot.py record --queue review_queue.jsonl \
      --id <sample_id> --reviewer alice --label crypto|not_crypto
  python scripts/label_review_pilot.py merge --queue review_queue.jsonl \
      --out reviewed_labels.jsonl
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random  # seeded sampling RNG — reproducibility, not a secrets source
from collections import Counter, defaultdict
from pathlib import Path

QUEUE_VERSION = "label-review-queue/1.0"
REVIEWED_LABELS_VERSION = "reviewed-labels/1.0"


def _snippet_key(code: str) -> str:
    """Whitespace-normalized snippet key (mirrors the dedup reports' notion
    loosely — stable within this tool, which is what the pilot needs)."""
    return hashlib.sha256(" ".join(code.split()).encode("utf-8")).hexdigest()


def _sample_id(entry: dict) -> str:
    raw = f"{entry['source']}\x00{entry['path']}\x00{entry['snippet_sha256']}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def load_corpus(path: Path) -> list[dict]:
    corpus = json.loads(path.read_text(encoding="utf-8"))
    files = corpus.get("corpus") if isinstance(corpus, dict) else corpus
    if not files:
        raise SystemExit(f"corpus at {path} has no entries")
    return files


def cmd_sample(args: argparse.Namespace) -> None:
    files = load_corpus(Path(args.corpus))

    # Priority 1: conflicting-label keys (the known noise hot-spots).
    by_key: dict[str, list[dict]] = defaultdict(list)
    for e in files:
        by_key[_snippet_key(e["code"])].append(e)
    conflict_idx = [
        i for i, e in enumerate(files)
        if len({x["is_crypto"] for x in by_key[_snippet_key(e["code"])]}) > 1
    ]

    # Priority 2: model boundary cases (when predictions are supplied).
    boundary_idx: list[int] = []
    if args.predictions:
        preds = {}
        pred_path = Path(args.predictions)
        for line in pred_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            p = json.loads(line)
            preds[(p.get("source", ""), p.get("path", ""))] = p
        for i, e in enumerate(files):
            p = preds.get((e["source"], e["path"]))
            if p is not None:
                conf = p.get("confidence", p.get("prob", 0.5))
                if isinstance(conf, (int, float)) and abs(conf - 0.5) < 0.15:
                    boundary_idx.append(i)

    rng = random.Random(args.seed)
    taken = set(conflict_idx) | set(boundary_idx)
    remaining = [i for i in range(len(files)) if i not in taken]
    rng.shuffle(remaining)

    by_lang: dict[str, list[int]] = defaultdict(list)
    for i in remaining:
        by_lang[files[i]["language"]].append(i)

    n = min(args.n, len(files))
    quota_total = len(conflict_idx) + len(boundary_idx)
    langs = sorted(by_lang, key=lambda lang: -len(by_lang[lang]))
    selected: list[int] = []
    if quota_total < n:
        selected = list(conflict_idx) + list(boundary_idx)[: n - len(conflict_idx)]
        left = n - len(selected)
        per = left // max(len(langs), 1)
        for j, lang in enumerate(langs):
            take = per + (1 if j < left - per * len(langs) else 0)
            selected += by_lang[lang][:take]
    else:
        selected = list(conflict_idx)[:n]

    entries = []
    for i in selected:
        e = files[i]
        entry = {
            "queue_version": QUEUE_VERSION,
            "sample_id": None,
            "source": e["source"],
            "path": e["path"],
            "language": e["language"],
            "corpus_label": int(bool(e["is_crypto"])),
            "taxonomy_label": e.get("label"),
            "snippet_sha256": _snippet_key(e["code"]),
            "priority": "label-conflict" if i in set(conflict_idx)
            else ("model-boundary" if i in set(boundary_idx) else "stratified"),
            "review_status": "pending",
            "votes": {},
        }
        entry["sample_id"] = _sample_id(entry)
        entries.append(entry)

    out = Path(args.out)
    with out.open("w", encoding="utf-8", newline="\n") as fh:
        for entry in entries:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    counts = Counter(e["priority"] for e in entries)
    print(f"queue: {len(entries)} entries -> {out} "
          f"(priority mix: {dict(counts)})")


def cmd_show(args: argparse.Namespace) -> None:
    files = load_corpus(Path(args.corpus))
    want = _find_entry(Path(args.queue), args.id)
    by_key = defaultdict(list)
    for e in files:
        by_key[_snippet_key(e["code"])].append(e)
    matches = by_key.get(want["snippet_sha256"], [])
    if not matches:
        raise SystemExit("snippet not found in corpus (queue/corpus mismatch?)")
    m = matches[0]
    print(f"--- {m['source']} :: {m['path']} [{m['language']}] "
          f"regex label is_crypto={m['is_crypto']} ---")
    print(m["code"][: args.max_chars])
    if len(m["code"]) > args.max_chars:
        print(f"... ({len(m['code']) - args.max_chars} chars truncated)")


def _read_queue(path: Path) -> list[dict]:
    return [json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()]


def _write_queue(path: Path, entries: list[dict]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as fh:
        for e in entries:
            fh.write(json.dumps(e, ensure_ascii=False) + "\n")
    tmp.replace(path)


def _find_entry(queue_path: Path, sample_id: str) -> dict:
    for e in _read_queue(queue_path):
        if e["sample_id"] == sample_id:
            return e
    raise SystemExit(f"sample_id {sample_id} not in queue")


def cmd_record(args: argparse.Namespace) -> None:
    if args.label not in ("crypto", "not_crypto"):
        raise SystemExit("--label must be 'crypto' or 'not_crypto'")
    queue_path = Path(args.queue)
    entries = _read_queue(queue_path)
    votes = 0
    for e in entries:
        if e["sample_id"] != args.id:
            continue
        e["votes"][args.reviewer] = 1 if args.label == "crypto" else 0
        e["review_status"] = (
            "reviewed" if len(set(e["votes"].values())) == 1 and len(e["votes"]) >= 2
            else "disagreed" if len(e["votes"]) >= 2 else "single-vote")
        votes += 1
    if not votes:
        raise SystemExit(f"sample_id {args.id} not in queue")
    _write_queue(queue_path, entries)
    print(f"recorded {args.reviewer}'s vote on {args.id} ({votes} entry)")


def _kappa(pairs: list[tuple[int, int]]) -> float | None:
    """Cohen's kappa for two raters over binary labels."""
    n = len(pairs)
    if n == 0:
        return None
    po = sum(1 for a, b in pairs if a == b) / n
    pa = sum(1 for a, _ in pairs if a == 1) / n
    pb = sum(1 for _, b in pairs if b == 1) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    if pe == 1:
        return 1.0
    return (po - pe) / (1 - pe)


def cmd_merge(args: argparse.Namespace) -> None:
    entries = _read_queue(Path(args.queue))
    by_id: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        by_id[e["sample_id"]].append(e)

    reviewed, quarantined = [], []
    pairs: list[tuple[int, int]] = []
    for sid, group in by_id.items():
        e = group[0]
        labels = list(e["votes"].values())
        if len(labels) >= 2:
            pairs.append((labels[0], labels[1]))
            if len(set(labels)) == 1:
                reviewed.append({
                    "version": REVIEWED_LABELS_VERSION,
                    "sample_id": sid,
                    "source": e["source"],
                    "path": e["path"],
                    "language": e["language"],
                    "label": labels[0],
                    "regex_label": e["corpus_label"],
                    "agree_with_regex": labels[0] == e["corpus_label"],
                    "reviewers": sorted(e["votes"]),
                    "priority": e["priority"],
                })
            else:
                quarantined.append({"sample_id": sid, "source": e["source"],
                                    "path": e["path"],
                                    "votes": e["votes"]})

    kappa = _kappa(pairs)
    stats = {
        "version": REVIEWED_LABELS_VERSION,
        "queue_entries": len(entries),
        "dual_annotated": len(pairs),
        "agreed": len(reviewed),
        "disagreed_quarantined": len(quarantined),
        "pending": len(entries) - len(pairs),
        "kappa": round(kappa, 4) if kappa is not None else None,
        "regex_label_flips": sum(1 for r in reviewed if not r["agree_with_regex"]),
    }
    out = Path(args.out)
    with out.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(stats, ensure_ascii=False) + "\n")
        for r in reviewed:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps(stats, indent=2))
    print(f"reviewed labels -> {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("sample")
    p.add_argument("--corpus", required=True)
    p.add_argument("--n", type=int, default=500)
    p.add_argument("--out", required=True)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--predictions", help="detector predictions JSONL for "
                                         "model-boundary prioritization")
    p.set_defaults(func=cmd_sample)

    p = sub.add_parser("show")
    p.add_argument("--queue", required=True)
    p.add_argument("--corpus", required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--max-chars", type=int, default=4000)
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("record")
    p.add_argument("--queue", required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--reviewer", required=True)
    p.add_argument("--label", required=True)
    p.set_defaults(func=cmd_record)

    p = sub.add_parser("merge")
    p.add_argument("--queue", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_merge)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

"""Near-duplicate audit for the repo-disjoint code split.

Protocol (unchanged from the paper audit): 5-line shingles over lines of at
least 12 characters, maximum Jaccard similarity against any *training* file.

By default this reproduces the historical v1 audit into
``paper/analysis/near_dup_full.json``. Pass ``--corpus-version 4 --stable`` to
audit the v4 corpus on the keyed, growth-stable source split used by
``scripts/train_discovery_stable.py``; the result is written to
``paper/analysis/near_dup_v4_stable.json`` so the historical artifact is never
overwritten.

The near-duplicate rate matters because a repo-disjoint split prevents exact
source leakage but not copied implementations (tiny-AES, public-domain SHA
code, vendored PQClean modules). A model that scores highly only on copied
files has not demonstrated generalisation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(r"C:\Users\Devesh tiwari\q-trust-projects")
DATASETS = ROOT / "q-trust-datasets"
REPO = ROOT / "q-trust"
OUT = REPO / "paper" / "analysis"
OUT.mkdir(parents=True, exist_ok=True)
K = 5
MIN_LINE = 12

CORPORA = {
    1: DATASETS / "code_corpus.json",
    2: DATASETS / "code_corpus_v2.json",
    3: DATASETS / "code_corpus_v3.json",
    4: DATASETS / "code_corpus_v4.json",
}


def legacy_split(corpus, seed=42):
    """Historical split (kept only to reproduce the stored v1 artifact)."""
    srcs = sorted({c.get("source", "unknown") for c in corpus})
    rnd = random.Random(seed)
    rnd.shuffle(srcs)
    n = max(1, int(len(srcs) * 0.8))
    tr, ev = set(srcs[:n]), set(srcs[n:])
    return (
        [c for c in corpus if c.get("source") in tr],
        [c for c in corpus if c.get("source") in ev],
    )


def stable_split(corpus, seed=42):
    """Stable keyed SHA-256 source split (the current training protocol)."""
    sys.path.insert(0, str(REPO))
    from qtrust_ai.discovery.data_split import split_corpus

    fit, _cal, ev = split_corpus(
        corpus, seed=seed, eval_buckets=(0, 1), calibration_buckets=()
    )
    return fit, ev


def shingles(code: str) -> set[bytes]:
    lines = [line.strip() for line in (code or "").splitlines()]
    lines = [line for line in lines if len(line) >= MIN_LINE]
    if len(lines) < K:
        return set()
    out: set[bytes] = set()
    for i in range(len(lines) - K + 1):
        out.add(
            hashlib.blake2b(
                "\n".join(lines[i : i + K]).encode("utf-8", "ignore"),
                digest_size=8,
            ).digest()
        )
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-version", type=int, choices=sorted(CORPORA), default=1)
    parser.add_argument("--stable", action="store_true",
                        help="use the keyed stable split instead of the legacy shuffle")
    parser.add_argument("--out", default=None,
                        help="output JSON path (default depends on protocol)")
    args = parser.parse_args()

    corpus_path = CORPORA[args.corpus_version]
    if not corpus_path.exists():
        raise SystemExit(f"corpus not found: {corpus_path}")
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))["corpus"]
    train, ev = (stable_split(corpus) if args.stable else legacy_split(corpus))
    print(f"corpus v{args.corpus_version}: split train={len(train)} eval={len(ev)}", flush=True)

    tr_sh = [shingles(c.get("code", "")) for c in train]
    index: dict[bytes, list[int]] = defaultdict(list)
    for i, shingle_set in enumerate(tr_sh):
        for h in shingle_set:
            index[h].append(i)

    rows = []
    for c in ev:
        s = shingles(c.get("code", ""))
        best, best_id = 0.0, None
        if s:
            candidates: Counter[int] = Counter()
            for h in s:
                for j in index.get(h, ()):
                    candidates[j] += 1
            for j, overlap in candidates.items():
                t = tr_sh[j]
                jaccard = overlap / (len(s) + len(t) - overlap)
                if jaccard > best:
                    best, best_id = jaccard, j
        rows.append({
            "key": c.get("source", "unknown") + "::" + c.get("path", ""),
            "source": c.get("source", "unknown"),
            "max_jaccard": round(float(best), 4),
            "nearest_train_key": (
                train[best_id]["source"] + "::" + train[best_id]["path"]
                if best_id is not None else None
            ),
        })

    vals = sorted(row["max_jaccard"] for row in rows)
    def pct(q: float) -> float:
        return vals[min(len(vals) - 1, int(q * len(vals)))] if vals else 0.0

    counts = {
        str(t): sum(1 for v in vals if v >= t)
        for t in (0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0)
    }
    keys = {
        t: sorted(row["key"] for row in rows if row["max_jaccard"] >= t)
        for t in (0.8, 0.95)
    }
    out = {
        "method": (
            f"{K}-line shingles (lines >= {MIN_LINE} chars), max Jaccard vs any "
            f"training file; "
            + ("keyed stable SHA-256 source buckets, seed 42"
               if args.stable else "legacy shuffled source split, seed 42")
        ),
        "corpus_version": args.corpus_version,
        "stable_split": args.stable,
        "n_eval": len(rows),
        "n_train": len(train),
        "counts": counts,
        "median": pct(0.5),
        "p90": pct(0.9),
        "p99": pct(0.99),
        "max": vals[-1] if vals else 0.0,
        "high_sim_keys_0.8": keys[0.8],
        "high_sim_keys_0.95": keys[0.95],
        "rows": rows,
    }
    if args.out:
        out_path = Path(args.out)
    elif args.stable:
        out_path = OUT / f"near_dup_v{args.corpus_version}_stable.json"
    else:
        out_path = OUT / "near_dup_full.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({k: out[k] for k in ("counts", "median", "p90", "p99", "max")}, indent=1))
    print(f"keys>=0.8: {len(keys[0.8])} | keys>=0.95: {len(keys[0.95])}")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

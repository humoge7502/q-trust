"""End-to-end tests for the reviewed-label pilot harness (scripts/).

Runs the CLI against a tiny synthetic corpus: sampling priorities (conflicts
first), hash-only queue (no code in the queue file), dual-annotation gating,
quarantine on disagreement, and Cohen's kappa on the merge stats.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "label_review_pilot.py"


def _run(*argv: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPT), *argv],
                          capture_output=True, text=True, check=True)


@pytest.fixture()
def corpus_file(tmp_path: Path) -> Path:
    # 6 entries: one conflicting-label key pair (same code, labels differ),
    # plus four singletons across several languages.
    shared = "def aes_encrypt(k, m):\n    return AES.new(k).encrypt(m)\n"
    entries = [
        {"code": shared, "language": "python", "label": "SYMMETRIC",
         "is_crypto": True, "source": "a/repo", "path": "enc.py"},
        {"code": shared, "language": "python", "label": "MISC",
         "is_crypto": False, "source": "b/repo", "path": "vendored.py"},
        {"code": "console.log('hello')", "language": "javascript",
         "label": "MISC", "is_crypto": False, "source": "c/repo", "path": "a.js"},
        {"code": "package main\nfunc main() {}\n", "language": "go",
         "label": "MISC", "is_crypto": False, "source": "d/repo", "path": "m.go"},
        {"code": "from Crypto.Cipher import AES\n", "language": "python",
         "label": "SYMMETRIC", "is_crypto": True, "source": "e/repo",
         "path": "c.py"},
        {"code": "SELECT 1;\n", "language": "sql", "label": "MISC",
         "is_crypto": False, "source": "f/repo", "path": "q.sql"},
    ]
    p = tmp_path / "corpus.json"
    p.write_text(json.dumps({"type": "code_corpus", "version": "4",
                             "corpus": entries}), encoding="utf-8")
    return p


def test_sample_prioritizes_conflicts_and_queue_is_hash_only(
        corpus_file: Path, tmp_path: Path) -> None:
    queue = tmp_path / "queue.jsonl"
    res = _run("sample", "--corpus", str(corpus_file), "--n", "5",
               "--out", str(queue), "--seed", "1")
    assert res.returncode == 0
    entries = [json.loads(line) for line in queue.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(entries) == 5
    # The conflicting-key pair must be in the queue and marked as such.
    conflicts = [e for e in entries if e["priority"] == "label-conflict"]
    assert len(conflicts) == 2
    assert {e["source"] for e in conflicts} == {"a/repo", "b/repo"}
    # Privacy: no code content in the queue.
    assert "AES.new" not in queue.read_text(encoding="utf-8")
    for e in entries:
        assert len(e["snippet_sha256"]) == 64
        assert e["review_status"] == "pending"


def test_dual_annotation_gates_and_kappa(corpus_file: Path, tmp_path: Path) -> None:
    queue = tmp_path / "queue.jsonl"
    _run("sample", "--corpus", str(corpus_file), "--n", "2",
         "--out", str(queue), "--seed", "1")
    entries = [json.loads(line) for line in queue.read_text(encoding="utf-8").splitlines() if line.strip()]
    sid_ok, sid_bad = entries[0]["sample_id"], entries[1]["sample_id"]

    # Two agreeing reviewers -> reviewed.
    _run("record", "--queue", str(queue), "--id", sid_ok,
         "--reviewer", "alice", "--label", "crypto")
    _run("record", "--queue", str(queue), "--id", sid_ok,
         "--reviewer", "bob", "--label", "crypto")
    # Two disagreeing reviewers -> quarantined.
    _run("record", "--queue", str(queue), "--id", sid_bad,
         "--reviewer", "alice", "--label", "crypto")
    _run("record", "--queue", str(queue), "--id", sid_bad,
         "--reviewer", "bob", "--label", "not_crypto")

    out = tmp_path / "reviewed.jsonl"
    _run("merge", "--queue", str(queue), "--out", str(out))
    lines = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines() if line.strip()]
    stats, labels = lines[0], lines[1:]
    assert stats["dual_annotated"] == 2
    assert stats["agreed"] == 1
    assert stats["disagreed_quarantined"] == 1
    # One full disagreement + one agreement over two raters → kappa 0.0.
    assert stats["kappa"] == 0.0
    assert len(labels) == 1
    assert labels[0]["label"] == 1
    assert labels[0]["reviewers"] == ["alice", "bob"]


def test_kappa_handles_full_agreement(corpus_file: Path, tmp_path: Path) -> None:
    queue = tmp_path / "queue.jsonl"
    _run("sample", "--corpus", str(corpus_file), "--n", "1",
         "--out", str(queue), "--seed", "1")
    entries = [json.loads(line) for line in queue.read_text(encoding="utf-8").splitlines() if line.strip()]
    sid = entries[0]["sample_id"]
    _run("record", "--queue", str(queue), "--id", sid, "--reviewer", "a", "--label", "crypto")
    _run("record", "--queue", str(queue), "--id", sid, "--reviewer", "b", "--label", "crypto")
    out = tmp_path / "reviewed.jsonl"
    _run("merge", "--queue", str(queue), "--out", str(out))
    stats = json.loads(out.read_text(encoding="utf-8").splitlines()[0])
    assert stats["kappa"] == 1.0
    assert stats["pending"] == 0

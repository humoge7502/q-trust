#!/usr/bin/env python3
"""Expand the discovery code corpus with genuinely NEW sources (v2).

The shipped corpus (``qtrust-datasets/code_corpus.json``, 13,973 files /
39 sources) trains and evaluates the crypto CodeBERTa detector. This script
adds new GitHub sources that are **not** among the existing 39 — chosen for
label diversity (a PQC-aware crypto framework in two languages, an OpenSSL
wrapper with different usage patterns than pyca/cryptography, an SSH
implementation, and a large non-crypto negative control):

    tink-crypto/tink-java   (Java, crypto framework)
    tink-crypto/tink-cc     (C++, crypto framework)
    pyca/pyopenssl          (Python, OpenSSL wrapper)
    lukewender?  — no: libssh/flatcap not needed; using **libssh/ssh**
                           via mirror "libssh/libssh-mirror" is unstable, so
                           the SSH implementation is pulled from the official
                           **GitLab-hosted** mirror is out of scope; instead:
    redis/redis             (C, negative control — almost no crypto)

Deliberately **excluded**: CryptoAPI-Bench and ApacheCryptoAPI-Bench — they
are the external *evaluation* sets for ``benchmarks/external/HEAD-TO-HEAD.md``;
folding them into training would make that head-to-head in-sample (metric
integrity).

Labeling: same transparent policy as the corpus — content-based keyword
rules (the inspector's static crypto patterns, applied per file). Label
taxonomy maps to the corpus' coarse labels (LIB / RSA/ECC / HASH / AES /
PQC / CERT / NONE). The original corpus file is NEVER modified; the result
is written to a new ``code_corpus_v2.json`` plus a provenance manifest.

Usage:
    python scripts/expand_code_corpus.py            # fetch + build v2
    python scripts/expand_code_corpus.py --max-per-source 150
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATASETS = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets")
CORPUS_V1 = DATASETS / "code_corpus.json"
CORPUS_V2 = DATASETS / "code_corpus_v2.json"

NEW_SOURCES = [
    # (github repo, default branch, path filter(s) or None, max files)
    ("tink-crypto/tink-java", "main", ["src/main/java"], 250),
    ("tink-crypto/tink-cc", "main", ["tink", "examples"], 200),
    ("pyca/pyopenssl", "main", ["src", "tests"], 120),
    ("redis/redis", "unstable", ["src"], 250),
]

LANG_BY_EXT = {
    ".java": "java", ".cc": "cpp", ".cpp": "cpp", ".c": "c", ".h": "c",
    ".hpp": "cpp", ".py": "python", ".pyx": "python",
}

# Transparent keyword labeling (coarse, mirrors the corpus taxonomy).
LABEL_RULES: list[tuple[str, re.Pattern]] = [
    ("PQC", re.compile(r"\b(ML[- ]?KEM|ML[- ]?DSA|SLH[- ]?DSA|Kyber|Dilithium|SPHINCS|Falcon|HQC)\b", re.I)),
    ("RSA/ECC", re.compile(r"\b(RSA|ECDSA|ECDH|Ed25519|X25519|secp256r1|P-256|elliptic)\b", re.I)),
    ("CERT", re.compile(r"\bx509\b|certificate|X509_", re.I)),
    ("HASH", re.compile(r"\b(SHA[- ]?(1|256|384|512)|SHA3|MD5|blake2|blake3|hmac)\b", re.I)),
    ("AES", re.compile(r"\b(AES|GCM|CBC|CTR|chacha20?|poly1305)\b", re.I)),
    ("LIB", re.compile(r"\b(openssl|libsodium|boringssl|wolfssl|botan|libcrypto|EVP_|crypto_\w+)\b", re.I)),
]


def label_code(code: str) -> tuple[bool, str]:
    for label, pat in LABEL_RULES:
        if pat.search(code):
            return True, label
    return False, "NONE"


def fetch_repo_zip(repo: str, branch: str) -> bytes:
    url = f"https://codeload.github.com/{repo}/zip/refs/heads/{branch}"
    req = urllib.request.Request(url, headers={"User-Agent": "qtrust-corpus-builder"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def records_from_zip(repo: str, blob: bytes, path_filters, max_files: int):
    recs = []
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = [n for n in zf.namelist()
                 if not n.endswith("/")
                 and "__MACOSX" not in n
                 and "/test-fixtures/" not in n]
        # deterministic order
        for name in sorted(names):
            if len(recs) >= max_files:
                break
            rel = name.split("/", 1)[1] if "/" in name else name
            if path_filters and not any(rel.startswith(f) for f in path_filters):
                continue
            ext = Path(rel).suffix.lower()
            lang = LANG_BY_EXT.get(ext)
            if not lang or lang in ("python",) and ext == ".pyx":
                continue
            try:
                code = zf.read(name).decode("utf-8", errors="ignore")
            except Exception:
                continue
            if not code.strip() or len(code) > 400_000:
                continue
            is_crypto, label = label_code(code)
            recs.append({
                "code": code, "language": lang, "label": label,
                "is_crypto": is_crypto, "source": repo, "path": rel,
            })
    return recs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-per-source", type=int, default=None,
                    help="override the per-source file cap")
    args = ap.parse_args()

    if not CORPUS_V1.exists():
        print(f"corpus v1 not found: {CORPUS_V1}", file=sys.stderr)
        return 1
    v1 = json.loads(CORPUS_V1.read_text(encoding="utf-8"))
    corpus = list(v1["corpus"])
    existing_sources = {r["source"] for r in corpus}
    print(f"v1: {len(corpus)} files, {len(existing_sources)} sources")

    added = []
    for repo, branch, filters, cap in NEW_SOURCES:
        if repo in existing_sources:
            print(f"  skip {repo} (already present)")
            continue
        cap = args.max_per_source or cap
        t0 = time.time()
        try:
            blob = fetch_repo_zip(repo, branch)
        except Exception as exc:
            print(f"  FAIL {repo}: {exc}")
            continue
        recs = records_from_zip(repo, blob, filters, cap)
        n_pos = sum(1 for r in recs if r["is_crypto"])
        added.append((repo, len(recs), n_pos))
        corpus.extend(recs)
        print(f"  + {repo:28s} {len(recs):4d} files ({n_pos:4d} crypto) "
              f"{time.time()-t0:.1f}s")

    by_lang: dict[str, dict] = {}
    for r in corpus:
        s = by_lang.setdefault(r["language"], {"files": 0, "crypto": 0})
        s["files"] += 1
        s["crypto"] += int(bool(r["is_crypto"]))

    v2 = {
        "type": "code_corpus",
        "version": "2",
        "corpus": corpus,
        "stats": {
            "total_files": len(corpus),
            "crypto": sum(1 for r in corpus if r["is_crypto"]),
            "non_crypto": sum(1 for r in corpus if not r["is_crypto"]),
            "sources": len({r["source"] for r in corpus}),
            "by_language": by_lang,
            "v1_baseline": {
                "total_files": len(v1["corpus"]),
                "sources": len(existing_sources),
            },
            "expansion": {
                "added_sources": [a[0] for a in added],
                "added_files": sum(a[1] for a in added),
                "added_crypto": sum(a[2] for a in added),
                "labeling": "transparent keyword rules (see script docstring)",
                "excluded": ("CryptoAPI-Bench + ApacheCryptoAPI-Bench kept "
                             "evaluation-only to protect HEAD-TO-HEAD.md "
                             "metric integrity"),
            },
        },
    }
    CORPUS_V2.write_text(json.dumps(v2), encoding="utf-8")
    print(f"\nv2: {len(corpus)} files, {v2['stats']['sources']} sources; "
          f"wrote {CORPUS_V2}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

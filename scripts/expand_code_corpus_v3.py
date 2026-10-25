#!/usr/bin/env python3
"""Corpus v3 expansion — eight NEW sources beyond v2's 42.

Chosen for label/language diversity absent from v1+v2 (verified against the
existing source list): mbedtls (C TLS — the only major TLS library missing),
golang/crypto (Go stdlib-adjacent x/crypto), ziglang/zig std.crypto (NEW
language), RustCrypto/hashes (NEW language), spring-security (Java framework
crypto usage), next-auth (modern web crypto: jose/WebAuthn), django (Python
negative control), git (C hash-usage middle ground).

Labeling: the same transparent keyword rules as expand_code_corpus.py.
Excluded still: CryptoAPI-Bench / ApacheCryptoAPI-Bench (E-08 evaluation-only).
Output: qtrust-datasets/code_corpus_v3.json (v2 untouched; provenance in stats).
"""
from __future__ import annotations

import io
import json
import re
import time
import urllib.request
import zipfile
from pathlib import Path

DATASETS = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets")
CORPUS_V2 = DATASETS / "code_corpus_v2.json"
CORPUS_V3 = DATASETS / "code_corpus_v3.json"

NEW_SOURCES = [
    # (github repo, branch, path filters or None, max files)
    ("Mbed-TLS/mbedtls", "master", ["library", "include", "programs"], 220),
    ("golang/crypto", "master", None, 250),
    ("ziglang/zig", "master", ["lib/std/crypto"], 200),
    ("RustCrypto/hashes", "master", None, 150),
    ("spring-projects/spring-security", "main", ["core", "crypto", "oauth2"], 250),
    ("nextauthjs/next-auth", "main", ["packages"], 150),
    ("django/django", "main", ["django"], 150),
    ("git/git", "master", None, 180),
]

LANG_BY_EXT = {
    ".java": "java", ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp",
    ".hpp": "cpp", ".go": "go", ".rs": "rust", ".zig": "zig", ".py": "python",
    ".ts": "js", ".tsx": "js", ".js": "js", ".mjs": "js",
}

LABEL_RULES = [
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
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def records_from_zip(repo: str, blob: bytes, path_filters, max_files: int):
    recs = []
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = [n for n in zf.namelist()
                 if not n.endswith("/") and "__MACOSX" not in n
                 and "/test-fixtures/" not in n and "/testdata/" not in n
                 and "/test-vectors/" not in n]
        for name in sorted(names):
            if len(recs) >= max_files:
                break
            rel = name.split("/", 1)[1] if "/" in name else name
            if path_filters and not any(rel.startswith(f) for f in path_filters):
                continue
            ext = Path(rel).suffix.lower()
            lang = LANG_BY_EXT.get(ext)
            if not lang:
                continue
            try:
                code = zf.read(name).decode("utf-8", errors="ignore")
            except Exception:
                continue
            if not code.strip() or len(code) > 400_000:
                continue
            is_crypto, label = label_code(code)
            recs.append({"code": code, "language": lang, "label": label,
                         "is_crypto": is_crypto, "source": repo, "path": rel})
    return recs


def main() -> int:
    v2 = json.loads(CORPUS_V2.read_text(encoding="utf-8"))
    corpus = list(v2["corpus"])
    existing = {r["source"] for r in corpus}
    print(f"v2: {len(corpus)} files, {len(existing)} sources")

    added = []
    for repo, branch, filters, cap in NEW_SOURCES:
        if repo in existing:
            print(f"  skip {repo}")
            continue
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
        print(f"  + {repo:34s} {len(recs):4d} files ({n_pos:4d} crypto) "
              f"{time.time()-t0:.1f}s")

    by_lang = {}
    for r in corpus:
        s = by_lang.setdefault(r["language"], {"files": 0, "crypto": 0})
        s["files"] += 1
        s["crypto"] += int(bool(r["is_crypto"]))

    v3 = {
        "type": "code_corpus",
        "version": "3",
        "corpus": corpus,
        "stats": {
            "total_files": len(corpus),
            "crypto": sum(1 for r in corpus if r["is_crypto"]),
            "non_crypto": sum(1 for r in corpus if not r["is_crypto"]),
            "sources": len({r["source"] for r in corpus}),
            "by_language": by_lang,
            "v2_baseline": {"total_files": len(v2["corpus"]),
                            "sources": len(existing)},
            "expansion": {
                "added_sources": [a[0] for a in added],
                "added_files": sum(a[1] for a in added),
                "added_crypto": sum(a[2] for a in added),
                "labeling": "transparent keyword rules (script docstring)",
            },
        },
    }
    CORPUS_V3.write_text(json.dumps(v3), encoding="utf-8")
    print(f"\nv3: {len(corpus)} files, {v3['stats']['sources']} sources; "
          f"wrote {CORPUS_V3}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

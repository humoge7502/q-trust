#!/usr/bin/env python3
"""Corpus v5 — 8 more crypto/TLS repos on top of v4, to test whether *more
diverse training data* (eval pinned, so these are training-only) improves the
clean held-out F1 that v4 set at 0.8966.

Focus: the digest eval repos are C-heavy (Mbed-TLS, wolfSSL) plus JS
(express, svelte) and Python (numpy, pyca/cryptography). So the new sources
target C TLS, Java crypto, Rust signatures and JS crypto — the axes most
likely to lift held-out generalization.

Labeling: identical transparent keyword rules as expand_code_corpus*.py.
Output: qtrust-datasets/code_corpus_v5.json (v4 untouched).
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
CORPUS_V4 = DATASETS / "code_corpus_v4.json"
CORPUS_V5 = DATASETS / "code_corpus_v5.json"

# (repo, preferred branch, fallback, path filters or None, max files)
NEW_SOURCES = [
    ("google/tink", "master", "main", ["java"], 180),
    ("curl/curl", "master", "main", ["lib"], 150),
    ("libressl/portable", "master", "main", ["crypto", "ssl"], 150),
    ("RustCrypto/signatures", "master", "main", None, 150),
    ("paulmillr/noble-hashes", "main", "master", ["src"], 120),
    ("digitalbazaar/forge", "main", "master", ["lib"], 120),
    ("pyca/bcrypt", "master", "main", ["src"], 60),
    ("apache/httpcomponents-core", "master", "main", ["httpcore5/src"], 150),
]

LANG_BY_EXT = {
    ".java": "java", ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp",
    ".hpp": "cpp", ".go": "go", ".rs": "rust", ".zig": "zig", ".py": "python",
    ".ts": "js", ".tsx": "js", ".js": "js", ".mjs": "js",
}

LABEL_RULES = [
    ("PQC", re.compile(r"\b(ML[- ]?KEM|ML[- ]?DSA|SLH[- ]?DSA|Kyber|Dilithium|SPHINCS|Falcon|HQC)\b", re.I)),
    ("RSA/ECC", re.compile(r"\b(RSA|ECDSA|ECDH|Ed25519|X25519|secp256r1|P-256|elliptic|secp256k1)\b", re.I)),
    ("CERT", re.compile(r"\bx509\b|certificate|X509_", re.I)),
    ("HASH", re.compile(r"\b(SHA[- ]?(1|256|384|512)|SHA3|MD5|blake2|blake3|hmac|bcrypt|scrypt|argon2)\b", re.I)),
    ("AES", re.compile(r"\b(AES|GCM|CBC|CTR|chacha20?|poly1305)\b", re.I)),
    ("LIB", re.compile(r"\b(openssl|libsodium|boringssl|wolfssl|botan|libcrypto|EVP_|crypto_\w+|gnutls|nss|tink|libressl)\b", re.I)),
]


def label_code(code: str) -> tuple[bool, str]:
    for label, pat in LABEL_RULES:
        if pat.search(code):
            return True, label
    return False, "NONE"


def fetch_repo_zip(repo: str, branch: str) -> bytes:
    url = f"https://codeload.github.com/{repo}/zip/refs/heads/{branch}"
    req = urllib.request.Request(url, headers={"User-Agent": "qtrust-corpus-builder"})
    # The URL is assembled only from a hardcoded allowlist of public GitHub repos
    # (see REPOS below); there is no untrusted/user-controlled input, and the
    # scheme is fixed to https://codeload.github.com/, so the file:// risk this
    # rule warns about does not apply to this developer corpus-build script.
    # nosemgrep: dynamic-urllib-use-detected
    with urllib.request.urlopen(req, timeout=240) as r:
        return r.read()


def records_from_zip(repo: str, blob: bytes, path_filters, max_files: int):
    recs = []
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = [n for n in zf.namelist()
                 if not n.endswith("/") and "__MACOSX" not in n
                 and "/test-fixtures/" not in n and "/testdata/" not in n
                 and "/test-vectors/" not in n and "/tests/" not in n
                 and "/test/" not in n]
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
    v4 = json.loads(CORPUS_V4.read_text(encoding="utf-8"))
    corpus = list(v4["corpus"])
    existing = {r["source"] for r in corpus}
    print(f"v4: {len(corpus)} files, {len(existing)} sources")

    added = []
    for repo, branch, fallback, filters, cap in NEW_SOURCES:
        if repo in existing:
            print(f"  skip {repo}")
            continue
        t0 = time.time()
        blob = None
        last_exc = None
        for br in (branch, fallback):
            try:
                blob = fetch_repo_zip(repo, br)
                branch_used = br
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
        if blob is None:
            print(f"  FAIL {repo}: {last_exc}")
            continue
        recs = records_from_zip(repo, blob, filters, cap)
        n_pos = sum(1 for r in recs if r["is_crypto"])
        added.append((repo, len(recs), n_pos))
        corpus.extend(recs)
        print(f"  + {repo:32s} {len(recs):4d} files ({n_pos:4d} crypto) "
              f"[{branch_used}] {time.time()-t0:.1f}s")

    by_lang = {}
    for r in corpus:
        s = by_lang.setdefault(r["language"], {"files": 0, "crypto": 0})
        s["files"] += 1
        s["crypto"] += int(bool(r["is_crypto"]))

    v5 = {
        "type": "code_corpus", "version": "5", "corpus": corpus,
        "stats": {
            "total_files": len(corpus),
            "crypto": sum(1 for r in corpus if r["is_crypto"]),
            "non_crypto": sum(1 for r in corpus if not r["is_crypto"]),
            "sources": len({r["source"] for r in corpus}),
            "by_language": by_lang,
            "v4_baseline": {"total_files": len(v4["corpus"]),
                            "sources": len(existing)},
            "expansion": {
                "added_sources": [a[0] for a in added],
                "added_files": sum(a[1] for a in added),
                "added_crypto": sum(a[2] for a in added),
            },
        },
    }
    CORPUS_V5.write_text(json.dumps(v5), encoding="utf-8")
    print(f"\nv5: {len(corpus)} files, {v5['stats']['sources']} sources; wrote {CORPUS_V5}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

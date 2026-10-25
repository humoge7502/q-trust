#!/usr/bin/env python3
"""Corpus v4 expansion — eight NEW PQC-dense / modern-crypto sources.

Goal (see scripts/train_discovery_v4.py): recover the solidity regression
(F1 0.8193 -> 0.4244) and lift the weak C score (0.32) that the v3 run left
behind, by adding *PQC-dense* and *modern-crypto* repositories that are
under-represented in v1+v2+v3:

  PQClean/PQClean          C     reference PQC impls (KEM/sign: Kyber, Dilithium,
                                   SPHINCS+, Falcon, HQC) — pure PQC signal
  nss-dev/nss              C     Mozilla NSS freebl/softoken/ssl — mature C crypto
  gnutls/gnutls            C     GnuTLS lib/ — C TLS implementation
  bitcoin-core/secp256k1   C     secp256k1 / ECDSA / ECDH — ECC anchor for C
  dalek-cryptography/
    curve25519-dalek       rust  Ed25519 / X25519 — modern Rust ECC
  panva/jose               js    JWE/JWS/JWK — modern web (Node) crypto
  RustCrypto/AEADs         rust  AES-GCM / ChaCha20Poly1305 — Rust AEADs
  ethers-io/ethers.js      js    Ethereum/Solidity-ecosystem crypto (TS)

Labeling: identical transparent keyword rules as expand_code_corpus*.py.
Excluded: CryptoAPI-Bench / ApacheCryptoAPI-Bench (E-08 evaluation-only).
Output: qtrust-datasets/code_corpus_v4.json (v3 corpus + new records;
provenance of the expansion captured in stats.expansion).
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
CORPUS_V3 = DATASETS / "code_corpus_v3.json"
CORPUS_V4 = DATASETS / "code_corpus_v4.json"

# (github repo, preferred branch, fallback branch, path filters or None, max files)
NEW_SOURCES = [
    ("PQClean/PQClean", "master", "main", ["crypto_kem", "crypto_sign"], 220),
    ("nss-dev/nss", "master", "main", ["lib/freebl", "lib/softoken", "lib/ssl"], 200),
    ("gnutls/gnutls", "master", "main", ["lib"], 200),
    ("bitcoin-core/secp256k1", "master", "main", None, 200),
    ("dalek-cryptography/curve25519-dalek", "master", "main", None, 200),
    ("panva/jose", "main", "master", ["src"], 160),
    ("RustCrypto/AEADs", "master", "main", None, 160),
    ("ethers-io/ethers.js", "main", "master", ["src"], 160),
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
    ("HASH", re.compile(r"\b(SHA[- ]?(1|256|384|512)|SHA3|MD5|blake2|blake3|hmac)\b", re.I)),
    ("AES", re.compile(r"\b(AES|GCM|CBC|CTR|chacha20?|poly1305)\b", re.I)),
    ("LIB", re.compile(r"\b(openssl|libsodium|boringssl|wolfssl|botan|libcrypto|EVP_|crypto_\w+|gnutls|nss|pqclean|secp256k1)\b", re.I)),
]


def label_code(code: str) -> tuple[bool, str]:
    for label, pat in LABEL_RULES:
        if pat.search(code):
            return True, label
    return False, "NONE"


def fetch_repo_zip(repo: str, branch: str) -> bytes:
    url = f"https://codeload.github.com/{repo}/zip/refs/heads/{branch}"
    req = urllib.request.Request(url, headers={"User-Agent": "qtrust-corpus-builder"})
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
    v3 = json.loads(CORPUS_V3.read_text(encoding="utf-8"))
    corpus = list(v3["corpus"])
    existing = {r["source"] for r in corpus}
    print(f"v3: {len(corpus)} files, {len(existing)} sources")

    added = []
    for repo, branch, fallback, filters, cap in NEW_SOURCES:
        if repo in existing:
            print(f"  skip {repo} (already present)")
            continue
        t0 = time.time()
        blob = None
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
        added.append((repo, len(recs), n_pos, branch_used))
        corpus.extend(recs)
        print(f"  + {repo:38s} {len(recs):4d} files ({n_pos:4d} crypto) "
              f"[{branch_used}] {time.time()-t0:.1f}s")

    by_lang = {}
    for r in corpus:
        s = by_lang.setdefault(r["language"], {"files": 0, "crypto": 0})
        s["files"] += 1
        s["crypto"] += int(bool(r["is_crypto"]))

    v4 = {
        "type": "code_corpus",
        "version": "4",
        "corpus": corpus,
        "stats": {
            "total_files": len(corpus),
            "crypto": sum(1 for r in corpus if r["is_crypto"]),
            "non_crypto": sum(1 for r in corpus if not r["is_crypto"]),
            "sources": len({r["source"] for r in corpus}),
            "by_language": by_lang,
            "v3_baseline": {"total_files": len(v3["corpus"]),
                            "sources": len(existing)},
            "expansion": {
                "added_sources": [a[0] for a in added],
                "added_files": sum(a[1] for a in added),
                "added_crypto": sum(a[2] for a in added),
                "labeling": "transparent keyword rules (script docstring)",
            },
        },
    }
    CORPUS_V4.write_text(json.dumps(v4), encoding="utf-8")
    print(f"\nv4: {len(corpus)} files, {v4['stats']['sources']} sources; "
          f"wrote {CORPUS_V4}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

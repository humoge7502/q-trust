#!/usr/bin/env python3
"""Push the Q-Trust v4 crypto detector + code corpus v4 to Hugging Face Hub.

Auth: reads HF_TOKEN from the environment (never hard-coded). Run:
    HF_TOKEN=... python scripts/push_to_hf.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

REPO_ROOT = Path(__file__).resolve().parent.parent
CKPT = REPO_ROOT / "qtrust_ai" / "artifacts" / "crypto_codebert_v4"
ART = REPO_ROOT / "qtrust_ai" / "artifacts"
DATASETS = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets")

MODEL_ID = "KRISHNAPURI/q-trust-crypto-detector"
DATA_ID = "KRISHNAPURI/q-trust-code-corpus-v4"

DATASET_CARD = """---
license: apache-2.0
task_categories:
  - text-classification
tags:
  - code
  - security
  - post-quantum
  - cryptography
pretty_name: Q-Trust Code Corpus v4
---

# Q-Trust Code Corpus v4

Labelled source-code corpus for cryptographic-code discovery (post-quantum migration).

- **17,171 files / 58 source repositories / 8,814 crypto-labelled**, 12 languages
  (C, C++, Java, Go, Rust, Python, JS/TS, Solidity, C#, PHP, Zig, Swift).
- Sources include OpenSSL, BoringSSL, AWS-LC, wolfSSL, Mbed-TLS, GnuTLS, NSS, libsodium,
  Botan, PQClean, liboqs, Cloudflare CIRCL, RustCrypto, secp256k1, curve25519-dalek,
  google/tink, pyca/cryptography, and negative controls (numpy, express, svelte, serde, ...).
- **Labels are regex-derived** (`is_crypto` = file contains a crypto keyword: RSA/ECC, AES/GCM/
  ChaCha20, SHA/BLAKE, X.509, and PQC ML-KEM/Kyber, ML-DSA/Dilithium, SLH-DSA/SPHINCS+, Falcon, HQC).
  This is a weak label — see the model card's limitations.

## Record schema

```json
{"code": "...", "language": "python", "label": "RSA/ECC", "is_crypto": true,
 "source": "pyca/cryptography", "path": "src/.../rsa.py"}
```

Split: repo-disjoint, digest-keyed (SHA-256 source buckets), seed 42 — the same split used for the
`KRISHNAPURI/q-trust-crypto-detector` evaluation (0% train/eval path overlap).
"""


def main() -> int:
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("ERROR: HF_TOKEN not set", file=sys.stderr)
        return 2
    api = HfApi(token=token)

    who = api.whoami()
    print(f"authenticated as: {who.get('name')}")

    # --- model repo -------------------------------------------------------
    print(f"\n[model] creating {MODEL_ID} ...")
    api.create_repo(MODEL_ID, repo_type="model", exist_ok=True)
    print("[model] uploading checkpoint ...")
    api.upload_folder(
        folder_path=str(CKPT),
        repo_id=MODEL_ID,
        repo_type="model",
        allow_patterns=["config.json", "model.safetensors", "tokenizer.json",
                        "tokenizer_config.json", "training_config.json", "README.md"],
    )
    for art in ("training_report_v4.json", "eval_leakage_audit.json", "calibration_v4.json"):
        p = ART / art
        if p.exists():
            api.upload_file(path_or_fileobj=str(p), path_in_repo=f"artifacts/{art}",
                            repo_id=MODEL_ID, repo_type="model")
            print(f"[model] + artifacts/{art}")

    # --- dataset repo -----------------------------------------------------
    print(f"\n[dataset] creating {DATA_ID} ...")
    api.create_repo(DATA_ID, repo_type="dataset", exist_ok=True)
    corpus = DATASETS / "code_corpus_v4.json"
    if corpus.exists():
        print(f"[dataset] uploading {corpus.name} ({corpus.stat().st_size/1e6:.0f} MB) ...")
        api.upload_file(path_or_fileobj=str(corpus), path_in_repo="code_corpus_v4.json",
                        repo_id=DATA_ID, repo_type="dataset")
    api.upload_file(path_or_fileobj=DATASET_CARD.encode("utf-8"), path_in_repo="README.md",
                    repo_id=DATA_ID, repo_type="dataset")

    print(f"\nDONE:\n  model:   https://huggingface.co/{MODEL_ID}\n  dataset: https://huggingface.co/datasets/{DATA_ID}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

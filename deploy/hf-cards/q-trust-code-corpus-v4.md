---
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

Labelled source-code corpus for cryptographic-code discovery (post-quantum migration). It is the
training and evaluation corpus for
[`KRISHNAPURI/q-trust-crypto-detector`](https://huggingface.co/KRISHNAPURI/q-trust-crypto-detector),
and the data behind the
[in-browser scanner](https://huggingface.co/spaces/KRISHNAPURI/q-trust-scanner).

- **17,171 file records / 58 source repositories / 8,814 crypto-labelled**, 12 languages
  (C, C++, Java, Go, Rust, Python, JS/TS, Solidity, C#, PHP, Zig, Swift).
- Sources include OpenSSL, BoringSSL, AWS-LC, wolfSSL, Mbed-TLS, GnuTLS, NSS, libsodium,
  Botan, PQClean, liboqs, Cloudflare CIRCL, RustCrypto, secp256k1, curve25519-dalek,
  google/tink, pyca/cryptography, and negative controls (numpy, express, svelte, serde, ...).
- **Labels are regex-derived** (`is_crypto` = file contains a crypto keyword: RSA/ECC, AES/GCM/
  ChaCha20, SHA/BLAKE, X.509, and PQC ML-KEM/Kyber, ML-DSA/Dilithium, SLH-DSA/SPHINCS+, Falcon, HQC).
  This is a weak label — the attainable detector F1 is bounded by the labeler's own error.

## Record schema

```json
{"code": "...", "language": "python", "label": "RSA/ECC", "is_crypto": true,
 "source": "pyca/cryptography", "path": "src/.../rsa.py"}
```

## Split and evaluation protocol

Repo-disjoint, digest-keyed split (SHA-256 of the source name, seed 42): 14,933 train / 2,238 eval
records, **0 % train/eval path overlap** (verified by an evaluation-leakage audit). The held-out set
repeats 197 `(source, path)` pairs (459 extra records, 22 label conflicts); the primary metric keeps
the longest copy per path, chosen without looking at the label, for n = 1,779.

Measured detector results on this corpus (digest split):

| View | Gate | Precision | Recall | F1 | n |
|---|---|---:|---:|---:|---:|
| De-duplicated, one per path (primary) | 0.50 | 0.9264 | 0.9146 | **0.9205** | 1,779 |
| Raw records | 0.50 | 0.9201 | 0.9088 | 0.9144 | 2,238 |
| Native split, raw records | 0.50 | 0.9232 | 0.9238 | **0.9235** | 2,566 |

One-per-path sensitivity across policies: 0.9208 (keep-first), 0.9223 (keep-last), 0.9205
(keep-longest, primary). The full protocol, including dedup policies and recorded negatives, is in
[`EXPERIMENTS.md`](https://github.com/humoge7502/q-trust/blob/main/EXPERIMENTS.md) E-14 → E-16 and
in `qtrust_ai/artifacts/eval_dedup_v4.json` in the GitHub repository.

## Related resources

- Detector: [`KRISHNAPURI/q-trust-crypto-detector`](https://huggingface.co/KRISHNAPURI/q-trust-crypto-detector)
- Live demo: [`KRISHNAPURI/q-trust-scanner`](https://huggingface.co/spaces/KRISHNAPURI/q-trust-scanner)
- Dataset package with the full corpus lineage (`v1` → `v5`, TLS scans, CVEs, CBOMs):
  [`KRISHNAPURI/q-trust-datasets`](https://huggingface.co/datasets/KRISHNAPURI/q-trust-datasets)
- Source: [humoge7502/q-trust](https://github.com/humoge7502/q-trust)

The corpus contains only public source code; no proprietary data. Labels are automated annotations,
not human ground truth. License follows the upstream repositories (Apache-2.0 for this packaging;
individual source files retain their original licenses).

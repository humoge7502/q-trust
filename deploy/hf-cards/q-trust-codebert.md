---
license: mit
library_name: transformers
pipeline_tag: text-classification
datasets:
- KRISHNAPURI/q-trust-datasets
base_model: huggingface/CodeBERTa-small-v1
tags:
- code
- cryptography
- post-quantum
- static-analysis
- legacy
widget:
- text: "cipher = Cipher.getInstance(\"AES/ECB/PKCS5Padding\"); // usage under review"
- text: "kem = OQS_KEM_ml_kem_768_new(); OQS_KEM_ml_kem_768_keypair(kem, pk, sk);"
---

# Q-Trust CodeBERT (v1 — legacy checkpoint)

> **Superseded.** This is the first Q-Trust crypto-usage classifier, kept for lineage and for
> reproducing earlier experiments. Its published held-out score came from a split that was later
> found to leak: the 2026-10-23 audit measured **87.6 % of its evaluation paths inside its own
> training data**. The weights are unchanged, but its F1 is **not a clean generalization estimate**
> and should not be quoted as one.
>
> Current model: [`KRISHNAPURI/q-trust-crypto-detector`](https://huggingface.co/KRISHNAPURI/q-trust-crypto-detector) —
> clean held-out **F1 0.9205** de-duplicated / **0.9235** native at the 0.50 gate, **0 % train/eval
> path overlap**. See [`EXPERIMENTS.md`](https://github.com/humoge7502/q-trust/blob/main/EXPERIMENTS.md)
> E-13 → E-17c for the audit, the retraining and the recorded negatives.

Binary code classifier that answers **"does this code use cryptography?"** — the discovery layer of
the Q-Trust post-quantum migration pipeline (`humoge7502/q-trust` on GitHub).

## What this checkpoint is

| | |
|---|---|
| Base | `huggingface/CodeBERTa-small-v1`, 2-label sequence classification |
| Training data | 12,462 real files (6,636 crypto-labelled) from 34 repositories |
| Input | source code, truncated to 256 tokens |
| Output | `LABEL_1` = crypto usage, `LABEL_0` = no crypto usage |
| Retained for | v1-vs-v4 head-to-head, GNN ranker and RL experiments that reference these exact weights |

## Corrected evaluation status

| | |
|---|---|
| Pre-audit held-out F1 | 0.9395 (leak-inflated: 87.6 % eval-path overlap) |
| Leakage audit | [`eval_leakage_audit`](https://github.com/humoge7502/q-trust/blob/main/EXPERIMENTS.md) — 2026-10-23 |
| Clean estimate for this checkpoint | none established — do not cite |
| Recommended successor | v4 detector, F1 0.9205 de-duplicated / 0.9235 native at gate 0.50, 0 % overlap |

The correction is enforced in the GitHub repository by `scripts/verify_metric_consistency.py`, so
the retired figure cannot drift back into current-facing documentation. This card keeps the
checkpoint unchanged: it is the canonical v1 artifact, not the current recommendation.

## Usage

```python
from transformers import pipeline

clf = pipeline("text-classification", model="KRISHNAPURI/q-trust-codebert")
clf("EVP_PKEY_assign_RSA(pkey, rsa);")
# [{'label': 'LABEL_1', 'score': 0.99}]  # LABEL_1 = crypto usage
```

```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification

tok = AutoTokenizer.from_pretrained("KRISHNAPURI/q-trust-codebert")
model = AutoModelForSequenceClassification.from_pretrained("KRISHNAPURI/q-trust-codebert")
```

## Scope and limits

This model finds crypto **usage** (recall 0.877 on CryptoAPI-Bench files); it is not a misuse
detector and makes no SOTA claim. Labels are regex-derived weak labels, so the attainable score is
bounded by the labeler's error. It is not a vulnerability scanner and not a substitute for human
review.

Sibling artifacts in this repository, all reported at their measured values:

- **GNN ranker** — τ-b 0.7168 vs 0.7210 for the doctrine heuristic: a tie.
- **RL migration agent** — likewise a tie with the heuristic.
- **Side-channel detector** — evaluated on 54 real trace sets.

`onnx/model_quantized.onnx` is the original int8 export used by the first browser demo. The current
[in-browser scanner](https://huggingface.co/spaces/KRISHNAPURI/q-trust-scanner) loads the v4 detector
instead.

## Provenance

- Training corpus: [`KRISHNAPURI/q-trust-datasets`](https://huggingface.co/datasets/KRISHNAPURI/q-trust-datasets)
- Metrics and audit trail: `reports/` in this repository and
  [`humoge7502/q-trust`](https://github.com/humoge7502/q-trust)

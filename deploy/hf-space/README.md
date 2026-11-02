---
title: Q-Trust Crypto-Usage Scanner
emoji: 🛡️
colorFrom: indigo
colorTo: blue
sdk: static
app_file: index.html
pinned: false
license: apache-2.0
short_description: Find crypto usage in code, privately in your browser.
models:
- KRISHNAPURI/q-trust-crypto-detector
datasets:
- KRISHNAPURI/q-trust-code-corpus-v4
---

# Q-Trust Crypto-Usage Scanner

Paste source code and find cryptographic API usage — including post-quantum
algorithms — without sending the code anywhere. A quantized CodeBERTa classifier
runs locally in WebAssembly inside this page.

**Model:** [`KRISHNAPURI/q-trust-crypto-detector`](https://huggingface.co/KRISHNAPURI/q-trust-crypto-detector)
· **Dataset:** [`KRISHNAPURI/q-trust-code-corpus-v4`](https://huggingface.co/datasets/KRISHNAPURI/q-trust-code-corpus-v4)
· **Source:** [humoge7502/q-trust](https://github.com/humoge7502/q-trust)

## What the number means

- **F1 0.9205** on the de-duplicated held-out split (1,779 files; P 0.9264 / R 0.9146)
  at the selected 0.50 gate. The native split scores **0.9235**.
- **0 % train/eval path overlap** — verified by `scripts/audit_eval_leakage.py`.
  The earlier v1 model trained on 87.6 % of its own evaluation paths; that
  result is retired and not quoted.
- Corpus v4: 17,171 real files / 58 repositories / 8,814 crypto-labelled files
  across 12 languages.

## Limits

This is **usage discovery**, not misuse detection or a vulnerability scanner.
Labels are regex-derived weak labels, so the attainable F1 is bounded by the
labeler's error. Long files are truncated to 256 tokens in this demo; the full
scanner chunks files and combines static, AST, and dataflow layers.

The full experiment log, including negative results and the leakage audit, is
in [`EXPERIMENTS.md`](https://github.com/humoge7502/q-trust/blob/main/EXPERIMENTS.md).

#!/usr/bin/env python3
"""Export the Q-Trust crypto detector to ONNX (fp32 + int8) and verify it.

The browser demo (`deploy/hf-space/`) loads `onnx/model_quantized.onnx` through
transformers.js. This script regenerates both graphs from the shipped
checkpoint and checks ONNX Runtime against PyTorch on fixed samples.

Run:
    python scripts/export_detector_onnx.py
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CHECKPOINT = ROOT / "qtrust_ai" / "artifacts" / "crypto_codebert_v4"

SAMPLES = {
    "rsa_c": "RSA_generate_key_ex(rsa, 2048, e, NULL);",
    "pandas_clean": "df = pd.read_csv('sales.csv'); print(df.describe())",
    "mlkem_c": "kem = OQS_KEM_ml_kem_768_new(); OQS_KEM_ml_kem_768_keypair(kem, pk, sk);",
    "add_clean": "def add(a, b):\n    return a + b\n" * 40,
    "aesgcm_python": (
        "from cryptography.hazmat.primitives.ciphers.aead import AESGCM\n"
        "key = AESGCM.generate_key(bit_length=256)"
    ),
}


def softmax2(x: np.ndarray) -> float:
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return float((e / e.sum(axis=-1, keepdims=True))[0, 1])


def torch_p_crypto(model, tok, text: str) -> float:
    enc = tok(text, return_tensors="pt", truncation=True, max_length=256)
    with torch.no_grad():
        logits = model(**enc).logits
    return float(torch.softmax(logits, -1)[0, 1])


def ort_p_crypto(session, tok, text: str) -> float:
    enc = tok(text, return_tensors="np", truncation=True, max_length=256)
    logits = session.run(
        ["logits"],
        {
            "input_ids": enc["input_ids"].astype(np.int64),
            "attention_mask": enc["attention_mask"].astype(np.int64),
        },
    )[0]
    return softmax2(logits)


def export(checkpoint: Path, out_dir: Path, opset: int) -> dict:
    tok = AutoTokenizer.from_pretrained(checkpoint)
    model = AutoModelForSequenceClassification.from_pretrained(
        checkpoint, attn_implementation="eager"
    ).eval()

    out_dir.mkdir(parents=True, exist_ok=True)
    fp32_path = out_dir / "model.onnx"
    int8_path = out_dir / "model_quantized.onnx"

    example = tok("RSA_generate_key_ex(rsa, 2048, e, NULL);", return_tensors="pt")
    torch.onnx.export(
        model,
        (example["input_ids"], example["attention_mask"]),
        str(fp32_path),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "logits": {0: "batch"},
        },
        opset_version=opset,
        do_constant_folding=True,
        dynamo=False,
    )

    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(
        str(fp32_path), str(int8_path), weight_type=QuantType.QUInt8, per_channel=False
    )

    fp32 = ort.InferenceSession(str(fp32_path), providers=["CPUExecutionProvider"])
    int8 = ort.InferenceSession(str(int8_path), providers=["CPUExecutionProvider"])

    rows = []
    fp32_diffs = []
    int8_diffs = []
    for name, text in SAMPLES.items():
        pt = torch_p_crypto(model, tok, text)
        fp = ort_p_crypto(fp32, tok, text)
        q8 = ort_p_crypto(int8, tok, text)
        fp32_diffs.append(abs(pt - fp))
        int8_diffs.append(abs(pt - q8))
        rows.append(
            {"sample": name, "torch": round(pt, 6), "onnx_fp32": round(fp, 6),
             "onnx_int8": round(q8, 6)}
        )

    max_fp32 = max(fp32_diffs)
    max_int8 = max(int8_diffs)
    if max_fp32 > 1e-4 or max_int8 > 0.05:
        raise SystemExit(
            f"verification failed: max diff fp32={max_fp32:.6f}, int8={max_int8:.6f}"
        )

    import onnx
    import onnxruntime
    import transformers

    report = {
        "checkpoint": str(checkpoint),
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "versions": {
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": onnxruntime.__version__,
        },
        "files": {
            "fp32": {"path": str(fp32_path.relative_to(ROOT)),
                     "bytes": fp32_path.stat().st_size},
            "int8": {"path": str(int8_path.relative_to(ROOT)),
                     "bytes": int8_path.stat().st_size},
        },
        "samples": rows,
        "max_abs_diff": {"fp32_vs_torch": max_fp32, "int8_vs_torch": max_int8},
        "opset": opset,
    }
    report_path = out_dir / "export_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    ap.add_argument("--out-dir", type=Path, default=None,
                    help="defaults to <checkpoint>/onnx")
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    checkpoint = args.checkpoint.resolve()
    if not (checkpoint / "model.safetensors").exists():
        print(f"ERROR: no model.safetensors in {checkpoint}", file=sys.stderr)
        return 2
    out_dir = args.out_dir or checkpoint / "onnx"
    report = export(checkpoint, out_dir, args.opset)
    print(f"ONNX export verified: max diff fp32={report['max_abs_diff']['fp32_vs_torch']:.2e}, "
          f"int8={report['max_abs_diff']['int8_vs_torch']:.2e}")
    print(f"fp32: {report['files']['fp32']['path']} "
          f"({report['files']['fp32']['bytes'] / 1e6:.1f} MB)")
    print(f"int8: {report['files']['int8']['path']} "
          f"({report['files']['int8']['bytes'] / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Publish the Q-Trust model, dataset cards and browser Space to Hugging Face Hub.

Auth: HF_TOKEN from the environment, or from the repo-local .env (gitignored).
The token is never printed.

Usage:
    python scripts/push_to_hf.py                     # all targets
    python scripts/push_to_hf.py --only model,space  # selected targets
Targets: model, legacy, corpus, datasets, space
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

REPO_ROOT = Path(__file__).resolve().parent.parent
CKPT = REPO_ROOT / "qtrust_ai" / "artifacts" / "crypto_codebert_v4"
ART = REPO_ROOT / "qtrust_ai" / "artifacts"
CARDS = REPO_ROOT / "deploy" / "hf-cards"
SPACE_DIR = REPO_ROOT / "deploy" / "hf-space"
DATASETS = Path(os.environ.get("QTRUST_DATASETS_DIR", REPO_ROOT.parent / "q-trust-datasets"))

MODEL_ID = "KRISHNAPURI/q-trust-crypto-detector"
LEGACY_ID = "KRISHNAPURI/q-trust-codebert"
CORPUS_ID = "KRISHNAPURI/q-trust-code-corpus-v4"
DATASETS_ID = "KRISHNAPURI/q-trust-datasets"
SPACE_ID = "KRISHNAPURI/q-trust-scanner"

MODEL_FILES = [
    "README.md",
    "config.json",
    "model.safetensors",
    "tokenizer.json",
    "tokenizer_config.json",
    "training_config.json",
    "onnx/model.onnx",
    "onnx/model_quantized.onnx",
    "onnx/export_report.json",
]
MODEL_ARTIFACTS = [
    "training_report_v4.json",
    "eval_dedup_v4.json",
    "eval_leakage_audit.json",
    "calibration_v4.json",
    "ensemble_scores_v4_native.json",
    "ensemble_scores_v4_pinned.json",
]
SPACE_FILES = ["index.html", "style.css", "README.md"]


def load_token() -> str:
    token = os.environ.get("HF_TOKEN")
    if token:
        return token.strip()
    env_file = REPO_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("HF_TOKEN="):
                value = line.split("=", 1)[1].strip().strip('"').strip("'")
                if value:
                    return value
    print("ERROR: HF_TOKEN is not set and not present in .env", file=sys.stderr)
    raise SystemExit(2)


def require(path: Path) -> Path:
    if not path.exists():
        raise SystemExit(f"ERROR: required file is missing: {path}")
    return path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def remote_sha(api: HfApi, repo_id: str, filename: str, repo_type: str = "model") -> str | None:
    info = api.repo_info(repo_id, repo_type=repo_type, files_metadata=True)
    for sibling in info.siblings:
        if sibling.rfilename == filename and sibling.lfs:
            return sibling.lfs.sha256
    return None


def upload_model(api: HfApi) -> None:
    print(f"\n[model] {MODEL_ID}")
    api.create_repo(MODEL_ID, repo_type="model", exist_ok=True)
    for name in MODEL_FILES:
        require(CKPT / name)
    weights = CKPT / "model.safetensors"
    if remote_sha(api, MODEL_ID, "model.safetensors") == sha256(weights):
        print("[model] model.safetensors unchanged on Hub — skipping upload")
    else:
        api.upload_file(
            path_or_fileobj=str(weights),
            path_in_repo="model.safetensors",
            repo_id=MODEL_ID,
            repo_type="model",
            commit_message="Update v4 checkpoint",
        )
        print("[model] model.safetensors uploaded")
    info = api.upload_folder(
        folder_path=str(CKPT),
        repo_id=MODEL_ID,
        repo_type="model",
        allow_patterns=[name for name in MODEL_FILES if name != "model.safetensors"],
        commit_message="Publish v4 detector with int8 ONNX export and corrected metrics",
    )
    print(f"[model] card + tokenizer + onnx uploaded ({info.oid[:10]})")
    for name in MODEL_ARTIFACTS:
        path = ART / name
        if not path.exists():
            print(f"[model] skip missing artifact {name}")
            continue
        api.upload_file(
            path_or_fileobj=str(path),
            path_in_repo=f"artifacts/{name}",
            repo_id=MODEL_ID,
            repo_type="model",
            commit_message=f"Publish evaluation artifact {name}",
        )
        print(f"[model] + artifacts/{name}")


def upload_legacy_card(api: HfApi) -> None:
    print(f"\n[legacy] {LEGACY_ID}")
    card = require(CARDS / "q-trust-codebert.md")
    api.create_repo(LEGACY_ID, repo_type="model", exist_ok=True)
    api.upload_file(
        path_or_fileobj=str(card),
        path_in_repo="README.md",
        repo_id=LEGACY_ID,
        repo_type="model",
        commit_message="Correct v1 card: leakage audit, retired metric, v4 successor",
    )
    print("[legacy] card corrected")


def upload_corpus(api: HfApi) -> None:
    print(f"\n[corpus] {CORPUS_ID}")
    card = require(CARDS / "q-trust-code-corpus-v4.md")
    api.create_repo(CORPUS_ID, repo_type="dataset", exist_ok=True)
    api.upload_file(
        path_or_fileobj=str(card),
        path_in_repo="README.md",
        repo_id=CORPUS_ID,
        repo_type="dataset",
        commit_message="Refresh corpus card: split protocol, clean metrics, Space link",
    )
    print("[corpus] card refreshed")
    # The corpus blob is already published and unchanged by card edits; upload
    # it only when explicitly bootstrapping a fresh dataset repo:
    #   HF_TOKEN=... python -c "from huggingface_hub import HfApi; ..."
    if not (DATASETS / "code_corpus_v4.json").exists():
        print(f"[corpus] note: {DATASETS / 'code_corpus_v4.json'} is not staged locally")


def upload_datasets_card(api: HfApi) -> None:
    print(f"\n[datasets] {DATASETS_ID}")
    card = require(DATASETS / "README.md")
    api.create_repo(DATASETS_ID, repo_type="dataset", exist_ok=True)
    api.upload_file(
        path_or_fileobj=str(card),
        path_in_repo="README.md",
        repo_id=DATASETS_ID,
        repo_type="dataset",
        commit_message="Correct detector metrics; link v4 detector and Space",
    )
    print("[datasets] card corrected")


def upload_space(api: HfApi) -> None:
    print(f"\n[space] {SPACE_ID}")
    for name in SPACE_FILES:
        require(SPACE_DIR / name)
    api.create_repo(SPACE_ID, repo_type="space", space_sdk="static", exist_ok=True)
    info = api.upload_folder(
        folder_path=str(SPACE_DIR),
        repo_id=SPACE_ID,
        repo_type="space",
        allow_patterns=SPACE_FILES,
        commit_message="Serve the v4 int8 detector with corrected metrics",
    )
    print(f"[space] uploaded ({info.oid[:10]})")


TASKS = {
    "model": upload_model,
    "legacy": upload_legacy_card,
    "corpus": upload_corpus,
    "datasets": upload_datasets_card,
    "space": upload_space,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", default=",".join(TASKS),
                        help="comma-separated subset of: " + ", ".join(TASKS))
    args = parser.parse_args()
    selected = [name.strip() for name in args.only.split(",") if name.strip()]
    unknown = sorted(set(selected) - set(TASKS))
    if unknown:
        print(f"ERROR: unknown targets {unknown}", file=sys.stderr)
        return 2

    api = HfApi(token=load_token())
    who = api.whoami()
    print(f"authenticated as: {who.get('name')}")

    for name in selected:
        TASKS[name](api)

    print("\nDONE")
    print(f"  model:    https://huggingface.co/{MODEL_ID}")
    print(f"  legacy:   https://huggingface.co/{LEGACY_ID}")
    print(f"  corpus:   https://huggingface.co/datasets/{CORPUS_ID}")
    print(f"  datasets: https://huggingface.co/datasets/{DATASETS_ID}")
    print(f"  space:    https://huggingface.co/spaces/{SPACE_ID}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

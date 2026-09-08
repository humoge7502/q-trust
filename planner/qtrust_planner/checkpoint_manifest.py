"""Startup integrity pinning for planner checkpoints (TM-PL-02).

The tracked checkpoints are published in the SHA-256 manifest ``models.sha256``
(repo root; ``planner/models.sha256`` is the image-baked planner copy). A
checkpoint swapped after build/checkout is detected at load time: callers hash
the resolved checkpoint and compare it to the pinned value, and refuse to start
on a mismatch (fail closed).

Contracts
---------
* A checkpoint whose basename appears in the manifest MUST match its pinned
  hash — :func:`verify_checkpoint` raises :class:`CheckpointVerificationError`
  otherwise. Callers fail closed: never catch it into a degraded mode.
* A checkpoint whose basename is NOT in the manifest is an operator-selected
  artifact outside the pinned set (documented rollback/canary path). It is
  reported as ``unlisted`` so the caller can warn without blocking.
* If no manifest is found at all, the result is ``no-manifest``; the caller
  decides (warn by default, fail closed under ``QTRUST_ENFORCE_MODEL_MANIFEST=1``).

Manifest search order (first hit wins):
    1. ``QTRUST_MODEL_MANIFEST`` (explicit operator override)
    2. ``models.sha256`` next to the checkpoint (image + ``planner/`` layout)
    3. ``models.sha256`` in an ancestor directory (repo-root layout)
"""
from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import Iterator, Optional

logger = logging.getLogger("qtrust_planner.checkpoint_manifest")

MANIFEST_NAME = "models.sha256"


class CheckpointVerificationError(RuntimeError):
    """A pinned checkpoint does not match its manifest hash (or is missing)."""


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _iter_candidate_manifests(checkpoint_path: Path) -> Iterator[Path]:
    env = os.environ.get("QTRUST_MODEL_MANIFEST")
    if env:
        yield Path(env)
    checkpoint_path = Path(checkpoint_path)
    # Models sit next to their manifest in both layouts that matter:
    #   image:      /app/model_real_v3.pt      + /app/models.sha256
    #   repo:       planner/model_real_v3.pt   + planner/models.sha256 + <root>/models.sha256
    for parent in checkpoint_path.resolve().parents:
        yield parent / MANIFEST_NAME


def find_manifest(checkpoint_path: str | Path) -> Optional[Path]:
    """Return the first existing manifest for a checkpoint, or None."""
    for candidate in _iter_candidate_manifests(Path(checkpoint_path)):
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def load_manifest(manifest_path: str | Path) -> dict[str, str]:
    """Parse a sha256sum-style manifest into {basename: sha256}."""
    entries: dict[str, str] = {}
    with open(manifest_path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            digest, rel = parts[0].lower(), parts[1]
            entries[Path(rel).name] = digest
    return entries


def verify_checkpoint(
    checkpoint_path: str | Path, manifest: str | Path | None = None
) -> dict[str, str]:
    """Verify a checkpoint against its pinned SHA-256 manifest entry.

    Returns a status dict; raises :class:`CheckpointVerificationError` when the
    checkpoint is missing or its hash does not match the pinned value.

    Status values:
      ``verified``   — hash matches the manifest (``sha256`` / ``manifest`` set)
      ``unlisted``   — basename not in the manifest (operator-selected artifact)
      ``no-manifest``— no manifest found in the search path
    """
    path = Path(checkpoint_path)
    if not path.is_file():
        raise CheckpointVerificationError(f"checkpoint not found: {path}")
    manifest_path = Path(manifest) if manifest is not None else find_manifest(path)
    if manifest_path is None or not manifest_path.is_file():
        return {"status": "no-manifest", "path": str(path)}
    expected = load_manifest(manifest_path).get(path.name)
    if expected is None:
        return {"status": "unlisted", "path": str(path)}
    digest = _sha256(path)
    if digest != expected:
        raise CheckpointVerificationError(
            f"checkpoint integrity check FAILED for {path}: sha256 {digest} != "
            f"pinned {expected} (manifest {manifest_path}) — refusing to load (TM-PL-02)"
        )
    return {"status": "verified", "path": str(path), "sha256": digest, "manifest": str(manifest_path)}


def enforce_manifest() -> bool:
    """True when a missing manifest/unlisted resolution must fail closed.

    Mirrors the threat model's deployment posture: set ``QTRUST_ENFORCE_MODEL_MANIFEST=1``
    where the image ships a manifest (compose) so a tampered or missing pin aborts startup.
    """
    return os.environ.get("QTRUST_ENFORCE_MODEL_MANIFEST", "0") == "1"

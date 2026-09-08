"""TM-PL-02 — checkpoint SHA-256 pinning tests.

Covers the models.sha256 manifest parsing, verified/unlisted/no-manifest
resolution, fail-closed mismatch behaviour, and the planner↔root manifest
drift guard. The server-level checks exercise ``server._verify_checkpoint_integrity``
(the startup path) without needing a real torch checkpoint, because verification
happens BEFORE ``torch.load``.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

PLANNER_ROOT = Path(__file__).resolve().parent.parent
if str(PLANNER_ROOT) not in sys.path:
    sys.path.insert(0, str(PLANNER_ROOT))
REPO_ROOT = PLANNER_ROOT.parent

pytest.importorskip("fastapi")  # server import pulls in FastAPI app construction

import qtrust_planner.checkpoint_manifest as cm  # noqa: E402
import server  # noqa: E402

# The planner checkpoints tracked in git (also listed in the manifests).
TRACKED_PLANNER = ["model_real_v3.pt", "model_gpu_v3.pt", "model_ddp_v3.pt", "rl_agent.pt"]


def _write(path: Path, data: bytes) -> Path:
    path.write_bytes(data)
    return path


def test_root_manifest_lists_and_matches_tracked_checkpoints() -> None:
    """The repo-root manifest's hashes match the tracked files (source of truth)."""
    manifest = REPO_ROOT / "models.sha256"
    assert manifest.is_file()
    entries = cm.load_manifest(manifest)
    for name in TRACKED_PLANNER:
        assert name in entries, f"{name} missing from {manifest}"
        digest = cm._sha256(PLANNER_ROOT / name)
        assert digest == entries[name], f"{name} hash drifted from {manifest}"


def test_planner_manifest_matches_root_manifest() -> None:
    """planner/models.sha256 (image copy) never drifts from the root manifest."""
    root_entries = cm.load_manifest(REPO_ROOT / "models.sha256")
    planner_entries = cm.load_manifest(PLANNER_ROOT / "models.sha256")
    assert set(planner_entries) == set(TRACKED_PLANNER)
    for name in TRACKED_PLANNER:
        assert planner_entries[name] == root_entries[name], f"{name} pinned hash drifted"


def test_verify_passes_against_auto_discovered_manifest() -> None:
    """A pristine tracked checkpoint resolves to a manifest and verifies."""
    result = cm.verify_checkpoint(PLANNER_ROOT / "model_real_v3.pt")
    assert result["status"] == "verified"
    assert result["sha256"] == cm.load_manifest(PLANNER_ROOT / "models.sha256")["model_real_v3.pt"]
    assert Path(result["manifest"]).is_file()


def test_verify_passes_with_explicit_root_manifest() -> None:
    """The same file verifies against the explicit repo-root manifest too."""
    result = cm.verify_checkpoint(PLANNER_ROOT / "rl_agent.pt", manifest=REPO_ROOT / "models.sha256")
    assert result["status"] == "verified"


def test_tampered_checkpoint_fails_closed(tmp_path: Path) -> None:
    """A swapped checkpoint with a pinned basename must raise, not load."""
    pinned = cm.load_manifest(PLANNER_ROOT / "models.sha256")["model_real_v3.pt"]
    manifest = _write(tmp_path / "models.sha256", f"{pinned}  model_real_v3.pt\n".encode())
    poisoned = _write(tmp_path / "model_real_v3.pt", b"poisoned-pickle-payload")
    with pytest.raises(cm.CheckpointVerificationError, match="integrity check FAILED"):
        cm.verify_checkpoint(poisoned, manifest=manifest)
    # Server startup path raises the same error (fail closed, never heuristic).
    with pytest.raises(cm.CheckpointVerificationError, match="TM-PL-02"):
        server._verify_checkpoint_integrity(str(poisoned), kind="gnn")


def test_missing_checkpoint_raises(tmp_path: Path) -> None:
    with pytest.raises(cm.CheckpointVerificationError, match="not found"):
        cm.verify_checkpoint(tmp_path / "nope.pt", manifest=tmp_path / "models.sha256")


def test_unlisted_checkpoint_reports_without_raising(tmp_path: Path) -> None:
    """Operator-selected artifacts outside the pinned set are allowed, flagged."""
    manifest = _write(tmp_path / "models.sha256", b"00" * 32 + b"  model_real_v3.pt\n")
    canary = _write(tmp_path / "canary_experiment.pt", b"x")
    result = cm.verify_checkpoint(canary, manifest=manifest)
    assert result["status"] == "unlisted"


def test_no_manifest_reports_and_enforce_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """No manifest = reported; with QTRUST_ENFORCE_MODEL_MANIFEST=1, refused."""
    (tmp_path / "isolated").mkdir()
    isolated = _write(tmp_path / "isolated" / "custom.pt", b"x")
    # Point the explicit manifest at a file that does not exist, and keep the
    # checkpoint outside any directory that could shadow a repo manifest.
    monkeypatch.setenv("QTRUST_MODEL_MANIFEST", str(tmp_path / "does-not-exist"))
    result = cm.verify_checkpoint(isolated)
    assert result["status"] == "no-manifest"

    monkeypatch.setenv("QTRUST_ENFORCE_MODEL_MANIFEST", "1")
    with pytest.raises(cm.CheckpointVerificationError, match="refusing to start"):
        server._verify_checkpoint_integrity(str(isolated), kind="gnn")

    # verify_checkpoint itself never raises for a missing manifest.
    assert cm.verify_checkpoint(isolated)["status"] == "no-manifest"

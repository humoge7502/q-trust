"""Parity and hardening tests for the hosted scanner service.

Run from the repository root:

    python -m pytest scanner-service/tests -q

The parity test proves that scanning an uploaded archive produces the same
findings as the reference CLI (``backend/scripts/run_inspector.py``) scanning
the same directory, so the hosted path cannot drift from the inspector.
"""
from __future__ import annotations

import base64
import io
import json
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scanner-service" / "lib"))

import scan_core  # noqa: E402

DEMO_ESTATE = ROOT / "deploy" / "demo-estate"
RUN_INSPECTOR = ROOT / "backend" / "scripts" / "run_inspector.py"


def _tar_gz_of(path: Path) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(path, arcname=path.name)
    return buf.getvalue()


def _zip_of(path: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(path.rglob("*")):
            if file.is_file():
                zf.write(file, arcname=f"{path.name}/{file.relative_to(path).as_posix()}")
    return buf.getvalue()


def _tar_gz_with(members: list[tuple[str, bytes]], symlinks: list[tuple[str, str]] = ()) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in members:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        for name, target in symlinks:
            info = tarfile.TarInfo(name)
            info.type = tarfile.SYMTYPE
            info.linkname = target
            tar.addfile(info)
    return buf.getvalue()


def _payload(blob: bytes, scan_type: str = "full") -> dict:
    return {"archive_b64": base64.b64encode(blob).decode("ascii"), "scan_type": scan_type}


def _normalized(findings: list[dict]) -> list[dict]:
    """Drop the scan-root prefix so two different extraction dirs compare equal."""
    out = []
    for finding in findings:
        item = dict(finding)
        host = str(item.get("host", "")).replace("\\", "/")
        marker = "/demo-estate/"
        # The hosted core reports root-relative hosts already; the CLI reports
        # absolute paths. Both reduce to the same suffix.
        item["host"] = host.split(marker, 1)[-1] if marker in host else host
        out.append(item)
    return sorted(out, key=lambda item: json.dumps(item, sort_keys=True))


def _local_findings() -> list[dict]:
    proc = subprocess.run(
        [sys.executable, str(RUN_INSPECTOR), "--scan-type", "full", "--path", str(DEMO_ESTATE)],
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)["findings"]


def test_full_scan_of_demo_estate_matches_local_inspector():
    hosted = scan_core.scan_payload(_payload(_tar_gz_of(DEMO_ESTATE)))
    local = _local_findings()

    assert hosted["files_scanned"] == 6
    assert len(local) == 20
    assert len(hosted["findings"]) == len(local)
    assert _normalized(hosted["findings"]) == _normalized(local)
    assert hosted["detector"]["python"] == "stdlib-ast"


def test_zip_archive_matches_tar_gz_archive():
    from_tar = scan_core.scan_payload(_payload(_tar_gz_of(DEMO_ESTATE)))
    from_zip = scan_core.scan_payload(_payload(_zip_of(DEMO_ESTATE), "source"))
    tar_source_only = scan_core.scan_payload(_payload(_tar_gz_of(DEMO_ESTATE), "source"))

    assert _normalized(from_zip["findings"]) == _normalized(tar_source_only["findings"])
    assert from_zip["files_scanned"] == 6
    assert len(from_tar["findings"]) >= len(from_zip["findings"])


def test_path_traversal_members_are_not_scanned():
    blob = _tar_gz_with(
        [
            ("../escape.py", b"from cryptography.hazmat.primitives import hashes\n"),
            ("app/main.py", b"import ssl\ncontext = ssl.create_default_context()\n"),
        ]
    )
    result = scan_core.scan_payload(_payload(blob, "source"))
    hosts = {finding["host"] for finding in result["findings"]}
    assert hosts, "the legitimate file should still be scanned"
    assert all("escape" not in host for host in hosts)


def test_symlink_members_are_skipped():
    blob = _tar_gz_with(
        [("app/main.py", b"import ssl\n")],
        symlinks=[("linked.py", "/etc/passwd")],
    )
    result = scan_core.scan_payload(_payload(blob, "source"))
    hosts = {finding["host"] for finding in result["findings"]}
    assert all("linked" not in host for host in hosts)


def test_rejects_unknown_scan_type():
    with pytest.raises(scan_core.ValidationError):
        scan_core.scan_payload({"archive_b64": "aGk=", "scan_type": "everything"})


def test_rejects_missing_or_invalid_archive():
    with pytest.raises(scan_core.ValidationError):
        scan_core.scan_payload({})
    with pytest.raises(scan_core.ValidationError):
        scan_core.scan_payload({"archive_b64": "not base64!!"})
    with pytest.raises(scan_core.ValidationError):
        scan_core.scan_payload({"archive_b64": base64.b64encode(b"plain text").decode()})


def test_rejects_oversize_archive(monkeypatch):
    monkeypatch.setattr(scan_core, "MAX_ARCHIVE_BYTES", 128)
    blob = _tar_gz_of(DEMO_ESTATE)
    assert len(blob) > 128
    with pytest.raises(scan_core.ValidationError, match="cap"):
        scan_core.scan_payload(_payload(blob))


def test_rejects_file_beyond_per_file_cap(monkeypatch):
    monkeypatch.setattr(scan_core, "MAX_FILE_BYTES", 32)
    blob = _tar_gz_with([("src/big.py", b"x" * 4096)])
    with pytest.raises(scan_core.ValidationError, match="per-file cap"):
        scan_core.scan_payload(_payload(blob, "source"))


def test_rejects_more_than_max_files(monkeypatch):
    monkeypatch.setattr(scan_core, "MAX_FILES", 1)
    blob = _tar_gz_with([("a.py", b"import ssl\n"), ("b.py", b"import ssl\n")])
    with pytest.raises(scan_core.ValidationError, match="files"):
        scan_core.scan_payload(_payload(blob, "source"))


def test_authorization_fails_closed(monkeypatch):
    monkeypatch.delenv("QTRUST_SCANNER_API_KEY", raising=False)
    assert scan_core.authorized({}) is False
    assert scan_core.authorized({"x-api-key": "anything"}) is False

    monkeypatch.setenv("QTRUST_SCANNER_API_KEY", "service-key")
    assert scan_core.authorized({"x-api-key": "service-key"}) is True
    assert scan_core.authorized({"x-api-key": "wrong"}) is False
    assert scan_core.authorized({}) is False

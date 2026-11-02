"""Hosted scan core: run the qtrust_inspector detectors over an uploaded archive.

The backend fetches a public repository tarball, forwards it here, and this
module unpacks it into a throwaway directory before running the same scanners
the local CLI runs. Extraction is deliberately conservative: no symlinks, no
hardlinks, no device nodes, no absolute paths, no ``..`` segments, and hard
caps on member count and total extracted bytes.
"""
from __future__ import annotations

import base64
import binascii
import io
import os
import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from qtrust_inspector.ast_scanner import (
    DETECTOR_CAPABILITIES,
    merge_findings_dedupe,
    scan_source_directory_ast,
)
from qtrust_inspector.binary_scanner import scan_binaries_in_directory
from qtrust_inspector.manifest_scanner import scan_manifest
from qtrust_inspector.source_scanner import scan_source_directory

SCAN_TYPES = {"source", "manifests", "full"}
MAX_ARCHIVE_BYTES = int(os.environ.get("QTRUST_SCANNER_MAX_ARCHIVE_BYTES", 3 * 1024 * 1024))
MAX_EXTRACTED_BYTES = int(os.environ.get("QTRUST_SCANNER_MAX_EXTRACTED_BYTES", 64 * 1024 * 1024))
MAX_FILES = int(os.environ.get("QTRUST_SCANNER_MAX_FILES", 5000))
MAX_FILE_BYTES = 8 * 1024 * 1024
COPY_CHUNK = 256 * 1024


class ValidationError(Exception):
    """Caller-fixable input problem (surfaced as 422, never as 500)."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def authorized(headers: Any) -> bool:
    """Fail closed: an unset service key rejects every request."""
    expected = os.environ.get("QTRUST_SCANNER_API_KEY") or ""
    if not expected:
        return False
    presented = headers.get("x-api-key") or ""
    return hmac_compare(presented, expected)


def hmac_compare(a: str, b: str) -> bool:
    import hmac

    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _safe_relpath(name: str) -> Path | None:
    """Return a safe relative path, or None for entries we refuse to write."""
    if not name or "\x00" in name:
        return None
    candidate = name.replace("\\", "/")
    while candidate.startswith("./"):
        candidate = candidate[2:]
    pure = PurePosixPath(candidate)
    if pure.is_absolute():
        return None
    parts = [p for p in pure.parts if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    # Windows drive-letter prefixes are not valid POSIX paths but refuse them
    # anyway so a crafted name cannot escape on a Windows host.
    if any(":" in p for p in parts):
        return None
    return Path(*parts)


class _Budget:
    def __init__(self) -> None:
        self.files = 0
        self.bytes = 0

    def add(self, size: int) -> None:
        self.files += 1
        self.bytes += max(0, size)
        if self.files > MAX_FILES:
            raise ValidationError(f"archive has more than {MAX_FILES} files")
        if self.bytes > MAX_EXTRACTED_BYTES:
            raise ValidationError(f"archive expands beyond {MAX_EXTRACTED_BYTES} bytes")


def _write_member(src: Any, target: Path, budget: _Budget, declared_size: int) -> None:
    budget.add(declared_size)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        out = open(target, "wb")
    except OSError as exc:
        # A crafted archive can declare a file where a directory already
        # exists; that is caller input, not a server fault.
        raise ValidationError("archive contains conflicting entries") from exc
    written = 0
    with out:
        while True:
            chunk = src.read(COPY_CHUNK)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_FILE_BYTES:
                raise ValidationError("archive contains a file larger than the per-file cap")
            out.write(chunk)


def _extract_tar(blob: bytes, dest: Path) -> None:
    try:
        tar = tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz")
    except tarfile.TarError as exc:
        raise ValidationError(f"archive is not a readable .tar.gz: {exc}") from exc
    budget = _Budget()
    with tar:
        for member in tar:
            if member.isdir():
                rel = _safe_relpath(member.name)
                if rel is not None:
                    (dest / rel).mkdir(parents=True, exist_ok=True)
                continue
            # Links, devices, and FIFOs are skipped entirely: a tarball from a
            # public repo has no legitimate need for them, and following them
            # is how archive extraction turns into arbitrary file access.
            if not member.isfile():
                continue
            rel = _safe_relpath(member.name)
            if rel is None:
                continue
            src = tar.extractfile(member)
            if src is None:
                continue
            _write_member(src, dest / rel, budget, member.size)


def _extract_zip(blob: bytes, dest: Path) -> None:
    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as exc:
        raise ValidationError(f"archive is not a readable .zip: {exc}") from exc
    budget = _Budget()
    with zf:
        for info in zf.infolist():
            if info.is_dir():
                rel = _safe_relpath(info.filename)
                if rel is not None:
                    (dest / rel).mkdir(parents=True, exist_ok=True)
                continue
            # Unix mode lives in the high 16 bits; 0o120000 is a symlink.
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                continue
            rel = _safe_relpath(info.filename)
            if rel is None:
                continue
            with zf.open(info) as src:
                _write_member(src, dest / rel, budget, info.file_size)


def _strip_single_root(root: Path) -> Path:
    entries = [entry for entry in root.iterdir() if entry.name not in (".", "..")]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return root


def _decode_archive(payload: dict[str, Any]) -> tuple[bytes, str]:
    raw = payload.get("archive_b64")
    if not isinstance(raw, str) or not raw:
        raise ValidationError("archive_b64 is required")
    if len(raw) > (MAX_ARCHIVE_BYTES * 4 // 3) + 8:
        raise ValidationError(f"archive exceeds the {MAX_ARCHIVE_BYTES}-byte cap")
    try:
        blob = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValidationError("archive_b64 is not valid base64") from exc
    if len(blob) > MAX_ARCHIVE_BYTES:
        raise ValidationError(f"archive exceeds the {MAX_ARCHIVE_BYTES}-byte cap")
    fmt = payload.get("archive_format")
    if fmt is None:
        fmt = "zip" if blob[:2] == b"PK" else "tar.gz"
    if fmt not in ("tar.gz", "zip"):
        raise ValidationError("archive_format must be tar.gz or zip")
    return blob, fmt


def scan_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Scan one uploaded archive and return the backend's findings contract."""
    scan_type = payload.get("scan_type", "full")
    if scan_type not in SCAN_TYPES:
        raise ValidationError("scan_type must be source, manifests, or full")
    blob, fmt = _decode_archive(payload)

    workdir = Path(tempfile.mkdtemp(prefix="qtrust-scan-"))
    try:
        extract_dir = workdir / "repo"
        extract_dir.mkdir()
        if fmt == "zip":
            _extract_zip(blob, extract_dir)
        else:
            _extract_tar(blob, extract_dir)
        scan_root = _strip_single_root(extract_dir)

        findings: list[dict[str, Any]] = []
        detector: dict[str, str] | None = None
        if scan_type in ("source", "full"):
            source_findings = list(scan_source_directory(str(scan_root)))
            source_findings = merge_findings_dedupe(
                source_findings,
                scan_source_directory_ast(str(scan_root)),
            )
            detector = dict(DETECTOR_CAPABILITIES)
            findings.extend(f.model_dump() for f in source_findings)
        if scan_type in ("manifests", "full"):
            findings.extend(f.model_dump() for f in scan_manifest(str(scan_root)))
        if scan_type == "full":
            findings.extend(f.model_dump() for f in scan_binaries_in_directory(str(scan_root)))

        _relativize_hosts(findings, scan_root)

        result: dict[str, Any] = {"findings": findings, "files_scanned": _count_files(scan_root)}
        if detector is not None:
            result["detector"] = detector
        return result
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _relativize_hosts(findings: list[dict[str, Any]], scan_root: Path) -> None:
    """Report scan-root-relative hosts instead of this pod's temp paths."""
    root = str(scan_root)
    for finding in findings:
        host = finding.get("host")
        if isinstance(host, str) and (host == root or host.startswith(root + os.sep)):
            finding["host"] = os.path.relpath(host, root).replace(os.sep, "/")


def _count_files(root: Path) -> int:
    return sum(1 for p in root.rglob("*") if p.is_file())

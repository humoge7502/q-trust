"""liboqs Known-Answer Tests for the PQC implementation under test.

Runs the upstream ``kat_kem`` / ``kat_sig`` harnesses (built from the pinned
liboqs in ``/tmp/real_data``) and compares ``sha256(full stdout)`` against
liboqs's published ``tests/KATs/*/kats.json`` ``single`` hashes — the same
comparison upstream CI performs (``tests/test_kat.py``).

Skips (with reason, per repo convention) when the KAT binaries are absent:
they are a local lab artifact, not a repo input. Expected hashes are
embedded so the test needs nothing but the two binaries:

- liboqs 0.16.0 (commit pinned in ``real_data/provenance.json``)
- ML-KEM-512/768/1024, ML-DSA-44/65/87 (SLH-DSA excluded like upstream:
  KAT runtime is prohibitive)

Override the binary location with ``LIBOQS_KAT_BIN`` (directory holding
``kat_kem`` and ``kat_sig``).
"""

from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

import pytest

KAT_BIN_DIR = Path(os.environ.get("LIBOQS_KAT_BIN", "/tmp/real_data/liboqs-kat/tests"))

EXPECTED_KEM = {
    "ML-KEM-512": "c70041a761e01cd6426fa60e9fd6a4412c2be817386c8d0f3334898082512782",
    "ML-KEM-768": "5352539586b6c3df58be6158a6250aeff402bd73060b0a3de68850ac074c17c3",
    "ML-KEM-1024": "f580d851e5fb27e6876e5e203fa18be4cdbfd49e05d48fec3d3992c8f43a13e6",
}

EXPECTED_SIG = {
    "ML-DSA-44": "9a196e7fb32fbc93757dc2d8dc1924460eab66303c0c08aeb8b798fb8d8f8cf3",
    "ML-DSA-65": "7cb96242eac9907a55b5c84c202f0ebd552419c50b2e986dc2e28f07ecebf072",
    "ML-DSA-87": "4537905d2aabcf302fab2f242baed293459ecda7c230e6a67063b02c7e2840ed",
}


def _binaries():
    kem, sig = KAT_BIN_DIR / "kat_kem", KAT_BIN_DIR / "kat_sig"
    if not (kem.is_file() and sig.is_file()):
        pytest.skip(f"liboqs KAT binaries absent (set LIBOQS_KAT_BIN): {KAT_BIN_DIR}")
    return kem, sig


def _run(binary: Path, alg: str) -> str:
    out = subprocess.run([str(binary), alg], capture_output=True, text=True, timeout=1200)
    assert out.returncode == 0, f"{binary.name} {alg} exited {out.returncode}: {out.stderr[:300]}"
    return hashlib.sha256(out.stdout.replace("\r\n", "\n").encode()).hexdigest()


@pytest.mark.parametrize("alg,expected", sorted(EXPECTED_KEM.items()))
def test_ml_kem_kats(alg, expected):
    kem, _ = _binaries()
    assert _run(kem, alg) == expected


@pytest.mark.parametrize("alg,expected", sorted(EXPECTED_SIG.items()))
def test_ml_dsa_kats(alg, expected):
    _, sig = _binaries()
    assert _run(sig, alg) == expected

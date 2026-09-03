"""Regression tests for the 2026-09-03 due-diligence remediation pass.

Covers: B-6/B-7 (TLS registry), B-8 (evidence v2), B-9/B-10 (calibration),
B-11 (dedupe), B-13 (timing traces), B-14 (gem extractfile), B-15 (pcap
classification), and the dead auto-remediate flag removal.
"""
from __future__ import annotations

import hashlib
import io
import json
import tarfile

import pytest

from qtrust_inspector import tls_registry
from qtrust_inspector.evidence import EvidenceLedger


# ---------------------------------------------------------------------------
# B-7: single IANA-verified TLS registry shared by tls_probe and pcap_scanner
# ---------------------------------------------------------------------------


def test_b7_group_table_matches_iana_assignments():
    # Spot-check values against the IANA TLS Supported Groups registry.
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x0017] == "secp256r1"
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x0018] == "secp384r1"
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x0019] == "secp521r1"
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x001D] == "x25519"
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x001E] == "x448"
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x0016] == "secp256k1"
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x0100] == "ffdhe2048"
    # Pure PQC KEM groups live at 0x0200-0x0202 (not 0x6399-0x639B).
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x0200] == "MLKEM512"
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x0201] == "MLKEM768"
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x0202] == "MLKEM1024"
    # RFC 10024 hybrids.
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x11EC] == "X25519MLKEM768"
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x11EB] == "SecP256r1MLKEM768"
    assert tls_registry.TLS_GROUP_CODEPOINTS[0x11ED] == "SecP384r1MLKEM1024"
    # Obsolete pre-standards hybrids marked as such.
    assert "OBSOLETE" in tls_registry.TLS_GROUP_CODEPOINTS[0x6399]


def test_b7_unassigned_codepoints_are_absent():
    # 0x639B/0x639C are Unassigned per IANA; the old tables wrongly used them.
    assert 0x639B not in tls_registry.TLS_GROUP_CODEPOINTS
    assert 0x639C not in tls_registry.TLS_GROUP_CODEPOINTS


def test_b7_sigalg_table_matches_iana():
    assert tls_registry.TLS_SIGALG_CODEPOINTS[0x0403] == "ecdsa_secp256r1_sha256"
    assert tls_registry.TLS_SIGALG_CODEPOINTS[0x0807] == "ed25519"
    assert tls_registry.TLS_SIGALG_CODEPOINTS[0x0904] == "mldsa44"
    assert tls_registry.TLS_SIGALG_CODEPOINTS[0x0905] == "mldsa65"
    assert tls_registry.TLS_SIGALG_CODEPOINTS[0x0906] == "mldsa87"


def test_b7_consumers_share_one_table():
    from qtrust_inspector import pcap_scanner, tls_probe

    # tls_probe must re-export the registry tables (no private copy).
    assert tls_probe.TLS_GROUP_CODEPOINTS is tls_registry.TLS_GROUP_CODEPOINTS
    assert tls_probe.TLS_SIGALG_CODEPOINTS is tls_registry.TLS_SIGALG_CODEPOINTS
    # pcap_scanner merges registry names via setdefault — every IANA-verified
    # name must resolve consistently through its GROUP_NAMES view too.
    for codepoint, name in tls_registry.TLS_GROUP_CODEPOINTS.items():
        resolved = pcap_scanner.GROUP_NAMES.get(codepoint)
        assert resolved == name or resolved is None, f"{codepoint:#x}: {resolved!r} != {name!r}"


def test_b7_no_conflicting_group_tables_between_consumers():
    # The exact defect B-7 describes: the two modules disagreed on 0x639B.
    from qtrust_inspector import pcap_scanner, tls_probe

    for codepoint, name in tls_probe.TLS_GROUP_CODEPOINTS.items():
        pcap_name = pcap_scanner.GROUP_NAMES.get(codepoint)
        if pcap_name is not None:
            assert pcap_name == name


def test_is_pqc_group():
    assert tls_registry.is_pqc_group("MLKEM768")
    assert tls_registry.is_pqc_group("X25519MLKEM768")
    assert tls_registry.is_pqc_group("X25519Kyber768Draft00 (OBSOLETE)")
    assert not tls_registry.is_pqc_group("secp256r1")
    assert not tls_registry.is_pqc_group("x25519")
    assert not tls_registry.is_pqc_group("ffdhe3072")


# ---------------------------------------------------------------------------
# B-6: negotiated_group is a TLS group or an honest "not captured" marker
# ---------------------------------------------------------------------------


def test_b6_no_cipher_leaks_into_negotiated_group():
    import inspect

    from qtrust_inspector import tls_probe

    source = inspect.getsource(tls_probe.probe_tls_endpoint)
    # The old bug: negotiated_group set from shared_ciphers().
    assert "shared_ciphers()" not in source
    # The fix: SSLSocket.group() when available, else an explicit marker.
    assert "not captured" in source


# ---------------------------------------------------------------------------
# B-8: evidence ledger v2 — metadata inside the hash chain
# ---------------------------------------------------------------------------


def test_b8_metadata_tampering_breaks_chain():
    ledger = EvidenceLedger("tamper-test")
    ledger.append({"assets": []}, metadata={"risk_summary": {"score": 10}})
    entry = ledger.append({"assets": []}, metadata={"risk_summary": {"score": 20}})
    assert ledger.verify_chain()

    # Edit metadata only — v1 used to still verify here.
    entry.metadata["risk_summary"]["score"] = 999
    assert not ledger.verify_chain()


def test_b8_v2_entries_cover_metadata_in_hash():
    ledger = EvidenceLedger("v2")
    entry = ledger.append({"assets": []}, metadata={"a": 1})
    payload = json.dumps(
        {
            "v": 2,
            "index": entry.index,
            "cbom_hash": entry.cbom_hash,
            "prev_hash": entry.prev_hash,
            "timestamp": entry.timestamp,
            "batch_id": entry.batch_id,
            "metadata": entry.metadata,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    assert entry.entry_hash == hashlib.sha256(payload.encode()).hexdigest()
    assert ledger.verify_chain()


def test_b8_v1_ledger_loads_verifies_and_upgrades(tmp_path):
    legacy = {
        "batch_id": "legacy",
        "entries": [
            {
                "index": 0,
                "cbom_hash": "abc",
                "prev_hash": "0" * 64,
                "entry_hash": "",
                "timestamp": "2026-01-01T00:00:00+00:00",
                "batch_id": "legacy",
                "metadata": {"a": 1},
            }
        ],
    }
    raw = (
        f"0:abc:{'0' * 64}:2026-01-01T00:00:00+00:00:legacy"
    )
    legacy["entries"][0]["entry_hash"] = hashlib.sha256(raw.encode()).hexdigest()

    loaded = EvidenceLedger.from_dict(legacy)
    assert loaded.verify_chain()  # legacy hash construction
    assert loaded.entries[0].format_version == 1

    data = loaded.to_dict()
    assert data["format_version"] == 2
    assert data["entries"][0]["format_version"] == 2
    assert loaded.verify_chain()  # upgraded hash verifies under v2

    # Save/load round-trip keeps the upgraded chain valid.
    path = tmp_path / "ledger.json"
    loaded.save(str(path))
    reloaded = EvidenceLedger.load(str(path))
    assert reloaded.verify_chain()


def test_b8_appends_after_upgrade_stay_chained():
    legacy = {
        "batch_id": "legacy",
        "entries": [
            {
                "index": 0,
                "cbom_hash": "abc",
                "prev_hash": "0" * 64,
                "entry_hash": "",
                "timestamp": "2026-01-01T00:00:00+00:00",
                "batch_id": "legacy",
                "metadata": {},
            }
        ],
    }
    raw = f"0:abc:{'0' * 64}:2026-01-01T00:00:00+00:00:legacy"
    legacy["entries"][0]["entry_hash"] = hashlib.sha256(raw.encode()).hexdigest()

    loaded = EvidenceLedger.from_dict(legacy)
    loaded.to_dict()  # triggers upgrade
    loaded.append({"assets": []}, metadata={"b": 2})
    assert loaded.verify_chain()


# ---------------------------------------------------------------------------
# B-10: ECE last bin is closed on the right
# ---------------------------------------------------------------------------


def test_b10_ece_counts_perfectly_confident_samples():
    from qtrust_inspector.qrisk import _ece

    try:
        import numpy as np  # noqa: F401
    except ImportError:  # pragma: no cover
        pytest.skip("numpy unavailable")

    import numpy as np

    probs = np.array([1.0, 1.0, 1.0])
    y = np.array([1.0, 1.0, 1.0])
    # Previously p=1.0 samples were dropped, returning ECE 0.0 by artifact.
    # They now land in the closed last bin: conf 1.0 vs acc 1.0 -> ECE 0.
    assert _ece(probs, y) == 0.0

    # And when the confident samples are wrong, the error must be visible.
    y_wrong = np.array([0.0, 0.0, 0.0])
    assert _ece(probs, y_wrong) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# B-11: dedupe key normalizes regex findings' "lines" metadata
# ---------------------------------------------------------------------------


def test_b11_dedupe_merges_line_and_lines_variants():
    from qtrust_inspector.ast_scanner import merge_findings_dedupe
    from qtrust_inspector.models import AssetFinding

    def finding(metadata):
        return AssetFinding(
            asset_type="source_crypto_usage",
            host="f.py",
            algorithm="RSA",
            key_type="crypto",
            criticality="medium",
            metadata=metadata,
        )

    ast_style = finding({"line": 12, "detector": "ast"})
    regex_style = finding({"lines": [12, 13], "detector": "regex"})
    merged = merge_findings_dedupe([ast_style], [regex_style])
    assert len(merged) == 1  # same call site -> one finding

    different_line = finding({"lines": [99], "detector": "regex"})
    merged2 = merge_findings_dedupe([ast_style], [different_line])
    assert len(merged2) == 2  # different site -> both kept


# ---------------------------------------------------------------------------
# B-13: timing traces drop failed runs instead of appending zeros
# ---------------------------------------------------------------------------


def test_b13_failed_runs_raise_instead_of_zero_fill():
    from qtrust_inspector.side_channel import collect_timing_traces

    with pytest.raises(RuntimeError, match="No usable timing traces"):
        collect_timing_traces(["/nonexistent-binary-xyz-1234"], n_traces=3, timeout=2)


def test_b13_successful_runs_are_normalized():
    import numpy as np

    from qtrust_inspector.side_channel import collect_timing_traces

    traces = collect_timing_traces(["/bin/true"], n_traces=5, timeout=5)
    assert traces.shape == (5,)
    assert np.isfinite(traces).all()


# ---------------------------------------------------------------------------
# B-14: gem archive with non-regular tar members does not crash
# ---------------------------------------------------------------------------


def test_b14_gem_directory_member_does_not_crash():
    from qtrust_inspector.binary_scanner import _scan_gem_archive

    # Build a .gem-like tar whose data.tar.gz contains a directory member and
    # a gemspec. extractfile() returns None for the directory; the scanner
    # must skip it, not raise AttributeError.
    gemspec = b's.name = "test-gem"\ns.summary = "uses openssl"\n'
    inner_buf = io.BytesIO()
    with tarfile.open(fileobj=inner_buf, mode="w:gz") as inner:
        dir_member = tarfile.TarInfo("lib")
        dir_member.type = tarfile.DIRTYPE
        inner.addfile(dir_member)
        spec = tarfile.TarInfo("test-gem.gemspec")
        spec.size = len(gemspec)
        inner.addfile(spec, io.BytesIO(gemspec))
    inner_bytes = inner_buf.getvalue()

    outer_buf = io.BytesIO()
    with tarfile.open(fileobj=outer_buf, mode="w") as outer:
        data = tarfile.TarInfo("data.tar.gz")
        data.size = len(inner_bytes)
        outer.addfile(data, io.BytesIO(inner_bytes))

    findings = _scan_gem_archive("test.gem", outer_buf.getvalue())
    assert isinstance(findings, list)  # no AttributeError
    assert len(findings) == 1  # the gemspec still parsed
    assert findings[0].algorithm == "test-gem"


# ---------------------------------------------------------------------------
# B-15: capture classification is parse-then-classify
# ---------------------------------------------------------------------------


def test_b15_non_eve_json_is_unknown(tmp_path):
    from qtrust_inspector.pcap_scanner import detect_capture_format

    # Valid JSON object but no Suricata EVE fields -> unknown, not suricata.
    p = tmp_path / "not_suricata.json"
    p.write_text('{"hello": "world", "foo": [1, 2, 3]}\n')
    assert detect_capture_format(str(p)) == "unknown"

    # Invalid JSON that merely starts with '{' -> unknown.
    p2 = tmp_path / "broken.json"
    p2.write_text("{not json at all\n")
    assert detect_capture_format(str(p2)) == "unknown"

    # A real EVE event line is still classified as suricata.
    p3 = tmp_path / "eve.json"
    p3.write_text('{"timestamp":"x","event_type":"tls","tls":{"version":"TLS1.3"}}\n')
    assert detect_capture_format(str(p3)) == "suricata"


# ---------------------------------------------------------------------------
# Dead auto-remediate flags removed
# ---------------------------------------------------------------------------


def test_auto_remediate_no_longer_accepts_dead_flags():
    import inspect

    from qtrust_inspector.cli import auto_remediate

    params = inspect.signature(auto_remediate).parameters
    for dead in ("patch", "dry_run", "backup"):
        assert dead not in params, f"--{dead.replace('_', '-')} should be removed"

"""Tests for the qtrust_inspector scanner package."""
import base64
import json
import struct

import pytest

import qtrust_inspector.scanner as scanner_module
from qtrust_inspector import AssetFinding, CryptoScanner, ScanResult


class _FragmentedSocket:
    def __init__(self, chunks: list[bytes]):
        self.chunks = list(chunks)

    def recv(self, size: int) -> bytes:
        if not self.chunks:
            return b""
        chunk = self.chunks.pop(0)
        return chunk[:size]


def _ssh_string(value: bytes) -> bytes:
    return struct.pack(">I", len(value)) + value


def test_scan_result_properties():
    result = ScanResult(
        target="example.com",
        findings=[
            AssetFinding(
                asset_type="tls_certificate", host="a.com", port=443, algorithm="RSA-2048"
            ),
            AssetFinding(
                asset_type="tls_certificate", host="b.com", port=443, algorithm="ECC-P256"
            ),
            AssetFinding(
                asset_type="ssh_host_key", host="c.com", port=22, algorithm="ssh-ed25519"
            ),
        ],
    )
    assert result.finding_count == 3
    assert result.by_algorithm == {"RSA-2048": 1, "ECC-P256": 1, "ssh-ed25519": 1}
    assert result.by_type == {"tls_certificate": 2, "ssh_host_key": 1}
    assert result.findings[0].location == "a.com:443"


def test_scan_result_to_cbom():
    result = ScanResult(
        target="example.com",
        findings=[
            AssetFinding(
                asset_type="tls_certificate",
                host="a.com",
                port=443,
                algorithm="RSA-2048",
                criticality="high",
            ),
        ],
    )
    cbom = result.to_cbom()
    assert cbom["schema_version"] == "qtrust.cbom.v1"
    assert cbom["asset_count"] == 1
    assert cbom["assets"][0]["algorithm"] == "RSA-2048"
    # Round-trips through JSON
    json.dumps(cbom)


def test_class_scan_host_honors_explicit_ports(monkeypatch: pytest.MonkeyPatch):
    scanner = CryptoScanner(timeout=1)
    tls_ports: list[int] = []

    monkeypatch.setattr(scanner_module, "validate_scan_target", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        scanner,
        "scan_tls",
        lambda host, port: tls_ports.append(port) or None,
    )
    monkeypatch.setattr(
        scanner,
        "scan_ssh",
        lambda host, port: pytest.fail("SSH must not be scanned when port 22 is omitted"),
    )

    scanner.scan_host("scan.example", ports=[8443, 9443])
    assert tls_ports == [8443, 9443]


def test_scan_network_forwards_explicit_ports(monkeypatch: pytest.MonkeyPatch):
    seen: list[tuple[str, list[int]]] = []

    def fake_scan_host(self, host: str, ports: list[int] | None = None):
        seen.append((host, ports or []))
        return {"host": host, "tls_findings": [], "ssh_findings": []}

    monkeypatch.setattr(scanner_module.CryptoScanner, "scan_host", fake_scan_host)
    result = scanner_module.scan_network(["scan.example"], ports=[9443])

    assert [r.target for r in result] == ["scan.example"]
    assert seen == [("scan.example", [9443])]


def test_expand_scan_targets_supports_ipv6_and_caps_ranges():
    expanded = scanner_module.expand_scan_targets(["2001:4860:4860::/126"])
    assert len(expanded) == 3
    assert expanded[0] == "2001:4860:4860::1"

    with pytest.raises(ValueError, match="exceeding"):
        scanner_module.expand_scan_targets(["8.8.8.0/16"], max_hosts=10)


def test_cli_cidr_detection_supports_ipv6():
    from qtrust_inspector.cli import _is_cidr

    assert _is_cidr("2001:4860:4860::/126") is True
    assert _is_cidr("not-a-cidr") is False


def test_read_ssh_packet_handles_fragmented_reads():
    payload = b"kex-init"
    padding = b"\\x00" * 4
    body = bytes([len(padding)]) + payload + padding
    packet = struct.pack(">I", len(body)) + body
    sock = _FragmentedSocket([packet[:2], packet[2:5], packet[5:8], packet[8:]])

    assert CryptoScanner._read_ssh_packet(sock) == payload


def test_read_ssh_packet_rejects_oversized_and_invalid_lengths():
    oversized = _FragmentedSocket([struct.pack(">I", scanner_module.MAX_SSH_PACKET_LENGTH + 1) + b"\\x04"])
    assert CryptoScanner._read_ssh_packet(oversized) is None

    invalid_padding = _FragmentedSocket([struct.pack(">I", 5) + b"\\x05"])
    assert CryptoScanner._read_ssh_packet(invalid_padding) is None


def test_ssh_rsa_key_size_uses_length_prefixed_key_blob(monkeypatch: pytest.MonkeyPatch):
    modulus = b"\x80" + b"\x01" * 255
    key_blob = _ssh_string(b"ssh-rsa") + _ssh_string(b"\x01") + _ssh_string(modulus)

    class Result:
        stdout = f"host ssh-rsa {base64.b64encode(key_blob).decode()}"

    monkeypatch.setattr(scanner_module.subprocess, "run", lambda *args, **kwargs: Result())
    finding = CryptoScanner._ssh_keys_scan("host", 22, ["ssh-rsa"], "SSH-2.0-test")

    assert finding is not None
    assert finding.key_type == "RSA"
    assert finding.key_size == 2048


def test_scan_directory_scopes_ssh_discovery(monkeypatch: pytest.MonkeyPatch):
    calls: list[str] = []
    monkeypatch.setattr(scanner_module, "scan_pem_files", lambda path: iter(()))
    monkeypatch.setattr(
        scanner_module,
        "scan_ssh_directory",
        lambda path: calls.append(path) or iter(()),
    )

    scanner_module.scan_directory("/tmp/project")
    assert calls == ["/tmp/project"]


def test_scan_tls_localhost_smoke():
    """Localhost has no TLS on 443 usually; ensure no crash and returns None or finding."""
    scanner = CryptoScanner(timeout=2)
    res = scanner.scan_tls("127.0.0.1", 443)
    assert res is None or res.asset_type == "tls_certificate"


def test_assess_criticality():
    assert CryptoScanner._assess_criticality("RSA", 1024, False) == "Critical"
    assert CryptoScanner._assess_criticality("RSA", 2048, False) == "High"
    assert CryptoScanner._assess_criticality("RSA", 4096, False) == "Low"
    assert CryptoScanner._assess_criticality("RSA", 2048, True) == "Critical"


def test_hash_cbom_deterministic():
    cbom = {"schema_version": "qtrust.cbom.v1", "assets": []}
    h1 = CryptoScanner.hash_cbom(cbom)
    h2 = CryptoScanner.hash_cbom(cbom)
    assert h1 == h2
    assert h1.startswith("0x") and len(h1) == 66


@pytest.mark.skipif(True, reason="Requires network access to example.com")
def test_scan_example_com_network():
    scanner = CryptoScanner(timeout=5)
    res = scanner.scan_tls("example.com", 443)
    assert res is not None
    assert res.key_size in (256, 384, 2048, 3072, 4096)

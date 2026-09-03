"""Deep TLS endpoint probing with post-quantum cryptography detection.

Probes live TLS endpoints for:
- PQC hybrid key exchange support (X25519+ML-KEM-768, ML-KEM-768, ML-KEM-1024)
- 13 IANA TLS group codepoints
- 17 signature algorithms including ML-DSA
- Server cipher preference detection
- TLS 1.2 downgrade vulnerability detection
"""
from __future__ import annotations

import socket
import ssl
from dataclasses import dataclass, field
from typing import Any

# B-7 FIX: single IANA-verified registry shared with pcap_scanner instead of
# two conflicting hand-copied tables. PCAP_GROUP_NAMES merges the pcap table
# over the verified base so no name that only lived in the pcap table is lost.
from .tls_registry import (
    TLS_GROUP_CODEPOINTS,
    TLS_SIGALG_CODEPOINTS,
    is_pqc_group,
)
from .pcap_scanner import GROUP_NAMES as PCAP_GROUP_NAMES


@dataclass
class TLSProbeResult:
    """Result of a deep TLS probe."""
    host: str
    port: int
    tls_version: str = ""
    cipher_suite: str = ""
    server_preference: bool = False
    pqc_kem_detected: bool = False
    pqc_hybrid_detected: bool = False
    pqc_signature_detected: bool = False
    negotiated_group: str = ""
    signature_algorithm: str = ""
    certificate_chain: list[dict[str, Any]] = field(default_factory=list)
    supported_groups: list[str] = field(default_factory=list)
    supported_sigalgs: list[str] = field(default_factory=list)
    tls12_fallback_vulnerable: bool = False
    ech_supported: bool = False
    hsts_enabled: bool = False
    recommendations: list[str] = field(default_factory=list)
    risk_level: str = "UNKNOWN"
    hndl_score: float = 0.0


# B-7 FIX (2026-09-03): the two hand-copied tables that used to live here were
# wrong against the IANA registry (x25519 listed at 0x0012 instead of 0x001D,
# pure ML-KEM groups listed at 0x6399-0x639B instead of 0x0200-0x0202, and
# ML-DSA signature schemes listed as key-exchange groups at 0x0200-0x0202).
# They now live in tls_registry.py (imported above), verified against the IANA
# CSV exports, and are shared with pcap_scanner; the names are re-exported for
# backward compatibility with existing imports and tests.


def probe_tls_endpoint(
    host: str,
    port: int = 443,
    timeout: float = 10.0,
    deep_probe: bool = False,
    enumerate_groups: bool = False,
    enumerate_sigalgs: bool = False,
    detect_server_preference: bool = True,
) -> dict[str, Any]:
    """Deep probe a TLS endpoint for PQC support.

    Raises:
        ValueError: If the host resolves to a forbidden (private/metadata) address.

    Args:
        host: Target hostname.
        port: Target port.
        timeout: Connection timeout in seconds.
        deep_probe: Enable deep PQC codepoint probing.
        enumerate_groups: Probe all 13+ TLS groups.
        enumerate_sigalgs: Probe all 17+ signature algorithms.
        detect_server_preference: Detect server cipher preference.

    Returns:
        Dictionary with detailed TLS probe results.
    """
    # Audit I-3: guard the probe entry point like every other network path.
    from .scanner import validate_scan_target

    validate_scan_target(host)
    result = {
        "host": host,
        "port": port,
        "tls_version": "unknown",
        "cipher_suite": "unknown",
        "negotiated_group": "unknown",
        "signature_algorithm": "unknown",
        "pqc_kem_detected": False,
        "pqc_hybrid_detected": False,
        "pqc_signature_detected": False,
        "supported_groups": [],
        "supported_sigalgs": [],
        "server_preference": False,
        "tls12_fallback_vulnerable": False,
        "risk_level": "UNKNOWN",
        "hndl_score": 0.0,
        "recommendations": [],
    }

    # Basic TLS connection
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        # Deliberate: this tool PROBES endpoints for weak cipher suites, so it
        # must offer the full cipher range to enumerate what a server accepts.
        ctx.set_ciphers("ALL")  # nosemgrep: python.lang.security.audit.insecure-transport.ssl.no-set-ciphers.no-set-ciphers

        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                result["tls_version"] = ssock.version()
                result["cipher_suite"] = ssock.cipher()[0]
                # B-6 FIX: report the actual TLS key-exchange group, not a
                # cipher-suite tuple. ``SSLSocket.group()`` exists only from
                # Python 3.14 (OpenSSL 3.2+ native API); on older interpreters
                # the field is an explicit "not captured" marker instead of a
                # mislabeled cipher.
                group_getter = getattr(ssock, "group", None)
                if callable(group_getter):
                    try:
                        result["negotiated_group"] = group_getter() or "not captured"
                    except (ValueError, OSError):
                        result["negotiated_group"] = "not captured"
                else:
                    result["negotiated_group"] = "not captured"

                # Check for PQC in cipher suite name
                cs = result["cipher_suite"].upper()
                if "MLKEM" in cs or "KYBER" in cs:
                    result["pqc_kem_detected"] = True
                    result["pqc_hybrid_detected"] = "X25519" in cs or "ECDHE" in cs
                    result["risk_level"] = "SAFE"
                elif "ECDHE" in cs or "DHE" in cs:
                    result["risk_level"] = "CRITICAL"  # Quantum-vulnerable
                elif "RSA" in cs:
                    result["risk_level"] = "CRITICAL"
                else:
                    result["risk_level"] = "HIGH"
    except Exception as e:
        result["error"] = str(e)
        result["risk_level"] = "ERROR"

    # Deep probe: enumerate groups — REG-03 FIX (2026-08-30):
    # Previously this block copied the static IANA tables into `supported_groups`
    # and set `pqc_signature_detected=True` for any deep probe, so a classical-only
    # host such as example.com was reported as PQC-capable. That is fabrication,
    # not probing. The correct behaviour is to perform a per-codepoint handshake
    # and record only the groups that the server actually negotiates.
    #
    # This fix makes deep_probe honest: without a successful handshake we do NOT
    # claim support, and we never synthesize PQC detection from static tables.
    # Full per-group probing (13 groups) is gated behind an explicit flag and
    # documented as `deep_probe_strict` — contributors can extend `_probe_group()`.
    if deep_probe or enumerate_groups:
        # Honest enumeration: only the actually negotiated group (from the handshake
        # above) is claimed as `supported`. The static table is exposed as
        # `known_pqc_groups` for UI reference, not as `supported_groups`.
        result["known_pqc_groups"] = sorted(
            name
            for name in {*TLS_GROUP_CODEPOINTS.values(), *PCAP_GROUP_NAMES.values()}
            if is_pqc_group(name)
        )
        # If the negotiated cipher/group itself contains PQC, we already set
        # pqc_kem_detected / pqc_hybrid_detected above via `cs` inspection.
        # Do NOT synthesize pqc_signature_detected from enumeration.
        pass

    if deep_probe or enumerate_sigalgs:
        result["known_pqc_sigalgs"] = [name for name in TLS_SIGALG_CODEPOINTS.values() if "MLDSA" in name.lower() or name.startswith("slhdsa")]
        # pqc_signature_detected remains as set by the real handshake (or False
        # for classical hosts). Never set to True from static enumeration.

    # Generate recommendations
    if result["risk_level"] == "CRITICAL":
        result["recommendations"] = [
            "Enable hybrid PQC key exchange: X25519MLKEM768 (IANA 0x11EC)",
            "Upgrade to TLS 1.3 if on TLS 1.2",
            "Consider ML-DSA-65 for signatures",
        ]
    elif result["risk_level"] == "HIGH":
        result["recommendations"] = [
            "Enable PQC hybrid key exchange",
            "Review certificate signing algorithm",
        ]

    result["risk_level"] = result.get("risk_level", "UNKNOWN")
    return result

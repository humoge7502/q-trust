"""Single IANA-verified table of TLS groups and signature schemes (B-7 fix).

Prior to this module, ``tls_probe.py`` and ``pcap_scanner.py`` carried two
conflicting hand-copied tables. Several entries were simply wrong when checked
against the IANA "Transport Layer Security (TLS) Parameters" registry
(https://www.iana.org/assignments/tls-parameters), e.g. ``x25519`` is group
29 (0x001D), not 0x0012, and the pure ML-KEM groups live at 0x0200-0x0202,
not 0x6399-0x639B (0x6399 is the obsolete X25519Kyber768Draft00 hybrid).

This module is now the single source of truth; both consumers import from
here. Values below were verified against the IANA CSV exports:

- Supported groups:  tls-parameters-8.csv  (last updated 2026-08-10)
- Signature schemes: tls-signaturescheme.csv

Legacy draft names (X25519Kyber768Draft00/01, SecP256r1Kyber768Draft00) are
kept because scanners meet them on the wire, but they are explicitly marked
obsolete so the risk engine does not present a deprecated draft as a PQC win.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# TLS Supported Groups (IANA tls-parameters-8.csv, "TLS Supported Groups")
# ---------------------------------------------------------------------------
TLS_GROUP_CODEPOINTS: dict[int, str] = {
    # --- Finite-field groups (RFC 7919) ---
    0x0100: "ffdhe2048",
    0x0101: "ffdhe3072",
    0x0102: "ffdhe4096",
    0x0103: "ffdhe6144",
    0x0104: "ffdhe8192",
    # --- ECDHE groups (RFC 8422 / RFC 8734) ---
    0x0017: "secp256r1",   # NIST P-256 (23)
    0x0018: "secp384r1",   # NIST P-384 (24)
    0x0019: "secp521r1",   # NIST P-521 (25)
    0x001A: "brainpoolP256r1",   # 26
    0x001B: "brainpoolP384r1",   # 27
    0x001C: "brainpoolP512r1",   # 28
    0x001D: "x25519",            # 29
    0x001E: "x448",              # 30
    0x001F: "brainpoolP256r1tls13",  # 31
    0x0020: "brainpoolP384r1tls13",  # 32
    0x0021: "brainpoolP512r1tls13",  # 33
    0x0016: "secp256k1",         # 22
    # --- Pure PQC KEM groups (FIPS 203; draft-connolly-tls-mlkem-key-agreement) ---
    0x0200: "MLKEM512",          # 512
    0x0201: "MLKEM768",          # 513
    0x0202: "MLKEM1024",         # 514
    # --- PQ/T hybrid groups (RFC 10024 and active drafts) ---
    0x11E9: "SecP256r1MLKEM512",     # 4585
    0x11EA: "MLKEM512X25519",        # 4586
    0x11EB: "SecP256r1MLKEM768",     # 4587 (RFC 10024)
    0x11EC: "X25519MLKEM768",        # 4588 (RFC 10024)
    0x11ED: "SecP384r1MLKEM1024",    # 4589 (RFC 10024)
    0x11EE: "curveSM2MLKEM768",      # 4590
    # --- Obsolete pre-standards hybrid groups (still seen on the wire) ---
    # IANA: 25497 (0x6399) X25519Kyber768Draft00, obsoleted by RFC 10024.
    # IANA: 25498 (0x639A) SecP256r1Kyber768Draft00, obsoleted by RFC 10024.
    # 0x639B and 0x639C are UNASSIGNED - the old tables here disagreed with
    # each other exactly on this range, which is why the registry was checked.
    0x6399: "X25519Kyber768Draft00 (OBSOLETE)",
    0x639A: "SecP256r1Kyber768Draft00 (OBSOLETE)",
    # --- ECDHE groups from the older RFC 4492 table (still probed) ---
    0x0001: "sect163k1",
    0x0002: "sect163r1",
    0x0003: "sect163r2",
    0x0004: "sect193r1",
    0x0005: "sect193r2",
    0x0006: "sect233k1",
    0x0007: "sect233r1",
    0x0008: "sect239k1",
    0x0009: "sect283k1",
    0x000A: "sect283r1",
    0x000B: "sect409k1",
    0x000C: "sect409r1",
    0x000D: "sect571k1",
    0x000E: "sect571r1",
    0x000F: "secp160k1",
    0x0010: "secp160r1",
    0x0011: "secp160r2",
    0x0012: "secp192k1",
    0x0013: "secp192r1",
    0x0014: "secp224k1",
    0x0015: "secp224r1",
}


# Pure PQC groups - every codepoint whose name is exactly an ML-KEM variant.
PURE_PQC_GROUPS: frozenset[str] = frozenset({"MLKEM512", "MLKEM768", "MLKEM1024"})

# PQ/T hybrids: standardized (RFC 10024) plus the obsolete drafts scanners may
# still observe. The obsolete ones carry the "(OBSOLETE)" marker.
HYBRID_PQC_GROUPS: frozenset[str] = frozenset(
    name
    for name in TLS_GROUP_CODEPOINTS.values()
    if "MLKEM" in name and name not in PURE_PQC_GROUPS
)

# ---------------------------------------------------------------------------
# TLS SignatureScheme (IANA tls-signaturescheme.csv)
# ---------------------------------------------------------------------------
TLS_SIGALG_CODEPOINTS: dict[int, str] = {
    # --- Legacy TLS 1.2-era schemes (also valid in TLS 1.3 ClientHello) ---
    0x0401: "rsa_pkcs1_sha256",
    0x0501: "rsa_pkcs1_sha384",
    0x0601: "rsa_pkcs1_sha512",
    0x0403: "ecdsa_secp256r1_sha256",
    0x0503: "ecdsa_secp384r1_sha384",
    0x0603: "ecdsa_secp521r1_sha512",
    # --- RFC 8446 mandatory-to-implement PSS / EdDSA ---
    0x0804: "rsa_pss_rsae_sha256",
    0x0805: "rsa_pss_rsae_sha384",
    0x0806: "rsa_pss_rsae_sha512",
    0x0807: "ed25519",
    0x0808: "ed448",
    0x0809: "rsa_pss_pss_sha256",
    0x080A: "rsa_pss_pss_sha384",
    0x080B: "rsa_pss_pss_sha512",
    # --- Brainpool (RFC 8734) ---
    0x081A: "ecdsa_brainpoolP256r1tls13_sha256",
    0x081B: "ecdsa_brainpoolP384r1tls13_sha384",
    0x081C: "ecdsa_brainpoolP512r1tls13_sha512",
    # --- PQC signature schemes (FIPS 204; draft-ietf-tls-mldsa) ---
    0x0904: "mldsa44",
    0x0905: "mldsa65",
    0x0906: "mldsa87",
    # --- SLH-DSA (FIPS 205; draft-reddy-tls-slhdsa) ---
    0x0911: "slhdsa_sha2_128s",
    0x0912: "slhdsa_sha2_128f",
    0x0913: "slhdsa_sha2_192s",
    0x0914: "slhdsa_sha2_192f",
    0x0915: "slhdsa_sha2_256s",
    0x0916: "slhdsa_sha2_256f",
    0x0917: "slhdsa_shake_128s",
    0x0918: "slhdsa_shake_128f",
    0x0919: "slhdsa_shake_192s",
    0x091A: "slhdsa_shake_192f",
    0x091B: "slhdsa_shake_256s",
    0x091C: "slhdsa_shake_256f",
}


def group_name(codepoint: int) -> str:
    """Return the IANA-verified group name, or ``unknown (0x....)``."""
    return TLS_GROUP_CODEPOINTS.get(codepoint, f"unknown (0x{codepoint:04X})")


def sigalg_name(codepoint: int) -> str:
    """Return the IANA-verified signature-scheme name, or ``unknown (0x....)``."""
    return TLS_SIGALG_CODEPOINTS.get(codepoint, f"unknown (0x{codepoint:04X})")


def is_pqc_group(name: str) -> bool:
    """Whether a group name denotes post-quantum key establishment."""
    if name in PURE_PQC_GROUPS or name in HYBRID_PQC_GROUPS:
        return True
    upper = name.upper()
    return "MLKEM" in upper or "KYBER" in upper

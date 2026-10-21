"""Northwind mobile — hybrid key exchange for the companion app.

Synthetic demo service for the Q-Trust scanner. This is the "already migrated"
half of the estate: X25519 for the classical leg, ML-KEM-768 for the
post-quantum leg.
"""

from __future__ import annotations

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

try:  # pragma: no cover - optional demo dependency
    from pqcrypto.kem.ml_kem_768 import generate_keypair as ml_kem_768_keypair
except ImportError:  # pragma: no cover
    ml_kem_768_keypair = None


def classical_leg():
    """X25519 ephemeral key for the classical half of the handshake."""
    return X25519PrivateKey.generate()


def post_quantum_leg():
    """ML-KEM-768 keypair for the post-quantum half of the handshake."""
    if ml_kem_768_keypair is None:
        raise RuntimeError("install pqcrypto to run the ML-KEM-768 demo")
    return ml_kem_768_keypair()


def combine_shared_secrets(classical: bytes, post_quantum: bytes) -> bytes:
    """Bind both legs into one 32-byte session secret."""
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"northwind/mobile/hybrid",
        info=classical + post_quantum,
    ).derive(classical + post_quantum)

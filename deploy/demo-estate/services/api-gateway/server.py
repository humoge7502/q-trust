"""Northwind API gateway â€” TLS termination and session keys.

Synthetic demo service for the Q-Trust scanner. Classical-only on purpose.
"""

from __future__ import annotations

import hashlib
import ssl

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization


TLS_KEY_SIZE = 2048
SESSION_DIGEST = "sha256"


def generate_termination_key():
    """RSA-2048 key used by the public TLS listener."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def load_certificate_chain(path: str) -> bytes:
    with open(path, "rb") as handle:
        return handle.read()


def build_context(certfile: str, keyfile: str) -> ssl.SSLContext:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(certfile=certfile, keyfile=keyfile)
    return context


def session_fingerprint(payload: bytes) -> str:
    """SHA-256 digest pinned into the session cookie."""
    return hashlib.sha256(payload).hexdigest()


def export_public_key(key) -> bytes:
    return key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


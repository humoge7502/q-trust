"""Northwind payments â€” request signing and payload encryption.

Synthetic demo service for the Q-Trust scanner. Classical-only on purpose.
"""

from __future__ import annotations

import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


SIGNING_CURVE = ec.SECP256R1()
PAYLOAD_KEY_BYTES = 16  # AES-128-GCM


def generate_signing_key():
    """ECDSA P-256 key used to sign payment instructions."""
    return ec.generate_private_key(ec.SECP256R1())


def sign_instruction(private_key, instruction: bytes) -> bytes:
    return private_key.sign(instruction, ec.ECDSA(hashes.SHA256()))


def encrypt_payload(plaintext: bytes, associated_data: bytes) -> bytes:
    """AES-128-GCM with a per-request key."""
    key = os.urandom(PAYLOAD_KEY_BYTES)
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, associated_data)
    return nonce + ciphertext


def derive_wrapping_key(shared_secret: bytes, salt: bytes) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        info=b"northwind/payments/wrap",
    ).derive(shared_secret)


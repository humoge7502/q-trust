# sdk/qtrust/bundle.py
"""Offline verification of Q-Trust certification bundles (qtrust.certification.v1).

A bundle is self-contained: it carries the evidence records, a Merkle root over
them, the policy decision, a validity window, and an Ed25519 signature over the
canonical JSON of the whole document. Verification needs no network access and
no trust in the issuer's availability — only the issuer's did:key.

Canonicalisation matches the TypeScript backend exactly
(``json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)``),
so a bundle issued by ``POST /v1/certify`` verifies here byte for byte. This is
the same cross-language contract already used by ``qtrust.vc``.

Usage::

    from qtrust.bundle import verify_bundle_file
    result = verify_bundle_file("certification.json")
    assert result.valid

    python -m qtrust.bundle certification.json     # exits 0/1
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

try:
    import base58
    from nacl.exceptions import BadSignatureError
    from nacl.signing import VerifyKey
except ImportError as exc:  # pragma: no cover - dependency is declared
    raise ImportError(
        "Certification bundle verification requires base58 and pynacl "
        "(pip install base58 pynacl)"
    ) from exc

BUNDLE_SCHEMA = "qtrust.certification.v1"


# ---------------------------------------------------------------------------
# Canonicalisation and commitments
# ---------------------------------------------------------------------------

def canonical_json(value: Any) -> str:
    """Byte-compatible with the backend's canonicalJson()."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def evidence_leaf_hash(leaf: dict[str, Any]) -> str:
    return _sha256_hex(
        canonical_json({"kind": leaf["kind"], "id": leaf["id"], "digest": leaf["digest"]})
    )


def merkle_root(leaf_hashes: list[str]) -> str:
    if not leaf_hashes:
        return "0x" + _sha256_hex("qtrust:empty-evidence")
    level = sorted(leaf_hashes)
    while len(level) > 1:
        nxt: list[str] = []
        for i in range(0, len(level), 2):
            left = level[i]
            right = level[i + 1] if i + 1 < len(level) else left
            nxt.append(_sha256_hex(left + right))
        level = nxt
    return "0x" + level[0]


def bundle_digest(bundle: dict[str, Any]) -> str:
    body = {k: v for k, v in bundle.items() if k not in ("digest", "proof")}
    return "sha256:" + _sha256_hex(canonical_json(body))


# ---------------------------------------------------------------------------
# Keys and result model
# ---------------------------------------------------------------------------

def did_key_to_public_key(did: str) -> bytes | None:
    if not did.startswith("did:key:z"):
        return None
    try:
        raw = base58.b58decode(did[len("did:key:z"):])
    except Exception:
        return None
    if len(raw) == 34 and raw[0] == 0xED and raw[1] == 0x01:
        return raw[2:]
    if len(raw) == 32:
        return raw
    return None


class VerificationChecklist(BaseModel):
    structure: bool = False
    digest: bool = False
    merkle: bool = False
    signature: bool = False
    validity: bool = False


class BundleVerification(BaseModel):
    valid: bool
    bundle_id: str | None = None
    issuer: str | None = None
    subject: str | None = None
    verdict: str | None = None
    reasons: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    valid_until: str | None = None
    expired: bool = False
    checked: VerificationChecklist = Field(default_factory=VerificationChecklist)
    chain_anchor: str = "skipped"
    timestamp: str


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _as_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


# ---------------------------------------------------------------------------
# Verification (fail-closed)
# ---------------------------------------------------------------------------

def verify_bundle(
    raw: Any,
    *,
    now: datetime | None = None,
    trust_anchor_did: str | None = None,
) -> BundleVerification:
    """Verify a certification bundle without network access.

    ``trust_anchor_did`` pins the expected issuer — pass the backend's did:key
    when the bundle is used for an admission decision, so a bundle signed by a
    different (valid) key cannot be substituted.
    """
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)

    result = BundleVerification(valid=False, timestamp=moment.isoformat())

    if not isinstance(raw, dict) or raw.get("schema") != BUNDLE_SCHEMA:
        result.reasons.append(f"not a {BUNDLE_SCHEMA} bundle")
        return result

    required = ("bundle_id", "issuer", "subject", "issued_at", "valid_from", "valid_until", "claims", "evidence", "proof")
    if any(k not in raw for k in required) or not isinstance(raw.get("evidence"), dict) or not isinstance(raw.get("proof"), dict):
        result.reasons.append("bundle is missing required fields")
        return result

    evidence = raw["evidence"]
    proof = raw["proof"]
    if not isinstance(raw.get("subject"), dict) or not isinstance(raw["subject"].get("org"), str):
        result.reasons.append("bundle is missing required fields")
        return result
    if not isinstance(evidence.get("leaves"), list) or not isinstance(proof.get("proofValue"), str):
        result.reasons.append("bundle is missing required fields")
        return result

    result.checked.structure = True
    result.bundle_id = _as_str(raw.get("bundle_id"))
    result.issuer = _as_str(raw.get("issuer"))
    result.subject = raw["subject"]["org"]
    result.verdict = _as_str(raw.get("verdict"))
    result.valid_until = _as_str(raw.get("valid_until"))
    result.caveats = [c for c in raw.get("caveats") or [] if isinstance(c, str)]

    # 1. Digest
    if raw.get("digest") != bundle_digest(raw):
        result.reasons.append("digest mismatch — bundle contents were modified")
    else:
        result.checked.digest = True

    # 2. Merkle commitment over embedded evidence
    merkle_ok = True
    if evidence.get("hash_algorithm") != "sha256":
        merkle_ok = False
        result.reasons.append("evidence block is not a sha256 Merkle commitment")
    else:
        hashes: list[str] = []
        for leaf in evidence["leaves"]:
            if (
                not isinstance(leaf, dict)
                or leaf.get("kind") not in ("asset", "migration", "attestation", "audit")
                or not isinstance(leaf.get("id"), str)
                or not isinstance(leaf.get("digest"), str)
                or not isinstance(leaf.get("record"), dict)
            ):
                merkle_ok = False
                result.reasons.append("malformed evidence leaf")
                break
            if _sha256_hex(canonical_json(leaf["record"])) != leaf["digest"]:
                merkle_ok = False
                result.reasons.append(f"evidence record tampered: {leaf['kind']}:{leaf['id']}")
                break
            hashes.append(evidence_leaf_hash(leaf))
        if merkle_ok:
            if len(hashes) != evidence.get("leaf_count"):
                merkle_ok = False
                result.reasons.append("evidence leaf count does not match the committed count")
            elif merkle_root(hashes) != evidence.get("merkle_root"):
                merkle_ok = False
                result.reasons.append("Merkle root mismatch — evidence set was altered")
    result.checked.merkle = merkle_ok

    # 3. Signature
    signature_ok = False
    if proof.get("type") != "Ed25519Signature2020":
        result.reasons.append(f"unsupported proof type: {proof.get('type')!r}")
    elif not isinstance(proof.get("verificationMethod"), str):
        result.reasons.append("proof has no verificationMethod")
    elif trust_anchor_did is not None and raw.get("issuer") != trust_anchor_did:
        result.reasons.append("issuer does not match the pinned trust anchor")
    else:
        issuer = raw.get("issuer")
        public_key = did_key_to_public_key(issuer) if isinstance(issuer, str) else None
        if public_key is None:
            result.reasons.append("issuer DID resolved to no usable Ed25519 key")
        elif not proof["verificationMethod"].startswith(f"{issuer}#"):
            result.reasons.append("proof verificationMethod is not bound to the issuer DID")
        else:
            try:
                signature = bytes.fromhex(proof["proofValue"])
                if len(signature) != 64:
                    raise ValueError("invalid Ed25519 signature length")
                payload = {k: v for k, v in raw.items() if k != "proof"}
                VerifyKey(public_key).verify(canonical_json(payload).encode("utf-8"), signature)
                signature_ok = True
            except (BadSignatureError, ValueError):
                result.reasons.append("Ed25519 signature does not verify against the issuer key")
    result.checked.signature = signature_ok

    # 4. Validity window
    start = _parse_iso(raw.get("valid_from", ""))
    end = _parse_iso(raw.get("valid_until", ""))
    if start is None or end is None:
        result.reasons.append("validity window is not a pair of ISO timestamps")
    elif moment < start:
        result.reasons.append("bundle is not valid yet")
    elif moment > end:
        result.expired = True
        result.reasons.append(f"bundle expired at {raw['valid_until']}")
    else:
        result.checked.validity = True

    result.valid = (
        result.checked.structure
        and result.checked.digest
        and result.checked.merkle
        and result.checked.signature
        and result.checked.validity
    )
    return result


def verify_bundle_file(
    path: str,
    *,
    now: datetime | None = None,
    trust_anchor_did: str | None = None,
) -> BundleVerification:
    with open(path, "r", encoding="utf-8") as fh:
        return verify_bundle(json.load(fh), now=now, trust_anchor_did=trust_anchor_did)


if __name__ == "__main__":  # pragma: no cover - thin CLI wrapper
    if len(sys.argv) != 2:
        print("usage: python -m qtrust.bundle <bundle.json>", file=sys.stderr)
        raise SystemExit(2)
    outcome = verify_bundle_file(sys.argv[1])
    print(outcome.model_dump_json(indent=2))
    raise SystemExit(0 if outcome.valid else 1)

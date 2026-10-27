"""Sector assurance packs — machine-checkable control crosswalks.

The compliance engine answers "is this primitive acceptable under framework X?".
An assurance pack answers the buyer's actual question: "can we pass the control
set that our sector's auditor will test, and what is the evidence?"

Each control maps to a concrete predicate over the CBOM. Controls that cannot
be decided from machine evidence are reported as MANUAL rather than silently
passing, so a pack can never overstate readiness.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, Iterable

from pydantic import BaseModel, Field

from .agility import score_estate
from .models import AssetFinding

_PQC = ("ml_kem", "mlkem", "ml_dsa", "mldsa", "slh_dsa", "slhdsa", "falcon", "kyber", "dilithium", "frodo", "mceliece", "hqc")
_BROKEN = ("des", "3des", "rc4", "rc2", "md4", "md5", "sha1")
_ASYM = ("rsa", "ecdsa", "dsa", "ed25519", "ed448", "dh_", "ecdh", "diffie", "ml_dsa", "mldsa", "slh_dsa", "slhdsa", "falcon")


class PackStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    PARTIAL = "PARTIAL"
    MANUAL = "MANUAL"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ControlResult(BaseModel):
    control_id: str
    title: str
    requirement: str
    severity: Severity
    status: PackStatus
    evidence: str
    affected_assets: list[str] = Field(default_factory=list)
    remediation: str = ""


class PackReport(BaseModel):
    pack_id: str
    title: str
    issuer: str
    pack_version: str
    asset_count: int
    controls: list[ControlResult]
    passed: int
    failed: int
    partial: int
    manual: int
    not_applicable: int
    score: float = Field(..., ge=0, le=100)
    verdict: str
    generated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    pack_digest: str = ""
    limitations: list[str] = Field(default_factory=list)


class PackDefinition(BaseModel):
    pack_id: str
    title: str
    issuer: str
    pack_version: str
    summary: str
    evaluator: str


PACKS: dict[str, PackDefinition] = {
    "cnsa-2.0": PackDefinition(
        pack_id="cnsa-2.0",
        title="NSA CNSA 2.0 Algorithm Suite",
        issuer="NSA",
        pack_version="1.0",
        summary="Post-quantum baseline for National Security Systems: ML-KEM-1024, ML-DSA-87, AES-256, SHA-384/512, TLS 1.3.",
        evaluator="_cnsa",
    ),
    "pci-dss-4.0": PackDefinition(
        pack_id="pci-dss-4.0",
        title="PCI DSS 4.0 Cryptographic Controls",
        issuer="PCI SSC",
        pack_version="4.0",
        summary="Cardholder-data cryptography: mandatory inventory (12.3.3), strong cryptography, TLS 1.2+, key rotation (future-dated 2025).",
        evaluator="_pci",
    ),
    "dora": PackDefinition(
        pack_id="dora",
        title="EU DORA ICT Cryptographic Resilience",
        issuer="European Supervisory Authorities",
        pack_version="2022/2554",
        summary="ICT asset inventory, cryptographic controls, crypto-agility and PQC readiness for EU financial entities.",
        evaluator="_dora",
    ),
    "hipaa": PackDefinition(
        pack_id="hipaa",
        title="HIPAA Security Rule — Encryption",
        issuer="HHS OCR",
        pack_version="2013 Omnibus",
        summary="Addressable encryption at rest and in transit, integrity controls and key management for ePHI.",
        evaluator="_hipaa",
    ),
    "fedramp-rev5": PackDefinition(
        pack_id="fedramp-rev5",
        title="FedRAMP Rev. 5 Cryptographic Controls",
        issuer="GSA / NIST",
        pack_version="Rev. 5",
        summary="SC-13, SC-8, IA-7 and the OMB M-23-02 post-quantum transition inventory.",
        evaluator="_fedramp",
    ),
}


def _norm(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[-_. ]+", "_", value.strip().lower())


def _alg(finding: AssetFinding) -> str:
    return _norm(finding.algorithm)


def _is_pqc(finding: AssetFinding) -> bool:
    return any(m in _alg(finding) for m in _PQC)


def _is_hybrid(finding: AssetFinding) -> bool:
    return any(m in _alg(finding) for m in ("x25519mlkem", "x25519_mlkem", "hybrid", "xwing"))


def _is_asym(finding: AssetFinding) -> bool:
    return any(m in _alg(finding) or m in _norm(finding.key_type) for m in _ASYM)


def _is_symm(finding: AssetFinding) -> bool:
    return any(m in _alg(finding) for m in ("aes", "chacha", "camellia", "aria", "des", "rc4"))


def _is_hash(finding: AssetFinding) -> bool:
    return any(m in _alg(finding) for m in ("sha", "md5", "blake", "shake", "hmac"))


def _is_kem(finding: AssetFinding) -> bool:
    return any(m in _alg(finding) for m in ("kem", "x25519", "x448", "dh", "ecdh", "ml_kem", "mlkem"))


def _is_tls(finding: AssetFinding) -> bool:
    return finding.asset_type in ("tls_certificate", "tls_cipher_suite", "tls_connection")


def _tls_protocol(finding: AssetFinding) -> str | None:
    """Return the negotiated protocol, or None when the CBOM does not record one.

    A cipher-suite finding carries the cipher in ``algorithm``, not the protocol;
    testing that string for "tls_1_3" would fail every cipher suite. Only assets
    whose protocol is actually recorded are in scope for a TLS-version control.
    """
    alg = _alg(finding)
    if "tls" in alg:
        return alg
    for key in ("tls_version", "protocol", "negotiated_protocol"):
        raw = finding.metadata.get(key)
        if isinstance(raw, str) and raw.strip():
            return _norm(raw)
    return None


def _tls_assets(items: list[AssetFinding]) -> list[AssetFinding]:
    return [f for f in items if _is_tls(f) and _tls_protocol(f)]


def _proto_key(finding: AssetFinding) -> str:
    protocol = _tls_protocol(finding) or ""
    return protocol.replace("_", "").replace(".", "")


def _is_tls13(finding: AssetFinding) -> bool:
    return _proto_key(finding) in ("tls13", "tlsv13")


def _is_tls12_plus(finding: AssetFinding) -> bool:
    return _proto_key(finding) in ("tls12", "tls13", "tlsv12", "tlsv13")


def _broken(finding: AssetFinding) -> bool:
    return any(m in _alg(finding) for m in _BROKEN)


def _locations(items: Iterable[AssetFinding], limit: int = 10) -> list[str]:
    return [f.location for f in list(items)[:limit]]


def _verdict(items: list[AssetFinding], predicate: Callable[[AssetFinding], bool]) -> tuple[PackStatus, list[AssetFinding]]:
    if not items:
        return PackStatus.NOT_APPLICABLE, []
    failures = [f for f in items if not predicate(f)]
    if not failures:
        return PackStatus.PASS, []
    return PackStatus.FAIL, failures


def _control(
    cid: str,
    title: str,
    requirement: str,
    severity: Severity,
    status: PackStatus,
    evidence: str,
    *,
    affected: list[AssetFinding] | None = None,
    remediation: str = "",
) -> ControlResult:
    return ControlResult(
        control_id=cid,
        title=title,
        requirement=requirement,
        severity=severity,
        status=status,
        evidence=evidence,
        affected_assets=_locations(affected or []),
        remediation=remediation,
    )


def _cnsa(items: list[AssetFinding]) -> list[ControlResult]:
    controls: list[ControlResult] = []
    kems = [f for f in items if _is_kem(f)]
    status, failures = _verdict(kems, lambda f: "ml_kem_1024" in _alg(f) or "mlkem1024" in _alg(f))
    controls.append(_control(
        "CNSA-2.0-KEM", "ML-KEM-1024 key establishment",
        "Use ML-KEM-1024 for all key establishment.", Severity.CRITICAL, status,
        f"{len(kems)} key-establishment assets; {len(failures)} do not use ML-KEM-1024.",
        affected=failures, remediation="Migrate key establishment to ML-KEM-1024 (hybrid during transition).",
    ))

    sigs = [f for f in items if _is_asym(f)]
    status, failures = _verdict(sigs, lambda f: "ml_dsa_87" in _alg(f) or "mldsa87" in _alg(f))
    controls.append(_control(
        "CNSA-2.0-SIG", "ML-DSA-87 signatures",
        "Use ML-DSA-87 for digital signatures.", Severity.CRITICAL, status,
        f"{len(sigs)} asymmetric assets; {len(failures)} do not use ML-DSA-87.",
        affected=failures, remediation="Migrate signature use to ML-DSA-87; keep SLH-DSA-SHA2-256s as the backup.",
    ))

    sym = [f for f in items if _is_symm(f)]
    status, failures = _verdict(sym, lambda f: "aes_256" in _alg(f))
    controls.append(_control(
        "CNSA-2.0-SYMM", "AES-256 symmetric encryption",
        "Use AES-256 for symmetric encryption.", Severity.CRITICAL, status,
        f"{len(sym)} symmetric assets; {len(failures)} are not AES-256.",
        affected=failures, remediation="Upgrade symmetric encryption to AES-256.",
    ))

    hashes = [f for f in items if _is_hash(f)]
    status, failures = _verdict(hashes, lambda f: any(h in _alg(f) for h in ("sha384", "sha_384", "sha512", "sha_512")))
    controls.append(_control(
        "CNSA-2.0-HASH", "SHA-384/SHA-512 hashing",
        "Use SHA-384 or SHA-512 for hashing.", Severity.HIGH, status,
        f"{len(hashes)} hash assets; {len(failures)} use a weaker digest.",
        affected=failures, remediation="Migrate to SHA-384 or SHA-512.",
    ))

    tls = _tls_assets(items)
    status, failures = _verdict(tls, _is_tls13)
    controls.append(_control(
        "CNSA-2.0-TLS", "TLS 1.3",
        "Use TLS 1.3 for all TLS endpoints.", Severity.HIGH, status,
        f"{len(tls)} TLS assets; {len(failures)} are not TLS 1.3.",
        affected=failures, remediation="Enable TLS 1.3 and disable downgrade to TLS 1.2 or lower.",
    ))
    return controls


def _pci(items: list[AssetFinding]) -> list[ControlResult]:
    inventory_status = PackStatus.PASS if items else PackStatus.FAIL
    controls = [
        _control(
            "PCI-DSS-12.3.3", "Cryptographic inventory",
            "Maintain an inventory of cryptographic algorithms, keys and their locations.",
            Severity.HIGH, inventory_status,
            f"{len(items)} cryptographic assets inventoried from this CBOM.",
            remediation="Retain this CBOM as the inventory of record and refresh it on every change.",
        )
    ]

    broken = [f for f in items if _broken(f)]
    controls.append(_control(
        "PCI-DSS-4.2.1-STRONG", "Strong cryptography only",
        "Do not use DES, 3DES, RC4, MD5 or SHA-1 for cardholder-data protection.",
        Severity.CRITICAL, PackStatus.FAIL if broken else (PackStatus.PASS if items else PackStatus.NOT_APPLICABLE),
        f"{len(broken)} assets use a prohibited primitive.",
        affected=broken, remediation="Replace prohibited primitives with AES-128+/SHA-256+.",
    ))

    tls = _tls_assets(items)
    status, failures = _verdict(tls, _is_tls12_plus)
    controls.append(_control(
        "PCI-DSS-4.2.1-TLS", "TLS 1.2 or higher",
        "Use TLS 1.2+ for all cardholder-data transmission.", Severity.CRITICAL, status,
        f"{len(tls)} TLS assets; {len(failures)} are below TLS 1.2.",
        affected=failures, remediation="Disable TLS 1.0/1.1 and enable TLS 1.2+.",
    ))

    rotation = []
    missing = []
    for f in items:
        raw = f.metadata.get("rotation_days", f.metadata.get("key_rotation_days"))
        if raw is None:
            missing.append(f)
            continue
        try:
            if float(raw) > 365:
                rotation.append(f)
        except (TypeError, ValueError):
            missing.append(f)
    if not items:
        rot_status = PackStatus.NOT_APPLICABLE
    elif missing:
        rot_status = PackStatus.MANUAL
    elif rotation:
        rot_status = PackStatus.FAIL
    else:
        rot_status = PackStatus.PASS
    controls.append(_control(
        "PCI-DSS-3.6.1.4", "Key rotation",
        "Rotate cryptographic keys at least annually and on suspected compromise.",
        Severity.HIGH, rot_status,
        f"{len(missing)} assets have no rotation evidence; {len(rotation)} exceed 365 days.",
        affected=rotation or missing[:10],
        remediation="Record rotation_days in the CBOM and enforce a <=365-day rotation policy.",
    ))
    return controls


def _dora(items: list[AssetFinding]) -> list[ControlResult]:
    controls = [
        _control(
            "DORA-Art8", "ICT asset inventory",
            "Maintain and update a register of ICT assets supporting critical functions.",
            Severity.HIGH,
            PackStatus.PASS if items else PackStatus.FAIL,
            f"{len(items)} cryptographic assets registered in this CBOM.",
            remediation="Include this CBOM in the ICT asset register and review quarterly.",
        )
    ]

    broken = [f for f in items if _broken(f)]
    controls.append(_control(
        "DORA-Art9-3", "Cryptographic controls",
        "Use state-of-the-art cryptography to protect confidentiality, integrity and authenticity.",
        Severity.CRITICAL,
        PackStatus.FAIL if broken else (PackStatus.PASS if items else PackStatus.NOT_APPLICABLE),
        f"{len(broken)} assets use a broken primitive.",
        affected=broken, remediation="Replace broken primitives and document the control set.",
    ))

    estate = score_estate(items)
    if not items:
        agility_status = PackStatus.NOT_APPLICABLE
    elif estate.score >= 55:
        agility_status = PackStatus.PASS
    elif estate.score >= 40:
        agility_status = PackStatus.PARTIAL
    else:
        agility_status = PackStatus.FAIL
    controls.append(_control(
        "DORA-Art9-3d", "Crypto-agility",
        "Be able to replace cryptographic primitives without material disruption.",
        Severity.HIGH, agility_status,
        f"Estate crypto-agility score {estate.score} ({estate.grade.value}); weakest assets: "
        + ", ".join(a.asset for a in estate.weakest[:5]),
        affected=[],
        remediation="Introduce provider abstraction, configuration-driven algorithms and rotation evidence.",
    ))

    pqc = [f for f in items if _is_pqc(f) or _is_hybrid(f)]
    controls.append(_control(
        "DORA-Art9-4", "PQC readiness",
        "Assess exposure to quantum computing and plan migration to post-quantum cryptography.",
        Severity.HIGH,
        PackStatus.PASS if pqc else (PackStatus.FAIL if items else PackStatus.NOT_APPLICABLE),
        f"{len(pqc)} of {len(items)} assets use post-quantum or hybrid primitives.",
        affected=[f for f in items if not (_is_pqc(f) or _is_hybrid(f))],
        remediation="Adopt a PQC migration plan targeting ML-KEM/ML-DSA and hybrid deployment first.",
    ))
    controls.append(_control(
        "DORA-Art9-3e", "Key management",
        "Protect keys through their full lifecycle (generation, storage, rotation, destruction).",
        Severity.MEDIUM, PackStatus.MANUAL,
        "Key lifecycle controls are organisational and cannot be inferred from a CBOM alone.",
        remediation="Attach HSM/KMS key-policy evidence and rotation logs to the assurance bundle.",
    ))
    return controls


def _hipaa(items: list[AssetFinding]) -> list[ControlResult]:
    sym = [f for f in items if _is_symm(f)]
    status, failures = _verdict(sym, lambda f: any(a in _alg(f) for a in ("aes_128", "aes_192", "aes_256", "chacha20")))
    controls = [
        _control(
            "HIPAA-164.312(a)(2)(iv)", "Encryption at rest",
            "Encrypt ePHI at rest using an approved algorithm.", Severity.HIGH, status,
            f"{len(sym)} symmetric assets; {len(failures)} are not AES-128+ or ChaCha20.",
            affected=failures, remediation="Encrypt ePHI at rest with AES-128+ and document the key custodian.",
        )
    ]

    tls = _tls_assets(items)
    status, failures = _verdict(tls, _is_tls12_plus)
    controls.append(_control(
        "HIPAA-164.312(e)(2)(ii)", "Encryption in transit",
        "Encrypt ePHI in transit using TLS 1.2+.", Severity.HIGH, status,
        f"{len(tls)} TLS assets; {len(failures)} are below TLS 1.2.",
        affected=failures, remediation="Enforce TLS 1.2+ on every ePHI endpoint.",
    ))

    hashes = [f for f in items if _is_hash(f)]
    weak = [f for f in hashes if any(m in _alg(f) for m in ("md5", "sha1"))]
    controls.append(_control(
        "HIPAA-164.312(c)(1)", "Integrity controls",
        "Protect ePHI from improper alteration using approved digests.",
        Severity.HIGH,
        PackStatus.FAIL if weak else (PackStatus.PASS if hashes else PackStatus.NOT_APPLICABLE),
        f"{len(weak)} of {len(hashes)} hash assets use MD5 or SHA-1.",
        affected=weak, remediation="Replace MD5/SHA-1 with SHA-256+.",
    ))
    controls.append(_control(
        "HIPAA-164.312(a)(2)(iv)-KEY", "Key management",
        "Document key generation, storage and destruction for ePHI encryption.",
        Severity.MEDIUM, PackStatus.MANUAL,
        "Key custody evidence is organisational and is not present in a CBOM.",
        remediation="Attach the key-management policy and KMS/HSM configuration evidence.",
    ))
    return controls


def _fedramp(items: list[AssetFinding]) -> list[ControlResult]:
    approved = [f for f in items if not _broken(f)]
    controls = [
        _control(
            "FedRAMP-SC-13", "Cryptographic protection",
            "Employ FIPS-validated cryptography for confidentiality and integrity.",
            Severity.CRITICAL,
            PackStatus.PASS if items and len(approved) == len(items) else (PackStatus.FAIL if items else PackStatus.NOT_APPLICABLE),
            f"{len(approved)} of {len(items)} assets use an approved primitive family.",
            affected=[f for f in items if _broken(f)],
            remediation="Replace deprecated primitives and validate the module against FIPS 140-3.",
        )
    ]

    tls = _tls_assets(items)
    status, failures = _verdict(tls, _is_tls12_plus)
    controls.append(_control(
        "FedRAMP-SC-8", "Transmission confidentiality",
        "Protect transmitted information with TLS 1.2+.", Severity.CRITICAL, status,
        f"{len(tls)} TLS assets; {len(failures)} are below TLS 1.2.",
        affected=failures, remediation="Enforce TLS 1.2+ and FIPS-approved cipher suites.",
    ))
    controls.append(_control(
        "FedRAMP-IA-7", "FIPS-validated authentication modules",
        "Use FIPS-validated cryptographic modules for authentication.",
        Severity.HIGH, PackStatus.MANUAL,
        "Module validation (CMVP certificate) is not observable from a CBOM.",
        remediation="Attach CMVP certificate numbers for each cryptographic module.",
    ))

    pqc = any(_is_pqc(f) or _is_hybrid(f) for f in items)
    controls.append(_control(
        "OMB-M-23-02", "Post-quantum transition inventory",
        "Inventory quantum-vulnerable cryptography and submit an annual transition plan.",
        Severity.HIGH,
        PackStatus.PARTIAL if items else PackStatus.NOT_APPLICABLE,
        f"Inventory produced ({len(items)} assets); PQC adoption {'started' if pqc else 'not started'}.",
        remediation="Submit the CBOM-derived inventory and a dated ML-KEM/ML-DSA migration plan.",
    ))
    return controls


_EVALUATORS: dict[str, Callable[[list[AssetFinding]], list[ControlResult]]] = {
    "_cnsa": _cnsa,
    "_pci": _pci,
    "_dora": _dora,
    "_hipaa": _hipaa,
    "_fedramp": _fedramp,
}


def list_packs() -> list[dict[str, str]]:
    return [p.model_dump() for p in PACKS.values()]


def _digest(report: PackReport) -> str:
    payload = report.model_dump(mode="json")
    payload.pop("generated_at", None)
    payload.pop("pack_digest", None)
    return "sha256:" + hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def evaluate_pack(findings: Iterable[AssetFinding], pack_id: str) -> PackReport:
    definition = PACKS.get(pack_id)
    if definition is None:
        raise ValueError(f"unknown assurance pack '{pack_id}' (available: {', '.join(sorted(PACKS))})")
    items = list(findings)
    controls = _EVALUATORS[definition.evaluator](items)

    counts = {status: 0 for status in PackStatus}
    for control in controls:
        counts[control.status] += 1
    automated = counts[PackStatus.PASS] + counts[PackStatus.FAIL] + counts[PackStatus.PARTIAL]
    score = round(
        (counts[PackStatus.PASS] * 100 + counts[PackStatus.PARTIAL] * 50) / automated, 2
    ) if automated else 0.0

    if not items:
        verdict = "NOT_READY"
    elif counts[PackStatus.FAIL]:
        verdict = "NOT_READY"
    elif counts[PackStatus.PARTIAL] or counts[PackStatus.MANUAL]:
        verdict = "CONDITIONAL"
    else:
        verdict = "READY"

    report = PackReport(
        pack_id=definition.pack_id,
        title=definition.title,
        issuer=definition.issuer,
        pack_version=definition.pack_version,
        asset_count=len(items),
        controls=controls,
        passed=counts[PackStatus.PASS],
        failed=counts[PackStatus.FAIL],
        partial=counts[PackStatus.PARTIAL],
        manual=counts[PackStatus.MANUAL],
        not_applicable=counts[PackStatus.NOT_APPLICABLE],
        score=score,
        verdict=verdict,
        limitations=[
            "Controls are evaluated from CBOM fields; organisational evidence is reported as MANUAL, never as PASS.",
            f"Pack definition version {definition.pack_version} — verify against the current published text before audit use.",
        ],
    )
    report.pack_digest = _digest(report)
    return report


def evaluate_all(findings: Iterable[AssetFinding]) -> dict[str, PackReport]:
    items = list(findings)
    return {pack_id: evaluate_pack(items, pack_id) for pack_id in PACKS}

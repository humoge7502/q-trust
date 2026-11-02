from __future__ import annotations

import pytest

from qtrust_inspector.agility import AgilityGrade, score_asset, score_estate
from qtrust_inspector.assurance_packs import PACKS, PackStatus, evaluate_all, evaluate_pack
from qtrust_inspector.compliance import ComplianceEngine, ComplianceFramework
from qtrust_inspector.crqc import assess
from qtrust_inspector.models import AssetFinding


def _classical_estate() -> list[AssetFinding]:
    return [
        AssetFinding(
            asset_type="tls_connection", host="legacy.example", port=443,
            algorithm="RSA-2048", key_type="RSA", key_size=2048, criticality="critical",
            not_after="2028-01-01T00:00:00Z",
        ),
        AssetFinding(
            asset_type="tls_cipher_suite", host="legacy.example", port=443,
            algorithm="TLS 1.2", cipher="AES128-SHA", criticality="high",
        ),
        AssetFinding(
            asset_type="file_key", host="/keys/old.pem", algorithm="3DES",
            key_size=168, criticality="high",
        ),
    ]


def _pqc_estate() -> list[AssetFinding]:
    return [
        AssetFinding(
            asset_type="tls_connection", host="pqc.example", port=443,
            algorithm="ML-KEM-1024", criticality="high",
            not_after="2030-01-01T00:00:00Z", issuer="Example CA",
            metadata={
                "algorithm_abstracted": True,
                "config_driven": True,
                "rotation_days": 90,
                "supported_protocols": ["TLS 1.3"],
                "tls_version": "TLS 1.3",
                "value_usd": 2_000_000,
            },
        ),
        AssetFinding(
            asset_type="source_file", host="src/sign.py", algorithm="ML-DSA-87",
            criticality="high",
            metadata={"provider": "liboqs", "config_driven": True, "rotation_days": 180},
        ),
        AssetFinding(
            asset_type="tls_cipher_suite", host="pqc.example", port=443,
            algorithm="AES-256-GCM", key_size=256, criticality="medium",
        ),
        AssetFinding(
            asset_type="file_hash", host="manifest.json", algorithm="SHA-512",
            criticality="medium",
        ),
    ]


# ---------------------------------------------------------------------------
# Crypto-agility
# ---------------------------------------------------------------------------


def test_agility_rewards_pqc_and_abstraction():
    pqc = score_asset(_pqc_estate()[0])
    legacy = score_asset(_classical_estate()[0])
    assert pqc.score > legacy.score
    assert pqc.grade in (AgilityGrade.A, AgilityGrade.B)
    assert legacy.grade in (AgilityGrade.C, AgilityGrade.D, AgilityGrade.E)
    assert pqc.blockers == []


def test_agility_is_deterministic_and_bounded():
    first = score_estate(_pqc_estate())
    second = score_estate(_pqc_estate())
    assert first.model_dump() == second.model_dump()
    assert 0 <= first.score <= 100
    assert sum(first.distribution.values()) == first.asset_count


def test_agility_empty_estate_is_grade_e():
    estate = score_estate([])
    assert estate.asset_count == 0
    assert estate.score == 0
    assert estate.grade == AgilityGrade.E


def test_agility_metadata_improves_score():
    bare = AssetFinding(asset_type="source_file", host="a.py", algorithm="AES-256-GCM", key_size=256)
    rich = AssetFinding(
        asset_type="source_file", host="a.py", algorithm="AES-256-GCM", key_size=256,
        not_after="2030-01-01", metadata={
            "algorithm_abstracted": True,
            "config_path": "settings.yaml",
            "rotation_days": 90,
        },
    )
    assert score_asset(rich).score > score_asset(bare).score


# ---------------------------------------------------------------------------
# CRQC Monte-Carlo
# ---------------------------------------------------------------------------


def test_crqc_is_deterministic_for_a_seed():
    a = assess(_classical_estate(), trials=2000, seed=7)
    b = assess(_classical_estate(), trials=2000, seed=7)
    assert a.expected_loss_usd == b.expected_loss_usd
    assert a.digest == b.digest


def test_crqc_earlier_arrival_increases_exposure():
    early = assess(_classical_estate(), trials=3000, seed=1, median_arrival_year=2030)
    late = assess(_classical_estate(), trials=3000, seed=1, median_arrival_year=2045)
    assert early.expected_loss_usd > late.expected_loss_usd
    assert early.p_any_exposure >= late.p_any_exposure


def test_crqc_percentiles_are_ordered():
    report = assess(_classical_estate(), trials=2000, seed=3)
    assert 0 <= report.loss_p10_usd <= report.loss_p50_usd <= report.loss_p90_usd
    assert report.expected_loss_usd >= 0


def test_crqc_pqc_estate_has_lower_exposure_than_classical():
    pqc = assess(_pqc_estate(), trials=3000, seed=11)
    classical = assess(_classical_estate(), trials=3000, seed=11)
    assert pqc.expected_loss_usd < classical.expected_loss_usd


def test_crqc_zero_value_has_zero_exposure():
    finding = AssetFinding(
        asset_type="file_key", host="k.pem", algorithm="RSA-2048", key_size=2048,
        metadata={"value_usd": 0},
    )
    report = assess([finding], trials=500, seed=5)
    assert report.expected_loss_usd == 0
    assert report.p_any_exposure == 0


def test_crqc_empty_estate_is_zero():
    report = assess([], trials=500)
    assert report.asset_count == 0
    assert report.expected_loss_usd == 0
    assert report.p_any_exposure == 0


# ---------------------------------------------------------------------------
# Assurance packs
# ---------------------------------------------------------------------------


def test_all_declared_packs_evaluate():
    reports = evaluate_all(_classical_estate())
    assert set(reports) == set(PACKS)
    for report in reports.values():
        assert report.asset_count == 3
        assert 0 <= report.score <= 100
        assert report.verdict in ("READY", "CONDITIONAL", "NOT_READY")


def test_cnsa_pack_fails_classical_estate():
    report = evaluate_pack(_classical_estate(), "cnsa-2.0")
    assert report.verdict == "NOT_READY"
    assert report.failed >= 3
    assert any(c.status == PackStatus.FAIL for c in report.controls)


def test_cnsa_pack_passes_pqc_estate():
    report = evaluate_pack(_pqc_estate(), "cnsa-2.0")
    assert report.failed == 0
    assert report.verdict == "READY"


def test_pack_digest_is_stable_and_tamper_evident():
    a = evaluate_pack(_classical_estate(), "pci-dss-4.0")
    b = evaluate_pack(_classical_estate(), "pci-dss-4.0")
    assert a.pack_digest == b.pack_digest
    a.controls[0].status = PackStatus.FAIL
    from qtrust_inspector.assurance_packs import _digest

    assert _digest(a) != a.pack_digest


def test_manual_controls_never_count_as_pass():
    report = evaluate_pack(_pqc_estate(), "dora")
    manuals = [c for c in report.controls if c.status == PackStatus.MANUAL]
    assert manuals
    assert report.verdict == "CONDITIONAL"
    assert all(c.status != PackStatus.PASS for c in manuals)


def test_empty_estate_is_not_ready():
    report = evaluate_pack([], "hipaa")
    assert report.verdict == "NOT_READY"


def test_unknown_pack_raises():
    with pytest.raises(ValueError):
        evaluate_pack(_classical_estate(), "nope")


# ---------------------------------------------------------------------------
# New compliance frameworks
# ---------------------------------------------------------------------------


def test_dora_framework_scores_broken_primitive_non_compliant():
    engine = ComplianceEngine()
    broken = AssetFinding(asset_type="file_key", host="k", algorithm="RC4")
    result = engine.evaluate(broken, ComplianceFramework.DORA)
    assert result.non_compliant_count >= 1
    assert any(r.rule_id == "DORA-ART9-3-CONTROLS" and r.status.value == "NON_COMPLIANT" for r in result.rules)


def test_hipaa_framework_covers_at_rest_and_transit():
    engine = ComplianceEngine()
    tls = AssetFinding(asset_type="tls_connection", host="h", port=443, algorithm="TLS 1.1")
    result = engine.evaluate(tls, ComplianceFramework.HIPAA)
    ids = {r.rule_id for r in result.rules}
    assert "HIPAA-164-312-E-2-II" in ids
    assert any(r.status.value == "NON_COMPLIANT" for r in result.rules)

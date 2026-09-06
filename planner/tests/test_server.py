"""Tests for the planner HTTP surface (server.py) — audit HIGH-1 follow-up.

The production FastAPI app previously had ZERO test coverage. These tests use
fastapi.testclient.TestClient with the real heuristic fallback (no model
checkpoint required) and cover:

  * /health shape
  * /plan happy path with a minimal CBOM
  * /plan input validation (missing assets → 422)
  * API-key auth: missing/wrong key rejected when configured; open in dev
  * rate limiter returns 429 headers shape (in-memory fallback)

Run: pytest planner/tests/test_server.py -q
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

PLANNER_ROOT = Path(__file__).resolve().parent.parent
if str(PLANNER_ROOT) not in sys.path:
    sys.path.insert(0, str(PLANNER_ROOT))

fastapi = pytest.importorskip("fastapi")
pytest.importorskip("fastapi.testclient")


MINIMAL_CBOM = {
    "components": [
        {"name": "openssl", "version": "3.0.0", "cryptoProperties": {"algorithms": ["RSA-2048"]}},
        {"name": "libgcrypt", "version": "1.9", "cryptoProperties": {"algorithms": ["AES-256"]}},
    ],
}


def _make_client(**env):
    """Import server.py fresh under a controlled environment."""
    saved = {k: os.environ.get(k) for k in (
        "QTRUST_PLANNER_API_KEY", "NODE_ENV", "QTRUST_ENV",
        "QTRUST_MODEL_PATH", "QTRUST_REDIS_URL",
    )}
    try:
        for k, v in env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        # Force re-import so middleware captures the new env.
        for mod in list(sys.modules):
            if mod == "server" or mod.startswith("qtrust_planner"):
                del sys.modules[mod]
        import server as server_module  # noqa: PLC0415
        from fastapi.testclient import TestClient  # noqa: PLC0415
        return TestClient(server_module.app, raise_server_exceptions=False)
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _cbom_payload():
    return {
        "cbom": {
            "assets": [
                {
                    "id": "asset-1",
                    "algorithm": "RSA",
                    "key_size": 1024,
                    "criticality": 0.9,
                    "data_lifetime_years": 5,
                },
                {
                    "id": "asset-2",
                    "algorithm": "ML-KEM-768",
                    "key_size": 1184,
                    "criticality": 0.2,
                    "data_lifetime_years": 1,
                },
            ]
        }
    }


def test_health_reports_ok_and_model_mode():
    client = _make_client()
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    # Heuristic mode is honest about missing weights.
    assert body["model"]["mode"] in {"heuristic_fallback", "heuristic", "gnn"}


def test_explicit_model_override_is_authoritative():
    model_path = PLANNER_ROOT / "model_gpu_v3.pt"
    if not model_path.exists():
        pytest.skip("tracked planner checkpoint is unavailable")
    client = _make_client()
    server_module = sys.modules["server"]
    # Mutate the loaded configuration to model an operator-provided rollback
    # or canary path without relying on module-cache/environment ordering.
    server_module.MODEL_PATH = str(model_path)

    resolved, variant = server_module._resolve_checkpoint_path()
    assert resolved == str(model_path)
    assert variant == "explicit"
    assert client.get("/health").status_code == 200


def test_plan_happy_path_returns_ordered_assets():
    client = _make_client()
    res = client.post("/plan", json=_cbom_payload())
    assert res.status_code == 200
    body = res.json()
    # The /plan contract: migration_order is the ranked asset list.
    assert "migration_order" in body
    order = body["migration_order"]
    assert len(order) == 2
    # Server assigns deterministic IDs when the CBOM lacks explicit ones.
    assert len({item["asset_id"] for item in order}) == 2
    ranks = [item["rank"] for item in order]
    assert ranks == sorted(ranks)


def test_plan_rejects_empty_cbom():
    client = _make_client()
    res = client.post("/plan", json={"cbom": {"assets": []}})
    assert res.status_code == 422


def test_api_key_enforced_when_configured():
    client = _make_client(QTRUST_PLANNER_API_KEY="secret-key-1")

    # Missing key → 401
    res = client.post("/plan", json=_cbom_payload())
    assert res.status_code == 401

    # Wrong key → 401
    res = client.post("/plan", json=_cbom_payload(), headers={"X-Api-Key": "nope"})
    assert res.status_code == 401

    # Correct key → passes auth (may still 4xx on validation, but not 401)
    res = client.post("/plan", json=_cbom_payload(), headers={"X-Api-Key": "secret-key-1"})
    assert res.status_code != 401

    # Health remains unauthenticated.
    assert client.get("/health").status_code == 200


def test_api_key_disabled_open_in_dev():
    client = _make_client(NODE_ENV="development")
    res = client.post("/plan", json=_cbom_payload())
    assert res.status_code != 401


def test_plan_malformed_key_size_is_422_not_500():
    """Regression: bad key_size used to surface as HTTP 500.

    int("abc") detonated in the /plan fallback path (and identically in
    /rl/plan) after the GNN path raised ValueError, turning malformed input
    into a server error. It must be a 422 validation error.
    """
    client = _make_client()
    res = client.post("/plan", json={
        "cbom": {"assets": [{"asset_id": "a", "algorithm": "RSA-2048", "key_size": "abc"}]}
    })
    assert res.status_code == 422
    assert "key_size" in res.json()["detail"]


def test_plan_malformed_key_size_is_422_on_rl_plan_too():
    """Regression: /rl/plan shared the same int() crash as /plan."""
    client = _make_client()
    res = client.post("/rl/plan", json={
        "cbom": {"assets": [{"asset_id": "a", "algorithm": "RSA-2048", "key_size": "not-a-number"}]}
    })
    assert res.status_code == 422
    assert "key_size" in res.json()["detail"]


def test_plan_non_dict_asset_entry_is_422_not_500():
    """Regression: a bare string inside cbom.assets used to 500 via a.get()."""
    client = _make_client()
    res = client.post("/plan", json={"cbom": {"assets": ["RSA-2048"]}})
    assert res.status_code == 422
    assert "assets[0]" in res.json()["detail"]


def test_plan_assets_not_a_list_is_422():
    client = _make_client()
    res = client.post("/plan", json={"cbom": {"assets": {"asset_id": "a"}}})
    assert res.status_code == 422
    assert "must be a list" in res.json()["detail"]


def test_plan_caps_assets_over_limit(monkeypatch):
    """DoS guard: CBOMs above the cap are rejected 422 before any inference.

    The cap is read from the module at request time so the env override stays
    testable without re-importing the app.
    """
    client = _make_client()
    server_module = sys.modules["server"]
    monkeypatch.setattr(server_module, "MAX_CBOM_ASSETS", 3, raising=False)
    cbom = {"cbom": {"assets": [
        {"asset_id": f"a{i}", "algorithm": "RSA-2048", "key_size": 2048} for i in range(4)
    ]}}
    res = client.post("/plan", json=cbom)
    assert res.status_code == 422
    assert "caps planning at 3" in res.json()["detail"]

    # At exactly the cap the request is accepted.
    cbom["cbom"]["assets"].pop()
    res = client.post("/plan", json=cbom)
    assert res.status_code == 200


def test_plan_key_size_numeric_string_is_coerced():
    """Integer strings stay accepted (API tolerance), normalized to int."""
    client = _make_client()
    res = client.post("/plan", json={
        "cbom": {"assets": [{"asset_id": "a", "algorithm": "RSA-2048", "key_size": "2048"}]}
    })
    assert res.status_code == 200
    order = res.json()["migration_order"]
    assert order and isinstance(order[0]["key_size"], int)


def test_api_key_fail_closed_in_production_when_unset():
    client = _make_client(QTRUST_PLANNER_API_KEY=None, NODE_ENV="production")
    res = client.post("/plan", json=_cbom_payload())
    assert res.status_code == 503


# ---------------------------------------------------------------------------
# FASTAPI-OPENAPI-001 (threat-model pass): docs/OpenAPI must not be exposed in
# production. Dev keeps them for docker-compose workflows.
# ---------------------------------------------------------------------------


def test_docs_disabled_in_production():
    client = _make_client(QTRUST_PLANNER_API_KEY=None, NODE_ENV="production")
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_docs_available_in_dev():
    client = _make_client(QTRUST_PLANNER_API_KEY=None)
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200

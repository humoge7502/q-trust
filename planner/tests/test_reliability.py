"""Regression tests for R5 (rate-limiter memory growth) and R7 (past schedule windows)."""
from __future__ import annotations

import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pytest

PLANNER_ROOT = Path(__file__).resolve().parent.parent
if str(PLANNER_ROOT) not in sys.path:
    sys.path.insert(0, str(PLANNER_ROOT))

pytest.importorskip("fastapi")


def _fresh_server():
    for mod in list(sys.modules):
        if mod == "server" or mod.startswith("qtrust_planner"):
            del sys.modules[mod]
    for k in ("QTRUST_PLANNER_API_KEY", "QTRUST_REDIS_URL"):
        os.environ.pop(k, None)
    os.environ["NODE_ENV"] = "development"
    import server as server_module  # noqa: PLC0415

    return server_module


def test_memory_fallback_drops_empty_buckets_and_bounds_table():
    server_module = _fresh_server()
    mw = server_module.RateLimitMiddleware.__new__(server_module.RateLimitMiddleware)
    mw.max_requests = 2
    mw.window_seconds = 60
    mw._requests = {}
    now = time.time()

    # Empty bucket for an idle IP must not be retained.
    mw._requests["10.0.0.9"] = [now - 10_000.0]
    allowed, _ = mw._memory_check("10.0.0.9", now)
    assert allowed is True
    # After trim+append the bucket holds exactly the new timestamp.
    assert mw._requests["10.0.0.9"] == [pytest.approx(now)]

    # Table growth is bounded even under many distinct IPs.
    for i in range(10_050):
        mw._memory_check(f"192.0.2.{i % 250}.{i // 250}", now)
    assert len(mw._requests) <= 10_001


def test_build_schedule_never_emits_windows_in_the_past():
    server_module = _fresh_server()
    # 30 days of effort against a 2-day deadline: infeasible by construction.
    order = [
        {"asset_id": f"a{i}", "migrate_days": 5.0} for i in range(6)
    ]
    deadline = date.today() + timedelta(days=2)
    schedule = server_module._build_schedule(order, deadline)

    assert schedule["feasible"] is False
    assert schedule["overflow_days"] > 0
    for window in schedule["windows"]:
        assert window["start"] >= date.today().isoformat(), window
    assert any(w["clamped_to_today"] for w in schedule["windows"])

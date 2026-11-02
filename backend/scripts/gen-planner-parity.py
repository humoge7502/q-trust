#!/usr/bin/env python3
"""Regenerate backend/tests/fixtures/planner-parity.json from the Python reference.

The embedded ONNX planner (backend/src/services/planner-embedded.ts) must rank,
schedule and validate exactly like planner-service/lib/planner_core.py. This
script freezes the reference outputs for every real CBOM fixture so
`planner-embedded.test.ts` can prove parity without a Python process in CI.

`date.today()` is pinned to a constant via a `date` subclass so schedule
expectations do not rot; the TypeScript test freezes its clock to the same day.

Usage:
    python backend/scripts/gen-planner-parity.py
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "planner-service" / "lib"))

import planner_core as pc  # noqa: E402

FROZEN_TODAY = date(2026, 10, 28)
DEADLINES = ["2026-12-31", "2027-03-31", "2027-12-31"]
SCHEDULE_CASES = [
    "real_finance_0",
    "real_gov_edu_3",
    "real_mixed_0",
    "real_tech_4",
]
RL_CASES = ["real_finance_0", "real_gov_edu_0", "real_mixed_0"]


class FrozenDate(date):
    @classmethod
    def today(cls) -> "FrozenDate":
        return cls(FROZEN_TODAY.year, FROZEN_TODAY.month, FROZEN_TODAY.day)


pc.date = FrozenDate


def r6(value: float) -> float:
    return round(float(value), 6)


def r2(value: float) -> float:
    return round(float(value), 2)


def expected_order(result: dict) -> list[dict]:
    return [
        {
            "asset_id": item["asset_id"],
            "algorithm": item["algorithm"],
            "key_size": item["key_size"],
            "priority_score": r6(item["priority_score"]),
            "risk_score": r6(item["risk_score"]),
            "migrate_days": item["migrate_days"],
        }
        for item in result["migration_order"]
    ]


def expected_schedule(schedule: dict) -> dict:
    return {
        "deadline": schedule["deadline"],
        "days_available": schedule["days_available"],
        "total_effort_days": r6(schedule["total_effort_days"]),
        "feasible": schedule["feasible"],
        "overflow_days": r2(schedule["overflow_days"]),
        "suggested_daily_rate": (
            None if schedule["suggested_daily_rate"] is None else r2(schedule["suggested_daily_rate"])
        ),
        "windows": [
            {
                "asset_id": window["asset_id"],
                "start": window["start"],
                "end": window["end"],
                "migrate_days": window["migrate_days"],
                "clamped_to_today": window["clamped_to_today"],
            }
            for window in schedule["windows"]
        ],
    }


def main() -> int:
    cbom_dir = REPO / "planner" / "data" / "real_cboms"
    names = sorted(path.stem for path in cbom_dir.glob("*.json"))
    if not names:
        print(f"no CBOM fixtures under {cbom_dir}", file=sys.stderr)
        return 1

    payload = {
        "generated_by": "backend/scripts/gen-planner-parity.py",
        "reference": "planner-service/lib/planner_core.py",
        "frozen_today": FROZEN_TODAY.isoformat(),
        "plans": {},
        "schedules": {},
        "rl": {},
    }

    for name in names:
        cbom = json.loads((cbom_dir / f"{name}.json").read_text(encoding="utf-8"))
        result = pc.handle_plan({"cbom": cbom})
        payload["plans"][name] = {
            "total_assets": result["total_assets"],
            "order": expected_order(result),
        }
        print(f"plan  {name}: {result['total_assets']} assets")

    for name in SCHEDULE_CASES:
        cbom = json.loads((cbom_dir / f"{name}.json").read_text(encoding="utf-8"))
        payload["schedules"][name] = {}
        for deadline in DEADLINES:
            result = pc.handle_plan({"cbom": cbom, "deadline": deadline})
            payload["schedules"][name][deadline] = expected_schedule(result["schedule"])
        print(f"schedule {name}: {len(DEADLINES)} deadlines")

    for name in RL_CASES:
        cbom = json.loads((cbom_dir / f"{name}.json").read_text(encoding="utf-8"))
        result = pc.handle_rl_plan({"cbom": cbom})
        payload["rl"][name] = {
            "method": result["method"],
            "order": expected_order(result),
        }
        print(f"rl    {name}: method={result['method']}")

    out = REPO / "backend" / "tests" / "fixtures" / "planner-parity.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(payload, indent=1, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

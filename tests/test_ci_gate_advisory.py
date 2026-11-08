"""Tests for scripts/ci_gate_advisory.py (X1 CI crypto gate advisory renderer).

The renderer is a standalone stdlib-only script, so these tests exercise it
the same way the composite GitHub Action does: as a subprocess writing the
markdown body to a file. Covered: empty findings, criticality counting,
threshold verdict strings (boundaries mirroring cli.py::_run_ci_gate), the
>10-findings truncation, and the exit-0-always advisory contract.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ci_gate_advisory.py"


def _run(*argv: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *argv], capture_output=True, text=True
    )


def _finding(
    criticality: str = "medium",
    host: str = "src/a.py",
    algorithm: str | None = None,
    line: int | None = None,
) -> dict:
    finding: dict = {
        "asset_type": "source_api",
        "host": host,
        "criticality": criticality,
        "metadata": {},
    }
    if algorithm is not None:
        finding["algorithm"] = algorithm
    if line is not None:
        finding["metadata"]["line"] = line
    return finding


def _write_findings(tmp_path: Path, findings: list[dict]) -> Path:
    data = {
        "target": "example-repo",
        "scanner": "qtrust-inspector",
        "findings": findings,
    }
    path = tmp_path / "findings.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _render(
    tmp_path: Path, findings: list[dict], threshold: str = "high"
) -> tuple[subprocess.CompletedProcess, str]:
    src = _write_findings(tmp_path, findings)
    out = tmp_path / "advisory.md"
    proc = _run(
        str(src), "--threshold", threshold, "--output", str(out)
    )
    return proc, out.read_text(encoding="utf-8")


def test_empty_findings_is_pass_and_has_no_findings_table(tmp_path: Path) -> None:
    proc, md = _render(tmp_path, [])
    assert proc.returncode == 0
    assert "**Verdict: PASS**" in md
    assert "no findings at or above the `high` threshold." in md
    assert "Findings: 0" in md
    # No findings table when there is nothing to show.
    assert "<details>" not in md
    assert "| # | Criticality |" not in md


def test_criticality_counts_by_observed_value(tmp_path: Path) -> None:
    findings = (
        [_finding(criticality="critical", host="src/k.py")]
        + [_finding(criticality="high", host=f"src/h{i}.py") for i in range(2)]
        + [_finding(criticality="medium", host=f"src/m{i}.py") for i in range(3)]
        + [_finding(criticality="low", host="src/l.py")]
    )
    proc, md = _render(tmp_path, findings)
    assert proc.returncode == 0
    assert "Findings: 7" in md
    assert "| critical | 1 |" in md
    assert "| high | 2 |" in md
    assert "| medium | 3 |" in md
    assert "| low | 1 |" in md
    assert f"`{SCRIPT.name}`" not in md  # no stray script self-references


def test_threshold_verdict_strings_mirror_cli_gate(tmp_path: Path) -> None:
    # threshold=high fails on critical AND high (order in cli.py is
    # critical > high > medium; blocking = criticality in order[:idx+1]).
    proc, md = _render(
        tmp_path,
        [_finding(criticality="critical"), _finding(criticality="high")],
        threshold="high",
    )
    assert proc.returncode == 0
    assert "**Verdict: FAIL** — 2 finding(s) at or above the `high` threshold." in md

    # threshold=critical ignores a merely-high finding.
    proc, md = _render(
        tmp_path, [_finding(criticality="high")], threshold="critical"
    )
    assert proc.returncode == 0
    assert "**Verdict: PASS** — no findings at or above the `critical` threshold." in md

    # threshold=medium trips on medium, not on low.
    proc, md = _render(tmp_path, [_finding(criticality="medium")], threshold="medium")
    assert proc.returncode == 0
    assert "**Verdict: FAIL** — 1 finding(s) at or above the `medium` threshold." in md

    proc, md = _render(tmp_path, [_finding(criticality="low")], threshold="medium")
    assert proc.returncode == 0
    assert "**Verdict: PASS**" in md


def test_more_than_ten_findings_are_truncated(tmp_path: Path) -> None:
    findings = [
        _finding(criticality="medium", host=f"src/f{i}.py") for i in range(13)
    ]
    proc, md = _render(tmp_path, findings)
    assert proc.returncode == 0
    assert "Findings (showing 10 of 13)" in md
    assert "and 3 more finding(s) truncated" in md
    rows = [line for line in md.splitlines() if line.startswith("| ") and line[2:3].isdigit()]
    assert len(rows) == 10


def test_findings_table_shows_location_and_algorithm(tmp_path: Path) -> None:
    proc, md = _render(
        tmp_path,
        [_finding(criticality="critical", host="src/kms.py", algorithm="RSA", line=41)],
    )
    assert proc.returncode == 0
    assert "| 1 | critical | `src/kms.py:41` | RSA |" in md


def test_exit_zero_even_when_findings_file_is_missing(tmp_path: Path) -> None:
    missing = tmp_path / "does-not-exist.json"
    out = tmp_path / "advisory.md"
    proc = _run(str(missing), "--output", str(out))
    assert proc.returncode == 0
    md = out.read_text(encoding="utf-8")
    assert "Could not read findings file" in md


def test_exit_zero_on_invalid_threshold(tmp_path: Path) -> None:
    proc, md = _render(tmp_path, [_finding(criticality="critical")], threshold="blocker")
    assert proc.returncode == 0
    assert "**Verdict: UNKNOWN**" in md


def test_stdout_mode_writes_markdown_and_exits_zero(tmp_path: Path) -> None:
    src = _write_findings(tmp_path, [_finding(criticality="high")])
    proc = _run(str(src), "--threshold", "high")
    assert proc.returncode == 0
    assert "## Q-Trust Crypto Gate (advisory)" in proc.stdout
    assert "**Verdict: FAIL** — 1 finding(s) at or above the `high` threshold." in proc.stdout

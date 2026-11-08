#!/usr/bin/env python3
"""Render the Q-Trust Crypto Gate advisory comment from a scan-source JSON file.

Standalone (stdlib only) so the composite GitHub Action at the repo root can
run it right after ``qtrust-inspector scan-source ... --output findings.json``
without importing the inspector package.

Contract (advisory is informational): this script always exits 0, even when
the findings file is missing or unreadable — it never blocks CI. Blocking
behavior lives in ``qtrust-inspector scan-source --ci-gate`` (see
``inspector/qtrust_inspector/cli.py``, ``_run_ci_gate``). The threshold
comparison here deliberately mirrors that gate: the order is
critical > high > medium, a finding blocks when its criticality appears at or
before the threshold in that order, and unknown criticality values never
block.

The findings file is the ``ScanResult`` JSON written by
``crypto-inspector scan-source --output`` (pydantic ``model_dump_json``): a
``target``/``scanner``/``findings`` object where each finding carries
``host``, ``port``, ``algorithm``, ``asset_type``, ``criticality`` and a
``metadata`` dict (source findings include the matched ``line``). The
``location`` shown below reconstructs the ``AssetFinding.location`` property
(``host[:port]``) and appends ``:line`` from metadata when present.

Everything rendered is read from the data or from this repository's files —
no invented claims. The artifact names must stay in sync with ``action.yml``.

Usage:
    python ci_gate_advisory.py findings.json [--threshold high] [--output advisory.md]

With ``--output`` the markdown is written to the file; without it the
markdown goes to stdout. Exit code is 0 in every case handled here.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Artifact file names uploaded by the root action.yml. Keep in sync.
ARTIFACT_FINDINGS = "qtrust-findings.json"
ARTIFACT_CBOM = "qtrust-cbom.json"
ARTIFACT_SARIF = "qtrust-cbom.sarif.json"

# Threshold order and semantics copied from cli.py::_run_ci_gate.
THRESHOLD_ORDER = ["critical", "high", "medium"]
# Display order for the counts table; non-standard values are appended after.
STANDARD_CRITICALITIES = ["critical", "high", "medium", "low"]

MAX_FINDINGS_SHOWN = 10


def load_result(path: Path) -> dict:
    """Load a ScanResult JSON file. Raises on missing/invalid files."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("findings file is not a JSON object")
    return data


def count_by_criticality(findings: list[dict]) -> dict[str, int]:
    """Count findings per observed criticality value (raw, no invention)."""
    counts: dict[str, int] = {}
    for f in findings:
        crit = str(f.get("criticality", ""))
        counts[crit] = counts.get(crit, 0) + 1
    return counts


def blocking_findings(findings: list[dict], threshold: str) -> list[dict]:
    """Findings at or above the threshold, mirroring cli.py::_run_ci_gate.

    Raises ValueError for a threshold outside critical|high|medium.
    """
    if threshold not in THRESHOLD_ORDER:
        raise ValueError(
            f"threshold must be one of: {', '.join(THRESHOLD_ORDER)}"
        )
    min_index = THRESHOLD_ORDER.index(threshold)
    allowed = THRESHOLD_ORDER[: min_index + 1]
    return [f for f in findings if str(f.get("criticality", "")) in allowed]


def _location(finding: dict) -> str:
    """Reconstruct AssetFinding.location (host[:port]) plus :line metadata."""
    host = str(finding.get("host", ""))
    port = finding.get("port")
    location = f"{host}:{port}" if port else host
    line = finding.get("metadata", {}).get("line")
    if isinstance(line, int):
        location = f"{location}:{line}"
    return location


def _cell(value: str) -> str:
    """Escape a value for use inside a markdown table cell."""
    return value.replace("|", "\\|").replace("\n", " ")


def _verdict_line(findings: list[dict], threshold: str) -> str:
    if threshold not in THRESHOLD_ORDER:
        return (
            f"**Verdict: UNKNOWN** — threshold `{threshold}` is not one of "
            f"{', '.join(f'`{t}`' for t in THRESHOLD_ORDER)}; "
            "no gate comparison performed."
        )
    blocking = blocking_findings(findings, threshold)
    if blocking:
        return (
            f"**Verdict: FAIL** — {len(blocking)} finding(s) at or above the "
            f"`{threshold}` threshold."
        )
    return (
        f"**Verdict: PASS** — no findings at or above the `{threshold}` "
        "threshold."
    )


def _findings_section(findings: list[dict]) -> str:
    """Table of up to MAX_FINDINGS_SHOWN findings with location + algorithm."""
    if not findings:
        return ""
    shown = findings[:MAX_FINDINGS_SHOWN]
    rows = ["| # | Criticality | Location | Algorithm |", "| --- | --- | --- | --- |"]
    for i, f in enumerate(shown, 1):
        algorithm = f.get("algorithm") or f.get("asset_type") or "-"
        rows.append(
            f"| {i} | {_cell(str(f.get('criticality', '')))} "
            f"| `{_cell(_location(f))}` | {_cell(str(algorithm))} |"
        )
    lines = [
        f"<details><summary>Findings (showing {len(shown)} of "
        f"{len(findings)})</summary>",
        "",
        *rows,
    ]
    if len(findings) > MAX_FINDINGS_SHOWN:
        hidden = len(findings) - MAX_FINDINGS_SHOWN
        lines += [
            "",
            f"_and {hidden} more finding(s) truncated; see the "
            f"`{ARTIFACT_FINDINGS}` artifact for the full list._",
        ]
    lines += ["", "</details>"]
    return "\n".join(lines)


def render_markdown(data: dict, threshold: str) -> str:
    """Render the advisory comment body from a ScanResult-shaped dict."""
    findings = data.get("findings", [])
    if not isinstance(findings, list):
        findings = []
    counts = count_by_criticality(findings)

    lines = [
        "## Q-Trust Crypto Gate (advisory)",
        "",
        f"Scan target: `{data.get('target', '')}` · "
        f"Findings: {len(findings)} · Threshold: `{threshold}`",
        "",
        "| Criticality | Findings |",
        "| --- | --- |",
    ]
    ordered = STANDARD_CRITICALITIES + sorted(
        c for c in counts if c not in STANDARD_CRITICALITIES
    )
    for crit in ordered:
        lines.append(f"| {crit} | {counts.get(crit, 0)} |")

    lines += ["", _verdict_line(findings, threshold)]

    findings_section = _findings_section(findings)
    if findings_section:
        lines += ["", findings_section]

    lines += [
        "",
        "Machine-readable outputs are attached to this workflow run as "
        f"artifacts: `{ARTIFACT_FINDINGS}` (scan result), "
        f"`{ARTIFACT_CBOM}` (CycloneDX 1.7 CBOM), "
        f"`{ARTIFACT_SARIF}` (SARIF 2.1).",
        "",
        "<sub>Advisory only: this comment is informational and does not gate "
        "merges. Threshold comparison mirrors "
        "`qtrust-inspector scan-source --ci-gate`.</sub>",
    ]
    return "\n".join(lines) + "\n"


def render_error_markdown(path: Path, reason: str) -> str:
    """Fallback body when the findings file cannot be read. Still exit 0."""
    return (
        "## Q-Trust Crypto Gate (advisory)\n"
        "\n"
        f"Could not read findings file `{path}`: {reason}\n"
        "\n"
        "This comment is informational only; the advisory renderer never "
        "blocks CI. Check the scan steps and the uploaded artifacts for "
        "details.\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render the Q-Trust Crypto Gate advisory comment "
        "(always exits 0)."
    )
    parser.add_argument("findings", help="ScanResult JSON from scan-source --output")
    parser.add_argument(
        "--threshold",
        default="high",
        help="critical|high|medium (mirrors scan-source --ci-gate semantics)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Write the markdown here (default: stdout)",
    )
    args = parser.parse_args(argv)

    findings_path = Path(args.findings)
    try:
        data = load_result(findings_path)
        markdown = render_markdown(data, args.threshold)
    except Exception as exc:  # advisory must never block CI
        markdown = render_error_markdown(findings_path, str(exc))

    if args.output is not None:
        args.output.write_text(markdown, encoding="utf-8")
    else:
        sys.stdout.write(markdown)
    return 0


if __name__ == "__main__":
    sys.exit(main())

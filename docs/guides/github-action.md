# Guide — Gate pull requests with the Q-Trust GitHub Action

The composite action at [`humoge7502/q-trust/.github/actions/qtrust-scan`](https://github.com/humoge7502/q-trust/tree/main/.github/actions/qtrust-scan) scans a repository, writes SARIF, uploads it to GitHub code scanning, and fails the job when findings meet a criticality threshold.

## Minimal workflow

```yaml
name: Crypto scan
on: [push, pull_request]

permissions:
  contents: read
  security-events: write   # required for SARIF upload

jobs:
  qtrust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: humoge7502/q-trust/.github/actions/qtrust-scan@main
        with:
          path: .
          threshold: high
```

The checkout step is required: the action scans the caller's workspace. The action installs the inspector from its **own pinned ref**, not from PyPI, so `uses: ...@<sha>` pins both the scanner code and the gate logic.

## What the action does

1. Sets up Python (`python-version`, default `3.12`) and installs the inspector from the action's checkout.
2. Runs `crypto-inspector scan <path> --sarif <sarif-file> [--ci-gate <threshold>]`, which covers source, manifest, binary and AST scanners.
3. Uploads the SARIF report to code scanning with category `qtrust` (when `upload: true`).
4. Fails the job when the scan exited `1` (gate tripped) or `2` (invalid input). SARIF is produced **before** the gate is evaluated, so results are always available even on a blocking run.

## Inputs

| Input | Default | Description |
|---|---|---|
| `path` | `.` | Directory to scan, relative to the workspace |
| `threshold` | `high` | Fail on findings at or above `critical`, `high` or `medium`; `none` reports without failing |
| `upload` | `true` | Upload SARIF to code scanning; requires `security-events: write` |
| `sarif-file` | `qtrust-results.sarif` | Where to write the report, relative to the workspace |
| `python-version` | `3.12` | Interpreter used to install the inspector |

## Outputs

| Output | Description |
|---|---|
| `sarif-file` | Path to the generated SARIF report |
| `exit-code` | `0` = passed, `1` = gate tripped, `2` = invalid threshold or target |

## Gate semantics

- `threshold: critical` fails only on critical findings.
- `threshold: high` (default) fails on high **and** critical findings.
- `threshold: medium` fails on medium, high and critical findings.
- `threshold: none` never fails the job; use it for advisory reporting.

An unknown threshold exits `2` rather than silently passing.

## Uploading without code scanning

Code scanning upload needs `security-events: write`, which fork pull requests do not receive. Set `upload: 'false'` there and keep the report as an artifact instead:

```yaml
      - id: qtrust
        uses: humoge7502/q-trust/.github/actions/qtrust-scan@main
        with:
          upload: 'false'
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: qtrust-sarif
          path: ${{ steps.qtrust.outputs.sarif-file }}
```

## Run the same scan locally

```bash
pip install ./inspector          # from a checkout of this repository
crypto-inspector scan . --sarif qtrust-results.sarif --ci-gate high
```

`--ci-gate` on the universal `scan` command is newer than PyPI release 2.2.0; install from the repository (or use the action) until the next PyPI release. The older `scan-source` command supports `--ci-gate` on PyPI 2.2.0.

## Limits

- The action scans one directory per invocation; a monorepo can run it as a matrix over package paths.
- Binary scanning walks archives and executables and can dominate runtime on large repositories. Point `path` at source directories when that matters.
- The action reports cryptographic findings; it is not a general SAST or secrets scanner.

The fixtures under `.github/actions/qtrust-scan/test-fixtures/` reproduce both outcomes: the clean fixture passes, and the weak-crypto fixture exits `1` at the `high` threshold while still producing SARIF. The CLI behaviour behind the gate is covered by `inspector/tests/test_scanner.py`.

*Last verified: 2026-10-29 · gate behaviour covered by `inspector/tests/test_scanner.py` and a local run of the action's scan commands against both fixtures.*

# Q-Trust CBOM Scan — GitHub Action

Scan your source for cryptographic APIs on every PR: CycloneDX 1.7 CBOM,
NIST/CNSA scoring, SARIF in GitHub code scanning, optional fail-gate.

## Use (10 lines)

```yaml
permissions:
  contents: read
  security-events: write

jobs:
  pqc:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: humoge7502/q-trust/cbom-action@v2.2.2
        with:
          compliance: nist,cnsa
          ci-gate: high        # fail the PR on high+ findings (omit to report only)
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: qtrust.sarif
          category: qtrust-cbom
```

## Inputs

| Input | Default | What |
|---|---|---|
| `path` | `.` | Source directory |
| `language` | (all) | e.g. `python`, `javascript`, `go` |
| `compliance` | `nist,cnsa` | fips, nis2, fisma, fedramp, cmmc also supported |
| `sarif-file` | `qtrust.sarif` | Feed to `upload-sarif` for code-scanning UI |
| `cbom-file` | `cbom.json` | CycloneDX 1.7 CBOM artifact |
| `ci-gate` | (off) | `critical` / `high` / `medium` fail threshold |
| `version` | `2.2.0` | Pinned `qtrust-inspector` from PyPI |

Powered by [`qtrust-inspector`](https://pypi.org/project/qtrust-inspector/)
(F1 0.9525 discovery, repo-disjoint eval). Scanner reference:
[humoge7502/q-trust](https://github.com/humoge7502/q-trust).

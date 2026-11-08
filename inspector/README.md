# qtrust-inspector

Multi-language cryptographic inventory and post-quantum risk scanner.
Produces CycloneDX CBOMs, SARIF findings, compliance scoring
(NIST / CNSA / PCI / BSI / NCSC / ASD), PCAP and network-log HNDL analysis,
and migration roadmaps. Part of the Q-Trust project
(`humoge7502/q-trust` on GitHub).

## Install

```bash
pip install qtrust-inspector
```

## Use

```bash
crypto-inspector scan example.com -c nist,cnsa
crypto-inspector scan ./src --sarif findings.sarif --cyclonedx cbom.json
```

## Library

```python
from qtrust_inspector.scanner import scan_host

result = scan_host("example.com")
print(result.finding_count, result.by_algorithm)
```

## Use in CI

The repository root ships a composite GitHub Action, `action.yml`
("Q-Trust Crypto Gate"), so other repositories can scan their source for
cryptographic API usage on every pull request:

```yaml
jobs:
  crypto-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7  # pin a SHA in your own workflow
      - uses: humoge7502/q-trust@main
        with:
          path: .
          threshold: high        # critical|high|medium
          advisory-only: true    # tripped gate never fails the job
          upload-cbom: true
```

Each run does the following:

- installs `qtrust-inspector` from PyPI and runs
  `crypto-inspector scan-source <path>` three times: once writing the
  findings JSON (`--output`) plus a CycloneDX 1.7 CBOM (`--cyclonedx`), once
  writing SARIF 2.1 (`--format sarif --output`; the CLI requires `--output`
  for SARIF and uses it for the SARIF file itself), and once enforcing the
  threshold with `--ci-gate`, which exits 1 when any finding is at or above
  the threshold (`high` also fails on `critical`, `medium` also fails on
  `high`);
- uploads `qtrust-findings.json`, `qtrust-cbom.sarif.json` and (unless
  `upload-cbom: false`) `qtrust-cbom.json` as workflow artifacts, even when
  the gate trips;
- on `pull_request` events, posts one advisory comment rendered from the
  findings JSON by `scripts/ci_gate_advisory.py` — counts by criticality,
  the threshold verdict (the same comparison `--ci-gate` applies), and up to
  10 findings with location and algorithm. The comment is informational;
  it never gates merges by itself.

Alpha limitations:

- the advisory comment is posted anew on every run — there is no
  deduplication or update of a previous comment yet;
- the action scans whatever is already in the caller's workspace, so run
  `actions/checkout` before it;
- a manual selftest of the action lives at
  `.github/workflows/crypto-gate-selftest.yml` (workflow_dispatch only;
  not wired into PR CI).

Real-world corpora and benchmarks live in
[`KRISHNAPURI/q-trust-datasets`](https://huggingface.co/datasets/KRISHNAPURI/q-trust-datasets).

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

Real-world corpora and benchmarks live in
[`KRISHNAPURI/q-trust-datasets`](https://huggingface.co/datasets/KRISHNAPURI/q-trust-datasets).

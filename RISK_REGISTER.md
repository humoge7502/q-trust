# Q-Trust Risk Register

Living document. Severity: CRITICAL / HIGH / MEDIUM / LOW. Status: OPEN / MITIGATED / ACCEPTED / CLOSED.

| # | Risk | Severity | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|---|---|
| R-01 | Smart contracts hold no external security audit; governance controls all registries via timelock | HIGH | — | Loss of funds/records if a vulnerability is exploited | UUPS + timelock (ADR 0003), 213 forge tests incl. Attack.t.sol adversarial suite, Slither pass clean of critical/high in project sources, IPausable compile-time invariant | OPEN (needs external audit budget) |
| R-02 | Backend relayer private key is a single operational secret; compromise allows forged attestations until revoked | HIGH | Low | Forged on-chain evidence | Daily spend cap + min-balance config (`QTRUST_RELAYER_*`), fail-closed startup, key never committed (verified by secret scan) | MITIGATED |
| R-03 | GNN/CodeBERTa checkpoints shipped without full from-scratch retrain reproduction in this engagement | MEDIUM | Low | Metrics could drift from code reality | TRUTH_AUDIT.md records lineage; leakage audit reproduced the split bit-identically; training scripts seeded and deterministic | ACCEPTED (4×GPU retrain queued) |
| R-04 | Planner unbounded request amplification (large CBOM → larger response) | MEDIUM | Medium | DoS cost amplification | `QTRUST_PLANNER_MAX_ASSETS` cap (verified live), rate limiter, API-key auth | MITIGATED |
| R-05 | Transient CI failures from external services (PyPI API, TLS scans) create false alarms | LOW | Medium | CI noise, blocked merges | Observed once (pip-audit network error, re-run green); policy: rerun before investigating | ACCEPTED |
| R-06 | docs-v2 and mkdocs are two documentation systems; drift risk between them | LOW | Medium | Conflicting instructions | docs-v2 already uses correct SDK API; docs-contract test locks README SDK examples to real code | MITIGATED |
| R-07 | Vendored OpenZeppelin carries Slither informational findings; upstream fixes lag | LOW | High | Cosmetic warnings mask real ones | Findings triaged and classified (see Slither report in PR #54); none critical/high | ACCEPTED |
| R-08 | EOA-governed relayer in dev; production multisig not yet wired | MEDIUM | — | Governance centralization in prod | Timelock delay enforced on-chain; documented in TRUTH_AUDIT (§QTRUST-010) | OPEN |

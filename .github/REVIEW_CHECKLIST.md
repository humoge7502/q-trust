# Reviewer Checklist

<!-- For reviewers of humoge7502/q-trust. Work through this before approving.
     Authors: this mirrors .github/PULL_REQUEST_TEMPLATE.md and CONTRIBUTING.md;
     if your PR follows the author checklist, this review is fast. Copy-paste the
     relevant sections into the PR conversation and check them off as you verify. -->

## 0. Triage & routing

- [ ] PR title follows conventional commits (`feat:`, `fix:`, `docs:`, `perf:`, `chore:`, …)
- [ ] Exactly one primary type label (`feat` / `fix` / `security` / `perf` / `docs` / `chore` / `deps`; `major`/`minor` for version bumps, or `skip-changelog`)
- [ ] Affected subsystems declared in the PR template match the actual diff — check every path with `git diff --stat main...HEAD`
- [ ] PR is small and focused; big mixed changes are split before review
- [ ] Correct reviewer routing per subsystem (contracts → Solidity reviewer, backend → backend reviewer, planner → ML reviewer, …)

## 1. Substantive review — read the diff first

- [ ] Read the whole diff yourself; comment on logic, naming, error handling, and edge cases — not style
- [ ] Approve-worthy code: clear intent, defensive input validation, no dead code, no copy-paste drift
- [ ] Question any added dependency: needed, maintained, smallest available surface?

## 2. Tests

Run the suites for every subsystem the PR touches (verified against
`CONTRIBUTING.md` and `.github/workflows/ci.yml`):

- [ ] Contracts: `cd contracts && forge test -vvv`
      New registry functions need invariant + fuzz coverage; invariant suite runs
      under `fail_on_revert=true` (runs=1000, depth=100)
- [ ] Backend: `cd backend && npm test` — plus `npm run typecheck` and `npm run build`
- [ ] Frontend: `cd frontend && npm test` — plus `npm run build`;
      E2E if UI changed: `npm run test:e2e` (Playwright)
- [ ] Inspector: `cd inspector && pytest`
- [ ] SDK: `cd sdk && pytest` — property tests: `pytest sdk/tests/test_properties.py -v`
- [ ] Planner: `QTRUST_PLANNER_DEVICE=cpu pytest planner/tests/ -v`
- [ ] New/changed behavior is covered by tests — no snapshot-only "coverage"
- [ ] Bug fixes include a regression test that fails on the old code

## 3. Measured claims (Q-Trust's credibility rests on reproducible numbers)

- [ ] Every number (latency, throughput, τ, gas, version counts) cites its source:
      benchmark script/JSON, CI run, or notebook — no unsourced numbers
- [ ] Spot-check at least one cited artifact exists and matches the claim
      (e.g. `planner/results/benchmark_v3.json`, `docs/PERFORMANCE.md`, `ops/loadtest/`)
- [ ] Stale numbers in docs touched by this PR were updated, not just re-asserted

## 4. Security

- [ ] No secrets, private keys, or API tokens in the diff (CI runs gitleaks +
      dev-key-guard; dev keys belong in tests only)
- [ ] Auth, key handling, on-chain access control, rate limiting, input
      validation, and data exposure considered — impact stated in the PR or "None"
- [ ] Security-sensitive changes: `npm audit` and `pip audit` run (CI enforces
      `npm audit --audit-level=high`)
- [ ] All admin paths still go through timelock governance — **no bypasses**
- [ ] If the PR fixes a vulnerability: exploit details are absent from the PR
      and it references the advisory

## 5. Breaking changes & migration

- [ ] Breaking-change checkbox matches reality (API, ABI, env var, on-chain
      schema, or storage layout change ⇒ `major` label)
- [ ] Migration path is described: env vars, API consumers, SDK users,
      contract upgrade/timelock steps — or "None"
- [ ] UUPS upgrades keep storage layout compatible; timelock delay respected

## 6. Documentation

- [ ] User-visible changes (CLI flags, API endpoints, env vars, contract events)
      update `docs/` in the same PR — or N/A with a one-line reason
- [ ] `docs-v2/` pages and `sdk/README.md` / CLI `--help` updated where relevant
- [ ] Mermaid diagrams stay ≤12 nodes and match the code
- [ ] Any new design decision lands as an ADR in `docs/adr/` (ADR-0000 format)

## 7. Style & hygiene

- [ ] Solidity 0.8.24, OpenZeppelin conventions, NatSpec on public/external functions, no hardcoded addresses
- [ ] Python passes `ruff check .`; type hints everywhere; Pydantic for data structures
- [ ] TypeScript strict mode; project ESLint config clean
- [ ] No generated artifacts, editor files, or `.env` changes committed

## 8. Before approving

- [ ] Required CI checks green (contracts, SDK, property tests, inspector, backend, frontend, planner, gitleaks)
- [ ] Every one of your own review comments is resolved or has a concrete follow-up issue
- [ ] Merge method follows repo convention (squash for feature branches)
- [ ] Release notes: label taxonomy correct so `.github/release-drafter.yml` picks it up

---

*Reviewer rule of thumb: review the code, not the author. Ask questions before
demanding changes; be specific and kind — see the Code of Conduct.*

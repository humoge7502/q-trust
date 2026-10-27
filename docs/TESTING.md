# Testing strategy

The suite is organised around a few claims, and every layer exists to make one of
them falsifiable. This page states which layer proves what, how to run it, what
it cannot prove, and the conventions a new test is expected to follow.

## 1. The claims

| Claim | What proves it |
|---|---|
| A verifier accepts only bundles that are intact, in window and signed by the named issuer | tamper matrix in `backend/tests/certification-structure.test.ts` — every signed field is mutated, and the reported reasons are asserted exactly |
| Issuance refuses, rather than signs, evidence the policy cannot support | per-gate refusal matrix in `backend/tests/certification-policy.test.ts` |
| Two issuers given identical evidence produce identical bytes | determinism tests (same content ⇒ same `bundle_id`, digest and signature) plus the committed fixture |
| The Python SDK accepts byte-for-byte what the TypeScript issuer produces | `sdk/tests/test_bundle.py` against `sdk/tests/fixtures/certification_bundle.json`, which CI regenerates and byte-compares |
| The certification core cannot be quietly weakened | Stryker mutation score with an enforced break threshold (§5) |
| The documented API surface is the served API surface | `backend/tests/certify-docs.test.ts` boots the plugin and diffs the registered routes against the OpenAPI document |
| The UI is operable, accessible and within budget | Vitest + Testing Library, axe audits and a Core Web Vitals budget in Playwright (§6) |
| Registry contracts preserve their invariants under hostile calls | Foundry suites in `contracts/test` (§7) |

## 2. Inventory

Counts re-measured on 2026-10-26 by running each suite locally.

| Package | Runner | Files | Tests | Run with |
|---|---|---|---|---|
| `backend` | Vitest 4 | 23 | 306 | `cd backend && npm test` |
| `sdk` | pytest | 9 | 87 | `cd sdk && python -m pytest` |
| `inspector` | pytest | 14 | 268 | `cd inspector && python -m pytest` |
| `planner` | pytest | 11 | 99 | `cd planner && python -m pytest` |
| `qtrust_ai` | pytest | 5 | 60 | `cd qtrust_ai && python -m pytest` |
| `frontend` | Vitest 4 + jsdom | 23 | 168 | `cd frontend && npm test` |
| `frontend` (browser) | Playwright | 7 specs | 64 (two viewports) | `cd frontend && npm run test:e2e` |
| `contracts` | Foundry | 18 `.t.sol` | 209 test functions | `cd contracts && forge test` |

Type checking is a separate gate: `cd backend && npm run typecheck`. A test run
that passes with a type error is not a pass.

## 3. Layers, in the order a change should be checked

1. **Unit** — one module, dependencies injected. Most backend services take
   their readers as function arguments, so a test passes a stub instead of
   mocking a module.
2. **Golden vectors** — `backend/tests/certification-vectors.test.ts` computes
   canonical JSON, leaf hashes, the Merkle root and the bundle digest with code
   written independently of the implementation, and compares.
3. **Cross-language compatibility** — `backend/scripts/make-certification-fixture.ts`
   writes a bundle from a fixed key and a fixed clock; the file is committed and
   the Python SDK verifies it. CI fails if the generator no longer reproduces it
   byte-for-byte, so a change that breaks Python clients cannot land silently.
4. **HTTP integration** — routes are exercised through `fastify.inject`, which
   covers serialisation, status mapping and error shapes without a socket.
5. **Docs-as-code** — the OpenAPI document is compared with the route table, so
   a new endpoint without documentation fails the build.
6. **Mutation** — see §5.
7. **Browser** — see §6.

## 4. Conventions

- **Assert reason lists exactly.** `expect(result.reasons).toEqual([...])` rather
  than `toContain(...)`. A verifier that reports the right refusal plus a spurious
  one is a different product behaviour, and `toContain` cannot see the difference.
  Order is part of the contract: structure → digest → Merkle → signature →
  validity.
- **Prefer stubs to module mocks.** Pass a function; do not mock a module, unless
  the test is specifically about resolution (the issuer-key resolver tests use
  `vi.hoisted` + `vi.mock(importOriginal)` to override exactly one export).
- **Mutate a draft, not the fixture.** `structuredClone(bundle)` then edit by
  dotted path; a test that edits the shared fixture leaks state into the next one.
- **Boundaries get a matrix.** A single "too old" case does not prove the
  boundary; `it.each` cases sit at `max`, `max + 1`, `0`, `NaN`, `±Infinity`.
- **Determinism is itself a test.** Issuing twice with the same inputs must
  produce the same bytes, and changing any signed field must change the id.
- **A test must be able to fail.** Before trusting a green test, mutation-testing
  the line it claims to cover is the cheapest proof; the Stryker survivors list
  in §5 is the standing record of where that has not been done.

## 5. Mutation testing

Scope is deliberately narrow: `backend/src/services/certification.ts`, the code
that decides whether a certificate is issued and whether one is accepted. A test
that passes against a mutated verifier is worse than no test, because it reports
safety that does not exist.

Configuration: `backend/stryker.config.json` (Vitest runner, `perTest` coverage
analysis, two workers, a dedicated `tsconfig` because TypeScript 7 no longer
exposes the legacy compiler API Stryker's default instrumenter needs).

```bash
cd backend
npm run test:mutation          # ~9 minutes, writes reports/mutation/
```

Thresholds are `high: 90`, `low: 80`, `break: 75`. A run below 75 exits non-zero,
and `.github/workflows/mutation.yml` runs the gate on changes to the service, its
Stryker config or the workflow itself.

### Reading a report

`reports/mutation/certification.json` records each mutant with its source
location. To resolve a survivor to code, use `location.start.line` /
`location.start.column` — columns are stable across edits, while line numbers
shift. A survivor is one of:

- **Missing test** — add one that pins the behaviour.
- **Redundant code** — delete the branch. A condition that cannot change the
  result should not exist; removing it also removes its mutants.
- **Equivalent mutant** — the mutation cannot change an observable result. Each
  one is recorded here with the argument for why, so the list does not grow
  silently.

### Run history

| Run | Mutants | Killed | Timed out | Survived | Score | Note |
|---|---|---|---|---|---|---|
| Baseline | 589 | 337 | — | — | 66.73% in scope | first measurement, before the hardening pass |
| Run 2 | 593 | 548 | 6 | — | 93.58% in scope | tamper matrix and refusal matrix added |
| Run 3 | 597 | 584 | 3 | 10 | 98.32% | redundant branches removed; survivors triaged |
| Run 4 | 596 | 588 | 3 | 5 | 99.16% | zero-word comparison, migration floor as a product, id restructure |

Reports for earlier runs are kept under `backend/reports/mutation/baseline-2026-10-25/`
(the directory is gitignored; regenerate with `npm run test:mutation`).

Stryker counts a timed-out mutant as detected: a mutant that makes the suite hang
has not passed. Excluding the three timeouts, the run is 588/596 = 98.66%. Every
one of the five survivors is listed below; none is an untested behaviour.

### The five survivors, and why they cannot be killed

| Location | Mutation | Why it cannot change an observable result |
|---|---|---|
| `sha256Hex` — `createHash().update(input, "utf8")` | encoding → `""` | Node treats an empty encoding for a string input exactly as `utf8`; the digest is identical |
| `Buffer.from(canonicalJson(...), "utf8")` in signing and in verification | encoding → `""` | same: identical bytes, therefore identical signature |
| audit fallback `result: "None"` | label → `""` | the fallback sets `exists: false` and only the falsy `exists` is read; the label never reaches a bundle, a refusal or a caveat |
| audit fallback object literal | whole object → `{}` | as above: `exists` is undefined, which is falsy, and no other field is read |

Two encoding survivors and one label survivor are the cost of writing the obvious
code rather than an obfuscated equivalent; deleting the encoding argument or the
label would make the source less clear to satisfy a metric. The list is
regenerated after every run: resolve each survivor and either kill it, delete the
code, or add a row here.

## 6. Frontend

- `npm test` — Vitest + Testing Library over components, hooks and client
  utilities (API URL resolution, sanitisation, operator-key handling, CID
  validation).
- `npm run test:e2e` — Playwright: smoke navigation, certification flow,
  mobile layout, axe accessibility audits (`a11y*.spec.ts`) and a Core Web
  Vitals budget (`cwv-budget.spec.ts`).
- `npm run build` — the production build is a gate of its own: a client
  component that reaches for a server-only API fails here and nowhere else.

The accessibility specs run axe against rendered pages, so a colour-token change
that drops a pair below 4.5:1 fails the suite rather than shipping.

## 7. Contracts

`contracts/test` holds 18 Foundry suites (209 test functions) covering registry
access control, upgrade authorisation, pausing, invariants and symbolic checks.
Foundry is not installed in this environment, so those suites are run by CI and
by any developer with `forge` on `PATH`; the TypeScript suite cannot substitute
for them. Deployment scripts are checked by the ABI-drift gate instead: the
committed ABI files must match what the Solidity sources compile to.

## 8. What this suite does not prove

- It does not prove the read model matches the chain at every block; that is
  the indexer's reconciliation job (`inspect` package) and is tested there.
- It does not prove the ML scorer is well calibrated on data it has not seen;
  that claim is measured separately and reported with its corpus and split.
- It does not prove the contracts are safe; it proves the tested behaviours.
  Foundry's invariant and symbolic suites raise the bar, not the ceiling.

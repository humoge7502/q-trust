# Q-Trust Audit Dossier

Prepared with the `audit-context-building` skill method (2026-09-06) for the
external contract audit tracked as RISK_REGISTER R-01. This is **context, not
verdicts**: what the system assumes, guarantees, and depends on. Per-function
records below cover the four functions where a bug would be most expensive;
the same discipline extends to the rest during the audit itself.

## 1. System rules that span functions

1. **All writes are role-gated.** Every registry write requires either an
   on-chain role (`REGISTRAR_ROLE`, `VENDOR_ROLE`, …) or a valid EIP-712
   signature from a role holder, relayed by the backend.
2. **Governance is timelocked and role-capped.** `PROPOSER_ROLE` schedules;
   the timelock executes after `DEFAULT_DELAY = 7 days`
   (`QTrustGovernance.sol:35`). Operational roles may ONLY be granted to the
   timelock itself; `DEFAULT_ADMIN_ROLE` can never be scheduled
   (`_scheduleGrantRole`, lines 85–100, audit M-3 fix).
3. **Upgrades are admin-only and delay-bound.** Each UUPS registry's
   `_authorizeUpgrade` requires `DEFAULT_ADMIN_ROLE` (e.g.
   `AssetRegistry.sol:105`); admin lives behind the timelock after
   initialization.
4. **Signed flows are replay-safe and revocation-safe.** Per-signer nonces
   increment monotonically (`VendorRegistry.sol:207`); `VENDOR_ROLE` is
   re-checked on the signed path even after role revocation (audit H-1 fix,
   line 194).
5. **Pausable everywhere, compile-time enforced.** All 10 registries inherit
   `IPausable`; writes are `whenNotPaused`; governance schedules
   `pause()/unpause()` via the interface (PR #54 invariant test).
6. **Domain separators are chain-fork safe.** EIP-712 domains cache the
   chainId and rebuild on mismatch (`_cacheDomainSeparator`,
   `VendorRegistry.sol:142`), so a chain fork cannot replay signatures.
7. **Relayer never holds user funds and cannot choose content.** The backend
   relayer validates signature + nonce before broadcast
   (`backend/src/services/attestation.ts`), per-vendor nonce locks serialize
   concurrent relays (lines 35–83), and a daily spend cap bounds gas drain.

## 2. Unenforced assumptions (nothing checks these in code)

| # | Assumption | If violated |
|---|---|---|
| A-1 | `REGISTRAR_ROLE` grants on mainnet are made only after verifying the org | Hostile but valid registrations poison public evidence |
| A-2 | The relayer key is rotated and its balance is small | Key theft enables forged-but-valid attestations until rotation |
| A-3 | The deployer initializes every proxy with the timelock (or a multisig) as admin, never an EOA long-term | Governance centralization (TRUTH_AUDIT §QTRUST-010) |
| A-4 | On-chain `metadataURI`/`evidenceURI` strings are not trusted by off-chain consumers | Frontend fetches are CID-validated (TM-FE-01 fix); other consumers must do the same |
| A-5 | `evidenceURI` points to content whose hash is not itself evidence | Evidence integrity rests on the `evidenceURI` provider, not the chain |

## 3. Function micro-analyses (highest-value targets)

### `QTrustGovernance._scheduleGrantRole` in src/QTrustGovernance.sol (L83–100)

**Purpose:** the only path by which any role lands on any account post-deploy.

**Inputs & Assumptions:** `role` (bytes32, untrusted — from proposer);
`account` (address, untrusted); `salt` (bytes32, untrusted, replay domain).
Implicit: caller holds `PROPOSER_ROLE`.

**Outputs & Effects:** schedules `grantRole(role, account)` on `target`
through the timelock after 7 days.

**Key block:**

```solidity
// L92-97
if (role == _DEFAULT_ADMIN_ROLE) revert ForbiddenGovernanceCall();
if (account != address(timelock)) revert ForbiddenGovernanceCall();
bytes memory data = abi.encodeCall(IAccessControl.grantRole, (role, account));
_schedule(target, data, salt);
```

- **Assumes:** `target` is a registry whose `grantRole` is standard AccessControl.
- **Establishes:** after the timelock delay, `account` (== timelock) holds `role`.
- **Depended on by:** every operational authorization in the system.
- **Audit note:** the double guard (no admin role; account must be timelock)
  closes the M-3 lateral-escalation path. Residual: a proposer can still
  schedule *pauses* and *deactivations* — denial-of-service via governance is
  possible for any proposer; proposers must therefore be as trusted as admins.

### `VendorRegistry.attestByRelayer` in src/VendorRegistry.sol (L186–210)

**Purpose:** gasless attestation entry; the only unauthenticated callable
write that mints state.

**Inputs & Assumptions:** all params untrusted; `signature` attacker-crafted;
implicit: signer must currently hold `VENDOR_ROLE` and be `active`.

**Key block:**

```solidity
// L193-207
address signer = _recoverSigner(...);
if (signer == address(0)) revert InvalidSignature();
if (!hasRole(VENDOR_ROLE, signer)) revert NotVendor(signer);
if (nonces[signer] != nonce) revert InvalidNonce(signer, nonce, nonces[signer]);
if (!_vendors[signer].active) revert VendorInactive(signer);
nonces[signer] = nonce + 1;
```

- **Establishes:** exactly-once attestation per (signer, nonce); role
  revocation kills the signed path even without deactivation (H-1 fix).
- **Depended on by:** relayer backend assumes this ordering; its per-vendor
  in-process nonce lock mirrors the on-chain monotonicity.
- **Audit note:** nonce check-before-increment is correct; `_recoverSigner`
  uses `ECDSA.recover` (reverts on malformed sigs → the `address(0)` check is
  belt-and-braces). Cross-registry signature replay is impossible because each
  registry's domain includes its own `verifyingContract`.

### `AssetRegistry._registerCBOM` (L219–247) + `_currentDomainSeparator` (L141–152)

**Purpose:** mints asset records; the domain-separator path here is shared by
every signed registry flow.

**Key property:** dynamic strings are hashed *individually*
(`keccak256(abi.encodePacked(metadataURI))`) inside `abi.encode` — the
adjacent-dynamic-type `encodePacked` collision class does not exist anywhere
in the EIP-712 hashing (verified across all 8 `encodePacked` uses in
VendorRegistry and equivalent sites in the other registries).

- **Assumes:** `block.chainid` changes only on fork; rebuild-on-mismatch
  (L142) handles it.
- **Establishes:** signatures are chain-bound and contract-bound; replay
  across forks or registries fails.

### Backend relayer nonce serialization in backend/src/services/attestation.ts (L35–83)

**Purpose:** prevents two concurrent relayed requests from racing the
on-chain nonce read → both revert (gas loss) or reorder.

**Key block:**

```typescript
// L76-83
const prev = nonceLocks.get(key) ?? Promise.resolve();
const tail = prev.then(run, run);
nonceLocks.set(key, tail);
... if (nonceLocks.get(key) === tail) nonceLocks.delete(key);
```

- **Assumes:** single backend process (in-memory Map). **Multi-process
  deployment needs a distributed lock** — recorded as the main scaling
  assumption for auditors to probe.
- **Establishes:** per-vendor FIFO relay ordering.

## 4. Open questions for the audit

1. Is the in-memory relayer nonce lock acceptable for the target deployment
   topology (single container) or should the design document a Redis-based
   lock for scale-out?
2. Should `schedulePause`-by-proposer be narrowed (proposer = DoS authority)?
3. Is there a need for an on-chain registry-content commitment (Merkle root)
   so bulk evidence can be audited without trusting the read model?

## 5. Existing hygiene (what auditors will find already done)

Slither pass (critical/high: none in project sources), 213 forge tests incl.
adversarial suite (`Attack.t.sol`), remediations from prior internal audits
labeled in-code (H-1, M-3, L-3, REG-14, FE-1/2/3), IPausable compile-time
invariant test, `weights_only=True` checkpoint loading, fail-closed backend
config gates, SSRF-hardened IPFS fetch (TM-FE-01), threat model at
`docs/SECURITY_THREAT_MODEL.md`.

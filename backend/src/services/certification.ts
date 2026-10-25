/**
 * Validity-gated certification bundles.
 *
 * A certification bundle is a self-contained, Ed25519-signed snapshot of an
 * organisation's on-chain assurance state: the assets, migrations, vendor
 * attestations and latest audit that existed at a specific block, committed to
 * a Merkle root, wrapped in a policy decision and a validity window.
 *
 * Two properties make it useful to auditors and to customers:
 *
 *   1. VALIDITY-GATED — issuance refuses (HTTP 409) when the evidence cannot
 *      support the claim under the selected policy (no assets, failed audit,
 *      stale audit, too many unverified migrations). It never signs a
 *      certificate it cannot back.
 *   2. OFFLINE-VERIFIABLE — the whole claim set, including the evidence
 *      records and their Merkle root, travels inside the bundle. A verifier
 *      with no network access re-checks the digest, the Merkle root and the
 *      Ed25519 signature. Chain re-anchoring is an optional extra, not a
 *      prerequisite.
 *
 * Canonicalisation is shared with the VC service (sorted keys, compact
 * separators) so the Python SDK can verify a bundle produced here byte for
 * byte — the same guarantee that already exists for credentials.
 */
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import type { Address } from "viem";
import { CHAIN, CONTRACTS, isZeroAddress, publicClient } from "../config.js";
import { RevocationAnchorAbi } from "../lib/abis.js";
import {
  getAssetsByOrg,
  getLatestAudit,
  getMigrationsByOrg,
  getOrgSummary,
  getVendorAttestations,
  type LatestAuditInfo,
} from "./verify.js";
import { canonicalJson, issuerKeyPair, resolveIssuerKey } from "./vc.js";

export const BUNDLE_SCHEMA = "qtrust.certification.v1";

// ------------------------------------------------------------------
// Policy registry
// ------------------------------------------------------------------
export interface CertificationPolicy {
  id: string;
  version: string;
  description: string;
  require_asset_evidence: boolean;
  require_audit: boolean;
  max_audit_age_days: number;
  reject_failed_audit: boolean;
  min_verified_migration_ratio: number;
  require_revocation_root: boolean;
  max_validity_days: number;
  default_validity_days: number;
}

const POLICIES: Record<string, CertificationPolicy> = {
  default: {
    id: "qtrust.certification.default",
    version: "1.0.0",
    description: "Baseline assurance: requires registered assets and no failed audit.",
    require_asset_evidence: true,
    require_audit: false,
    max_audit_age_days: 365,
    reject_failed_audit: true,
    min_verified_migration_ratio: 0,
    require_revocation_root: false,
    max_validity_days: 365,
    default_validity_days: 30,
  },
  regulated: {
    id: "qtrust.certification.regulated",
    version: "1.0.0",
    description:
      "Regulated-sector assurance: requires a current audit and a published revocation root.",
    require_asset_evidence: true,
    require_audit: true,
    max_audit_age_days: 365,
    reject_failed_audit: true,
    min_verified_migration_ratio: 0,
    require_revocation_root: true,
    max_validity_days: 180,
    default_validity_days: 30,
  },
  strict: {
    id: "qtrust.certification.strict",
    version: "1.0.0",
    description:
      "Strict assurance: current passing audit, revocation root, and >=90% verified migrations.",
    require_asset_evidence: true,
    require_audit: true,
    max_audit_age_days: 180,
    reject_failed_audit: true,
    min_verified_migration_ratio: 0.9,
    require_revocation_root: true,
    max_validity_days: 90,
    default_validity_days: 14,
  },
};

export function listCertificationPolicies(): CertificationPolicy[] {
  return Object.values(POLICIES).map((p) => ({ ...p }));
}

export function getCertificationPolicy(id: string): CertificationPolicy {
  const policy = POLICIES[id];
  if (!policy) {
    throw new CertificationPolicyError(
      `Unknown certification policy '${id}' — choose one of: ${Object.keys(POLICIES).join(", ")}`,
    );
  }
  return { ...policy };
}

export class CertificationPolicyError extends Error {}
export class CertificationRefusedError extends Error {
  constructor(
    message: string,
    readonly reasons: string[],
    readonly policy: CertificationPolicy,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------
// Bundle types
// ------------------------------------------------------------------
export type EvidenceKind = "asset" | "migration" | "attestation" | "audit";

export interface EvidenceLeaf {
  kind: EvidenceKind;
  id: string;
  /** sha256 over the canonical JSON of `record`. */
  digest: string;
  record: Record<string, unknown>;
}

export interface MerkleEvidence {
  hash_algorithm: "sha256";
  leaf_count: number;
  merkle_root: string;
  leaves: EvidenceLeaf[];
}

export interface BundleAnchor {
  chain_id: number;
  chain_name: string;
  block_number: number | null;
  block_hash: string | null;
  block_timestamp: number | null;
  anchored: boolean;
}

export interface RevocationState {
  checked: boolean;
  root: string | null;
  configured: boolean;
}

export interface BundleClaims {
  asset_count: number;
  migration_counts: { total: number; verified: number; unverified: number };
  latest_audit: {
    exists: boolean;
    result: string;
    result_code: number;
    timestamp: number;
  } | null;
  attestation_count: number;
  revocation: RevocationState;
}

export interface BundleProof {
  type: "Ed25519Signature2020";
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  proofValue: string;
}

export interface CertificationBundle {
  schema: typeof BUNDLE_SCHEMA;
  bundle_id: string;
  issued_at: string;
  valid_from: string;
  valid_until: string;
  issuer: string;
  subject: { org: string; chain_id: number };
  verdict: "CERTIFIED" | "CONDITIONAL";
  policy: CertificationPolicy;
  claims: BundleClaims;
  evidence: MerkleEvidence;
  anchor: BundleAnchor;
  caveats: string[];
  digest: string;
  proof: BundleProof;
}

export interface IssueCertificationInput {
  org: Address;
  policy?: string;
  validity_days?: number;
  now?: Date;
  /** Evidence page size; bounded to keep bundles portable. */
  evidence_limit?: number;
}

export interface CertificationDeps {
  summary: typeof getOrgSummary;
  assets: typeof getAssetsByOrg;
  migrations: typeof getMigrationsByOrg;
  attestations: typeof getVendorAttestations;
  audit: typeof getLatestAudit;
  revocation: (org: Address) => Promise<RevocationState>;
  anchor: () => Promise<BundleAnchor>;
}

/**
 * The live dependency set: indexer reads plus on-chain revocation root and
 * block anchor. Exported so a caller can override one read — a benchmark, a
 * fixture, a test — while keeping the real chain readers instead of
 * reimplementing them.
 */
export const defaultDeps: CertificationDeps = {
  summary: getOrgSummary,
  assets: getAssetsByOrg,
  migrations: getMigrationsByOrg,
  attestations: getVendorAttestations,
  audit: getLatestAudit,
  revocation: readRevocationRoot,
  anchor: readAnchor,
};

// ------------------------------------------------------------------
// Hashing helpers
// ------------------------------------------------------------------
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function evidenceLeafHash(leaf: Pick<EvidenceLeaf, "kind" | "id" | "digest">): string {
  return sha256Hex(canonicalJson({ kind: leaf.kind, id: leaf.id, digest: leaf.digest }));
}

/**
 * Deterministic Merkle root. Leaves are sorted so the root does not depend on
 * query order; odd levels duplicate the last node (Bitcoin-style), which is
 * unambiguous because leaf count is committed in the bundle.
 */
export function merkleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 0) {
    return `0x${sha256Hex("qtrust:empty-evidence")}`;
  }
  let level = [...leafHashes].sort();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(sha256Hex(left + right));
    }
    level = next;
  }
  return `0x${level[0]}`;
}

/** Digest of everything in the bundle except `digest` and `proof`. */
export function bundleDigest(bundle: Record<string, unknown>): string {
  const body: Record<string, unknown> = { ...bundle };
  delete body.digest;
  delete body.proof;
  return `sha256:${sha256Hex(canonicalJson(body))}`;
}

/**
 * Content-derived bundle id: a name-based UUID (RFC 4122 bit layout, SHA-256
 * in place of SHA-1) over the canonical bundle without its own id. Re-issuing
 * an unchanged assertion therefore reproduces the same bundle byte for byte —
 * which is what makes the cross-language fixture reproducible — and a verifier
 * can tell a duplicate claim from a new one. Same principle as the keccak256
 * registry ids in ADR 0006.
 */
function bundleId(content: Record<string, unknown>): string {
  const hex = sha256Hex(canonicalJson(content));
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const groups = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ];
  return `urn:uuid:${groups.join("-")}`;
}

function auditTimestamp(value: { timestamp: number } | null): number | null {
  if (!value || !Number.isFinite(value.timestamp) || value.timestamp <= 0) return null;
  return value.timestamp;
}

// ------------------------------------------------------------------
// Issuance
// ------------------------------------------------------------------

/** Solidity's default value for an unset `bytes32`. */
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

async function readRevocationRoot(org: Address): Promise<RevocationState> {
  if (isZeroAddress(CONTRACTS.revocationAnchor)) {
    return { checked: false, root: null, configured: false };
  }
  try {
    const root = (await publicClient.readContract({
      address: CONTRACTS.revocationAnchor,
      abi: RevocationAnchorAbi,
      functionName: "getRevocationRoot",
      args: [org],
    })) as string;
    // Solidity's default for an unset bytes32 is the zero word. It means "no
    // root has been published", which is a different statement from a root
    // that happens to be all zeros — so compare the word, do not pattern it.
    const empty = root.toLowerCase() === ZERO_BYTES32;
    return { checked: true, root: empty ? null : root, configured: true };
  } catch {
    return { checked: false, root: null, configured: true };
  }
}

async function readAnchor(): Promise<BundleAnchor> {
  const base: BundleAnchor = {
    chain_id: CHAIN.id,
    chain_name: CHAIN.name,
    block_number: null,
    block_hash: null,
    block_timestamp: null,
    anchored: false,
  };
  try {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    if (block.hash && block.number !== null) {
      return {
        ...base,
        block_number: Number(block.number),
        block_hash: block.hash,
        block_timestamp: Number(block.timestamp),
        anchored: true,
      };
    }
  } catch {
    // Offline / RPC-less issuance still produces a verifiable bundle; the
    // anchor is an enhancement, not a requirement, for the default policy.
  }
  return base;
}

export async function issueCertification(
  input: IssueCertificationInput,
  deps: CertificationDeps = defaultDeps,
): Promise<CertificationBundle> {
  const org = input.org;
  const policy = getCertificationPolicy(input.policy ?? "default");
  const now = input.now ?? new Date();
  const validityDays = input.validity_days ?? policy.default_validity_days;
  if (!Number.isFinite(validityDays) || validityDays <= 0 || validityDays > policy.max_validity_days) {
    throw new CertificationPolicyError(
      `validity_days must be between 1 and ${policy.max_validity_days} for policy '${policy.id}'`,
    );
  }
  const evidenceLimit = Math.min(Math.max(input.evidence_limit ?? 200, 1), 500);

  const summary = await deps.summary(org);
  const [assetPage, migrationPage, attestationPage, audit] = await Promise.all([
    deps.assets(org, 0, evidenceLimit),
    deps.migrations(org, 0, evidenceLimit),
    deps.attestations(org, 0, evidenceLimit),
    // A registry read that throws must not skip the audit gate. Absent and
    // unreadable are the same statement to a policy: no audit is recorded.
    deps.audit(org).catch(
      (): LatestAuditInfo => ({
        org_address: org,
        exists: false,
        result: "None",
        result_code: 0,
        timestamp: 0,
      }),
    ),
  ]);
  const revocation = await deps.revocation(org);
  const anchor = await deps.anchor();

  // ------------------------------------------------------------------
  // Validity gate — refuse before signing anything unsupportable.
  // ------------------------------------------------------------------
  const refusals: string[] = [];
  const caveats: string[] = [];

  if (policy.require_asset_evidence && assetPage.total === 0) {
    refusals.push("no registered assets — nothing to certify");
  }

  if (!audit.exists) {
    if (policy.require_audit) refusals.push("policy requires an audit, but none has been recorded");
    else caveats.push("no audit recorded; this bundle asserts registry state only");
  } else {
    if (policy.reject_failed_audit && audit.result === "Failed") {
      refusals.push("latest audit failed — certification cannot be issued");
    }
    const auditedAt = auditTimestamp(audit);
    if (auditedAt === null) {
      // An audit that cannot be dated is no audit at all: it cannot satisfy a
      // policy that demands a current one, and it is not old enough to warn
      // about where the policy does not.
      if (policy.require_audit) refusals.push("latest audit has no usable timestamp");
    } else {
      const ageDays = (now.getTime() / 1000 - auditedAt) / 86_400;
      if (ageDays > policy.max_audit_age_days) {
        const reason = `latest audit is ${Math.floor(ageDays)} days old (policy allows ${policy.max_audit_age_days})`;
        if (policy.require_audit) refusals.push(reason);
        else caveats.push(reason);
      }
    }
  }

  const totalMigrations = summary.migration_counts.total;
  const verified = summary.migration_counts.verified;
  // The floor is applied as a product, not a quotient. Nothing to migrate would
  // otherwise be 0/0 = NaN, and NaN fails every comparison including this one,
  // so a ratio would need a special case for the empty set; the product form
  // makes the empty set pass on its own. Division stays inside the refusal,
  // where the message prints it and a non-zero denominator is guaranteed.
  if (verified < totalMigrations * policy.min_verified_migration_ratio) {
    refusals.push(
      `verified migration ratio ${((verified / totalMigrations) * 100).toFixed(1)}% is below the policy floor of ${(
        policy.min_verified_migration_ratio * 100
      ).toFixed(0)}%`,
    );
  }
  if (totalMigrations > verified) {
    caveats.push(`${totalMigrations - verified} migration(s) are recorded but unverified`);
  }

  if (policy.require_revocation_root && !revocation.root) {
    refusals.push("policy requires a published revocation root, but none is available");
  } else if (!revocation.root) {
    caveats.push("no revocation root published — revocation status is asserted, not proven");
  }

  if (!anchor.anchored) {
    caveats.push("chain anchor unavailable at issuance — bundle proves registry snapshot only");
  }

  if (refusals.length > 0) {
    throw new CertificationRefusedError(
      "Certification refused: evidence does not satisfy the selected policy",
      refusals,
      policy,
    );
  }

  // ------------------------------------------------------------------
  // Evidence commitment
  // ------------------------------------------------------------------
  const leaves: EvidenceLeaf[] = [];
  const addLeaf = (kind: EvidenceKind, id: string, record: Record<string, unknown>) => {
    leaves.push({ kind, id, digest: sha256Hex(canonicalJson(record)), record });
  };

  for (const asset of assetPage.items) {
    addLeaf("asset", asset.asset_id, { ...asset });
  }
  for (const migration of migrationPage.items) {
    addLeaf("migration", migration.migration_id, { ...migration });
  }
  for (const attestation of attestationPage.items) {
    addLeaf("attestation", attestation.attestation_id, { ...attestation });
  }
  if (audit.exists) {
    addLeaf("audit", `audit:${org.toLowerCase()}`, {
      org: org.toLowerCase(),
      result: audit.result,
      result_code: audit.result_code,
      timestamp: audit.timestamp,
    });
  }

  const root = merkleRoot(leaves.map(evidenceLeafHash));

  const claims: BundleClaims = {
    asset_count: summary.asset_count,
    migration_counts: { ...summary.migration_counts },
    latest_audit: audit.exists
      ? {
          exists: true,
          result: audit.result,
          result_code: audit.result_code,
          timestamp: audit.timestamp,
        }
      : null,
    attestation_count: attestationPage.total,
    revocation,
  };

  const issuedAt = now.toISOString();
  const validUntil = new Date(now.getTime() + validityDays * 86_400_000).toISOString();

  const { privateKey, did } = issuerKeyPair();
  const asserted: Omit<CertificationBundle, "digest" | "proof" | "bundle_id"> = {
    schema: BUNDLE_SCHEMA,
    issued_at: issuedAt,
    valid_from: issuedAt,
    valid_until: validUntil,
    issuer: did,
    subject: { org: org.toLowerCase(), chain_id: CHAIN.id },
    verdict: caveats.length > 0 ? "CONDITIONAL" : "CERTIFIED",
    policy,
    claims,
    evidence: {
      hash_algorithm: "sha256",
      leaf_count: leaves.length,
      merkle_root: root,
      leaves,
    },
    anchor,
    caveats,
  };

  const unsigned: Omit<CertificationBundle, "digest" | "proof"> = {
    // The id is derived from every field except itself, so it names the
    // assertion rather than the moment it was written. Canonical JSON sorts
    // keys before hashing, so where `bundle_id` sits in this literal cannot
    // change the id, the digest, or what a verifier recomputes.
    ...asserted,
    bundle_id: bundleId(asserted as unknown as Record<string, unknown>),
  };

  const digest = bundleDigest(unsigned as unknown as Record<string, unknown>);
  const withDigest = { ...unsigned, digest };
  const signature = ed25519.sign(Buffer.from(canonicalJson(withDigest), "utf8"), privateKey);
  const proof: BundleProof = {
    type: "Ed25519Signature2020",
    created: issuedAt,
    verificationMethod: `${did}#key-1`,
    proofPurpose: "assertionMethod",
    proofValue: Buffer.from(signature).toString("hex"),
  };

  return { ...withDigest, proof };
}

// ------------------------------------------------------------------
// Verification (offline by default)
// ------------------------------------------------------------------
export interface VerificationChecklist {
  structure: boolean;
  digest: boolean;
  merkle: boolean;
  signature: boolean;
  validity: boolean;
}

export interface VerifyBundleOptions {
  /** Evaluate validity at this instant (defaults to now). */
  now?: Date;
  /** Re-fetch the anchored block and compare its hash. Requires RPC. */
  check_chain?: boolean;
  /**
   * Pin the expected issuer DID. Without a pin, a bundle signed by any
   * self-consistent Ed25519 key verifies — the signature proves key possession,
   * not that the key belongs to the party the caller intended to trust.
   */
  trust_anchor_did?: string;
}

export interface BundleVerification {
  valid: boolean;
  bundle_id: string | null;
  issuer: string | null;
  subject: string | null;
  verdict: string | null;
  reasons: string[];
  caveats: string[];
  valid_until: string | null;
  expired: boolean;
  checked: VerificationChecklist;
  chain_anchor: "verified" | "mismatch" | "unavailable" | "skipped";
  timestamp: string;
}

const HEX64 = /^0x[0-9a-f]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Verify a certification bundle. Fail-closed: every check must pass.
 * Works with zero network access unless `check_chain` is requested.
 */
export async function verifyCertificationBundle(
  raw: unknown,
  options: VerifyBundleOptions = {},
): Promise<BundleVerification> {
  const now = options.now ?? new Date();
  const result: BundleVerification = {
    valid: false,
    bundle_id: null,
    issuer: null,
    subject: null,
    verdict: null,
    reasons: [],
    caveats: [],
    valid_until: null,
    expired: false,
    checked: { structure: false, digest: false, merkle: false, signature: false, validity: false },
    chain_anchor: "skipped",
    timestamp: now.toISOString(),
  };

  // 1. Structure
  if (!isRecord(raw) || raw.schema !== BUNDLE_SCHEMA) {
    result.reasons.push(`not a ${BUNDLE_SCHEMA} bundle`);
    return result;
  }
  const bundle = raw as unknown as CertificationBundle;
  const structureOk =
    typeof bundle.bundle_id === "string" &&
    typeof bundle.issuer === "string" &&
    isRecord(bundle.subject) &&
    typeof bundle.subject.org === "string" &&
    typeof bundle.issued_at === "string" &&
    typeof bundle.valid_from === "string" &&
    typeof bundle.valid_until === "string" &&
    isRecord(bundle.claims) &&
    isRecord(bundle.evidence) &&
    Array.isArray(bundle.evidence.leaves) &&
    isRecord(bundle.proof) &&
    typeof bundle.proof.proofValue === "string";
  if (!structureOk) {
    result.reasons.push("bundle is missing required fields");
    return result;
  }
  result.checked.structure = true;
  result.bundle_id = bundle.bundle_id;
  result.issuer = bundle.issuer;
  result.subject = bundle.subject.org;
  result.verdict = typeof bundle.verdict === "string" ? bundle.verdict : null;
  result.valid_until = bundle.valid_until;
  result.caveats = Array.isArray(bundle.caveats) ? bundle.caveats.filter((c) => typeof c === "string") : [];

  // 2. Digest
  const computedDigest = bundleDigest(bundle as unknown as Record<string, unknown>);
  // A `digest` that is not a string cannot equal the computed one, so a single
  // strict comparison covers both the missing field and the modified content.
  if (bundle.digest !== computedDigest) {
    result.reasons.push("digest mismatch — bundle contents were modified");
  } else {
    result.checked.digest = true;
  }

  // 3. Merkle commitment over the embedded evidence records
  let merkleOk = false;
  if (bundle.evidence.hash_algorithm === "sha256" && Array.isArray(bundle.evidence.leaves)) {
    merkleOk = true;
    const hashes: string[] = [];
    for (const leaf of bundle.evidence.leaves) {
      if (
        !isRecord(leaf) ||
        (leaf.kind !== "asset" && leaf.kind !== "migration" && leaf.kind !== "attestation" && leaf.kind !== "audit") ||
        typeof leaf.id !== "string" ||
        typeof leaf.digest !== "string" ||
        !isRecord(leaf.record)
      ) {
        merkleOk = false;
        result.reasons.push("malformed evidence leaf");
        break;
      }
      if (sha256Hex(canonicalJson(leaf.record)) !== leaf.digest) {
        merkleOk = false;
        result.reasons.push(`evidence record tampered: ${leaf.kind}:${leaf.id}`);
        break;
      }
      hashes.push(evidenceLeafHash(leaf));
    }
    if (merkleOk) {
      if (hashes.length !== bundle.evidence.leaf_count) {
        merkleOk = false;
        result.reasons.push("evidence leaf count does not match the committed count");
      } else if (merkleRoot(hashes) !== bundle.evidence.merkle_root) {
        merkleOk = false;
        result.reasons.push("Merkle root mismatch — evidence set was altered");
      }
    }
  } else {
    result.reasons.push("evidence block is not a sha256 Merkle commitment");
  }
  result.checked.merkle = merkleOk;

  // 4. Signature over the canonical bundle without `proof`
  let signatureOk = false;
  if (bundle.proof.type !== "Ed25519Signature2020") {
    result.reasons.push(`unsupported proof type: ${String(bundle.proof.type)}`);
  } else if (typeof bundle.proof.verificationMethod !== "string") {
    result.reasons.push("proof has no verificationMethod");
  } else if (options.trust_anchor_did && bundle.issuer !== options.trust_anchor_did) {
    // Deliberately keeps signature false: a substituted-but-valid key must not
    // pass an admission decision that named the issuer it expected.
    result.reasons.push("issuer does not match the pinned trust anchor");
  } else {
    try {
      const publicKey = await resolveIssuerKey(bundle.issuer, bundle.proof.verificationMethod);
      if (!publicKey || publicKey.length !== 32) {
        result.reasons.push("issuer DID resolved to no usable Ed25519 key");
      } else {
        const signature = Buffer.from(bundle.proof.proofValue, "hex");
        if (signature.length !== 64) {
          result.reasons.push("invalid Ed25519 signature length");
        } else {
          const payload: Record<string, unknown> = { ...(bundle as unknown as Record<string, unknown>) };
          delete payload.proof;
          signatureOk = ed25519.verify(signature, Buffer.from(canonicalJson(payload), "utf8"), publicKey);
          if (!signatureOk) result.reasons.push("Ed25519 signature does not verify against the issuer key");
        }
      }
    } catch (err) {
      result.reasons.push(
        `signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  result.checked.signature = signatureOk;

  // 5. Validity window
  const from = Date.parse(bundle.valid_from);
  const until = Date.parse(bundle.valid_until);
  if (Number.isNaN(from) || Number.isNaN(until)) {
    result.reasons.push("validity window is not a pair of ISO timestamps");
  } else if (now.getTime() < from) {
    result.reasons.push("bundle is not valid yet");
    result.checked.validity = false;
  } else if (now.getTime() > until) {
    result.expired = true;
    result.reasons.push(`bundle expired at ${bundle.valid_until}`);
  } else {
    result.checked.validity = true;
  }

  // 6. Optional chain re-anchoring (never required for offline verification)
  if (options.check_chain) {
    if (!bundle.anchor?.anchored || !bundle.anchor.block_hash) {
      result.chain_anchor = "unavailable";
      result.reasons.push("bundle carries no chain anchor");
    } else {
      try {
        const block = await publicClient.getBlock({ blockNumber: BigInt(bundle.anchor.block_number ?? 0) });
        if (block.hash?.toLowerCase() === bundle.anchor.block_hash.toLowerCase()) {
          result.chain_anchor = "verified";
        } else {
          result.chain_anchor = "mismatch";
          result.reasons.push("anchored block hash does not match the chain");
        }
      } catch {
        result.chain_anchor = "unavailable";
        result.reasons.push("could not fetch the anchored block");
      }
    }
  }

  result.valid =
    result.checked.structure &&
    result.checked.digest &&
    result.checked.merkle &&
    result.checked.signature &&
    result.checked.validity &&
    (result.chain_anchor === "skipped" || result.chain_anchor === "verified");
  return result;
}

/** Structural helper used by tests and the CLI to assert a root's shape. */
export function isBytes32Hex(value: string): boolean {
  return HEX64.test(value);
}

/** Minimal listing used by the API route. */
export function certificationPolicySummary(): Array<Pick<CertificationPolicy, "id" | "version" | "description" | "max_validity_days">> {
  return listCertificationPolicies().map(({ id, version, description, max_validity_days }) => ({
    id,
    version,
    description,
    max_validity_days,
  }));
}

/**
 * The identity the running process signs bundles with, as public material.
 *
 * Pinning a trust anchor requires the issuer DID *before* a bundle arrives, and
 * rotation means announcing a new one; both need a way to ask "which key signs
 * now?" without issuing a certificate to find out. Exposes public key +
 * fingerprint only.
 */
export interface CertificationIssuerIdentity {
  schema: string;
  issuer: string;
  verification_method: string;
  public_key_multibase: string;
  key_fingerprint: string;
}

export function certificationIssuerIdentity(): CertificationIssuerIdentity {
  const { publicKey, did } = issuerKeyPair();
  return {
    schema: BUNDLE_SCHEMA,
    issuer: did,
    verification_method: `${did}#key-1`,
    public_key_multibase: did.slice("did:key:".length),
    key_fingerprint: createHash("sha256").update(publicKey).digest("hex"),
  };
}

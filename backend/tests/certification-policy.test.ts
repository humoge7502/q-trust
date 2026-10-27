import { describe, it, expect, beforeEach } from "vitest";
import type { Address } from "viem";
import {
  CertificationPolicyError,
  CertificationRefusedError,
  certificationPolicySummary,
  getCertificationPolicy,
  issueCertification,
  listCertificationPolicies,
  type BundleAnchor,
  type CertificationDeps,
  type RevocationState,
} from "../src/services/certification.js";

/**
 * Policy gates.
 *
 * The certification service is a *claim* about evidence: each policy flag is a
 * promise to an auditor ("a regulated bundle always has a current audit"). A
 * flipped boolean here does not throw, does not corrupt a hash, and still
 * produces a perfectly verifiable bundle — it just certifies something that is
 * not true. So every flag is pinned twice: once as data, once as behaviour.
 */
const ORG = "0x1111111111111111111111111111111111111111" as Address;
const OTHER_ORG = "0x2222222222222222222222222222222222222222" as Address;
const NOW = new Date("2026-10-24T12:00:00.000Z");
const DAY = 86_400_000;

const ASSET = {
  asset_id: `0x${"a".repeat(64)}`,
  org_did: ORG,
  cbom_hash: `0x${"b".repeat(64)}`,
  metadata_uri: "ipfs://cbom-1",
  timestamp: 1_760_000_000,
  last_updated: 1_760_000_000,
  active: true,
};

type AuditRecord = {
  org_address: string;
  exists: boolean;
  result: string;
  result_code: number;
  timestamp: number;
};

function audit(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    org_address: ORG,
    exists: true,
    result: "Passed",
    result_code: 1,
    timestamp: Math.floor(NOW.getTime() / 1000) - DAY / 1000,
    ...overrides,
  };
}

const ANCHORED: BundleAnchor = {
  chain_id: 84532,
  chain_name: "Base Sepolia",
  block_number: 12_345_678,
  block_hash: `0x${"f".repeat(64)}`,
  block_timestamp: 1_760_001_000,
  anchored: true,
};

const WITH_ROOT: RevocationState = {
  checked: true,
  root: `0x${"9".repeat(64)}`,
  configured: true,
};

function makeDeps(
  overrides: Partial<CertificationDeps> = {},
  org: Address = ORG,
): CertificationDeps {
  return {
    summary: async () => ({
      org,
      asset_count: 1,
      migration_counts: { total: 1, verified: 1, unverified: 0 },
      latest_audit: audit({ org_address: org }),
      source: "indexer",
    }),
    assets: async () => ({ items: [{ ...ASSET, org_did: org }], total: 1, offset: 0, limit: 200 }),
    migrations: async () => ({ items: [], total: 1, offset: 0, limit: 200 }),
    attestations: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
    audit: async () => audit({ org_address: org }),
    revocation: async () => WITH_ROOT,
    anchor: async () => ANCHORED,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.QTRUST_VC_ISSUER_KEY = "11".repeat(32);
});

describe("policy registry", () => {
  const FLAGS = {
    default: {
      id: "qtrust.certification.default",
      version: "1.0.0",
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
      require_asset_evidence: true,
      require_audit: true,
      max_audit_age_days: 180,
      reject_failed_audit: true,
      min_verified_migration_ratio: 0.9,
      require_revocation_root: true,
      max_validity_days: 90,
      default_validity_days: 14,
    },
  } as const;

  for (const [name, expected] of Object.entries(FLAGS)) {
    it("pins every gate of the '${name}' policy", () => {
      const policy = getCertificationPolicy(name);
      for (const [key, value] of Object.entries(expected)) {
        expect(policy, `${name}.${key}`).toHaveProperty(key, value);
      }
    });
  }

  it("describes each policy so a refusal can be explained to a customer", () => {
    expect(getCertificationPolicy("default").description).toMatch(/Baseline assurance/);
    expect(getCertificationPolicy("regulated").description).toMatch(/current audit/);
    expect(getCertificationPolicy("strict").description).toMatch(/>=90% verified migrations/);
  });

  it("hands out copies, never the registry itself", () => {
    const policy = getCertificationPolicy("strict");
    policy.max_validity_days = 100_000;
    policy.require_audit = false;
    expect(getCertificationPolicy("strict").max_validity_days).toBe(90);
    expect(getCertificationPolicy("strict").require_audit).toBe(true);

    const listed = listCertificationPolicies();
    listed[0].require_revocation_root = true;
    expect(listCertificationPolicies()[0].require_revocation_root).toBe(false);
  });

  it("lists exactly the three policies for the catalogue endpoint", () => {
    const summary = certificationPolicySummary();
    expect(summary.map((p) => p.id)).toEqual([
      "qtrust.certification.default",
      "qtrust.certification.regulated",
      "qtrust.certification.strict",
    ]);
    // The catalogue deliberately hides the gates: it exposes only what a
    // caller needs to pick a policy.
    for (const entry of summary) {
      expect(Object.keys(entry).sort()).toEqual([
        "description",
        "id",
        "max_validity_days",
        "version",
      ]);
    }
    expect(summary.map((p) => p.max_validity_days)).toEqual([365, 180, 90]);
  });

  it("rejects an unknown policy and names the choices", () => {
    expect(() => getCertificationPolicy("nope")).toThrow(CertificationPolicyError);
    expect(() => getCertificationPolicy("nope")).toThrow(
      /Unknown certification policy 'nope'.*default, regulated, strict/,
    );
  });
});

describe("validity window limits", () => {
  const LIMITS: Array<[string, number]> = [
    ["default", 365],
    ["regulated", 180],
    ["strict", 90],
  ];

  it.each(LIMITS)("accepts 1 and the %s maximum", async (policy, max) => {
    for (const days of [1, max]) {
      const bundle = await issueCertification(
        { org: ORG, policy, validity_days: days, now: NOW },
        makeDeps(),
      );
      expect(new Date(bundle.valid_until).getTime() - new Date(bundle.valid_from).getTime()).toBe(
        days * DAY,
      );
    }
  });

  it.each(LIMITS)("refuses 0, negative, NaN, infinite and max+1 for %s", async (policy, max) => {
    for (const days of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, max + 1]) {
      // A string argument does substring matching — no dynamic RegExp
      // (Semgrep detect-non-literal-regexp; the message is asserted verbatim).
      await expect(
        issueCertification({ org: ORG, policy, validity_days: days, now: NOW }, makeDeps()),
      ).rejects.toThrow(`validity_days must be between 1 and ${max} for policy`);
    }
  });

  it("uses the policy default when the caller asks for none", async () => {
    for (const [policy, days] of [["default", 30], ["regulated", 30], ["strict", 14]] as const) {
      const bundle = await issueCertification({ org: ORG, policy, now: NOW }, makeDeps());
      expect(new Date(bundle.valid_until).getTime() - new Date(bundle.issued_at).getTime()).toBe(
        days * DAY,
      );
    }
  });
});

describe("evidence limits", () => {
  it("clamps the requested page size into [1, 500] for every reader", async () => {
    const seen: number[] = [];
    const record = (limit: number) => {
      seen.push(limit);
      return { items: [ASSET], total: 1, offset: 0, limit };
    };
    await issueCertification(
      { org: ORG, now: NOW },
      makeDeps({
        assets: async (_org, _offset, limit) => record(limit),
        migrations: async (_org, _offset, limit) => record(limit),
        attestations: async (_org, _offset, limit) => record(limit),
      }),
    );
    expect(seen).toEqual([200, 200, 200]);

    seen.length = 0;
    await issueCertification(
      { org: ORG, now: NOW, evidence_limit: 0 },
      makeDeps({
        assets: async (_org, _offset, limit) => record(limit),
        migrations: async (_org, _offset, limit) => record(limit),
        attestations: async (_org, _offset, limit) => record(limit),
      }),
    );
    expect(seen).toEqual([1, 1, 1]);

    seen.length = 0;
    await issueCertification(
      { org: ORG, now: NOW, evidence_limit: 100_000 },
      makeDeps({
        assets: async (_org, _offset, limit) => record(limit),
        migrations: async (_org, _offset, limit) => record(limit),
        attestations: async (_org, _offset, limit) => record(limit),
      }),
    );
    expect(seen).toEqual([500, 500, 500]);
  });
});

describe("refusals per gate", () => {
  async function refuse(
    policy: string,
    overrides: Partial<CertificationDeps>,
  ): Promise<string[]> {
    try {
      await issueCertification({ org: ORG, policy, now: NOW }, makeDeps(overrides));
    } catch (err) {
      if (err instanceof CertificationRefusedError) return err.reasons;
      throw err;
    }
    throw new Error(`expected ${policy} to refuse`);
  }

  it("requires registered assets under every policy", async () => {
    for (const policy of ["default", "regulated", "strict"]) {
      // Exact, not `toContain`: a refusal that names an extra gate the evidence
      // does not fail is a refusal an auditor cannot act on.
      expect(await refuse(policy, { assets: async () => ({ items: [], total: 0, offset: 0, limit: 200 }) })).toEqual([
        "no registered assets — nothing to certify",
      ]);
    }
  });

  it("requires a recorded audit only where the policy says so", async () => {
    const missing = { audit: async () => audit({ exists: false, result: "None", result_code: 0, timestamp: 0 }) };
    expect(await refuse("regulated", missing)).toEqual([
      "policy requires an audit, but none has been recorded",
    ]);
    expect(await refuse("strict", missing)).toEqual([
      "policy requires an audit, but none has been recorded",
    ]);
    // default has no audit requirement: it issues, with a caveat.
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps(missing));
    expect(bundle.caveats).toEqual(["no audit recorded; this bundle asserts registry state only"]);
    expect(bundle.claims.latest_audit).toBeNull();
    // …and no audit leaf, because there is no audit to embed.
    expect(bundle.evidence.leaves.filter((leaf) => leaf.kind === "audit")).toEqual([]);
  });

  it("refuses a failed audit under every policy", async () => {
    const failed = { audit: async () => audit({ result: "Failed", result_code: 2 }) };
    for (const policy of ["default", "regulated", "strict"]) {
      expect(await refuse(policy, failed)).toEqual([
        "latest audit failed — certification cannot be issued",
      ]);
    }
  });

  it("treats an audit older than the policy window as a refusal or a caveat", async () => {
    const old = (days: number) => ({
      audit: async () => audit({ timestamp: Math.floor(NOW.getTime() / 1000) - days * 86_400 }),
    });
    expect(await refuse("regulated", old(400))).toEqual([
      "latest audit is 400 days old (policy allows 365)",
    ]);
    expect(await refuse("strict", old(200))).toEqual([
      "latest audit is 200 days old (policy allows 180)",
    ]);
    // default: same age, caveat instead of refusal, and the bundle still issues.
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps(old(400)));
    expect(bundle.verdict).toBe("CONDITIONAL");
    expect(bundle.caveats).toEqual(["latest audit is 400 days old (policy allows 365)"]);
    // Inside the window: no caveat at all.
    const fresh = await issueCertification({ org: ORG, now: NOW }, makeDeps(old(1)));
    expect(fresh.caveats).toEqual([]);
  });

  it("keeps an audit that is exactly as old as the policy allows", async () => {
    // The window is `>` not `>=`: a bundle whose audit is precisely 365 days
    // old is still current, and one day later it is not. Off-by-one here
    // silently re-certifies stale evidence.
    const boundary: Array<[string, number]> = [
      ["default", 365],
      ["regulated", 365],
      ["strict", 180],
    ];
    const aged = (days: number) => ({
      audit: async () => audit({ timestamp: Math.floor(NOW.getTime() / 1000) - days * 86_400 }),
    });
    for (const [policy, max] of boundary) {
      const atLimit = await issueCertification({ org: ORG, policy, now: NOW }, makeDeps(aged(max)));
      expect(atLimit.verdict, policy).toBe("CERTIFIED");
      expect(atLimit.caveats, policy).toEqual([]);
      const oneDayMore = `latest audit is ${max + 1} days old (policy allows ${max})`;
      if (policy === "default") {
        // default warns instead of refusing.
        const stale = await issueCertification({ org: ORG, policy, now: NOW }, makeDeps(aged(max + 1)));
        expect(stale.verdict).toBe("CONDITIONAL");
        expect(stale.caveats).toEqual([oneDayMore]);
      } else {
        expect(await refuse(policy, aged(max + 1))).toEqual([oneDayMore]);
      }
    }
  });

  const UNDATEABLE: Array<[string, number]> = [
    ["zero", 0],
    ["negative", -86_400],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["negatively infinite", Number.NEGATIVE_INFINITY],
  ];

  it.each(UNDATEABLE)("refuses an audit whose timestamp is %s only when an audit is required", async (_label, timestamp) => {
    const broken = { audit: async () => audit({ timestamp }) };
    expect(await refuse("regulated", broken)).toEqual(["latest audit has no usable timestamp"]);
    expect(await refuse("strict", broken)).toEqual(["latest audit has no usable timestamp"]);
    // default: an undateable audit is not a claim about currency, so the bundle
    // issues with no caveat and a CERTIFIED verdict.
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps(broken));
    expect(bundle.verdict).toBe("CERTIFIED");
    expect(bundle.caveats).toEqual([]);
  });

  it("enforces the verified-migration floor of the strict policy", async () => {
    const counts = (total: number, verified: number) => ({
      summary: async () => ({
        org: ORG,
        asset_count: 1,
        migration_counts: { total, verified, unverified: total - verified },
        latest_audit: audit(),
        source: "indexer" as const,
      }),
    });
    expect(await refuse("strict", counts(10, 8))).toContain(
      "verified migration ratio 80.0% is below the policy floor of 90%",
    );
    // Exactly at the floor it passes; no migrations is not a failure.
    expect(await issueCertification(
      { org: ORG, policy: "strict", now: NOW },
      makeDeps(counts(10, 9)),
    )).toBeTruthy();
    expect(await issueCertification(
      { org: ORG, policy: "strict", now: NOW },
      makeDeps(counts(0, 0)),
    )).toBeTruthy();
  });

  it("caveats unverified migrations without refusing under default", async () => {
    const bundle = await issueCertification(
      { org: ORG, now: NOW },
      makeDeps({
        summary: async () => ({
          org: ORG,
          asset_count: 1,
          migration_counts: { total: 10, verified: 3, unverified: 7 },
          latest_audit: audit(),
          source: "indexer",
        }),
      }),
    );
    expect(bundle.caveats).toContain("7 migration(s) are recorded but unverified");
    expect(bundle.verdict).toBe("CONDITIONAL");
  });

  it("requires a published revocation root only for regulated and strict", async () => {
    const none = { revocation: async () => ({ checked: true, root: null, configured: true }) };
    expect(await refuse("regulated", none)).toContain(
      "policy requires a published revocation root, but none is available",
    );
    expect(await refuse("strict", none)).toContain(
      "policy requires a published revocation root, but none is available",
    );
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps(none));
    expect(bundle.caveats).toContain(
      "no revocation root published — revocation status is asserted, not proven",
    );
  });

  it("caveats an unavailable chain anchor rather than refusing", async () => {
    const bundle = await issueCertification(
      { org: ORG, now: NOW },
      makeDeps({
        anchor: async () => ({ ...ANCHORED, anchored: false, block_hash: null, block_number: null }),
      }),
    );
    expect(bundle.anchor.anchored).toBe(false);
    expect(bundle.caveats).toContain(
      "chain anchor unavailable at issuance — bundle proves registry snapshot only",
    );
    expect(bundle.verdict).toBe("CONDITIONAL");
  });

  it("refuses with the policy attached and never signs a refusal", async () => {
    const failed = { audit: async () => audit({ result: "Failed", result_code: 2 }) };
    try {
      await issueCertification({ org: ORG, policy: "regulated", now: NOW }, makeDeps(failed));
      throw new Error("expected the regulated policy to refuse a failed audit");
    } catch (err) {
      expect(err).toBeInstanceOf(CertificationRefusedError);
      const refused = err as CertificationRefusedError;
      expect(refused.message).toBe(
        "Certification refused: evidence does not satisfy the selected policy",
      );
      expect(refused.policy.id).toBe("qtrust.certification.regulated");
      expect(JSON.stringify(refused)).not.toContain("proofValue");
    }
  });

  it("treats an unreadable audit record as no audit, not as a passed gate", async () => {
    // Fail-closed regression: the audit read used to resolve to `null` on a
    // throw, which skipped the whole gate — a regulated bundle could then be
    // signed with no audit check and no caveat.
    const unreadable = {
      audit: async () => {
        throw new Error("registry unreadable");
      },
    };
    expect(await refuse("regulated", unreadable)).toContain(
      "policy requires an audit, but none has been recorded",
    );
    expect(await refuse("strict", unreadable)).toContain(
      "policy requires an audit, but none has been recorded",
    );
    const bundle = await issueCertification(
      { org: ORG, now: NOW },
      makeDeps(unreadable),
    );
    expect(bundle.caveats).toContain("no audit recorded; this bundle asserts registry state only");
    expect(bundle.claims.latest_audit).toBeNull();
    expect(bundle.verdict).toBe("CONDITIONAL");
  });
});

describe("evidence snapshot", () => {
  it("lowercases the subject and every audit leaf id", async () => {
    const mixed = `0x${"AbCdEf1234".repeat(4)}` as Address;
    const lower = mixed.toLowerCase();
    const bundle = await issueCertification(
      { org: mixed, now: NOW },
      makeDeps({
        audit: async () => audit({ org_address: mixed }),
        assets: async () => ({ items: [{ ...ASSET, org_did: mixed }], total: 1, offset: 0, limit: 200 }),
      }),
    );
    expect(bundle.subject.org).toBe(lower);
    const auditLeaf = bundle.evidence.leaves.find((leaf) => leaf.kind === "audit");
    expect(auditLeaf?.id).toBe(`audit:${lower}`);
    // The record inside the leaf is normalised too: a mixed-case org in the
    // embedded evidence would not match what the registry itself stores.
    expect(auditLeaf?.record).toEqual({
      org: lower,
      result: "Passed",
      result_code: 1,
      timestamp: Math.floor(NOW.getTime() / 1000) - DAY / 1000,
    });
    expect(bundle.evidence.leaves.filter((leaf) => leaf.kind === "asset")).toHaveLength(1);
  });

  it("reports a missing audit as null and a present one in full", async () => {
    const present = await issueCertification({ org: ORG, now: NOW }, makeDeps());
    expect(present.claims.latest_audit).toEqual({
      exists: true,
      result: "Passed",
      result_code: 1,
      timestamp: Math.floor(NOW.getTime() / 1000) - DAY / 1000,
    });
  });

  it("counts assets, migrations and attestations from the readers", async () => {
    const bundle = await issueCertification(
      { org: ORG, now: NOW },
      makeDeps({
        attestations: async () => ({ items: [], total: 3, offset: 0, limit: 200 }),
      }),
    );
    expect(bundle.claims.attestation_count).toBe(3);
    expect(bundle.claims.asset_count).toBe(1);
    expect(bundle.claims.migration_counts).toEqual({ total: 1, verified: 1, unverified: 0 });
    // The summary object is copied, not aliased to the reader's result.
    expect(bundle.claims.migration_counts).not.toBe(
      (await makeDeps().summary(ORG)).migration_counts,
    );
  });

  it("carries the revocation state through to the claims", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps());
    expect(bundle.claims.revocation).toEqual(WITH_ROOT);
    expect(bundle.anchor).toEqual(ANCHORED);
  });

  it("stamps the bundle with a uuid urn and the schema", async () => {
    const bundle = await issueCertification({ org: ORG, now: NOW }, makeDeps());
    expect(bundle.bundle_id).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(bundle.schema).toBe("qtrust.certification.v1");
    expect(bundle.issued_at).toBe(NOW.toISOString());
    expect(bundle.valid_from).toBe(NOW.toISOString());
    expect(bundle.policy.id).toBe("qtrust.certification.default");
  });

  it("names the bundle after what it asserts, not after the roll of a die", async () => {
    const ids = await Promise.all(
      Array.from({ length: 3 }, () =>
        issueCertification({ org: ORG, now: NOW }, makeDeps()).then((b) => b.bundle_id),
      ),
    );
    expect(new Set(ids).size).toBe(1);

    const again = await issueCertification({ org: ORG, now: NOW }, makeDeps());
    const replay = await issueCertification({ org: ORG, now: NOW }, makeDeps());
    expect(JSON.stringify(replay)).toBe(JSON.stringify(again));

    // …and any change to what is being claimed produces a different name.
    const later = await issueCertification(
      { org: ORG, now: new Date(NOW.getTime() + 60_000) },
      makeDeps(),
    );
    expect(later.bundle_id).not.toBe(again.bundle_id);

    const otherOrg = await issueCertification(
      { org: OTHER_ORG, now: NOW },
      makeDeps({}, OTHER_ORG),
    );
    expect(otherOrg.subject.org).toBe(OTHER_ORG.toLowerCase());
    expect(otherOrg.bundle_id).not.toBe(again.bundle_id);

    const differentEvidence = await issueCertification(
      { org: ORG, now: NOW },
      makeDeps({
        assets: async () => ({
          items: [{ ...ASSET, metadata_uri: "ipfs://cbom-2" }],
          total: 1,
          offset: 0,
          limit: 200,
        }),
      }),
    );
    expect(differentEvidence.bundle_id).not.toBe(again.bundle_id);
  });
});

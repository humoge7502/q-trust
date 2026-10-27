#!/usr/bin/env tsx
/**
 * Regenerate the cross-language certification fixture consumed by
 * sdk/tests/test_bundle.py. Deterministic in every input (fixed key, fixed
 * clock, fixed records) so the fixture is reproducible and the Python test
 * proves byte-compatible canonicalisation between TypeScript and Python.
 *
 * `bundle_id` is derived from the bundle's content rather than random, which is
 * what makes the claim above true: CI regenerates this file and byte-compares
 * it against the committed copy (see .github/workflows/ci.yml). A random id
 * there would make the cross-language contract untestable.
 *
 *   npm run certify:fixture
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";
import { issueCertification } from "../src/services/certification.js";

process.env.QTRUST_VC_ISSUER_KEY = "11".repeat(32);

const ORG = "0x1111111111111111111111111111111111111111" as Address;
const now = new Date("2026-10-24T12:00:00.000Z");
const auditedAt = Math.floor(now.getTime() / 1000) - 86_400;

const bundle = await issueCertification({ org: ORG, policy: "default", now }, {
  summary: async () => ({
    org: ORG,
    asset_count: 2,
    migration_counts: { total: 1, verified: 1, unverified: 0 },
    latest_audit: {
      org_address: ORG,
      exists: true,
      result: "Passed",
      result_code: 1,
      timestamp: auditedAt,
    },
    source: "indexer",
  }),
  assets: async () => ({
    items: [
      {
        asset_id: "0x" + "a".repeat(64),
        org_did: ORG,
        cbom_hash: "0x" + "b".repeat(64),
        metadata_uri: "ipfs://cbom-1",
        timestamp: 1_760_000_000,
        last_updated: 1_760_000_000,
        active: true,
      },
      {
        asset_id: "0x" + "1".repeat(64),
        org_did: ORG,
        cbom_hash: "0x" + "2".repeat(64),
        metadata_uri: "ipfs://cbom-2",
        timestamp: 1_760_000_100,
        last_updated: 1_760_000_100,
        active: true,
      },
    ],
    total: 2,
    offset: 0,
    limit: 200,
  }),
  migrations: async () => ({
    items: [{
      migration_id: "0x" + "c".repeat(64),
      asset_id: "0x" + "a".repeat(64),
      org_did: ORG,
      from_algorithm: "RSA-2048",
      to_algorithm: "ML-KEM-768",
      evidence_hash: "0x" + "d".repeat(64),
      evidence_uri: "ipfs://evidence-1",
      timestamp: 1_760_000_500,
      verified: true,
    }],
    total: 1,
    offset: 0,
    limit: 200,
  }),
  attestations: async () => ({
    items: [{
      attestation_id: "0x" + "e".repeat(64),
      vendor_did: "0x2222222222222222222222222222222222222222",
      product_id: "load-balancer",
      version: "4.2.0",
      algorithm: "ML-KEM-768",
      supported: true,
      evidence_uri: "ipfs://vendor-evidence",
      timestamp: 1_760_000_900,
      revoked: false,
    }],
    total: 1,
    offset: 0,
    limit: 200,
  }),
  audit: async () => ({
    org_address: ORG,
    exists: true,
    result: "Passed",
    result_code: 1,
    timestamp: auditedAt,
  }),
  revocation: async () => ({ checked: true, root: "0x" + "9".repeat(64), configured: true }),
  anchor: async () => ({
    chain_id: 84532,
    chain_name: "Base Sepolia",
    block_number: 12_345_678,
    block_hash: "0x" + "f".repeat(64),
    block_timestamp: 1_760_001_000,
    anchored: true,
  }),
});

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../sdk/tests/fixtures/certification_bundle.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n", "utf8");
console.log(`wrote ${out}`);

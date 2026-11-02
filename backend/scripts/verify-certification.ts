#!/usr/bin/env tsx
/**
 * Offline certification-bundle verifier.
 *
 *   npm run certify:verify -- path/to/bundle.json
 *   npm run certify:verify -- path/to/bundle.json --chain   # also re-anchor
 *
 * Exits 0 when the bundle is valid, 1 otherwise. No network access is needed
 * unless --chain is passed. The same bundle can be verified with
 * `python -m qtrust.bundle <file>`; both implementations share canonical JSON.
 */
import { readFileSync } from "node:fs";
import { verifyCertificationBundle } from "../src/services/certification.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const checkChain = args.includes("--chain");

if (!file) {
  console.error("usage: npm run certify:verify -- <bundle.json> [--chain]");
  process.exit(2);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`cannot read bundle: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const result = await verifyCertificationBundle(raw, { check_chain: checkChain });
console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);

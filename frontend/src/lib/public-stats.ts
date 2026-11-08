/**
 * Canonical public-facing stat constants.
 *
 * The landing page stated the same claims in two places (ProofSection and the
 * public stats band), each with its own literals — a same-claim duplication
 * that could drift apart on the next edit. These constants are the single
 * source of truth for every number the marketing layer prints in public.
 *
 * Honesty rule (DESIGN.md): never change a value here without a traceable
 * artifact (contract count from the deployed registries, test totals from the
 * suites, coverage from the scanner detector set).
 */

/** Registry contracts deployed for assets, vendors, migration, and audits. */
export const REGISTRY_CONTRACTS = 11;

/** Scanner coverage: source languages plus manifests, binaries, network, and config. */
export const SCANNER_COVERAGE = 12;

/** Tests and audits across contract, inspector, SDK, and backend suites. */
export const TESTS_AND_AUDITS = 364;

/** Verification requires no wallet or platform account. */
export const VERIFICATION_MODE = "Open";

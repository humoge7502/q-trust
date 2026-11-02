#!/usr/bin/env tsx
/**
 * Print the certification/credential issuer identity for the configured seed.
 *
 *   npm run certify:issuer
 *   QTRUST_VC_ISSUER_KEY=<new 32-byte hex seed> npm run certify:issuer
 *
 * Used by the rotation runbook to announce the DID and key fingerprint a new
 * seed will produce *before* it is deployed. Public material only: the seed is
 * read from the environment and never printed.
 */
import { certificationIssuerIdentity } from "../src/services/certification.js";

console.log(JSON.stringify(certificationIssuerIdentity(), null, 2));

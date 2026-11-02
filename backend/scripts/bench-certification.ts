#!/usr/bin/env tsx
/**
 * Offline certification-verification throughput benchmark.
 *
 * Verifies the committed TS->Python fixture repeatedly (Ed25519 via did:key, no
 * network) and reports p50/p95 latency plus ops/sec. The point is not to chase a
 * number but to make the "offline verification is cheap enough for CI and edge
 * verifiers" claim measurable on the host that ships it.
 *
 *   npm run certify:bench            # 2,000 iterations
 *   CERTIFY_BENCH_N=10000 npm run certify:bench
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyCertificationBundle } from "../src/services/certification.js";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../sdk/tests/fixtures/certification_bundle.json", import.meta.url)),
    "utf8",
  ),
) as Record<string, unknown>;

const iterations = Number(process.env.CERTIFY_BENCH_N ?? 2_000);
const now = new Date("2026-10-24T13:00:00.000Z");

for (let i = 0; i < 50; i++) {
  const warm = await verifyCertificationBundle(fixture, { now });
  if (!warm.valid) throw new Error(`fixture failed warm-up: ${warm.reasons.join("; ")}`);
}

const samples: number[] = [];
for (let i = 0; i < iterations; i++) {
  const start = process.hrtime.bigint();
  const result = await verifyCertificationBundle(fixture, { now });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  if (!result.valid) throw new Error(`fixture failed at iteration ${i}: ${result.reasons.join("; ")}`);
  samples.push(elapsedMs);
}

samples.sort((a, b) => a - b);
const percentile = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

console.log(JSON.stringify({
  iterations,
  leaves: (fixture.evidence as { leaves: unknown[] }).leaves.length,
  p50_ms: Number(percentile(0.5).toFixed(4)),
  p95_ms: Number(percentile(0.95).toFixed(4)),
  mean_ms: Number(mean.toFixed(4)),
  ops_per_sec: Math.round(1000 / mean),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
}, null, 2));

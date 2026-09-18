/**
 * Contract tests binding the UI to the proxy authorization policy.
 *
 * The defect these lock down: the shipped UI called privileged endpoints
 * (`/v1/scan/full`, `/v1/plans`, `/v1/gpu/*`, `/v1/relay/attestation`, …) that
 * the same-origin proxy denied by default, so those controls returned 403 in
 * every deployment using the proxy — while the component tests stubbed `fetch`
 * and never noticed. The proxy tests asserted the denial; the UI tests asserted
 * the call. Nothing compared the two lists.
 *
 * This file compares them: it reads the UI source, extracts every `/v1/...`
 * endpoint literal, and fails if the policy module does not classify it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROUTE_POLICY,
  classifyEndpoint,
  endpointRequiresOperatorKey,
  isValidOperatorKeyShape,
  matchRouteRule,
  MAX_OPERATOR_KEY_LENGTH,
} from "@/lib/api-route-policy";

const SRC_ROOT = join(process.cwd(), "src");

/** Directories whose entire content is UI that talks to the backend. */
const SCAN_ROOTS = ["app", "components", "hooks", "lib"].map((d) => join(SRC_ROOT, d));

/**
 * Files that legitimately contain endpoint literals but are not UI call sites:
 * the policy table itself, the proxy that enforces it, and generated code.
 */
function isExcluded(file: string): boolean {
  const rel = relative(SRC_ROOT, file);
  if (rel.includes(`${sep}__tests__${sep}`)) return true;
  if (/\.(test|spec)\.tsx?$/.test(rel)) return true;
  if (rel === join("lib", "api-route-policy.ts")) return true;
  if (rel.startsWith(join("app", "api"))) return true;
  if (rel.startsWith(join("lib", "generated"))) return true;
  return false;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !isExcluded(full)) out.push(full);
  }
  return out;
}

/**
 * Extract `/v1/...` literals from string and template literals. Template
 * expressions are truncated at `${`, which is safe here because the policy
 * matches by segment prefix (`/v1/gpu/quantum/estimate/${bits}` -> matches the
 * `/v1/gpu/` operator rule).
 */
function endpointsIn(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(/["'`](\/v1\/[^"'`\s]*)["'`]/g)) {
    const literal = match[1].split("${")[0];
    if (literal.length > "/v1/".length) found.push(literal);
  }
  return found;
}

describe("API route policy", () => {
  it("classifies every endpoint literal referenced by the UI", () => {
    const unclassified: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of sourceFiles(root)) {
        for (const endpoint of endpointsIn(file)) {
          if (matchRouteRule(endpoint) === null) {
            unclassified.push(`${relative(SRC_ROOT, file)} -> ${endpoint}`);
          }
        }
      }
    }
    expect(
      unclassified,
      "The UI calls endpoints the proxy policy does not classify. Add a rule to " +
        "ROUTE_POLICY (lib/api-route-policy.ts) and, if privileged, wire operator " +
        "access into the calling component.",
    ).toEqual([]);
  });

  it("covers /health and rejects paths that are not part of the API surface", () => {
    expect(matchRouteRule("/health")).not.toBeNull();
    expect(matchRouteRule("/internal/debug")).toBeNull();
    expect(matchRouteRule("/")).toBeNull();
  });

  it("longest prefix wins so parameterised public reads stay reachable", () => {
    // Broader operator rules must not shadow the narrower public reads.
    expect(classifyEndpoint("/v1/relay/nonce/did:web:example", "GET")).toBe("public-read");
    expect(classifyEndpoint("/v1/relay/cbom-nonce/did:web:example", "GET")).toBe("public-read");
    // R1: GET /v1/plans/:did was retired — the planner is stateless, so the
    // proxy intentionally exposes nothing there (default-deny 403).
    expect(classifyEndpoint("/v1/plans/did:web:example", "GET")).toBeNull();
    // ...while the operator surface behind them still requires a key.
    expect(classifyEndpoint("/v1/relay/attestation", "POST")).toBe("operator");
    expect(classifyEndpoint("/v1/plans", "POST")).toBe("operator");
  });

  it("does not grant access on a shared string prefix", () => {
    expect(matchRouteRule("/v1/stats-private")).toBeNull();
    expect(classifyEndpoint("/v1/assets-private", "GET")).toBeNull();
  });

  it("enforces method restrictions", () => {
    expect(classifyEndpoint("/v1/stats", "POST")).toBeNull();
    expect(classifyEndpoint("/v1/assets/asset-1", "DELETE")).toBeNull();
    expect(classifyEndpoint("/v1/assets/asset-1", "GET")).toBe("public-read");
  });

  it("classifies the privileged surface exactly as the UI expects", () => {
    const operatorEndpoints: Array<[string, string]> = [
      ["/v1/scan/full", "POST"],
      ["/v1/scan/source", "POST"],
      ["/v1/scan/manifests", "POST"],
      ["/v1/roadmap/generate", "POST"],
      ["/v1/evidence/create", "POST"],
      ["/v1/plans", "POST"],
      ["/v1/gpu/side-channel/analyze", "POST"],
      ["/v1/gpu/rl/plan", "POST"],
      ["/v1/gpu/anomaly/score", "POST"],
      ["/v1/gpu/quantum/estimate/2048", "GET"],
      ["/v1/relay/attestation", "POST"],
      ["/v1/webhooks/subscribe", "POST"],
    ];
    for (const [path, method] of operatorEndpoints) {
      expect(endpointRequiresOperatorKey(path, method), `${method} ${path}`).toBe(true);
    }

    // Stateless compute stays open to anonymous browsers.
    for (const [path, method] of [
      ["/v1/risk/score", "POST"],
      ["/v1/compliance/evaluate", "POST"],
      ["/v1/evidence/verify", "POST"],
    ] as Array<[string, string]>) {
      expect(endpointRequiresOperatorKey(path, method), `${method} ${path}`).toBe(false);
      expect(classifyEndpoint(path, method)).toBe("public-compute");
    }
  });

  it("has no duplicate or shadowing rules", () => {
    const seen = new Set<string>();
    for (const rule of ROUTE_POLICY) {
      const identity = `${rule.prefix}|${[...rule.methods].sort().join(",")}`;
      expect(seen.has(identity), `duplicate rule ${identity}`).toBe(false);
      seen.add(identity);
      expect(rule.methods.size, `rule ${rule.prefix} has no methods`).toBeGreaterThan(0);
    }
  });

  it("validates operator key shape", () => {
    expect(isValidOperatorKeyShape("abc123")).toBe(true);
    expect(isValidOperatorKeyShape("")).toBe(false);
    expect(isValidOperatorKeyShape("k".repeat(MAX_OPERATOR_KEY_LENGTH + 1))).toBe(false);
    expect(isValidOperatorKeyShape("bad\nkey")).toBe(false);
    expect(isValidOperatorKeyShape("bad\u0000key")).toBe(false);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

vi.mock("../src/services/certification.js", () => {
  class CertificationPolicyError extends Error {}
  class CertificationRefusedError extends Error {
    constructor(message: string, public reasons: string[], public policy: unknown) {
      super(message);
    }
  }
  return {
    CertificationPolicyError,
    CertificationRefusedError,
    issueCertification: vi.fn(),
    verifyCertificationBundle: vi.fn(),
    certificationPolicySummary: vi.fn(() => [
      { id: "qtrust.certification.default", version: "1.0.0", description: "baseline", max_validity_days: 365 },
    ]),
    certificationIssuerIdentity: vi.fn(() => ({
      schema: "qtrust.certification.v1",
      issuer: "did:key:z6MkExample",
      verification_method: "did:key:z6MkExample#key-1",
      public_key_multibase: "z6MkExample",
      key_fingerprint: "ab".repeat(32),
    })),
  };
});

import { registerCertifyRoutes } from "../src/routes/certify.js";
import {
  CertificationPolicyError,
  CertificationRefusedError,
  certificationIssuerIdentity,
  issueCertification,
  verifyCertificationBundle,
} from "../src/services/certification.js";

const ORG = "0x1111111111111111111111111111111111111111";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerCertifyRoutes(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.mocked(issueCertification).mockReset();
  vi.mocked(verifyCertificationBundle).mockReset();
});

describe("POST /v1/certify", () => {
  it("returns the issued bundle", async () => {
    const bundle = { schema: "qtrust.certification.v1", verdict: "CERTIFIED" };
    vi.mocked(issueCertification).mockResolvedValue(bundle as never);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/certify",
      payload: { org: ORG, policy: "default", validity_days: 14 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ verdict: "CERTIFIED" });
    expect(issueCertification).toHaveBeenCalledWith(
      expect.objectContaining({ org: ORG, policy: "default", validity_days: 14 }),
    );
  });

  it("rejects a missing or malformed org", async () => {
    const app = await buildApp();
    const missing = await app.inject({ method: "POST", url: "/v1/certify", payload: {} });
    const bad = await app.inject({ method: "POST", url: "/v1/certify", payload: { org: "0xnope" } });
    const nonInteger = await app.inject({
      method: "POST",
      url: "/v1/certify",
      payload: { org: ORG, validity_days: 1.5 },
    });
    await app.close();

    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe("invalid_org");
    expect(bad.statusCode).toBe(400);
    expect(nonInteger.statusCode).toBe(400);
    expect(nonInteger.json().code).toBe("invalid_validity");
  });

  it("maps a refused issuance to 409 with the policy reasons", async () => {
    vi.mocked(issueCertification).mockRejectedValue(
      new CertificationRefusedError("refused", ["no registered assets"], { id: "p" }),
    );
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/certify", payload: { org: ORG } });
    await app.close();

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: "certification_refused",
      reasons: ["no registered assets"],
    });
  });

  it("maps an invalid policy to 400 and an evidence outage to 503", async () => {
    vi.mocked(issueCertification).mockRejectedValueOnce(new CertificationPolicyError("bad policy"));
    const app = await buildApp();
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/certify",
      payload: { org: ORG, policy: "nope" },
    });

    vi.mocked(issueCertification).mockRejectedValueOnce(new Error("RPC down"));
    const outage = await app.inject({ method: "POST", url: "/v1/certify", payload: { org: ORG } });
    await app.close();

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("invalid_policy");
    expect(outage.statusCode).toBe(503);
    expect(outage.json().code).toBe("evidence_unavailable");
  });
});

describe("POST /v1/certify/verify", () => {
  it("verifies offline by default and never allows silent chain checks", async () => {
    vi.mocked(verifyCertificationBundle).mockResolvedValue({ valid: true } as never);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/certify/verify",
      payload: { bundle: { schema: "qtrust.certification.v1" } },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true });
    expect(verifyCertificationBundle).toHaveBeenCalledWith(expect.anything(), { check_chain: false });
  });

  it("passes check_chain through when explicitly requested", async () => {
    vi.mocked(verifyCertificationBundle).mockResolvedValue({ valid: false, chain_anchor: "unavailable" } as never);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/certify/verify",
      payload: { bundle: { schema: "qtrust.certification.v1" }, check_chain: true },
    });
    await app.close();

    expect(verifyCertificationBundle).toHaveBeenCalledWith(expect.anything(), { check_chain: true });
    expect(res.json().chain_anchor).toBe("unavailable");
  });

  it("rejects a missing bundle payload", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/certify/verify", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_bundle");
  });

  it("forwards a pinned trust anchor and rejects a non-string one", async () => {
    vi.mocked(verifyCertificationBundle).mockResolvedValue({ valid: true } as never);
    const app = await buildApp();

    const pinned = await app.inject({
      method: "POST",
      url: "/v1/certify/verify",
      payload: {
        bundle: { schema: "qtrust.certification.v1" },
        trust_anchor_did: "did:key:z6MkIssuer",
      },
    });
    expect(pinned.statusCode).toBe(200);
    expect(verifyCertificationBundle).toHaveBeenCalledWith(expect.anything(), {
      check_chain: false,
      trust_anchor_did: "did:key:z6MkIssuer",
    });

    const bad = await app.inject({
      method: "POST",
      url: "/v1/certify/verify",
      payload: { bundle: { schema: "qtrust.certification.v1" }, trust_anchor_did: 42 },
    });
    const tooLong = await app.inject({
      method: "POST",
      url: "/v1/certify/verify",
      payload: { bundle: { schema: "qtrust.certification.v1" }, trust_anchor_did: `did:key:${"z".repeat(600)}` },
    });
    await app.close();

    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("invalid_trust_anchor");
    expect(tooLong.statusCode).toBe(400);
  });
});

describe("GET /v1/certify/policies", () => {
  it("lists admission policies", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/certify/policies" });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().policies[0].id).toContain("qtrust.certification");
  });
});

describe("GET /v1/certify/issuer", () => {
  it("publishes the signing identity so verifiers can pin before issuance", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/certify/issuer" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      schema: "qtrust.certification.v1",
      issuer: "did:key:z6MkExample",
      verification_method: "did:key:z6MkExample#key-1",
      public_key_multibase: "z6MkExample",
      key_fingerprint: "ab".repeat(32),
    });
  });

  it("never leaks private key material", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/certify/issuer" });
    await app.close();

    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "issuer",
      "key_fingerprint",
      "public_key_multibase",
      "schema",
      "verification_method",
    ]);
  });

  it("fails closed when the configured issuer seed is unusable", async () => {
    vi.mocked(certificationIssuerIdentity).mockImplementationOnce(() => {
      throw new Error("QTRUST_VC_ISSUER_KEY must be a 32-byte hex key in production");
    });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/certify/issuer" });
    await app.close();

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("issuer_unavailable");
    expect(JSON.stringify(res.json())).not.toContain("QTRUST_VC_ISSUER_KEY=1111");
  });
});

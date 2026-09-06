/**
 * Verifiable Credentials service — real Ed25519 issuance + fail-closed
 * cryptographic verification (W3C VC Data Model v2.0, Ed25519Signature2020).
 *
 * Addresses the principal-audit P0: /v1/credentials/verify previously returned
 * `signature_verification_unavailable_in_backend` (structural checks only) and
 * /v1/credentials/issue produced an UNSIGNED stub. This service implements the
 * full issuance/verification triangle in TypeScript, byte-compatible with the
 * Python SDK (`qtrust.vc.VCIssuer` / `VCVerifier`):
 *
 *   - canonical signing payload: the VC JSON with sorted keys and compact
 *     separators (`json.dumps(sort_keys=True, separators=(",", ":"))` in the
 *     SDK) WITHOUT the proof field;
 *   - proof: { type: "Ed25519Signature2020", created, verificationMethod,
 *     proofPurpose: "assertionMethod", proofValue: hex(ed25519 sig) };
 *   - verification is FAIL-CLOSED: valid only when the proof is present, the
 *     issuer DID resolves to an Ed25519 key, the signature verifies, and the
 *     credential is not expired.
 *
 * DID resolution supports did:key (self-contained Ed25519 multibase) and
 * did:web (HTTPS fetch with an SSRF guard, mirroring sdk/qtrust/did.py).
 */
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import * as dotenv from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import * as https from "node:https";
import * as tls from "node:tls";
import { isIP } from "node:net";
import { isPrivateIp, resolvePublicAddress } from "./webhook.js";

dotenv.config();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Proof {
  type: string;
  created: string;
  verificationMethod: string;
  proofPurpose: string;
  proofValue: string;
  [k: string]: unknown;
}

export interface VerifiableCredential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: Record<string, unknown>;
  credentialSchema?: { id: string; type: string };
  credentialStatus?: Record<string, unknown>;
  proof?: Proof;
  [k: string]: unknown;
}

export interface IssueOptions {
  subject_did: string;
  issuer_did: string;
  schema_id?: string | null;
  claims?: Record<string, unknown>;
  expiration_date?: string | null;
}

export interface VerificationChecklist {
  structure: boolean;
  expiration: boolean;
  signature: boolean;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  detail?: string;
  issuer_did?: string;
  subject_did?: string;
  schema_id?: string | null;
  has_proof?: boolean;
  expired?: boolean;
  checked: VerificationChecklist;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Canonicalization (byte-compatible with the Python SDK)
// ---------------------------------------------------------------------------

/**
 * Deterministic stringify matching Python's
 * `json.dumps(obj, sort_keys=True, separators=(",", ":"))`:
 * recursively sorted object keys, no whitespace, null omitted.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) {
        continue; // SDK's exclude_none=True drops None fields
      }
      parts.push(`${serialize(k)}:${serialize(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  if (typeof value === "string") {
    return `"${escapeString(value)}"`;
  }
  // numbers / booleans
  return String(value);
}

/**
 * Escape a JSON string exactly like Python's json.dumps(ensure_ascii=True):
 * ASCII control chars get short escapes, non-ASCII becomes \uXXXX, and the
 * forward slash is NOT escaped. Byte-compatibility with the Python SDK's
 * canonical payload is what lets both languages verify each other's VCs.
 */
function escapeString(s: string): string {
  let out = "";
  // Iterate by code point so astral characters (e.g. emoji) escape as the
  // same surrogate pairs Python emits for ensure_ascii=True.
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') {
      out += '\\"';
    } else if (ch === "\\") {
      out += "\\\\";
    } else if (ch === "\b") {
      out += "\\b";
    } else if (ch === "\f") {
      out += "\\f";
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      out += "\\r";
    } else if (ch === "\t") {
      out += "\\t";
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (code >= 0x7f) {
      // ensure_ascii=True: escape every non-ASCII code point. Astral code
      // points become a UTF-16 surrogate pair, exactly like Python.
      if (code > 0xffff) {
        const hi = 0xd800 + ((code - 0x10000) >> 10);
        const lo = 0xdc00 + ((code - 0x10000) & 0x3ff);
        out += `\\u${hi.toString(16)}` + `\\u${lo.toString(16)}`;
      } else {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ed25519 helpers
// ---------------------------------------------------------------------------

const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01]);

/** Encode a 32-byte Ed25519 public key as a did:key (multibase base58btc). */
export function publicKeyToDidKey(publicKey: Uint8Array): string {
  const payload = new Uint8Array(2 + publicKey.length);
  payload.set(ED25519_MULTICODEC, 0);
  payload.set(publicKey, 2);
  return `did:key:z${base58.encode(payload)}`;
}

/**
 * Decode a did:key into its raw 32-byte Ed25519 public key.
 * Returns null for non-Ed25519 or malformed did:key values.
 */
export function didKeyToPublicKey(did: string): Uint8Array | null {
  if (!did.startsWith("did:key:z")) {
    return null;
  }
  try {
    const raw = base58.decode(did.slice("did:key:z".length));
    if (raw.length === 34 && raw[0] === 0xed && raw[1] === 0x01) {
      return raw.slice(2);
    }
    if (raw.length === 32) {
      return raw; // bare key without multicodec prefix
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolve the issuer seed once per process so every credential has the same
 * issuer identity and can be verified after the credential was issued.
 * Production requires an operator-managed key; development uses a fixed,
 * clearly non-production seed rather than generating a new identity per call.
 */
let cachedIssuerSeed: { key: string; seed: Uint8Array } | null = null;
function issuerSeed(): Uint8Array {
  const env = process.env.QTRUST_VC_ISSUER_KEY?.trim() ?? "";
  if (process.env.NODE_ENV === "production" && !/^[0-9a-fA-F]{64}$/.test(env)) {
    throw new Error("QTRUST_VC_ISSUER_KEY must be a 32-byte hex key in production");
  }
  if (cachedIssuerSeed?.key === env) return cachedIssuerSeed.seed;

  if (env && /^[0-9a-fA-F]{64}$/.test(env)) {
    const seed = Uint8Array.from(Buffer.from(env, "hex"));
    cachedIssuerSeed = { key: env, seed };
    return seed;
  }

  // Stable local identity makes development credentials mutually verifiable.
  // This seed is intentionally public and must never be used in production.
  const seed = createHash("sha256")
    .update("qtrust-development-vc-issuer-v1", "utf8")
    .digest();
  cachedIssuerSeed = { key: env, seed };
  return seed;
}

export function issuerKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array; did: string } {
  const privateKey = issuerSeed();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey, did: publicKeyToDidKey(publicKey) };
}

// ---------------------------------------------------------------------------
// DID resolution (did:key + did:web with SSRF guard)
// ---------------------------------------------------------------------------

/**
 * The proof's verificationMethod does not cryptographically bind to the issuer
 * DID. This is a proof failure (invalid signature semantics), not a DID
 * resolution failure, so callers classify it under invalid_signature.
 */
class DidKeyBindingError extends Error {}

/** Extract the Ed25519 key bound to the requested verification method. */
function publicKeyFromDidDocument(
  doc: { id?: unknown; verificationMethod?: unknown[] },
  issuerDid: string,
  verificationMethod?: string,
): Uint8Array | null {
  if (doc.id !== issuerDid) {
    throw new DidKeyBindingError("DID document id does not match the issuer DID");
  }
  const methods = Array.isArray(doc.verificationMethod) ? doc.verificationMethod : [];
  for (const m of methods) {
    if (!m || typeof m !== "object") continue;
    const method = m as Record<string, unknown>;
    const methodId = method.id;
    const controller = method.controller;
    if (typeof methodId !== "string") continue;
    if (verificationMethod !== undefined && methodId !== verificationMethod) continue;
    if (typeof controller === "string" && controller !== issuerDid) continue;
    // publicKeyMultibase (base58btc, z-prefixed, multicodec)
    const mb = method.publicKeyMultibase;
    if (typeof mb === "string" && mb.startsWith("z")) {
      try {
        const raw = base58.decode(mb.slice(1));
        if (raw.length === 34 && raw[0] === 0xed && raw[1] === 0x01) {
          return raw.slice(2);
        }
        if (raw.length === 32) {
          return raw;
        }
      } catch {
        /* try next method */
      }
    }
    // publicKeyJwk (OKP / Ed25519)
    const jwk = method.publicKeyJwk as Record<string, unknown> | undefined;
    if (jwk && jwk.kty === "OKP" && jwk.crv === "Ed25519" && typeof jwk.x === "string") {
      try {
        const x = jwk.x.replace(/-/g, "+").replace(/_/g, "/");
        const padded = x.padEnd(x.length + ((4 - (x.length % 4)) % 4), "=");
        const key = Uint8Array.from(Buffer.from(padded, "base64"));
        if (key.length === 32) return key;
      } catch {
        /* try next method */
      }
    }
  }
  return null;
}

/** Reject malformed or private did:web hosts before any network access. */
function isDidWebHostAllowlisted(host: string): boolean {
  return (process.env.QTRUST_DID_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .includes(host.toLowerCase());
}

function assertSafeDidWebHost(host: string): void {
  const normalized = host.toLowerCase();

  // did:web host components are DNS names, not URLs or user-controlled ports.
  // Keep the accepted syntax deliberately narrow so URL parser edge cases
  // cannot turn the identifier into credentials, a port, or another authority.
  if (
    !host ||
    host.length > 253 ||
    host.includes("@") ||
    host.includes("/") ||
    host.includes("?") ||
    host.includes("#") ||
    !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host)
  ) {
    throw new Error("did:web host is malformed (SSRF guard)");
  }
  if (isDidWebHostAllowlisted(host)) return;
  if ((isIP(host) > 0 && isPrivateIp(host)) || normalized === "localhost" || normalized.endsWith(".local") || normalized.endsWith(".internal")) {
    throw new Error("did:web host resolves to forbidden address (SSRF guard)");
  }
}

const DID_WEB_MAX_BODY_BYTES = 1 * 1024 * 1024;

/** Fetch a DID document over the already-validated HTTPS connection target. */
async function fetchDidDocument(
  url: URL,
  address: string,
  family: number,
): Promise<{ id?: unknown; verificationMethod?: unknown[] }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: address,
        family,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { accept: "application/json", host: url.host },
        servername: url.hostname,
        // The socket connects to the pinned IP, but the certificate must still
        // authenticate the issuer's hostname rather than the numeric address.
        checkServerIdentity: (_hostname, cert) => tls.checkServerIdentity(url.hostname, cert),
        timeout: 10_000,
      },
      (resp) => {
        const status = resp.statusCode ?? 0;
        const declaredLength = Number(resp.headers["content-length"] ?? 0);
        if (status < 200 || status >= 300) {
          resp.resume();
          reject(new Error(`did:web resolution failed: HTTP ${status} for ${url.href}`));
          return;
        }
        if (Number.isFinite(declaredLength) && declaredLength > DID_WEB_MAX_BODY_BYTES) {
          resp.resume();
          reject(new Error("did:web document exceeds the response size limit"));
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        resp.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > DID_WEB_MAX_BODY_BYTES) {
            resp.destroy();
            reject(new Error("did:web document exceeds the response size limit"));
            return;
          }
          chunks.push(chunk);
        });
        resp.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as { verificationMethod?: unknown[] });
          } catch {
            reject(new Error("did:web resolution returned invalid JSON"));
          }
        });
        resp.on("error", () => reject(new Error("did:web document read failed")));
      },
    );
    req.on("timeout", () => req.destroy(new Error("did:web resolution timed out")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Resolve an issuer DID to its Ed25519 public key.
 * Supports did:key (self-contained) and did:web (HTTPS fetch).
 * Throws on resolution failure; returns null when the key type is unsupported.
 */
export async function resolveIssuerKey(
  issuerDid: string,
  verificationMethod?: string,
): Promise<Uint8Array | null> {
  if (issuerDid.startsWith("did:key:")) {
    if (
      typeof verificationMethod !== "string" ||
      !verificationMethod.startsWith(`${issuerDid}#`)
    ) {
      throw new DidKeyBindingError("proof verificationMethod is not bound to the issuer DID");
    }
    return didKeyToPublicKey(issuerDid);
  }
  if (issuerDid.startsWith("did:web:")) {
    // did:web:example.com -> https://example.com/.well-known/did.json
    // did:web:example.com:path -> https://example.com/path/did.json
    const rest = issuerDid.slice("did:web:".length);
    const parts = rest.split(":");
    const host = parts[0];
    assertSafeDidWebHost(host);
    const pathParts = parts.slice(1);
    if (
      pathParts.some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment.includes("/") ||
          segment.includes("?") ||
          segment.includes("#"),
      )
    ) {
      throw new Error("did:web path is malformed (SSRF guard)");
    }
    const path = pathParts.length > 0 ? `${pathParts.join("/")}/did.json` : ".well-known/did.json";
    const url = new URL(`https://${host}/${path}`);
    if (url.hostname !== host.toLowerCase() || url.port) {
      throw new Error("did:web host is malformed (SSRF guard)");
    }
    // Resolve once and connect to the validated address directly. No redirect
    // handling is used, so a DID document cannot redirect into a private host.
    const { address, family } = await resolvePublicAddress(
      url.hostname,
      isDidWebHostAllowlisted(host),
    );
    const doc = await fetchDidDocument(url, address, family);
    const key = publicKeyFromDidDocument(doc, issuerDid, verificationMethod);
    if (!key) {
      throw new Error("DID document has no usable Ed25519 verification method");
    }
    return key;
  }
  throw new Error(`Unsupported DID method: ${issuerDid.slice(0, issuerDid.indexOf(":"))}`);
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

/** Sign a VC payload with Ed25519, attaching an Ed25519Signature2020 proof. */
export function signCredential(vc: VerifiableCredential, privateKey: Uint8Array, publicKey: Uint8Array): VerifiableCredential {
  const payload = { ...vc };
  delete payload.proof;
  const message = canonicalJson(payload);
  const signature = ed25519.sign(Buffer.from(message, "utf8"), privateKey);
  const did = publicKeyToDidKey(publicKey);
  return {
    ...vc,
    proof: {
      type: "Ed25519Signature2020",
      created: new Date().toISOString(),
      verificationMethod: `${did}#key-1`,
      proofPurpose: "assertionMethod",
      proofValue: Buffer.from(signature).toString("hex"),
    },
  };
}

/**
 * Issue a signed Verifiable Credential.
 * The issuer DID is the backend's configured Ed25519 identity (did:key);
 * callers cannot forge issuance under an arbitrary DID they don't control.
 */
export function issueCredential(options: IssueOptions): VerifiableCredential {
  const { privateKey, publicKey, did } = issuerKeyPair();
  const now = new Date().toISOString();
  const vc: VerifiableCredential = {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://www.w3.org/ns/credentials/credentials/v2",
    ],
    id: `urn:uuid:${randomUUID()}`,
    type: ["VerifiableCredential"],
    issuer: did,
    issuanceDate: now,
    credentialSubject: {
      id: options.subject_did,
      ...(options.claims ?? {}),
    },
  };
  if (options.schema_id) {
    vc.credentialSchema = { id: options.schema_id, type: "JsonSchema2021" };
  }
  if (options.expiration_date) {
    vc.expirationDate = options.expiration_date;
  }
  return signCredential(vc, privateKey, publicKey);
}

// ---------------------------------------------------------------------------
// Verification (fail-closed)
// ---------------------------------------------------------------------------

function isExpired(vc: VerifiableCredential): boolean {
  if (typeof vc.expirationDate !== "string") return false;
  const exp = new Date(vc.expirationDate);
  return Number.isNaN(exp.getTime()) || exp < new Date();
}

/**
 * Verify a verifiable credential cryptographically.
 * FAIL-CLOSED: valid only when the proof verifies against the issuer DID's
 * key AND the credential is not expired.
 */
export async function verifyCredential(raw: Record<string, unknown>): Promise<VerifyResult> {
  const timestamp = new Date().toISOString();
  const vc = raw as VerifiableCredential;

  // 1. Structure
  if (!vc.issuer || !vc.credentialSubject) {
    return {
      valid: false,
      reason: "missing_required_fields",
      detail: "Missing required fields: issuer, credentialSubject",
      checked: { structure: false, expiration: false, signature: false },
      timestamp,
    };
  }

  // 2. Expiration
  let expired = false;
  if (typeof vc.expirationDate === "string") {
    const expTime = new Date(vc.expirationDate);
    if (Number.isNaN(expTime.getTime())) {
      return {
        valid: false,
        reason: "invalid_expiration_date",
        detail: "expirationDate is not a valid date",
        checked: { structure: true, expiration: false, signature: false },
        timestamp,
      };
    }
    expired = expTime < new Date();
    if (expired) {
      return {
        valid: false,
        reason: "expired",
        detail: `Credential expired at ${vc.expirationDate}`,
        issuer_did: vc.issuer,
        subject_did: (vc.credentialSubject.id as string) ?? undefined,
        expired: true,
        checked: { structure: true, expiration: false, signature: false },
        timestamp,
      };
    }
  }

  // 3. Proof present
  const proof = vc.proof as Proof | undefined;
  const hasProof = Boolean(
    proof &&
      typeof proof.proofValue === "string" &&
      proof.proofValue.length > 0 &&
      typeof proof.verificationMethod === "string" &&
      proof.verificationMethod.length > 0,
  );
  if (!hasProof) {
    return {
      valid: false,
      reason: "unsigned_credential",
      detail: "Credential has no proof — cryptographic verification required",
      issuer_did: vc.issuer,
      subject_did: (vc.credentialSubject.id as string) ?? undefined,
      has_proof: false,
      checked: { structure: true, expiration: true, signature: false },
      timestamp,
    };
  }

  // 4. Resolve issuer key
  const verificationMethod = proof!.verificationMethod;
  let publicKey: Uint8Array | null;
  try {
    publicKey = await resolveIssuerKey(vc.issuer, verificationMethod);
  } catch (err) {
    // A proof that does not bind to the issuer DID (mismatched verification
    // method, wrong document id) is a proof failure, not a resolution failure.
    if (err instanceof DidKeyBindingError) {
      return {
        valid: false,
        reason: "invalid_signature",
        detail: err.message,
        issuer_did: vc.issuer,
        subject_did: (vc.credentialSubject.id as string) ?? undefined,
        has_proof: true,
        checked: { structure: true, expiration: true, signature: false },
        timestamp,
      };
    }
    return {
      valid: false,
      reason: "did_resolution_failed",
      detail: err instanceof Error ? err.message : "DID resolution failed",
      issuer_did: vc.issuer,
      subject_did: (vc.credentialSubject.id as string) ?? undefined,
      has_proof: true,
      checked: { structure: true, expiration: true, signature: false },
      timestamp,
    };
  }
  if (!publicKey || publicKey.length !== 32) {
    return {
      valid: false,
      reason: "public_key_unavailable",
      detail: "Issuer DID resolved to no usable Ed25519 key",
      issuer_did: vc.issuer,
      subject_did: (vc.credentialSubject.id as string) ?? undefined,
      has_proof: true,
      checked: { structure: true, expiration: true, signature: false },
      timestamp,
    };
  }

  // 5. Verify signature over the canonical payload (without proof)
  try {
    const signature = Uint8Array.from(Buffer.from((proof as Proof).proofValue as string, "hex"));
    if (signature.length !== 64) {
      throw new Error("invalid signature length");
    }
    const payload = { ...vc };
    delete payload.proof;
    const message = Buffer.from(canonicalJson(payload), "utf8");
    const ok = ed25519.verify(signature, message, publicKey);
    if (!ok) {
      return {
        valid: false,
        reason: "invalid_signature",
        detail: "Ed25519 signature does not match the issuer's public key",
        issuer_did: vc.issuer,
        subject_did: (vc.credentialSubject.id as string) ?? undefined,
        has_proof: true,
        checked: { structure: true, expiration: true, signature: false },
        timestamp,
      };
    }
  } catch (err) {
    return {
      valid: false,
      reason: "invalid_signature",
      detail: err instanceof Error ? err.message : "Signature verification failed",
      issuer_did: vc.issuer,
      subject_did: (vc.credentialSubject.id as string) ?? undefined,
      has_proof: true,
      checked: { structure: true, expiration: true, signature: false },
      timestamp,
    };
  }

  return {
    valid: true,
    issuer_did: vc.issuer,
    subject_did: (vc.credentialSubject.id as string) ?? undefined,
    schema_id: typeof vc.credentialSchema?.id === "string" ? vc.credentialSchema.id : null,
    has_proof: true,
    checked: { structure: true, expiration: true, signature: true },
    timestamp,
  };
}

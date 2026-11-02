import { describe, expect, it, afterAll, vi } from "vitest";

/**
 * Public-repository ingestion (`POST /v1/scan/repo`).
 *
 * The route is the only place the backend fetches a caller-influenced URL, so
 * these tests pin the SSRF guards (slug validation, codeload-only redirects,
 * streaming size cap), the hosted-scanner handoff, and honest error mapping.
 * Network is stubbed; the real scanner is covered by scanner-service/tests.
 */

const API_KEY = "repo-scan-test-key-4b1c9e";
process.env.QTRUST_API_KEYS = API_KEY;
process.env.QTRUST_SCANNER_SERVICE_URL = "https://scanner.example/";
process.env.QTRUST_SCANNER_API_KEY = "scanner-service-key";
process.env.QTRUST_DATA_DIR = process.env.TEMP || "/tmp";

const { parseGithubRepo, normalizeGithubRef, RepoScanError } = await import(
  "../src/services/repo-scan.js"
);
const { registerScannerRoutes } = await import("../src/routes/scanner.js");

async function scannerApp() {
  const { default: Fastify } = await import("fastify");
  const app = Fastify({ logger: false });
  await app.register(registerScannerRoutes);
  return app;
}

type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, init });
      return handler(url, init);
    }),
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.QTRUST_API_KEYS;
  delete process.env.QTRUST_SCANNER_SERVICE_URL;
  delete process.env.QTRUST_SCANNER_API_KEY;
  delete process.env.QTRUST_DATA_DIR;
});

describe("github repo parsing", () => {
  it("accepts owner/name and github.com URL forms", () => {
    expect(parseGithubRepo("octocat/Spoon-Knife")).toEqual({
      owner: "octocat",
      repo: "Spoon-Knife",
    });
    expect(parseGithubRepo("https://github.com/octocat/Spoon-Knife")).toEqual({
      owner: "octocat",
      repo: "Spoon-Knife",
    });
    expect(parseGithubRepo("https://github.com/octocat/Spoon-Knife.git")).toEqual({
      owner: "octocat",
      repo: "Spoon-Knife",
    });
    expect(parseGithubRepo("github.com/octocat/Spoon-Knife")).toEqual({
      owner: "octocat",
      repo: "Spoon-Knife",
    });
  });

  it("rejects other hosts, extra segments, and traversal", () => {
    for (const bad of [
      "https://evil.example/octocat/Spoon-Knife",
      "https://github.com/octocat/Spoon-Knife/tree/main",
      "octocat",
      "a/b/c",
      "octocat/..",
      "-bad/repo",
      "own er/repo",
    ]) {
      expect(() => parseGithubRepo(bad), bad).toThrow(RepoScanError);
    }
  });

  it("accepts branch refs and rejects traversal/flag refs", () => {
    expect(normalizeGithubRef(undefined)).toBeUndefined();
    expect(normalizeGithubRef("main")).toBe("main");
    expect(normalizeGithubRef("refs/heads/release/1.2")).toBe("refs/heads/release/1.2");
    for (const bad of ["../main", "main/..", "-force", "a//b", "x".repeat(201)]) {
      expect(() => normalizeGithubRef(bad), bad).toThrow(RepoScanError);
    }
  });
});

describe("POST /v1/scan/repo", () => {
  it("requires an API key", async () => {
    stubFetch(() => jsonResponse(500, { error: "should not be called" }));
    const app = await scannerApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/repo",
      payload: { repo: "octocat/Spoon-Knife" },
    });
    expect(res.statusCode).toBe(401);
    expect(fetchCalls).toHaveLength(0);
    await app.close();
  });

  it("rejects an invalid repo before any network call", async () => {
    stubFetch(() => jsonResponse(500, { error: "should not be called" }));
    const app = await scannerApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/repo",
      headers: { "x-api-key": API_KEY },
      payload: { repo: "https://evil.example/a/b" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("owner/name");
    expect(fetchCalls).toHaveLength(0);
    await app.close();
  });

  it("fetches the tarball, forwards it to the scanner service, and returns findings", async () => {
    const archive = Buffer.from("fake-tarball-bytes");
    stubFetch((url) => {
      if (url === "https://codeload.github.com/octocat/Spoon-Knife/tar.gz/HEAD") {
        return new Response(new Uint8Array(archive), { status: 200 });
      }
      if (url === "https://scanner.example/api/scan") {
        return jsonResponse(200, {
          findings: [
            { asset_type: "source_crypto_usage", host: "app.py", algorithm: "RSA-2048" },
          ],
          files_scanned: 4,
          detector: { python: "stdlib-ast" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const app = await scannerApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/repo",
      headers: { "x-api-key": API_KEY },
      payload: { repo: "https://github.com/octocat/Spoon-Knife.git" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.repo).toBe("octocat/Spoon-Knife");
    expect(body.scanType).toBe("full");
    expect(body.filesScanned).toBe(4);
    expect(body.findings).toHaveLength(1);
    expect(body.detector).toEqual({ python: "stdlib-ast" });
    expect(typeof body.timestamp).toBe("string");

    const scannerCall = fetchCalls.find((call) => call.url === "https://scanner.example/api/scan");
    expect(scannerCall?.init?.method).toBe("POST");
    expect(new Headers(scannerCall?.init?.headers).get("x-api-key")).toBe("scanner-service-key");
    const sent = JSON.parse(String(scannerCall?.init?.body)) as {
      archive_b64: string;
      archive_format: string;
      scan_type: string;
    };
    expect(sent.scan_type).toBe("full");
    expect(sent.archive_format).toBe("tar.gz");
    expect(Buffer.from(sent.archive_b64, "base64").equals(archive)).toBe(true);
    await app.close();
  });

  it("passes an explicit ref and scan type through", async () => {
    stubFetch((url) => {
      if (url === "https://codeload.github.com/octocat/Spoon-Knife/tar.gz/refs/heads/release/1.2") {
        return new Response(new Uint8Array(Buffer.from("x")), { status: 200 });
      }
      if (url === "https://scanner.example/api/scan") {
        return jsonResponse(200, { findings: [], files_scanned: 1 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const app = await scannerApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/repo",
      headers: { "x-api-key": API_KEY },
      payload: {
        repo: "octocat/Spoon-Knife",
        ref: "refs/heads/release/1.2",
        scanType: "manifests",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ref).toBe("refs/heads/release/1.2");
    expect(res.json().scanType).toBe("manifests");
    const scannerCall = fetchCalls.find((call) => call.url.endsWith("/api/scan"));
    expect(JSON.parse(String(scannerCall?.init?.body)).scan_type).toBe("manifests");
    await app.close();
  });

  it("maps a missing repository to 404", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    const app = await scannerApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/repo",
      headers: { "x-api-key": API_KEY },
      payload: { repo: "octocat/does-not-exist" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("not found");
    await app.close();
  });

  it("refuses redirects off codeload.github.com", async () => {
    stubFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/archive.tar.gz" },
        }),
    );
    const app = await scannerApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/repo",
      headers: { "x-api-key": API_KEY },
      payload: { repo: "octocat/Spoon-Knife" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("redirected off GitHub");
    expect(fetchCalls).toHaveLength(1);
    await app.close();
  });

  it("rejects an archive whose declared size exceeds the cap", async () => {
    stubFetch(
      () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": String(6 * 1024 * 1024) },
        }),
    );
    const app = await scannerApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/repo",
      headers: { "x-api-key": API_KEY },
      payload: { repo: "octocat/Spoon-Knife" },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toContain("larger than 3 MB");
    await app.close();
  });

  it("surfaces a scanner 422 detail and maps scanner failures to 503", async () => {
    const archive = Buffer.from("bytes");
    stubFetch((url) => {
      if (url.startsWith("https://codeload.github.com/")) {
        return new Response(new Uint8Array(archive), { status: 200 });
      }
      return jsonResponse(422, { detail: "archive contains a file larger than the per-file cap" });
    });
    const app = await scannerApp();
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/scan/repo",
      headers: { "x-api-key": API_KEY },
      payload: { repo: "octocat/Spoon-Knife" },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error).toContain("per-file cap");
    await app.close();

    stubFetch((url) => {
      if (url.startsWith("https://codeload.github.com/")) {
        return new Response(new Uint8Array(archive), { status: 200 });
      }
      return jsonResponse(500, { error: "scan failed" });
    });
    const app2 = await scannerApp();
    const failed = await app2.inject({
      method: "POST",
      url: "/v1/scan/repo",
      headers: { "x-api-key": API_KEY },
      payload: { repo: "octocat/Spoon-Knife" },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error).toBe("hosted scanner service failed");
    await app2.close();
  });
});

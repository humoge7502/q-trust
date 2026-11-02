/**
 * Public-repository ingestion for `POST /v1/scan/repo`.
 *
 * The only network source this module will talk to is codeload.github.com: the
 * caller supplies an `owner/name` pair (or a github.com URL) which is validated
 * against a strict slug grammar before it is interpolated into a URL, and every
 * redirect is re-checked against the codeload host. The archive is capped while
 * it streams, then forwarded to the hosted scanner service (or scanned by the
 * local Python fallback when running on an operator machine).
 */
import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FastifyBaseLogger } from "fastify";
import { SCANNER_SERVICE_API_KEY, SCANNER_SERVICE_URL } from "../config.js";

const execFileAsync = promisify(execFile);

const ARCHIVE_SCAN_SCRIPT = fileURLToPath(
  new URL("../../scripts/run_archive_scan.py", import.meta.url),
);

export const MAX_REPO_ARCHIVE_BYTES = 3 * 1024 * 1024;
const CODELOAD_HOST = "codeload.github.com";
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 30_000;
const SCAN_TIMEOUT_MS = 60_000;

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const REF_SEGMENT_RE = /^[A-Za-z0-9._-]{1,100}$/;

export type RepoScanType = "source" | "manifests" | "full";
export type RepoScanStatus = 400 | 404 | 413 | 422 | 502 | 503;

export class RepoScanError extends Error {
  readonly statusCode: RepoScanStatus;

  constructor(message: string, statusCode: RepoScanStatus) {
    super(message);
    this.name = "RepoScanError";
    this.statusCode = statusCode;
  }
}

/** Parse `owner/name`, `owner/name.git`, or a github.com repository URL. */
export function parseGithubRepo(input: string): { owner: string; repo: string } {
  const text = input.trim();
  const urlMatch = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/?$/i.exec(text);
  const candidate = (urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : text.replace(/^github\.com\//i, ""))
    .replace(/\.git$/i, "");
  const parts = candidate.split("/");
  if (parts.length !== 2) {
    throw new RepoScanError("repo must be owner/name or a github.com repository URL", 400);
  }
  const [owner, repo] = parts;
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..") {
    throw new RepoScanError("repo must be owner/name or a github.com repository URL", 400);
  }
  return { owner, repo };
}

/** Branch, tag, or commit ref; rejects traversal, flags, and control bytes. */
export function normalizeGithubRef(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const ref = input.trim();
  if (!ref || ref.length > 200) throw new RepoScanError("ref is not a valid git ref", 400);
  const segments = ref.split("/");
  if (
    segments.length > 5 ||
    segments.some(
      (segment) =>
        !REF_SEGMENT_RE.test(segment) || segment === "." || segment === ".." || segment.startsWith("-"),
    )
  ) {
    throw new RepoScanError("ref is not a valid git ref", 400);
  }
  return ref;
}

function codeloadUrl(owner: string, repo: string, ref: string | undefined): string {
  const tail = ref
    ? ref.split("/").map(encodeURIComponent).join("/")
    : "HEAD";
  return `https://${CODELOAD_HOST}/${owner}/${repo}/tar.gz/${tail}`;
}

async function readCappedBody(response: Response): Promise<Buffer> {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_REPO_ARCHIVE_BYTES) {
      throw new RepoScanError("repository archive is larger than 3 MB", 413);
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_REPO_ARCHIVE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new RepoScanError("repository archive is larger than 3 MB", 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/** Download a public repository tarball, following only codeload redirects. */
export async function fetchRepoArchive(
  owner: string,
  repo: string,
  ref: string | undefined,
): Promise<Buffer> {
  let url = codeloadUrl(owner, repo, ref);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "application/x-gzip", "user-agent": "qtrust-repo-scan/1.0" },
      });
    } catch (err) {
      throw new RepoScanError(
        err instanceof Error && err.name === "TimeoutError"
          ? "timed out downloading the repository archive"
          : "could not reach GitHub",
        502,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new RepoScanError("GitHub redirect had no location", 502);
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new RepoScanError("GitHub redirect was not a valid URL", 502);
      }
      if (next.protocol !== "https:" || next.hostname !== CODELOAD_HOST) {
        throw new RepoScanError("repository archive redirected off GitHub", 502);
      }
      url = next.toString();
      continue;
    }
    if (response.status === 404) {
      throw new RepoScanError("repository or ref not found", 404);
    }
    if (!response.ok) {
      throw new RepoScanError(`GitHub returned status ${response.status}`, 502);
    }
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_REPO_ARCHIVE_BYTES) {
      throw new RepoScanError("repository archive is larger than 3 MB", 413);
    }
    return readCappedBody(response);
  }
  throw new RepoScanError("too many redirects fetching the repository archive", 502);
}

function scanFailureFrom(err: unknown): RepoScanError | null {
  const stdout = (err as { stdout?: string }).stdout;
  if (typeof stdout !== "string" || !stdout.trim()) return null;
  try {
    const parsed = JSON.parse(stdout) as { error?: unknown; status?: unknown };
    if (typeof parsed.error !== "string") return null;
    return new RepoScanError(parsed.error, parsed.status === 422 ? 422 : 503);
  } catch {
    return null;
  }
}

async function scanArchiveLocally(payload: object): Promise<Record<string, unknown>> {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "qtrust-repo-scan-"));
  const payloadPath = path.join(tempDir, "payload.json");
  try {
    await fsp.writeFile(payloadPath, JSON.stringify(payload), "utf8");
    const pythonBin = process.env.QTRUST_INSPECTOR_PYTHON || "python3";
    const { stdout } = await execFileAsync(pythonBin, [ARCHIVE_SCAN_SCRIPT, "--payload", payloadPath], {
      timeout: SCAN_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (err) {
    throw scanFailureFrom(err) ?? new RepoScanError("local archive scanner unavailable", 503);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function scanArchive(
  archive: Buffer,
  scanType: RepoScanType,
  log: Pick<FastifyBaseLogger, "warn">,
): Promise<Record<string, unknown>> {
  const payload = {
    archive_b64: archive.toString("base64"),
    archive_format: "tar.gz",
    scan_type: scanType,
  };

  if (SCANNER_SERVICE_URL) {
    let response: Response;
    try {
      response = await fetch(`${SCANNER_SERVICE_URL}/api/scan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(SCANNER_SERVICE_API_KEY ? { "x-api-key": SCANNER_SERVICE_API_KEY } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
      });
    } catch (err) {
      log.warn({ err }, "Hosted scanner service unreachable");
      throw new RepoScanError("hosted scanner service is unreachable", 503);
    }
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: unknown } | null;
      log.warn({ status: response.status }, "Hosted scanner rejected an archive scan");
      throw new RepoScanError(
        response.status === 422 && typeof detail?.detail === "string"
          ? detail.detail
          : "hosted scanner service failed",
        response.status === 422 ? 422 : 503,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }

  if (process.env.VERCEL || process.env.QTRUST_SERVERLESS === "1") {
    throw new RepoScanError("hosted scanner service is not configured", 503);
  }
  return scanArchiveLocally(payload);
}

export interface RepoScanResult {
  repo: string;
  ref?: string;
  scanType: RepoScanType;
  findings: unknown[];
  filesScanned?: number;
  detector?: Record<string, string>;
}

export async function scanGithubRepo(options: {
  repo: string;
  ref?: string;
  scanType: RepoScanType;
  log: Pick<FastifyBaseLogger, "warn">;
}): Promise<RepoScanResult> {
  const { owner, repo } = parseGithubRepo(options.repo);
  const ref = normalizeGithubRef(options.ref);
  const archive = await fetchRepoArchive(owner, repo, ref);
  const result = await scanArchive(archive, options.scanType, options.log);
  return {
    repo: `${owner}/${repo}`,
    ...(ref ? { ref } : {}),
    scanType: options.scanType,
    findings: Array.isArray(result.findings) ? result.findings : [],
    ...(typeof result.files_scanned === "number" ? { filesScanned: result.files_scanned } : {}),
    ...(result.detector && typeof result.detector === "object"
      ? { detector: result.detector as Record<string, string> }
      : {}),
  };
}

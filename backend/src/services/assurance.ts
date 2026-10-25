/**
 * Assurance analytics bridge — runs the real inspector engines over CBOM
 * findings supplied by the API caller.
 *
 * The engines live in Python (crypto-agility scoring, CRQC Monte-Carlo
 * exposure, sector assurance packs) and stay there: reimplementing them in
 * TypeScript is exactly how the two rule engines diverged before. Findings
 * travel over stdin as JSON (no shell interpolation), and the bridge exits 2
 * with `{"error": "..."}` for invalid input, which maps to HTTP 422.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const BRIDGE_SCRIPT = fileURLToPath(new URL("../../scripts/run_assurance.py", import.meta.url));

export const MAX_ASSURANCE_FINDINGS = 2000;
const TIMEOUT_MS = 60_000;

export class AssuranceInputError extends Error {}
export class AssuranceUnavailableError extends Error {}

export interface AssuranceRequest {
  op?: "report" | "agility" | "crqc" | "packs";
  findings: unknown[];
  pack?: string;
  top?: number;
  crqc?: Record<string, unknown>;
}

function pythonBinary(): string {
  return (
    process.env.QTRUST_INSPECTOR_PYTHON ||
    (process.platform === "win32" ? "python" : "python3")
  );
}

export async function runAssurance(
  payload: AssuranceRequest,
  script = BRIDGE_SCRIPT,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBinary(), [script], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new AssuranceUnavailableError("assurance evaluation timed out")));
    }, TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 32 * 1024 * 1024) {
        child.kill();
        finish(() => reject(new AssuranceUnavailableError("assurance output exceeded the size limit")));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      // Bound stderr too: a noisy module import must not exhaust memory.
      if (stderr.length < 16_384) stderr += chunk;
    });
    child.on("error", () => {
      finish(() => reject(new AssuranceUnavailableError("assurance bridge could not be started")));
    });
    child.on("close", (code) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        finish(() =>
          reject(
            new AssuranceUnavailableError(
              `assurance bridge returned no JSON (exit ${code}): ${stderr.slice(0, 300)}`,
            ),
          ),
        );
        return;
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>).error === "string"
      ) {
        const message = (parsed as Record<string, string>).error;
        finish(() =>
          reject(
            code === 2
              ? new AssuranceInputError(message)
              : new AssuranceUnavailableError(message),
          ),
        );
        return;
      }
      finish(() => resolve(parsed as Record<string, unknown>));
    });

    child.stdin.on("error", () => {
      // EPIPE when the child exits early; the close handler reports the cause.
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

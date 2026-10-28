#!/usr/bin/env node
/**
 * Environment hygiene preflight.
 *
 * The deploy path reads several env files (root `.env`, `frontend/.env.local`)
 * and the backend resolves some keys twice. Two failure modes motivated this
 * check:
 *
 *   1. A duplicated key. Env parsers keep the last occurrence, but deploy
 *      scripts that build their own map keep the first — so the local backend
 *      and the hosted backend can disagree about a credential while both look
 *      configured.
 *   2. Two names for one setting. `QTRUST_PLANNER_TUNNEL_URL` survived as an
 *      alias of `QTRUST_PLANNER_URL`; the canonical value was stale and the
 *      deploy script silently used the alias. The durable-planner migration
 *      makes `QTRUST_PLANNER_URL` the single contract.
 *
 * This script reports names, counts and equality booleans only — it never
 * prints a value, so it is safe to run in a shared terminal or CI log.
 *
 * Run: node scripts/env-preflight.mjs
 * Exit: 0 clean, 1 hygiene problems found.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Legacy names that must not reappear next to the canonical setting. */
const LEGACY_PLANNER_ALIASES = ["QTRUST_PLANNER_TUNNEL_URL"];

const FILES = [".env", ".env.local", "backend/.env", "frontend/.env.local"];

const problems = [];
const warnings = [];

function fail(message) {
  problems.push(message);
}

function warn(message) {
  warnings.push(message);
}

function readEnvFile(relPath) {
  const absolute = resolve(ROOT, relPath);
  if (!existsSync(absolute)) return null;
  const lines = readFileSync(absolute, "utf8").split(/\r?\n/);
  const entries = [];
  let comments = 0;
  let blanks = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      blanks += 1;
      continue;
    }
    if (line.trim().startsWith("#")) {
      comments += 1;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) {
      warn(`${relPath}:${index + 1}: line has no "=" and is ignored by strict parsers`);
      continue;
    }
    const key = line.slice(0, eq).trim();
    const raw = line.slice(eq + 1).trim();
    const value = raw.replace(/^["']|["']$/g, "");
    entries.push({ key, value, line: index + 1 });
  }
  return { relPath, entries, comments, blanks };
}

function duplicatesOf(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1);
}

function firstValue(entries, key) {
  return entries.find((entry) => entry.key === key)?.value;
}

const files = FILES.map(readEnvFile).filter(Boolean);

if (files.length === 0) {
  console.error("env-preflight: no env file found");
  process.exit(1);
}

console.log("Env files");
for (const file of files) {
  console.log(
    `  ${file.relPath}: ${file.entries.length} keys, ${file.comments} comments, ${file.blanks} blank lines`,
  );
  const duplicates = duplicatesOf(file.entries);
  for (const [key, count] of duplicates) {
    fail(`${file.relPath}: "${key}" is defined ${count} times (last value wins locally, first wins in script maps)`);
  }
  for (const entry of file.entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key)) {
      fail(`${file.relPath}:${entry.line}: "${entry.key}" is not a valid env key name`);
    }
  }
}

console.log("\nPlanner contract");
const rootEnv = files.find((f) => f.relPath === ".env");
const plannerFiles = files.filter((f) => firstValue(f.entries, "QTRUST_PLANNER_URL") !== undefined);

if (plannerFiles.length === 0) {
  warn("QTRUST_PLANNER_URL is not set anywhere (fine only if every runtime uses the embedded planner)");
}
for (const file of plannerFiles) {
  const url = firstValue(file.entries, "QTRUST_PLANNER_URL");
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1|planner)(:|\/|$)/.test(url);
  const isHttps = url.startsWith("https://");
  console.log(`  ${file.relPath}: QTRUST_PLANNER_URL present (${isHttps ? "https" : isLocal ? "local" : "other scheme"})`);
  if (!isHttps && !isLocal) {
    warn(`${file.relPath}: QTRUST_PLANNER_URL is neither https nor a loopback address`);
  }
  for (const alias of LEGACY_PLANNER_ALIASES) {
    if (firstValue(file.entries, alias) !== undefined) {
      fail(`${file.relPath}: legacy alias "${alias}" is set alongside "QTRUST_PLANNER_URL"; keep one name`);
    }
  }
}

// Cross-file disagreement: the same key configured twice with different values
// is the exact shape that made the canonical planner URL look healthy while
// the deploy script used the alias.
const crossChecked = ["QTRUST_PLANNER_URL", "QTRUST_API_KEY", "QTRUST_BACKEND_URL"];
for (const key of crossChecked) {
  const values = files
    .map((file) => ({ file: file.relPath, value: firstValue(file.entries, key) }))
    .filter((entry) => entry.value !== undefined);
  if (values.length < 2) continue;
  const distinct = new Set(values.map((entry) => entry.value));
  const names = values.map((entry) => entry.file).join(", ");
  console.log(`  ${key}: configured in ${values.length} files (${names}), identical=${distinct.size === 1}`);
  if (distinct.size > 1) {
    fail(`${key} differs between ${names}; the local and hosted runtimes will disagree`);
  }
}

console.log("\nAPI key shape");
if (rootEnv) {
  const single = firstValue(rootEnv.entries, "QTRUST_API_KEY");
  const plural = firstValue(rootEnv.entries, "QTRUST_API_KEYS");
  if (single && plural) {
    const first = plural.split(",")[0].trim();
    console.log(`  QTRUST_API_KEY equals the first QTRUST_API_KEYS entry: ${single === first}`);
    if (single !== first) {
      warn("QTRUST_API_KEY is not the first entry in QTRUST_API_KEYS; the proxy and backend use different keys");
    }
  }
  if (single && single.length < 32) warn("QTRUST_API_KEY is shorter than 32 characters");
}

console.log("\nSecret files stay untracked");
let repoRoot = ROOT;
try {
  repoRoot = execFileSync("git", ["-C", ROOT, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  warn("not a git worktree — cannot verify that env files are ignored");
}
if (repoRoot) {
  const tracked = new Set(
    (() => {
      try {
        return execFileSync("git", ["-C", repoRoot, "ls-files"], { encoding: "utf8" })
          .split(/\r?\n/)
          .filter(Boolean);
      } catch {
        return [];
      }
    })(),
  );
  for (const relPath of [".env", "frontend/.env.local", "backend/.env"]) {
    if (!existsSync(join(ROOT, relPath))) continue;
    let ignored = false;
    try {
      execFileSync("git", ["-C", repoRoot, "check-ignore", "-q", resolve(ROOT, relPath)], {
        stdio: "ignore",
      });
      ignored = true;
    } catch {
      ignored = false;
    }
    const isTracked = tracked.has(relPath) || tracked.has(relPath.replace(/\\/g, "/"));
    console.log(`  ${relPath}: ignored=${ignored}, tracked=${isTracked}`);
    if (!ignored) fail(`${relPath} is not gitignored`);
    if (isTracked) fail(`${relPath} is tracked by git`);
  }
}

console.log("");
for (const message of warnings) console.log(`WARN ${message}`);
for (const message of problems) console.log(`FAIL ${message}`);
console.log(problems.length ? `\nRESULT: FAIL (${problems.length} problems, ${warnings.length} warnings)` : `\nRESULT: PASS (${warnings.length} warnings)`);
process.exitCode = problems.length ? 1 : 0;

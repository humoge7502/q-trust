import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The hosted scanner service vendors the detector modules from the inspector so
 * it can deploy without the full package (and its optional dependencies). If a
 * fix lands in `inspector/qtrust_inspector` but not in the vendored copy, the
 * hosted and CLI scan paths drift silently. This test makes that drift loud.
 */
const VENDORED_MODULES = [
  "models.py",
  "source_scanner.py",
  "ast_scanner.py",
  "manifest_scanner.py",
  "binary_scanner.py",
];

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("scanner-service vendored modules", () => {
  it.each(VENDORED_MODULES)("%s is byte-identical to the inspector source", (file) => {
    const upstream = readFileSync(`${REPO_ROOT}inspector/qtrust_inspector/${file}`);
    const vendored = readFileSync(`${REPO_ROOT}scanner-service/lib/qtrust_inspector/${file}`);
    expect(vendored.equals(upstream), `${file} drifted from inspector/qtrust_inspector`).toBe(true);
  });

  it("keeps the vendored package importable without the full inspector", () => {
    const init = readFileSync(`${REPO_ROOT}scanner-service/lib/qtrust_inspector/__init__.py`, "utf8");
    expect(init).toContain("from .models import AssetFinding, ScanResult");
    expect(init).not.toContain("from .cli");
  });
});

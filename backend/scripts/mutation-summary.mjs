// Summarizes a Stryker mutation report into the GitHub Actions step summary.
//
// Run from the backend working directory:
//   node scripts/mutation-summary.mjs >> "$GITHUB_STEP_SUMMARY"
//
// Exits 0 even when no report is produced (the gate itself is the Stryker
// threshold in stryker.config.json, not this display step).
import { readFileSync, existsSync } from "node:fs";

const file = "reports/mutation/certification.json";

if (!existsSync(file)) {
  console.log("No mutation report produced.");
  process.exit(0);
}

const report = JSON.parse(readFileSync(file, "utf8"));
const mutants = Object.values(report.files).flatMap((f) => f.mutants ?? []);
const by = (s) => mutants.filter((m) => m.status === s);
const killed = by("Killed").length + by("Timeout").length;
const survived = by("Survived");
const uncovered = by("NoCoverage").length;
const ignored = by("Ignored").length;
const scored = mutants.length - uncovered - ignored;
const pct = scored ? ((killed / scored) * 100).toFixed(2) : "n/a";
const allPct = mutants.length ? ((killed / mutants.length) * 100).toFixed(2) : "n/a";

console.log(`## Mutation score: ${pct}% of in-scope mutants killed (${killed}/${scored})`);
console.log(
  `\n${allPct}% of all ${mutants.length} generated mutants (${uncovered} had no coverage, ${ignored} ignored, ${survived.length} survived).`,
);

const list = [...survived].sort(
  (a, b) => (a.location?.start?.line ?? 0) - (b.location?.start?.line ?? 0),
);
const rows = list.slice(0, 30).map((m) => {
  // Escape for a markdown table cell — backslashes FIRST, then pipes and
  // newlines (CodeQL js/incomplete-string-escaping: replacing pipes before
  // backslashes would let an input backslash un-escape a produced pipe).
  const replacement = String(m.replacement ?? "")
    .slice(0, 80)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
  return `| ${m.mutatorName} | ${m.location?.start?.line ?? "?"} | \`${replacement}\` |`;
});
if (rows.length) {
  console.log("\n| Mutator | Line | Replacement |\n|---|---|---|\n" + rows.join("\n"));
}
if (list.length > rows.length) {
  console.log(`\n…and ${list.length - rows.length} more in the uploaded artifact.`);
}

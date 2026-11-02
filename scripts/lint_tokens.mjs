#!/usr/bin/env node
/**
 * Design-token ratchet gate (hallmark Floor rule 1 / sloplint gate 48).
 *
 * Every colour in `frontend/src` should resolve through a semantic token
 * (a `:root`/`@theme` custom property), not a raw Tailwind palette utility
 * like `text-slate-600` or `bg-[#f4f5f2]`. Raw utilities defeat theming,
 * dark mode, and contrast guarantees — and they drift back in faster than
 * anyone removes them.
 *
 * This gate is a RATCHET: it records the current raw-palette count in
 * `.hallmark/token-baseline.json` and fails only when the count *increases*.
 * That lets the codebase stay green today while making the debt strictly
 * non-growing; each cleanup PR lowers the baseline.
 *
 * Usage:
 *   node scripts/lint_tokens.mjs            # check (CI)
 *   node scripts/lint_tokens.mjs --update   # lower the baseline after cleanup
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "frontend/src");
const BASELINE = path.resolve(process.cwd(), ".hallmark/token-baseline.json");

// Raw Tailwind palette utilities: <property>-<colour>-<shade>.
const RE =
  /\b(?:bg|text|border|from|to|via|ring|outline|fill|stroke|decoration|placeholder|divide|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)\b/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...walk(p));
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

if (!fs.existsSync(ROOT)) {
  console.log("token-ratchet: frontend/src not found — skipping (not the repo root?)");
  process.exit(0);
}

let total = 0;
const byFile = new Map();
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, "utf8");
  const matches = text.match(RE);
  if (matches && matches.length) {
    total += matches.length;
    byFile.set(path.relative(process.cwd(), file), matches.length);
  }
}

const update = process.argv.includes("--update");
const prev = fs.existsSync(BASELINE)
  ? JSON.parse(fs.readFileSync(BASELINE, "utf8")).total
  : null;

const top = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

if (update || prev === null) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(
    BASELINE,
    JSON.stringify({ total, updatedAt: new Date().toISOString() }, null, 2) + "\n",
  );
  console.log(`token-ratchet: baseline written = ${total} raw palette classes`);
  process.exit(0);
}

if (total > prev) {
  console.error(
    `token-ratchet: FAIL — raw palette classes grew ${prev} -> ${total} (+${total - prev}).`,
  );
  console.error("Top offenders:");
  for (const [f, c] of top) console.error(`  ${c}\t${f}`);
  console.error(
    "\nFix: use a semantic token (e.g. text-muted-foreground, border-subtle) instead of a raw palette utility.",
  );
  process.exit(1);
}

if (total < prev) {
  console.log(
    `token-ratchet: OK — ${total} raw palette classes (down from ${prev}). Run with --update to lower the baseline.`,
  );
} else {
  console.log(`token-ratchet: OK — ${total} raw palette classes (at baseline).`);
}
process.exit(0);

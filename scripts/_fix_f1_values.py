#!/usr/bin/env python3
"""One-off consistency fix: correct the stale discovery F1 0.9525 -> 0.9395
(across precision/recall too) in all docs that present it as the achieved
number. REANALYSIS.md and GAP_ANALYSIS_REPORT.md are preserved because they
legitimately quote 0.9525 as the *corrected-from* value.

Canonical corrected values (source of truth: paper/REANALYSIS.md):
  F1 0.9395, precision 0.9279, recall 0.9514.
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Files that present 0.9525 as the *achieved* number and must be corrected.
TARGETS = [
    "README.md",
    "EXPERIMENTS.md",
    "FINAL_ENGINEERING_REPORT.md",
    "CHANGELOG.md",
    "PROJECT_SCORECARD.md",
    "RELEASE_CHECKLIST.md",
    "RISK_REGISTER.md",
    "docs/DEVELOPER_ROADMAP.md",
    "docs/essays/why-we-published-a-tie.md",
    "cbom-action/README.md",
]

# Preserve: paper/REANALYSIS.md, GAP_ANALYSIS_REPORT.md (quote 0.9525 as history).

# Ordered so 0.9525 is removed before the bare 0.952/0.953 precision/recall fixes.
TOKEN_MAP = [
    ("0.9525", "0.9395"),
    ("precision 0.952", "precision 0.9279"),
    ("P 0.952", "P 0.9279"),
    ("recall 0.953", "recall 0.9514"),
    ("R 0.953", "R 0.9514"),
    ("F1 0.952", "F1 0.9395"),
]

# Historical records that describe the 40-fold run: append a reconciliation note
# rather than rewriting the detailed experiment prose.
HISTORICAL_NOTE = (
    "\n\n> **Metric-correction note (2026-10-23):** the discovery F1 quoted above as "
    "`0.9525` was corrected to **0.9395** (P 0.9279 / R 0.9514) by the re-audit in "
    "`paper/REANALYSIS.md` (no threshold reaches 0.9525). Update any downstream value "
    "accordingly."
)
HISTORICAL_FILES = {
    "CHANGELOG.md", "RELEASE_CHECKLIST.md", "RISK_REGISTER.md",
}

changed = []
for rel in TARGETS:
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        print(f"SKIP (missing): {rel}")
        continue
    with io.open(p, encoding="utf-8") as f:
        text = f.read()
    before = text
    for old, new in TOKEN_MAP:
        c = text.count(old)
        if c:
            text = text.replace(old, new)
            print(f"  {rel}: {old!r} -> {new!r}  (x{c})")
    if text != before:
        with io.open(p, "w", encoding="utf-8") as f:
            f.write(text)
        changed.append(rel)

# Append reconciliation note to the historical records (only once).
for rel in HISTORICAL_FILES:
    p = os.path.join(ROOT, rel)
    with io.open(p, encoding="utf-8") as f:
        text = f.read()
    if "Metric-correction note (2026-10-23)" not in text:
        with io.open(p, "a", encoding="utf-8") as f:
            f.write(HISTORICAL_NOTE)
        print(f"  NOTE appended: {rel}")

print("\nChanged files:", changed)
# Sanity: no 0.9525 should remain in any target (except the two preserved docs).
leftover = []
for rel in TARGETS:
    p = os.path.join(ROOT, rel)
    with io.open(p, encoding="utf-8") as f:
        if "0.9525" in f.read():
            leftover.append(rel)
print("Leftover 0.9525 in targets:", leftover)
sys.exit(1 if leftover else 0)

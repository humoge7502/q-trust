#!/usr/bin/env python3
"""
Metric consistency gate for the Q-Trust project.

Authoritative source of truth: the on-disk artifact files plus paper/REANALYSIS.md.
This script fails CI if:
  (a) a headline JSON artifact contradicts its reconciled value — either the
      legacy v1 record (0.9395, leaky) or the clean v4 headline (0.9205 at the
      selected 0.50 gate) — or
  (b) a document asserts the stale discovery F1 (0.9525) as a *result*, or
  (c) a document claims the planner *outperforms* the doctrine heuristic
      (it ties; tau_b 0.71 vs 0.72, delta is negative / within noise).

It deliberately does NOT force a single LOO number: the project legitimately
reports two different leave-one-out conditions (the paper's clean-warm-start
variant at tau_b 0.7168, and the full 40-fold real-CBOM run at 0.7263). Both are
allowed as long as they are not mislabelled as "outperforming".

Run: python scripts/verify_metric_consistency.py
Exits non-zero on any contradiction.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Legacy v1 artifact values (paper/REANALYSIS.md). Retained because those
# artifacts are historical records; they are NOT the clean detector claim
# (87.6 % of the v1 eval paths were in training — E-14 leakage audit).
CANON_DISCOVERY_F1 = 0.9395
CANON_DISCOVERY_P = 0.9279
CANON_DISCOVERY_R = 0.9514

# Clean v4 headline (E-14/E-15/E-16): de-duplicated pinned digest split,
# selected 0.50 ML gate, zero train/eval path overlap.
CLEAN_V4_F1 = 0.9205
CLEAN_V4_RAW_F1 = 0.9144
CLEAN_V4_GATE = 0.5

# Strings that must not appear as a *claimed result* in docs.
# 0.9525 is the pre-reanalysis discovery F1 (never reproduced).
FORBIDDEN_RESULT_STRINGS = ["0.9525"]

# Planner does not outperform the doctrine heuristic; it ties it.
FORBIDDEN_PHRASES = ["outperform"]

# Files whose mention of the forbidden strings is a legitimate correction note.
ALLOW_NOTE_FILES = {
    os.path.join(ROOT, "GAP_ANALYSIS_REPORT.md"),
    os.path.join(ROOT, "paper", "REANALYSIS.md"),
}

# Artifacts that must carry the canonical headline numbers.
ARTIFACT_CHECKS = [
    (os.path.join(ROOT, "qtrust_ai", "artifacts", "benchmark_comparison.json"),
     {"comparisons[0].qtrust.f1": CANON_DISCOVERY_F1}),
    (os.path.join(ROOT, "qtrust_ai", "artifacts", "training_report_real.json"),
     {"results[0].train._eval.f1": CANON_DISCOVERY_F1}),
    # Clean v4 headline: the de-duplicated pinned view at the selected gate,
    # plus the raw view so a gate/dedupe regression is caught in CI.
    (os.path.join(ROOT, "qtrust_ai", "artifacts", "eval_dedup_v4.json"),
     {"gate": CLEAN_V4_GATE,
      "policies.keep_longest.f1": CLEAN_V4_F1,
      "policies.raw.f1": CLEAN_V4_RAW_F1}),
    # E-09 outcome LOO canonical values (added 2026-10-24): the GNN attains
    # the QRD optimum out-of-sample; the heuristic leaves ~4.7% excess.
    (os.path.join(ROOT, "planner", "results", "outcome_loo_42.json"),
     {"aggregate_qrd_ratio.gnn.mean": 1.0}),
]

# Figures that are real ONLY under synthetic labels and must be qualified
# wherever they appear in prose (2026-10-24: the README carried the
# synthetic-only tau 0.975 unqualified in five places; this check keeps
# that class of drift out of the docs permanently).
SYNTHETIC_ONLY_FIGURES = {"0.975": "synthetic-scale held-out tau_b"}


def deep_get(d, path):
    cur = d
    for part in path.split("."):
        m = re.match(r"([^\[]+)(?:\[(\d+)\])?$", part)
        key = m.group(1)
        idx = m.group(2)
        if key:
            cur = cur[key]
        if idx is not None:
            cur = cur[int(idx)]
    return cur


def check_artifacts():
    problems = []
    for path, fields in ARTIFACT_CHECKS:
        if not os.path.exists(path):
            problems.append(f"MISSING artifact: {path}")
            continue
        with open(path) as f:
            data = json.load(f)
        for dotted, expected in fields.items():
            try:
                val = deep_get(data, dotted)
            except Exception as e:  # noqa
                problems.append(f"{path}: cannot read {dotted} ({e})")
                continue
            if abs(val - expected) > 1e-6:
                problems.append(
                    f"{path}: {dotted} = {val} but canonical is {expected}")
    return problems


def correction_window(text, pos, before=120):
    start = max(0, pos - before)
    return text[start:pos]


def context_window(text, pos, before=140, after=140):
    """Symmetric window around a figure — used by checks that qualify a
    figure with words that naturally FOLLOW it ("0.975 (synthetic)")."""
    start = max(0, pos - before)
    return text[start:min(len(text), pos + after)]


def check_docs():
    problems = []
    for dirpath, dirs, files in os.walk(ROOT):
        if "node_modules" in dirpath or ".git" in dirpath:
            continue
        for fn in files:
            if not fn.endswith(".md"):
                continue
            full = os.path.join(dirpath, fn)
            if full in ALLOW_NOTE_FILES:
                continue
            try:
                text = open(full, encoding="utf-8", errors="ignore").read()
            except Exception:
                continue
            # (b) stale F1 as a result
            for bad in FORBIDDEN_RESULT_STRINGS:
                for m in re.finditer(re.escape(bad), text):
                    w = correction_window(text, m.start())
                    if re.search(r"was\s+" + re.escape(bad) + r"\b", w):
                        continue
                    if "no threshold reaches" in w:
                        continue
                    if "correction" in w.lower() or "re-audit" in w.lower() \
                            or "not reproduced" in w.lower():
                        continue
                    problems.append(
                        f"{full}: stale F1 '{bad}' asserted as a result "
                        f"(context: ...{w[-80:]})")
            # (c) planner outperforms
            for phrase in FORBIDDEN_PHRASES:
                for m in re.finditer(re.escape(phrase), text, re.IGNORECASE):
                    w = correction_window(text, m.start())
                    # Same correction-context exemption as the F1 check above:
                    # an audit/scorecard note that *documents forbidding* an
                    # overclaim is not itself an overclaim.
                    if "correction" in w.lower() or "re-audit" in w.lower() \
                            or "not reproduced" in w.lower() \
                            or "forbid" in w.lower() or "does not" in w.lower():
                        continue
                    problems.append(
                        f"{full}: planner claim '{phrase}' — planner TIES the "
                        f"doctrine (tau_b ~0.71 vs 0.72), it does not outperform "
                        f"(context: ...{w[-60:]})")
            # (d) synthetic-only figures must be qualified as such
            for figure, meaning in SYNTHETIC_ONLY_FIGURES.items():
                for m in re.finditer(re.escape(figure), text):
                    w = context_window(text, m.start())
                    if "correction" in w.lower() or "re-audit" in w.lower():
                        continue
                    if "synthetic" not in w.lower():
                        problems.append(
                            f"{full}: figure '{figure}' ({meaning}) appears "
                            f"without a 'synthetic' qualifier in its context — "
                            f"real-estate LOO is tau_b 0.7168 (tie at the tie "
                            f"ceiling) and the outcome-based result is E-09 "
                            f"(context: ...{w[-80:]})")
    return problems


def main():
    problems = []
    problems += check_artifacts()
    problems += check_docs()
    if problems:
        print("METRIC CONSISTENCY: FAIL")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print(f"METRIC CONSISTENCY: PASS "
          f"(legacy v1 F1={CANON_DISCOVERY_F1}, P={CANON_DISCOVERY_P}, "
          f"R={CANON_DISCOVERY_R}; clean v4 F1={CLEAN_V4_F1} at gate "
          f"{CLEAN_V4_GATE}; no stale-F1 or 'outperform' claims)")
    sys.exit(0)


if __name__ == "__main__":
    main()

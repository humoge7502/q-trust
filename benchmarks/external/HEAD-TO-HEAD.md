# Head-to-head: Q-Trust detector on public crypto benchmarks

Measured 2026-09-18 with the deterministic scanner layers
(`CryptoCodeDetector(seed=42)`, static + AST — no HF weights), via
`scan_file` per case file. Raw per-file records:
`results/cryptobench_filelevel.json`, `results/apache_filelevel.json`.

## CryptoAPI-Bench (203 Java files: 187 misuse, 16 secure)

| Metric | Value |
|---|---|
| Usage recall on misuse files | **164/187 = 0.877** |
| Flag rate on secure (`*Corrected`) files | 12/16 = 0.750 |
| File-level misuse precision | 164/176 = **0.932** |

Reading guide: this tool detects crypto **usage**, not misuse. Flagging a
`*Corrected` file is correct behavior for a usage detector (the file uses
crypto, correctly) — the 0.750 is reported for completeness, not as a
false-positive rate. Misses cluster in credential/HTTP/password categories
(`CredentialInString`, `HttpProtocol*`, `Predictable*Password`) that contain
no crypto API surface — outside a usage detector's scope by definition.

## ApacheCryptoAPI-Bench (121 cases, 71 mapped)

Only 71/121 cases map to files in the 8 shipped `-sources.jar`s; 50 case
files are absent from this source subset and are **unevaluable here**
(stated, not zero-filled).

| Metric | Value |
|---|---|
| Recall (TP cases flagged) | **33/34 = 0.971** |
| File-level precision | 33/62 = **0.532** |
| File-level F1 | **0.688** |

The 29 FPs are a file-level artifact: TN *lines* live in files that contain
real crypto elsewhere, which a usage detector correctly flags. Line-level
scoring was attempted and **rejected**: ground-truth line numbers do not
match the jar sources (e.g. GT-line 26 vs actual call at line 50 — version
drift proven per case), so line-level numbers would be invalid either way.

## Relation to published SOTA — no superiority claim

CryptoGuard/CogniCrypt (~80%+ P/R) and GPT-4 (0.87P/0.90R) are measured on
**misuse detection** over crafted cases — a related but different task from
usage discovery. These numbers are published so others can compare, not as a
"we beat X" claim. A misuse-discrimination head-to-head needs misuse-labeled
ground truth mapped to this detector's finding semantics — open follow-up.

## Reproduce

```bash
python3 - <<'EOF'
import sys, glob
sys.path.insert(0, 'qtrust_ai'); sys.path.insert(0, '.')
from qtrust_ai.discovery.code_detector import CryptoCodeDetector
det = CryptoCodeDetector(seed=42)
files = sorted(glob.glob(
    'benchmarks/external/CryptoAPI-Bench/src/main/java/**/*.java',
    recursive=True))
print(len(files), 'files,',
      sum(bool(det.scan_file(f)) for f in files), 'flagged')
EOF
```

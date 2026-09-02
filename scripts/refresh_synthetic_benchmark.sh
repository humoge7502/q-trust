#!/usr/bin/env bash
# Regenerate the canonical synthetic benchmark (results/benchmark_v3.json)
# after retraining the flagship v3 / v2 reference checkpoints on the current
# (corrected) synthetic data pool, then verify the CI promotion gate and
# refresh models.sha256 for the new binary blobs.
#
# Why this exists: the committed checkpoints predate the ML-DSA parameter-set
# rename (441/659/877 -> 44/65/87, final FIPS 204 names) and the hardened
# algorithm encoder, so evaluating them under current code no longer matches
# the recorded canonical numbers. Retrain first, then run this.
set -euo pipefail
cd "$(dirname "$0")/.."

cd planner
echo "== Re-recording results/benchmark_v3.json under current code =="
python -m qtrust_planner.benchmark_v3 --n-graphs 1000 --json-out results/benchmark_v3.json

echo
echo "== Promotion gate: fresh v3 must beat canonical v2 =="
python - <<'PY'
import json
fresh = json.load(open("results/benchmark_v3.json"))
v3 = fresh["v3 (GPU-trained, 256-dim)"]["kendall"]
v2 = fresh["v2 (1.2K graphs, 64-dim)"]["kendall"]
print(f"v3 kendall = {v3:.4f}  v2 kendall = {v2:.4f}  delta = {v3 - v2:+.4f}")
assert v3 > v2, f"promotion gate FAILED: v3 {v3:.4f} does not beat v2 {v2:.4f}"
print("promotion gate passed")
PY
cd ..

echo
echo "== Refreshing models.sha256 for the new checkpoints =="
./scripts/verify_models.sh --update
./scripts/verify_models.sh

echo
echo "== Fresh headline numbers (for README/docs) =="
python - <<'PY'
import json
d = json.load(open("planner/results/benchmark_v3.json"))
for k, v in d.items():
    if isinstance(v, dict) and "kendall" in v:
        metas = {kk: vv for kk, vv in v.items() if kk.startswith("meta_")}
        print(f"{k}: kendall={v['kendall']:.4f} top5={v.get('top5')} device={v.get('device')} {metas}")
PY

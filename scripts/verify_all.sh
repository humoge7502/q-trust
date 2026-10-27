#!/usr/bin/env bash
# Q-Trust full-stack verification. Run from the repo root.
# Verifies: contracts, SDK (unit + E2E), inspector, planner benchmark, backend,
# frontend, pilot, notebooks. Fails loudly if any check fails.
#
# TD-05 (2026-10-23): the formerly-serial ~20-minute pipeline now runs as
# three independent lanes started concurrently — (A) contracts + on-chain
# E2E + pilot, (B) Python suites + notebooks, (C) Node builds + audits —
# aggregated at the end. Every anvil user stays inside lane A so no two
# lanes contend for port 8545. Wall-clock ≈ the slowest lane instead of the
# sum of all stages. Set VERIFY_ALL_SERIAL=1 for the original behaviour.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; }

# Notebook location moved to research/notebooks per Blueprint §5.1 — handle
# both old and new paths (used by lanes A and B).
NB_DIR="$ROOT/notebooks"
if [ ! -d "$NB_DIR" ] && [ -d "$ROOT/research/notebooks" ]; then NB_DIR="$ROOT/research/notebooks"; fi
export NB_DIR

lane_a() {  # contracts + on-chain flows (owns anvil :8545 sequentially)
  echo "==> [1/9] Contracts (forge build + test)"
  (cd "$ROOT/contracts" && forge build > /dev/null && forge test 2>&1 | tail -1 | grep -q "tests passed") \
    && pass "forge build + all tests pass" || fail "contracts"

  echo "==> [3/9] SDK E2E (fresh anvil + deploy)"
  "$ROOT/sdk/tests/run_e2e.sh" 2>&1 | tail -1 | grep -q "ALL E2E CHECKS PASSED" \
    && pass "sdk E2E" || fail "sdk E2E"

  echo "==> [9/9] Pilot + bank-pilot notebook (fresh anvil + deploy)"
  setsid anvil --host 127.0.0.1 --port 8545 --chain-id 84532 > /tmp/qtrust-anvil-pilot.log 2>&1 < /dev/null &
  ANVIL_PID=$!
  sleep 3
  DEPLOY_LOG=$(mktemp)
  # QTRUST_DEV_GRANTEE grants the deployer (account 0, the pilot's default
  # signing account) the REGISTRAR/operational roles, exactly as the SDK E2E
  # does — otherwise the pilot cannot register the scanned CBOM on-chain.
  (cd "$ROOT/contracts" && \
    QTRUST_DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" \
    QTRUST_DEV_GRANTEE="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" \
    forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast 2>&1 | tee "$DEPLOY_LOG")
  export QTRUST_ASSET_REGISTRY_ADDRESS="$(grep 'AssetRegistry proxy:' "$DEPLOY_LOG" | awk '{print $NF}')"
  export QTRUST_VENDOR_REGISTRY_ADDRESS="$(grep 'VendorRegistry proxy:' "$DEPLOY_LOG" | awk '{print $NF}')"
  export QTRUST_MIGRATION_REGISTRY_ADDRESS="$(grep 'MigrationRegistry proxy:' "$DEPLOY_LOG" | awk '{print $NF}')"
  export QTRUST_AUDIT_REGISTRY_ADDRESS="$(grep 'AuditRegistry proxy:' "$DEPLOY_LOG" | awk '{print $NF}')"
  # The pilot refuses to run without an explicit deployer key against local
  # anvil; export it (plus the RPC) so the pilot subshell sees them.
  export QTRUST_DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  rm -f "$DEPLOY_LOG"
  (cd "$ROOT/pilot" && python run_pilot.py > /tmp/qtrust-pilot-debug.log 2>&1; \
    s=$?; tail -30 /tmp/qtrust-pilot-debug.log | grep -q "PILOT COMPLETE" && s=0; exit $s) \
    && pass "pilot" || fail "pilot"
  jupyter nbconvert --to notebook --execute "$NB_DIR/08_bank_pilot.ipynb" --output /tmp/qtrust_nb8.ipynb > /dev/null 2>&1 \
    && pass "notebooks (08 bank pilot)" || fail "notebooks (08)"
  kill "$ANVIL_PID" 2>/dev/null || true
}

lane_b() {  # Python suites + notebooks
  echo "==> [2/9] SDK unit tests"
  (cd "$ROOT/sdk" && python -m pytest -q > /dev/null 2>&1) && pass "sdk pytest" || fail "sdk unit"

  echo "==> [4/9] Inspector tests"
  (cd "$ROOT/inspector" && python -m pytest -q > /dev/null 2>&1) && pass "inspector pytest" || fail "inspector"

  echo "==> [5/9] Planner benchmark (multi-seed, honest metrics)"
  (cd "$ROOT/planner" && python -m qtrust_planner.benchmark --seeds 42 43 44 --epochs 10 \
    --out-dir /tmp/qtrust-bench-verify-lane-b > /dev/null 2>&1) \
    && pass "planner benchmark" || fail "planner benchmark"

  echo "==> [8/9] Notebooks execute"
  jupyter nbconvert --to notebook --execute "$NB_DIR/01_quantum_threat_demo.ipynb" --output /tmp/qtrust_nb1.ipynb > /dev/null 2>&1 \
    && pass "notebooks (01 quantum demo)" || fail "notebooks (01)"
}

lane_c() {  # Node builds + dependency audits
  echo "==> [6/9] Backend build (tsc)"
  (cd "$ROOT/backend" && npm run build > /dev/null 2>&1) && pass "backend build" || fail "backend build"

  echo "==> [7/9] Frontend build (next)"
  # A non-'demo' project ID makes wagmi happy even in production builds; CI
  # uses the same all-zeros placeholder (0000...0000).
  (cd "$ROOT/frontend" && NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="00000000000000000000000000000000" \
    npm run build > /dev/null 2>&1) && pass "frontend build" || fail "frontend build"

  echo "==> [bonus] Dependency audit (npm)"
  (cd "$ROOT/backend" && npm audit --omit dev 2>&1 | tail -3) && pass "backend npm audit" || fail "backend npm audit"
  (cd "$ROOT/frontend" && npm audit --omit dev 2>&1 | tail -3) && pass "frontend npm audit" || fail "frontend npm audit"
}

if [[ "${VERIFY_ALL_SERIAL:-0}" == "1" ]]; then
  LOG_A=$(mktemp /tmp/qtrust-verify-a.XXXXXX.log)
  LOG_B=$(mktemp /tmp/qtrust-verify-b.XXXXXX.log)
  LOG_C=$(mktemp /tmp/qtrust-verify-c.XXXXXX.log)
  lane_a 2>&1 | tee "$LOG_A"
  lane_b 2>&1 | tee "$LOG_B"
  lane_c 2>&1 | tee "$LOG_C"
  echo
  FAILED=$(cat "$LOG_A" "$LOG_B" "$LOG_C" | grep -c "^FAIL:" || true)
  rm -f "$LOG_A" "$LOG_B" "$LOG_C"
else
  LOG_A=$(mktemp /tmp/qtrust-verify-a.XXXXXX.log)
  LOG_B=$(mktemp /tmp/qtrust-verify-b.XXXXXX.log)
  LOG_C=$(mktemp /tmp/qtrust-verify-c.XXXXXX.log)
  lane_a > "$LOG_A" 2>&1 & PID_A=$!
  lane_b > "$LOG_B" 2>&1 & PID_B=$!
  lane_c > "$LOG_C" 2>&1 & PID_C=$!
  wait $PID_A $PID_B $PID_C
  echo "── lane A (contracts + on-chain) ──"; cat "$LOG_A"
  echo "── lane B (python) ────────────────"; cat "$LOG_B"
  echo "── lane C (node builds + audits) ──"; cat "$LOG_C"
  FAILED=$(cat "$LOG_A" "$LOG_B" "$LOG_C" | grep -c "^FAIL:" || true)
  rm -f "$LOG_A" "$LOG_B" "$LOG_C"
fi

echo
if [ "${FAILED:-0}" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "ONE OR MORE CHECKS FAILED"
  exit 1
fi

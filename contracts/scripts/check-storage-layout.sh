#!/usr/bin/env bash
# UUPS storage-layout guard (SEC-05).
#
# UUPS proxies keep state in the proxy's storage. Reordering, retyping, or
# removing a storage variable in an upgrade silently corrupts existing state —
# and nothing in forge test detects it. This script snapshots each contract's
# storage layout and fails if it changes without an explicit baseline update.
#
# Usage:
#   bash scripts/check-storage-layout.sh            # check (CI)
#   bash scripts/check-storage-layout.sh --update   # re-baseline after an
#                                                   # intentional, reviewed change
set -euo pipefail
cd "$(dirname "$0")/.."

CONTRACTS=(
  AssetRegistry VendorRegistry MigrationRegistry AuditRegistry
  ComplianceAttestation EvidenceRegistry RevocationAnchor PolicyCommitment
  SchemaRegistry TrustAnchorRegistry QTrustGovernance
)
SNAP="storage-layout.snapshot.json"

generate() {
  local out="$1"
  : > "$out"
  for c in "${CONTRACTS[@]}"; do
    echo "### $c" >> "$out"
    # --json prints a stable object; sort keys so field order can't cause noise.
    forge inspect "$c" storageLayout --json 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=x=>JSON.stringify(x,Object.keys(x||{}).sort());console.log(JSON.stringify({storage:o.storage,types:o.types},null,2))}catch(e){console.log("(no layout)")}})' \
      >> "$out" || echo "(inspect failed)" >> "$out"
  done
}

if [ "${1:-}" = "--update" ] || [ ! -f "$SNAP" ]; then
  generate "$SNAP"
  echo "storage-layout: baseline written to $SNAP (commit it)."
  exit 0
fi

TMP="$(mktemp)"
generate "$TMP"
if ! diff -q "$SNAP" "$TMP" >/dev/null; then
  echo "storage-layout: FAIL — a contract's storage layout changed."
  echo "This is a UUPS upgrade hazard: existing proxy state may be corrupted."
  echo "If the change is intentional and migration-safe, re-run with --update."
  echo "--- diff (first 40 lines) ---"
  diff "$SNAP" "$TMP" | head -40 || true
  rm -f "$TMP"
  exit 1
fi
rm -f "$TMP"
echo "storage-layout: OK — unchanged."

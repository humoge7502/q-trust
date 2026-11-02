#!/usr/bin/env python3
"""Local fallback for POST /v1/scan/repo: scan a base64 archive with scan_core.

Used when QTRUST_SCANNER_SERVICE_URL is not configured and the backend runs on
an operator machine (the hosted/scanner-service path is preferred). Reads a
JSON payload file, writes the same JSON the hosted service returns.

Usage:
    python3 run_archive_scan.py --payload <payload.json>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan an uploaded archive with the hosted scan core.")
    parser.add_argument("--payload", required=True, help="Path to a JSON payload file")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    lib = repo_root / "scanner-service" / "lib"
    if lib.is_dir() and str(lib) not in sys.path:
        sys.path.insert(0, str(lib))

    try:
        from scan_core import ValidationError, scan_payload
    except ImportError as exc:
        print(json.dumps({"error": f"scanner core unavailable: {exc}", "status": 503}))
        return 3

    try:
        payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": f"unreadable payload: {exc}", "status": 400}))
        return 2

    try:
        result = scan_payload(payload)
    except ValidationError as exc:
        print(json.dumps({"error": exc.detail, "status": 422}))
        return 4
    except Exception as exc:  # noqa: BLE001 - surface any scan failure as JSON
        print(json.dumps({"error": f"scan failed: {exc}", "status": 500}))
        return 5

    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

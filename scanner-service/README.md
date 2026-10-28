# Q-Trust scanner service

Hosted execution for the `qtrust_inspector` detectors. The Node backend fetches
a public repository tarball, forwards it here as base64, and this service
extracts it into a throwaway directory and runs the same source/AST/manifest/
binary scanners as `backend/scripts/run_inspector.py`.

The five scanner modules in `lib/qtrust_inspector/` are vendored byte-identical
from `inspector/qtrust_inspector/`; `backend/tests/scanner-service-sync.test.ts`
fails if they drift.

## Endpoints

- `GET /api/health` — public readiness probe with the configured archive cap.
- `POST /api/scan` — requires `x-api-key: $QTRUST_SCANNER_API_KEY`.

```json
{
  "scan_type": "source | manifests | full",
  "archive_format": "tar.gz | zip",   // optional, sniffed from the magic bytes
  "archive_b64": "<base64 archive>"
}
```

Response: `{"findings": [...], "files_scanned": N, "detector": {...}?}` where
each finding matches the backend's `AssetFinding` contract.

## Limits

| Limit | Default | Env override |
|---|---|---|
| Archive bytes | 3 MiB | `QTRUST_SCANNER_MAX_ARCHIVE_BYTES` |
| Extracted bytes | 64 MiB | `QTRUST_SCANNER_MAX_EXTRACTED_BYTES` |
| File count | 5,000 | `QTRUST_SCANNER_MAX_FILES` |
| Per-file bytes | 8 MiB | — |

Extraction skips symlinks, hardlinks, device nodes, absolute paths, `..`
segments, and Windows drive-letter names. `QTRUST_SCANNER_API_KEY` is required;
an unset key rejects every request (fail closed).

## Local use

```bash
python -m pytest scanner-service/tests -q
```

## Deploy

```bash
cd scanner-service
vercel link --yes --project qtrust-scanner
vercel env add QTRUST_SCANNER_API_KEY production
vercel deploy --prod --yes
```

Then set `QTRUST_SCANNER_SERVICE_URL` and the same `QTRUST_SCANNER_API_KEY` on
the backend project so `/v1/scan/repo` can reach it.

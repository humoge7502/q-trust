# Q-Trust planner service (durable)

The production planner. Serves the canonical v3 GNN and RL agent through ONNX
Runtime, so planning does not depend on an operator laptop or a Cloudflare
quick tunnel.

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/health` | public | model + integrity status |
| `POST /api/plan` | `x-api-key` | GNN-ranked migration order (+ optional deadline schedule) |
| `POST /api/plan/deadline` | `x-api-key` | alias of `/plan` |
| `POST /api/rl/plan` | `x-api-key` | RL-policy order, honest `method` label |

Request/response shapes match `planner/server.py` exactly; the backend sets
`QTRUST_PLANNER_URL` to this service's `/api` base.

## Model provenance

`lib/manifest.json` pins the ONNX bytes by SHA-256 and records the source
checkpoint, config and metrics. `lib/planner_core.py` verifies the hash at cold
start and refuses to serve on mismatch (the same fail-closed rule as TM-PL-02).
Symmetric estates can tie exactly; torch and ONNX Runtime may break such ties
differently at the 1e-6 level. The parity suite asserts score equivalence and
requires exact order wherever the reference has a real margin.

## Regenerate the artifacts

From the repository root, with the planner environment (torch +
torch-geometric + onnx installed):

```bash
python planner-service/scripts/export_onnx.py
```

## Tests

```bash
python -m pytest planner-service/tests -q
```

Runs every real CBOM fixture through both the torch planner and this service and
compares ordering, scores, schedule and response fields.

## Deploy

```bash
vercel --prod --cwd planner-service
```

Set the environment variable `QTRUST_PLANNER_API_KEY` in the Vercel project
(the same value the backend holds). Without it the service fails closed (401 on
inference routes).

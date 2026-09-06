# Performance Benchmarks

Real load-test results against a fully-wired local stack: Fastify API →
Postgres/Redis read model → anvil (Base Sepolia fork, all 8 registry
proxies deployed) → on-chain reads.

## k6 Stress Test

- **Script:** [`ops/loadtest/k6-stress.js`](https://github.com/humoge7502/q-trust/blob/main/ops/loadtest/k6-stress.js)
  (10→100 VUs over 5 minutes; mixed workload — health checks, unknown-asset
  404 probes, paginated org queries)
- **Date:** 2026-08-24
- **Target:** `http://127.0.0.1:3210` (backend dev server via tsx)
- **Environment:** 24-core x86_64 · 1.7 TB RAM · NVIDIA A100-SXM4-80GB ·
  Linux 6.x · Node 20 (tsx), Postgres 16, Redis 7, anvil single node

### Results (100 VUs sustained)

| Metric | Value | Threshold | Status |
|---|---|---|---|
| Requests/sec | **147.8** | — | — |
| Total requests (5 min) | 44,592 | — | — |
| p50 latency | 1.84 ms | — | — |
| p95 latency | **11.27 ms** | < 800 ms | ✅ |
| p90 latency | 5.75 ms | — | — |
| Health-route p95 | **5.02 ms** | < 100 ms | ✅ |
| Health failure rate | 0.00% | < 2% | ✅ |
| Org-assets failure rate | 0.00% | < 2% | ✅ |
| Checks succeeded | 100% (29,728/29,728) | > 98% | ✅ |

Smoke run (`k6-smoke.js`, 10 VUs / 60 s): p95 = 10.6 ms, 600/600 checks ✓.

## Notes on methodology

- The global rate limiter was disabled for the run
  (`QTRUST_RATE_LIMIT_MAX=0`); at the default 120 req/min per IP, k6's
  100-VU swarm from one source address is throttled by design. Real traffic
  arrives from many IPs.
- The `assets` probe intentionally requests a nonexistent asset to exercise
  the 404 fast path; thresholds are scoped per tag so deliberate 404s do not
  count against failure budgets.
- Numbers are from a development-grade process (`tsx`, no dist build) on the
  same host as the chain and stores — production builds behind a proxy
  should do at least as well on latency and better on throughput.

## Reproduce

```bash
# 1. Local chain + contracts
anvil --port 8545 --chain-id 84532 &
cd contracts && QTRUST_DEPLOYER_PRIVATE_KEY=0xac09...ff80 \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# 2. Backend (rate limiter off for the test)
QTRUST_BASE_SEPOLIA_RPC=http://127.0.0.1:8545 \
QTRUST_ASSET_REGISTRY_ADDRESS=0x... \
QTRUST_RATE_LIMIT_MAX=0 npm run dev   # in backend/

# 3. Load
k6 run --env BASE_URL=http://127.0.0.1:3001 ops/loadtest/k6-stress.js
```

## GPU feature latencies (A100-SXM4-80GB)

Measured through the Python bridge directly (`backend/scripts/gpu_bridge.py`):

| Operation | Latency |
|---|---|
| Side-channel analysis, 5,000 traces (trained CNN+LSTM) | ~2 s end-to-end |
| CBOM anomaly scoring (VAE forward) | ~3 s cold start (model load + torch init), <100 ms inference |
| Shor order-finding, N=35 (18-qubit circuit, CPU Aer) | 0.78 s |
| Quantum order-finding, N=77 (a=2, r=30 verified) | 3.0 s |
| GNN v3 evaluation, 150 graphs | 1.6 s |

## Planner microservice latency (`/plan`, 2026-09-06)

Measured against the shipped `model_real_v3.pt` GNN checkpoint, single
uvicorn worker, sequential requests (150 samples per size after 5 warmups),
same host as the service. The validation gate (`_parse_assets`, added in the
adversarial-API pass) runs before feature construction; no regression was
measured from it.

| CBOM assets | p50 | p95 | max |
|---|---|---|---|
| 50 | 28.0 ms | 43.2 ms | 50.9 ms |
| 500 | 67.0 ms | 281.9 ms | 537.4 ms |
| 2,000 | 123.3 ms | 337.2 ms | 346.8 ms |

Reproduce: start the planner with `QTRUST_RATE_LIMIT_MAX` raised, then time
`POST /plan` with synthetic CBOMs (see `docs/TRUTH_AUDIT.md` for the benchmark
culture — no numbers in this repo are estimates).

# Q-Trust deployment status

_Last updated: 2026-10-21_

## Live now

| Component | Where | URL / reference |
|---|---|---|
| Frontend | Vercel (`q-trust`, team `devesh-tiwari-p-projects1`) | https://q-trust-nu.vercel.app |
| Backend API | **Vercel serverless** (`qtrust-backend`) — Fastify bridge at `backend/api/index.mjs` | https://qtrust-backend.vercel.app/api |
| Indexer | Docker on this machine (`qtrust-api`), writing to hosted Postgres | polls every 4 s; reorg check still runs |
| Python scanner + evidence chain | Docker on this machine, exposed through a Cloudflare quick tunnel; the hosted API proxies `/v1/scan/*` and `/v1/evidence/*` there | see `QTRUST_SCANNER_PROXY_URL` in `.env` |
| ML bridge (side-channel, anomaly, RL, quantum) | Same `qtrust-api` container, CPU-only torch + copied model weights (`/opt/qtrust-models`) | hosted API proxies `/v1/gpu/*` to it |
| GNN planner (v3 + RL) | Docker on this machine (`qtrust-planner:2.2.0`), exposed with a second Cloudflare quick tunnel | see `QTRUST_PLANNER_TUNNEL_URL` in `.env` |
| Postgres (hosted) | Neon, provisioned through the Vercel Marketplace | resource `quiet-sound-15608005`; pooled URL in `frontend/.env.local`, unpooled in `.env` |
| Postgres (local) | Docker on this machine (fallback/demo only) | `qtrust-postgres` (127.0.0.1:5433) |
| Redis | Docker on this machine (local API only; the hosted API uses an in-memory webhook fallback) | `qtrust-redis` (127.0.0.1:6379) |
| Contracts | Base Sepolia (chain 84532) | see `deploy/logs/contracts-deploy.log` and `.env` |

Vercel Deployment Protection is **disabled** for the `q-trust` project so the
site is publicly reachable.

### How the hosted split works

- The backend runs as a single Vercel Function (`backend/api/index.mjs`). The
  function builds the same Fastify app as the Docker image
  (`backend/src/server.ts` exports `buildServer()`), never starts the indexer,
  and receives every request through one rewrite:
  `{"source":"/api/:path*","destination":"/api/index?__p=:path*"}`.
- Body parsing is disabled (`config.api.bodyParser = false`) so Fastify reads
  the raw request stream itself.
- `QTRUST_SCANNER_PROXY_URL` points at the local API tunnel. The hosted API
  forwards `/v1/scan/`, `/v1/evidence/`, and `/v1/gpu/` there, preserving the
  caller's `x-api-key`, so the local API enforces the same policy. Everything
  else runs on Vercel, including planner calls through `QTRUST_PLANNER_URL`.
- The local API container was switched to the hosted Postgres with
  `docker-compose.override.yml` (`QTRUST_COMPOSE_PG_URL` in `.env`), so one
  Neon database backs both the local indexer and the deployed API.
- **Public compute for anonymous visitors.** The frontend proxy
  (`frontend/src/lib/api-route-policy.ts`) classifies scanner, evidence
  creation, Roadmap sync, planner, and GPU calls as `public-compute` and
  attaches the server key on the server side. Operator-only routes
  (`/v1/write/`, `/v1/relay/`, `/v1/webhooks/`, credential issuance) still
  require the caller's own key — this protects relayer gas and on-chain writes.
- **API docs are public** (`QTRUST_DOCS_PUBLIC=true`), so the header's
  "API docs" link works for everyone.
- **Indexer:** `watchEvent` now uses `poll: true` (HTTP transports have no push
  channel) and processes delivered logs immediately; reorg safety comes from the
  periodic `detectAndHandleReorg()` check. Address comparisons in read queries
  are case-insensitive (`lower(org_did) = lower($1)`), because contract events
  arrive checksummed while callers pass lowercase addresses.
- **CSP:** production `script-src` includes `'unsafe-inline'`. Next.js always
  emits inline bootstrap/RSC-streaming scripts; without it every page stayed on
  its loading skeleton because React never hydrated. The policy still locks
  down `object-src`, `base-uri`, `frame-ancestors`, and an explicit
  `connect-src` that includes the configured Base Sepolia RPC origin.
- Provisioning/redeploying the hosted API:

  ```
  powershell -File deploy/vercel-backend.ps1                # sync env + deploy
  powershell -File deploy/vercel-backend.ps1 -SkipEnvSync   # deploy only
  ```

  The script creates/reuses the `qtrust-backend` project, upserts every
  `QTRUST_*` variable from `.env` with hosted overrides, writes
  `backend/.vercel/project.json`, and runs `vercel deploy --prod`.
  If the Vercel CLI session has expired, the script asks the CLI to refresh it
  once (`vercel whoami`) and retries the API call instead of failing the
  watchdog run.

### Keeping the local half alive

`deploy/ensure-local-stack.ps1` is a safe-to-rerun watchdog:

1. starts Docker Desktop if it is not running;
2. ensures `postgres`, `redis`, `api`, and `planner` containers are up;
3. ensures both `cloudflared` quick tunnels exist (downloads `cloudflared` to
   `%LOCALAPPDATA%\qtrust\bin` on first use) with
   `--edge-ip-version 4 --protocol http2`. This network drops cloudflared's
   QUIC edge connections after a few minutes, so the tunnels use HTTP/2 over
   TCP instead;
4. if a tunnel URL changed, updates `.env` and re-syncs + redeploys the Vercel
   backend automatically.

A running tunnel is kept through a short 530/502 blip, because quick tunnels
often reconnect on the same URL. If health probes keep failing for 15 minutes,
the watchdog replaces that tunnel, updates `.env`, and redeploys the backend so
the hosted API follows the new URL. This recovers a QUIC connection that will
not come back instead of leaving the scanner and planner permanently dark.

```
powershell -File deploy/ensure-local-stack.ps1                    # check once
powershell -File deploy/ensure-local-stack.ps1 -InstallStartup     # per-user, no admin
powershell -File deploy/ensure-local-stack.ps1 -InstallTask        # scheduled task, needs admin
```

The installed Startup-folder watcher (`QTrustLocalStack.vbs`) runs hidden at
logon and repeats every five minutes; `-InstallTask` is only an option for an
elevated shell. Logs: `deploy/logs/stack.log`. Container restart policies are
`unless-stopped`.

### Demo records (seeded and indexed)

`node backend/scripts/seed-demo-records.mjs` is idempotent: it reuses existing
CBOM documents, skips hashes already registered, records an RSA-2048 →
ML-KEM-768 migration, waits for the indexer, and writes
`deploy/demo-records.json` plus `frontend/src/lib/demo-records.json` (the home
page imports the latter to render its "Live on-chain records" strip, so redeploy
the frontend after reseeding).

| Target | Asset ID | Metadata |
|---|---|---|
| `/workspace/projects/inspector/qtrust_inspector` (23 findings) | `0x125fad1d7f435ea1dfeb014bdcbbbe0636fe7043b1e4e4ac90975768e3d1a349` | `/demo/cbom-inspector.json` |
| `/workspace/projects/planner/qtrust_planner` (7 findings) | `0xd30d41f474522329945e5927ba1e28c0ce376fba80942b1e80b7cdc3c74f7cac` | `/demo/cbom-planner.json` |
| `/workspace/projects/backend/src` (0 findings, clean) | `0xbc5464cb3f08b7984fcf6392a0ab12f01759ca3a4f654f6b070a2e3d2f7eddd7` | `/demo/cbom-backend.json` |

Migration record: `0xec0e55de99ddcb18b9a394be9f704c703e7d5ade53b29e16c4fc0a60264d3984`
(tx `0x014e6d93c8ded0e535ebecf11985736f867ea0708a949983c5b3ad16a794fe8e`).

### Demo estate (default scanner target)

`deploy/demo-estate/` is a small synthetic estate (API gateway, payments,
mobile handshake) with intentional RSA-2048, ECDSA P-256, X25519, AES-128 and
ML-KEM-768 usage. It is mounted into the API container at
`/workspace/projects/deploy/demo-estate` and is the scanner's default target,
so a first-time visitor gets a meaningful scan (20 findings across 3 services)
in one click.

The scanner recognises post-quantum modules (`pqcrypto.kem.ml_kem_768`,
`kyber`, `ml_dsa`, `dilithium`, `slh_dsa` / `sphincs`) and reports them as
`key_type: pqc`, so an already-migrated asset scores 10 (PQC_READY) instead of
being labelled broken. Libraries and protocol dependencies are classified as
inventory rows (18 / 30 / 45) rather than critical algorithm findings.

### Launch films

| File | What it is |
|---|---|
| `brag-output/brag.mp4` | 21.5 s teaser, no narration, -18.7 LUFS |
| `brag-output/explainer.mp4` | 92.6 s narrated explainer (9 scenes), -18.0 LUFS, real UI captures |
| `brag-output/explainer.jpg` | Explainer poster (finale with the live URL) |

Both are HyperFrames compositions; see `brag-output/README.md` for the scene
tables, voiceover settings and re-render commands.

### Verification

```
powershell -File deploy/smoke-test.ps1 -RepoRoot <repo>   # API + planner + scanner + frontend
npm run audit:live --prefix frontend                      # 146 live checks, full stack
node frontend/scripts/browser-check.mjs                   # quick anonymous browser pass
npm test --prefix backend                                  # 109 tests
npm test --prefix frontend                                 # 139 tests
pytest inspector/tests -q                                  # CI installs ./inspector[dev,ml]
```

`audit:live` drives the production site in a real Chromium: every route,
verify lookup, mobile menu, the injected-wallet connect/switch/disconnect
flow, org/vendor/new-wallet roles, all eight scanner tabs, the GPU actions,
API auth gates, CORS, security headers, secret-leak checks, and axe WCAG
serious/critical checks. It writes `report.json` and screenshots under
`%TEMP%/opencode/qtrust-audit`.

The last full run (2026-10-21) passed **146/146** checks. That run created and
verified a real evidence record, ran every scanner tab and GPU action, exercised
all four wallet roles plus a wrong-chain connect and disconnect, and found no
serious/critical axe violations on the home, record, dashboard, vendor and
scanner pages. The Neon read model and Base Sepolia agree: 3 assets, 1 verified
migration, 3 vendor attestations, and the latest audit result is `Passed`; there
were zero registry events after the indexer checkpoint, so the read model is
current.

## Base Sepolia contracts

| Contract | Address |
|---|---|
| AssetRegistry | `0x98727508C2ca1dba85DbB10A1b1DBAc255c232BC` |
| VendorRegistry | `0xd8Bb8E02B2680A8C7D3b4788c038b6c727BD5607` |
| MigrationRegistry | `0xe5c71e228d49752434dA9D8Ec8F078d1bA45287D` |
| AuditRegistry | `0xDA8CFE63e53400ad6146A04C1dfBBfb1Dc17EA82` |
| RevocationAnchor | `0x2bb1F82E36554e22C3772e0f7a4E68d9ea16974f` |
| PolicyCommitment | `0xde9cBe5A3bC07A87F8BD0C0759CdbF53185C3187` |
| SchemaRegistry | `0x6d8d2B0018e4Df6599c9E39dE539D1CA6A908850` |
| TrustAnchorRegistry | `0xF89B94cC31725CF004Bbad8faA0cE64F58e7e15d` |

Indexer start block: `48333836`. Operational roles were granted to the relayer
`0xE610569aE0352DC3262419bb051a86145f52875c` (funded with 0.01 Base Sepolia
ETH via the OpenFaucet proof-of-work faucet); `DEFAULT_ADMIN_ROLE` was
renounced.

## Hosting blockers (checked 2026-10-20)

- **Render:** every service creation returns HTTP 402 ("Payment information is
  required") — including free web services and free databases.
- **Hugging Face Docker Spaces:** creation returns HTTP 402 — free Docker
  Spaces require a PRO subscription.

The Vercel serverless deployment is the no-card path that works today.

## Known limitations

- **The local machine must stay on** for the indexer, Python scanner, evidence
  chain, ML bridge, and planner. If it goes offline, the hosted API keeps
  serving RPC-backed reads and the last indexed data; `/v1/scan/*`,
  `/v1/evidence/*`, `/v1/gpu/*` return a proxy error and `/v1/plans` fails.
  `deploy/ensure-local-stack.ps1` restarts the pieces after a reboot and
  re-points Vercel when tunnel URLs change.
- **Quick-tunnel URLs are not stable.** The watchdog updates `.env` and
  redeploys the backend when they change; otherwise run
  `deploy/vercel-backend.ps1` after editing the two tunnel variables. The
  tunnels use HTTP/2 and are replaced after a sustained outage, but they are
  still best-effort and have no uptime SLA.
- **Serverless cold starts.** The first request after idle takes ~1–2 s while
  the Fastify app boots; `/tmp/qtrust` on Vercel is ephemeral (evidence is
  proxied to the local API, which keeps the durable chain).
- **In-memory rate limiting on Vercel** (`QTRUST_RATE_LIMIT_MAX`, 600 req/min
  per warm instance; keys are scoped per route so page reads cannot exhaust the
  scan budget). No Redis-backed shared limits there.
- **Webhook subscribers on Vercel** are held in memory per warm instance and
  are lost on cold start. The local API uses Redis and is authoritative for
  long-lived subscriptions.
- **WalletConnect / Rainbow are hidden without a real project ID.** The build
  falls back to the public `demo` ID only for local previews; production does
  not render an entry that cannot complete a pairing. Injected browser wallets
  (including MetaMask via the "Browser Wallet" entry) and Coinbase are offered.
  Create a project at https://cloud.walletconnect.com, set
  `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, and redeploy to add WalletConnect.
- **Only the deployed chain is advertised to wallets.** The app offers the
  single network in `lib/config.ts` (Base Sepolia by default). A wallet that
  connects while on another network is asked to switch to Base Sepolia; this
  prevents the dashboard from looking healthy while reading a registry that has
  no code on the wallet's chain.
- **No custom domain.** The Vercel URLs are the production entry points.
- **Shared secrets were rotated** after an accidental env dump in the local
  session log: API key, planner key, webhook encryption key, and VC issuer key.
  The Base Sepolia relayer/deployer keys were also visible in that log; they
  are testnet-only and the relayer cannot be rotated because
  `DEFAULT_ADMIN_ROLE` was renounced.

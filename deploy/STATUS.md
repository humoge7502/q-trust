# Q-Trust deployment status

_Last updated: 2026-10-20_

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
  (`/v1/write/`, the non-vendor `/v1/relay/` writes, `/v1/webhooks/`,
  credential issuance) still require the caller's own key — this protects
  relayer gas and on-chain writes.
- **Gasless vendor attestation.** `POST /v1/relay/attestation` is the one
  exception to the operator rule: it is `public-compute`, because the
  authorization is the vendor's EIP-712 signature rather than an API key.
  The backend recovers the signer, compares the signed nonce with the
  on-chain nonce, and requires `VENDOR_ROLE` on `VendorRegistry` **before**
  the relayer broadcasts, so an anonymous caller can never make the relayer
  spend gas on a non-vendor. The route stays rate limited (10/min) and the
  backend still requires a key on the wire — the frontend proxy supplies it
  server-side. Verified locally: an anonymous proxied POST reaches signature
  validation and fails with `400 EIP-712 signature verification failed`,
  while `POST /v1/relay/migration` without a key still returns
  `403 operator_key_required`. This is live on
  https://q-trust-nu.vercel.app since the 2026-10-20 frontend deploy: an
  anonymous `POST /api/v1/relay/attestation` answers `400` (signature
  validation reached) instead of `403 operator_key_required`, while
  `POST /api/v1/relay/migration` without a key still answers `403`.
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

### Keeping the local half alive

`deploy/ensure-local-stack.ps1` is a safe-to-rerun watchdog:

1. starts Docker Desktop if it is not running;
2. ensures `postgres`, `redis`, `api`, and `planner` containers are up;
3. ensures both `cloudflared` quick tunnels exist (downloads `cloudflared` to
   `%LOCALAPPDATA%\qtrust\bin` on first use) with `--edge-ip-version 4`; forcing
   IPv4 avoids the QUIC timeouts this network sees on Cloudflare's IPv6 edges;
4. if a tunnel URL changed, updates `.env` and re-syncs + redeploys the Vercel
   backend automatically.

A running tunnel is never killed just because one health probe returns 530/502:
quick tunnels reconnect on the same URL, and restarting one changes the URL and
costs a redeploy. The watchdog only starts a tunnel when no process for that
port exists.

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

Migration record: id `0x014e6d93c8ded0e535ebecf11985736f867ea0708a949983c5b3ad16a794fe8e`,
recorded in tx `0xec0e55de99ddcb18b9a394be9f704c703e7d5ade53b29e16c4fc0a60264d3984`
(`recordMigration`) and verified in tx
`0x2070b8ec0442dd7a10db18cf47d2d992523728b5d984b21bfdd9ed2f5c7d16ee`
(`verifyMigration`). Both land on `MigrationRegistry`
`0xe5c71e228d49752434dA9D8Ec8F078d1bA45287D`.

Indexed read model for the demo org
`0xE610569aE0352DC3262419bb051a86145f52875c` (from
`GET /v1/orgs/<org>/migrations`):

| Measure | Value |
|---|---|
| Assets registered | 3 |
| Migrations recorded | 1 |
| Migrations verified | 1 (0 unverified) |
| Vendor attestations indexed | 3 |
| Latest audit | `Passed` (result code 1) |

`deploy/demo-records.json` mirrors these numbers plus the asset and migration
identifiers, so the docs and the on-chain state cannot drift silently.

### Verification

```
powershell -File deploy/smoke-test.ps1 -RepoRoot <repo>   # API + planner + scanner + frontend
node frontend/scripts/browser-check.mjs                   # live anonymous browser flows
npm test --prefix backend                                  # 109 tests
npm test --prefix frontend                                 # 142 tests
```

Both suites pass on the merged tree: backend 109/109, frontend 142/142. Run
the backend suite with `npx vitest run --maxWorkers=2` on a busy machine —
under full parallelism the pool starves and a few suites hit the 5 s default
timeout (they pass in isolation).

Live state on 2026-10-21:

- `deploy/smoke-test.ps1` against the hosted deployment: **all checks pass**
  (API health, authenticated docs, planner proxy, scanner proxy, frontend).
- `frontend/scripts/browser-check.mjs`: **31/31** against a production build
  (`npm run build && npx next start`) wired to the local Docker API.
- The same script cannot run against `https://q-trust-nu.vercel.app` from
  this workstation: the local network's FortiGuard web filter and SSL
  inspection answer `*.vercel.app` with a block page and an untrusted
  certificate, so the browser never reaches the app. The API-level checks
  above are unaffected (PowerShell trusts the inspection CA), and the live
  proxy behaviour was verified directly: `POST /api/v1/relay/attestation`
  without a key answers `400` (signature validation) and
  `POST /api/v1/relay/migration` without a key answers `403`.
- The hosted backend's tunnel variables had gone stale while the Vercel API
  was unreachable, which made `/v1/plans` and `/v1/scan/source` answer `503`
  (quick-tunnel URLs change whenever a tunnel restarts). Re-running
  `deploy/vercel-backend.ps1` re-synced the current URLs and redeployed;
  `deploy/ensure-local-stack.ps1` does the same automatically when it can
  reach Vercel.

The browser check covers: home loads and links to real records, `/v/<id>`
renders VALID/REVOKED, `/scanner` runs a full scan and reaches the AI planner
and GPU lab panels, and `/dashboard` / `/vendors` load without server errors.

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

## Launch video

The Q-Trust launch film is produced with the `brag` workflow
(https://github.com/latent-spaces/brag) as a HyperFrames composition.

| Artifact | Path |
|---|---|
| Composition source | `brag-output/composition/index.html` (+ `styles.css`, `assets/`) |
| Creative contract / plan | `brag-output/brag-plan.md` |
| Implementation brief | `brag-output/composition-brief.md` |
| Rendered master | `brag-output/brag.mp4` (1920x1080, 30 fps, 21.5 s, H.264 + AAC) |
| Poster frame | `brag-output/brag.jpg` (20.2 s) |

Scene timing: `0-3.7` NIST IR 8547 deadline hook, `3.7-7.9` the claim, `7.9-14.1`
the workspace, `14.1-18.5` the on-chain proof, `18.5-21.5` the light editorial
finale. The copy uses the real workspace numbers (284 assets, 39 at risk, 68 %
PQC ready) and the real seeded records (migration
`0x014e6d93...a794fe8e`, verification tx `0x2070b8ec...7d16ee`).

Re-render:

```
cd brag-output/composition
npx hyperframes check            # lint + runtime + layout + motion + contrast
npx hyperframes render -o ../brag.mp4 --quality delivery --fps 30
```

`npx hyperframes check` currently reports 0 lint errors, 0 runtime warnings,
0 layout issues, 0 motion issues and 156/156 WCAG AA contrast checks passing.
The music bed is not committed (third-party library track); restore
`assets/music/bed.mp3` from
`happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (first 21.5 s) before
re-rendering.

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
  `deploy/vercel-backend.ps1` after editing the two tunnel variables.
- **Serverless cold starts.** The first request after idle takes ~1–2 s while
  the Fastify app boots; `/tmp/qtrust` on Vercel is ephemeral (evidence is
  proxied to the local API, which keeps the durable chain).
- **In-memory rate limiting on Vercel** (`QTRUST_RATE_LIMIT_MAX`, 600 req/min
  per warm instance; keys are scoped per route so page reads cannot exhaust the
  scan budget). No Redis-backed shared limits there.
- **Webhook subscribers on Vercel** are held in memory per warm instance and
  are lost on cold start. The local API uses Redis and is authoritative for
  long-lived subscriptions.
- **WalletConnect uses the public `demo` project ID** with
  `NEXT_PUBLIC_QTRUST_ALLOW_DEMO_WALLETCONNECT=1`. Browser-extension wallets
  work normally; WalletConnect pairing is rate-limited by the demo project.
  Create a project at https://cloud.walletconnect.com, set
  `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, and redeploy.
- **No custom domain.** The Vercel URLs are the production entry points.
- **Shared secrets were rotated** after an accidental env dump in the local
  session log: API key, planner key, webhook encryption key, and VC issuer key.
  The Base Sepolia relayer/deployer keys were also visible in that log; they
  are testnet-only and the relayer cannot be rotated because
  `DEFAULT_ADMIN_ROLE` was renounced.
- **The Neon (hosted Postgres) credential is still the one secret that has
  not been rotated.** It was provisioned through the Vercel Marketplace, so
  no Neon API key is available on this machine (`neonctl` is not installed
  and `NEON_API_KEY` is not in any env file) — the password has to be reset
  in the Neon console (or with a Neon API key), and the new value then has to
  be written to every consumer in one pass: `.env` (`QTRUST_PG_URL`,
  `QTRUST_COMPOSE_PG_URL`), `frontend/.env.local` (`DATABASE_URL`,
  `DATABASE_URL_UNPOOLED`, `POSTGRES_*`), the `q-trust` Vercel project
  (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_*`,
  `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`,
  `POSTGRES_URL_NO_SSL`) and the `qtrust-backend` Vercel project
  (`QTRUST_PG_URL`). Until that is done, rotate the Neon password **first**
  and update all of them in the same session — the local indexer and the
  hosted API share that database.
- **The local network filters `*.vercel.app`.** FortiGuard's web filter and
  SSL inspection block the Vercel domains from this workstation (the browser
  gets a "Web Page Blocked" page, `curl` gets an untrusted root), so the
  live browser suite cannot run here. The hosted API is still reachable from
  tools that trust the inspection CA, and the tunnel watchdog re-points
  Vercel whenever a quick tunnel comes back with a new URL.

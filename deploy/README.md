# Q-Trust full-stack deployment runbook

Target architecture:

```
Vercel                         Render (oregon)
┌────────────────────┐        ┌─────────────────────────────┐
│ Next.js frontend   │──/api──▶│ Fastify API + indexer       │
│ app.<domain>       │        │ qtrust-backend.onrender.com │
└────────────────────┘        │  ├─ Postgres (managed)      │
                              │  ├─ Redis (managed)         │
                              │  └─ /var/lib/qtrust (disk)  │
                              │            │                │
                              │            ▼                │
                              │ FastAPI GNN planner (pserv) │
                              └─────────────────────────────┘
                                           │
                                           ▼
                                  Base Sepolia (84532)
                                  8 UUPS proxy registries (app-wired)
```

> **Contract count note.** The repository contains **11 source contracts**
> (see `docs/ARCHITECTURE.md`). This runbook wires **8** of them into the
> backend/frontend `.env` (the data registries + anchors). The remaining three
> — `QTrustGovernance`, `ComplianceAttestation`, `EvidenceRegistry` — are also
> deployed on-chain under the same 7-day timelock, but their addresses are not
> yet surfaced to the application environment (governance is reached via the
> timelock; compliance/evidence are recorded on-chain and read via RPC, not via
> dedicated frontend env vars). Hence "8 UUPS proxy registries" refers to the
> app-wired set, not the total on-chain contract count.

## 0. Prerequisites

| Item | Requirement |
|---|---|
| Deployer EOA | >= 0.01 ETH on Base Sepolia (0.03 recommended) |
| Relayer EOA | >= 0.005 ETH on Base Sepolia; must be a **different** key |
| RPC | HTTPS endpoint. Public `https://sepolia.base.org` works but is rate-limited; use Alchemy/QuickNode for production |
| WalletConnect | Project ID from https://cloud.walletconnect.com |
| Render | Workspace + API key, or dashboard access |
| Vercel | Account (CLI or dashboard) |
| Domain | One apex/root domain; this runbook uses `app.<domain>` and `api.<domain>` |
| Local tools | Docker Desktop, Node 20+, PowerShell 7, Git |

Faucets: https://www.alchemy.com/faucets/base-sepolia,
https://faucet.circle.com, https://www.coinbase.com/faucets/base-ethereum-goerli-sepolia-faucet

## 1. Fill secrets

Edit `.env` and replace:

```text
QTRUST_DEPLOYER_PRIVATE_KEY=0x...
QTRUST_RELAYER_PRIVATE_KEY=0x...
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<32 hex chars>
BASESCAN_API_KEY=<optional, for contract verification>
```

Also set your real origins/domain now (or update after the first deploy):

```text
QTRUST_CORS_ORIGINS=https://app.<domain>
NEXT_PUBLIC_QTRUST_API_URL=https://api.<domain>
QTRUST_BACKEND_URL=https://api.<domain>
NEXT_PUBLIC_QTRUST_SITE_URL=https://app.<domain>
QTRUST_PUBLIC_URL=https://api.<domain>
```

Never commit `.env` or `frontend/.env.local` (both are gitignored).

## 2. Deploy the contracts to Base Sepolia

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\deploy-contracts.ps1
```

The script:

1. derives the deployer and relayer addresses;
2. checks both balances on Base Sepolia;
3. runs `forge test` (skip with `-SkipTests`);
4. deploys the 8 UUPS proxy registries + timelock/governance;
5. grants the relayer's operational roles (`QTRUST_DEV_GRANTEE`) so hosted
   writes work immediately, while still renouncing the deployer's admin role;
6. writes all proxy addresses and `QTRUST_INDEXER_FROM_BLOCK` into `.env`
   and the four frontend addresses into `frontend/.env.local`.

Logs: `deploy/logs/contracts-deploy.log`,
`contracts/broadcast/Deploy.s.sol/84532/run-latest.json`.

> Security note: `QTRUST_DEV_GRANTEE` is named "dev" in the contracts, but it
> is the supported bootstrap mechanism for giving the hosted relayer the
> operational roles before the 7-day timelock takes over. The deployer keeps
> no admin role. For a stricter production posture, omit it and submit a
> governance proposal after deployment (7-day delay).

## 3. Deploy the backend + planner to Render

### Option A - Blueprint (dashboard)

1. Push this repository (including the updated `render.yaml` and the frontend
   `Dockerfile`) to GitHub.
2. Open https://render.com/deploy?repo=https://github.com/humoge7502/q-trust
3. Fill the prompted secrets (`sync: false`) from `.env`:
   - `QTRUST_RELAYER_PRIVATE_KEY`
   - `QTRUST_PLANNER_API_KEY`
   - `QTRUST_API_KEYS`
   - `QTRUST_WEBHOOK_ENC_KEY`
   - `QTRUST_VC_ISSUER_KEY`
   - `QTRUST_BASE_SEPOLIA_RPC`
   - all 8 `QTRUST_*_ADDRESS` values
   - `QTRUST_INDEXER_FROM_BLOCK`
   - `QTRUST_CORS_ORIGINS`
   - `QTRUST_PUBLIC_URL`
4. Apply the Blueprint. Render creates Postgres, Redis, the private planner,
   the public backend, and a 1 GB evidence disk.

### Option B - Render API (automated)

Put `RENDER_API_KEY=...` in `.env`, then:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\deploy-render.ps1
```

The script creates/updates the datastores, backend, and planner via the Render
API and prints the public backend URL.

### Verify

```powershell
curl https://api.<domain>/health
# {"status":"ok","chain_id":84532,"relayer":"0x..."}
curl https://api.<domain>/docs/json -H "x-api-key: $env:QTRUST_API_KEY"
```

## 4. Deploy the frontend to Vercel

```powershell
cd frontend
vercel login          # one-time, opens the browser
vercel link           # create/link the project
vercel env add NEXT_PUBLIC_QTRUST_API_URL production
vercel env add NEXT_PUBLIC_QTRUST_CHAIN_ID production
vercel env add NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC production
vercel env add NEXT_PUBLIC_QTRUST_ASSET_REGISTRY_ADDRESS production
vercel env add NEXT_PUBLIC_QTRUST_VENDOR_REGISTRY_ADDRESS production
vercel env add NEXT_PUBLIC_QTRUST_MIGRATION_REGISTRY_ADDRESS production
vercel env add NEXT_PUBLIC_QTRUST_AUDIT_REGISTRY_ADDRESS production
vercel env add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID production
vercel env add NEXT_PUBLIC_QTRUST_SITE_URL production
vercel env add NEXT_PUBLIC_IPFS_GATEWAY production
vercel env add QTRUST_BACKEND_URL production
vercel env add QTRUST_API_KEY production
vercel --prod
```

`NEXT_PUBLIC_*` values are baked at build time, so set them **before**
`vercel --prod`. `QTRUST_BACKEND_URL` and `QTRUST_API_KEY` are server-only.

Or import the repo in the Vercel dashboard with **Root Directory = `frontend`**
and paste the same variables for Production + Preview.

## 5. DNS

| Record | Name | Value |
|---|---|---|
| CNAME | `app` | `cname.vercel-dns.com` |
| CNAME | `api` | the Render service hostname |

Add both custom domains in the Vercel/Render dashboards and wait for TLS.

## 6. Post-deploy smoke test

```powershell
# API
curl https://api.<domain>/health
curl https://api.<domain>/v1/plans/health -H "x-api-key: $env:QTRUST_API_KEY"

# Frontend
curl -I https://app.<domain>/

# Scan the bundled sample source tree (read-only mount)
curl -X POST https://api.<domain>/v1/scan -H "content-type: application/json" `
  -H "x-api-key: $env:QTRUST_API_KEY" `
  -d '{\"directory\":\"/workspace/projects/backend/src\"}'
```

Then open `https://app.<domain>/scanner`, run a scan, and verify the result
appears in the dashboard.

## 7. Operations

- **Evidence chain**: persisted on the Render disk at
  `/var/lib/qtrust/evidence_chain.jsonl`.
- **Indexer**: starts at `QTRUST_INDEXER_FROM_BLOCK`; it backfills the
  registries and detects reorgs.
- **Relayer**: requires Base Sepolia ETH. Guardrails in `.env` stop broadcasts
  below `QTRUST_RELAYER_MIN_BALANCE_ETH` or above the daily cap.
- **Planner**: private service; only reachable from the backend with
  `QTRUST_PLANNER_API_KEY`.
- **Observability**: the compose stack ships Prometheus/Grafana/Alertmanager
  for self-hosted runs; Render uses its built-in logs/metrics.
- **Rotating keys**: update Render secrets and redeploy; update
  `QTRUST_API_KEYS` + `QTRUST_API_KEY` together.

## Cost sketch (Render starter + Vercel hobby)

| Resource | Plan | Approx |
|---|---|---|
| Backend web service | Starter | $7/mo |
| Planner private service | Starter | $7/mo |
| Postgres | Starter | $7/mo |
| Redis/Key Value | Starter | $3-7/mo |
| Evidence disk 1 GB | - | ~$0.25/mo |
| Vercel | Hobby | $0 |
| Base Sepolia gas | - | testnet ETH |

Free Render plans can be substituted for a demo, but free web services sleep,
free Postgres expires, and private services/disks require paid plans.

#requires -Version 5.1
<#
.SYNOPSIS
  Create/update the Q-Trust backend, planner, Postgres, and Key Value on Render.

.DESCRIPTION
  Requires RENDER_API_KEY in .env (or the process environment), and the
  contract addresses already written by deploy-contracts.ps1.

  This script is idempotent: existing resources are reused by name; service
  environment variables are replaced with the values in .env.

  Usage:
    pwsh ./deploy/deploy-render.ps1 -Plan starter -Region oregon
    pwsh ./deploy/deploy-render.ps1 -Plan free -FreeTier

  The source repo defaults to QTRUST_GITHUB_REPO_URL in .env, then to the
  upstream public repo. Point it at a repo that contains the local deploy
  fixes (backend/Dockerfile schema copy, render.yaml, deploy scripts), for
  example with QTRUST_GITHUB_REPO_URL=https://github.com/<you>/q-trust.

  -FreeTier keeps the deployment compatible with Render's free plan: no
  persistent disk (evidence chain lives in the container filesystem) and the
  planner runs as an API-key protected public web service instead of a
  private service.

  Cost warning: private services, persistent disks, and paid Postgres/Key
  Value plans are billed by Render. Use -Plan free for a throwaway demo
  (free web services sleep, free databases expire, and evidence is ephemeral).
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [ValidateSet("free", "starter", "standard")][string]$Plan = "starter",
  [ValidateSet("oregon", "ohio", "virginia", "frankfurt", "singapore")][string]$Region = "oregon",
  # Repository Render builds from. Defaults to QTRUST_GITHUB_REPO_URL in .env,
  # then to the upstream public repo (which does NOT contain the local deploy
  # fixes, so prefer setting QTRUST_GITHUB_REPO_URL or passing -RepoUrl).
  [string]$RepoUrl = "",
  [string]$Branch = "main",
  # URL of a planner hosted outside Render (for example the local GNN planner
  # behind a Cloudflare tunnel). When set, no Render planner service is
  # created and the backend targets this URL. Defaults to
  # QTRUST_PLANNER_TUNNEL_URL in .env.
  [string]$ExternalPlannerUrl = "",
  # External datastore URLs (Neon Postgres / Upstash Redis). When set, the
  # matching Render-managed datastore is skipped. Defaults come from
  # QTRUST_EXTERNAL_PG_URL and QTRUST_EXTERNAL_REDIS_URL in .env.
  [string]$ExternalPgUrl = "",
  [string]$ExternalRedisUrl = "",
  # Skip Redis entirely. The backend degrades gracefully (webhook
  # subscriptions return 503); useful when no free Redis is available.
  [switch]$SkipRedis,
  # Free tier has no persistent disks and no private services. This switch
  # keeps the evidence chain in the container filesystem and exposes the
  # planner as a public web service (still API-key protected).
  [switch]$FreeTier,
  [switch]$SkipDeployWait
)

$ErrorActionPreference = "Stop"
$envPath = Join-Path $RepoRoot ".env"
$frontendEnvPath = Join-Path $RepoRoot "frontend\.env.local"
$apiBase = "https://api.render.com/v1"
$logDir = Join-Path $RepoRoot "deploy\logs"
$logPath = Join-Path $logDir "render-deploy.log"

function Read-DotEnv([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { continue }
    $map[$line.Substring(0, $idx).Trim()] = $line.Substring($idx + 1).Trim()
  }
  return $map
}

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = @([IO.File]::ReadAllLines($Path))
  $found = $false
  $escapedKey = [regex]::Escape($Key)
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$escapedKey\s*=") {
      $lines[$i] = "$Key=$Value"
      $found = $true
    }
  }
  if (-not $found) { $lines += "$Key=$Value" }
  [IO.File]::WriteAllLines($Path, $lines, (New-Object System.Text.UTF8Encoding($false)))
}

function Assert-Filled([hashtable]$Map, [string]$Key) {
  $value = $Map[$Key]
  if ([string]::IsNullOrWhiteSpace($value) -or $value -match '^__FILL' -or $value -match '^0x0{40}$') {
    throw "Missing or placeholder value for $Key in .env."
  }
}

function Invoke-Render {
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [object]$Body = $null
  )
  $uri = "$apiBase$Path"
  $headers = @{
    Authorization = "Bearer $script:renderKey"
    Accept = "application/json"
  }
  $requestArgs = @{
    Method = $Method
    Uri = $uri
    Headers = $headers
    ErrorAction = "Stop"
  }
  if ($null -ne $Body) {
    $requestArgs["ContentType"] = "application/json"
    $requestArgs["Body"] = ($Body | ConvertTo-Json -Depth 20 -Compress)
  }
  try {
    return Invoke-RestMethod @requestArgs
  } catch {
    $status = $null
    try { $status = [int]$_.Exception.Response.StatusCode } catch { }
    $detail = $_.ErrorDetails.Message
    if ([string]::IsNullOrWhiteSpace($detail)) {
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $detail = $reader.ReadToEnd()
      } catch { }
    }
    if ([string]::IsNullOrWhiteSpace($detail)) { $detail = $_.Exception.Message }
    throw "Render $Method $Path failed (HTTP $status): $detail"
  }
}

function Get-Items($Response) {
  if ($null -eq $Response) { return @() }
  return @($Response | ForEach-Object {
    if ($null -ne $_.service) { $_.service }
    elseif ($null -ne $_.owner) { $_.owner }
    elseif ($null -ne $_.postgres) { $_.postgres }
    elseif ($null -ne $_.redis) { $_.redis }
    else { $_ }
  })
}

function Wait-Database([string]$Kind, [string]$Id, [int]$TimeoutSeconds = 900) {
  $path = if ($Kind -eq "postgres") { "/postgres/$Id" } else { "/key-value/$Id" }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $db = Invoke-Render -Method GET -Path $path
    $status = $db.status
    Write-Host ("    {0} {1}: {2}" -f $Kind, $Id, $status)
    if ($status -eq "available") { return $db }
    if ($status -in @("unavailable", "recovery_failed")) {
      throw "$Kind $Id entered status $status."
    }
    Start-Sleep -Seconds 10
  }
  throw "Timed out waiting for $Kind $Id to become available."
}

function Get-ByName([string]$Path, [string]$Name) {
  $items = Get-Items (Invoke-Render -Method GET -Path "${Path}?limit=100")
  return $items | Where-Object { $_.name -eq $Name } | Select-Object -First 1
}

if (-not (Test-Path -LiteralPath $envPath)) { throw "No .env found at $envPath." }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$envMap = Read-DotEnv $envPath
$script:renderKey = $envMap["RENDER_API_KEY"]
if ([string]::IsNullOrWhiteSpace($script:renderKey) -or $script:renderKey -match '^__FILL') {
  $script:renderKey = $env:RENDER_API_KEY
}
if ([string]::IsNullOrWhiteSpace($script:renderKey)) {
  throw "Set RENDER_API_KEY in .env (Render Dashboard -> Account Settings -> API Keys)."
}
if ([string]::IsNullOrWhiteSpace($RepoUrl)) { $RepoUrl = $envMap["QTRUST_GITHUB_REPO_URL"] }
if ([string]::IsNullOrWhiteSpace($RepoUrl)) {
  $RepoUrl = "https://github.com/humoge7502/q-trust"
  Write-Warning "No QTRUST_GITHUB_REPO_URL in .env and no -RepoUrl given; falling back to upstream $RepoUrl, which lacks the local deploy fixes."
}
Write-Host "==> Source repo: $RepoUrl (branch $Branch)" -ForegroundColor Cyan
foreach ($key in @(
  "QTRUST_RELAYER_PRIVATE_KEY", "QTRUST_PLANNER_API_KEY", "QTRUST_API_KEYS",
  "QTRUST_WEBHOOK_ENC_KEY", "QTRUST_VC_ISSUER_KEY", "QTRUST_ASSET_REGISTRY_ADDRESS",
  "QTRUST_VENDOR_REGISTRY_ADDRESS", "QTRUST_MIGRATION_REGISTRY_ADDRESS",
  "QTRUST_AUDIT_REGISTRY_ADDRESS", "QTRUST_REVOCATION_ANCHOR_ADDRESS",
  "QTRUST_POLICY_COMMITMENT_ADDRESS", "QTRUST_SCHEMA_REGISTRY_ADDRESS",
  "QTRUST_TRUST_ANCHOR_REGISTRY_ADDRESS")) {
  Assert-Filled $envMap $key
}

$owners = Get-Items (Invoke-Render -Method GET -Path "/owners?limit=10")
if ($owners.Count -eq 0) { throw "No Render workspace found for this API key." }
$owner = $owners[0]
$ownerId = $owner.id
Write-Host "==> Render workspace: $($owner.name) ($ownerId)" -ForegroundColor Cyan

# ---------------------------------------------------------------- datastores
# External databases (Neon/Upstash provisioned through the Vercel Marketplace)
# skip Render-managed datastores, which require a payment method even on the
# free plan.
if ([string]::IsNullOrWhiteSpace($ExternalPgUrl)) { $ExternalPgUrl = $envMap["QTRUST_EXTERNAL_PG_URL"] }
if ([string]::IsNullOrWhiteSpace($ExternalRedisUrl)) { $ExternalRedisUrl = $envMap["QTRUST_EXTERNAL_REDIS_URL"] }

if (-not [string]::IsNullOrWhiteSpace($ExternalPgUrl)) {
  Write-Host "==> Postgres: using external database (no Render Postgres)" -ForegroundColor Cyan
  $pg = $null
  $pgUrl = $ExternalPgUrl
} else {
Write-Host "==> Postgres" -ForegroundColor Cyan
$pg = Get-ByName "/postgres" "qtrust-postgres"
if (-not $pg) {
  Write-Host "    creating qtrust-postgres ($Plan)"
  $pg = Invoke-Render -Method POST -Path "/postgres" -Body @{
    name = "qtrust-postgres"
    ownerId = $ownerId
    plan = $Plan
    region = $Region
    version = "16"
    databaseName = "qtrust"
    databaseUser = "qtrust"
  }
} else {
  Write-Host "    reusing $($pg.id)"
}
if ($pg.status -ne "available") { $pg = Wait-Database "postgres" $pg.id }
$pgInfo = Invoke-Render -Method GET -Path "/postgres/$($pg.id)/connection-info"
$pgUrl = $pgInfo.internalConnectionString
}

if ($SkipRedis) {
  Write-Host "==> Key Value: skipped (-SkipRedis; webhook subscriptions disabled)" -ForegroundColor Cyan
  $redis = $null
  $redisUrl = ""
} elseif (-not [string]::IsNullOrWhiteSpace($ExternalRedisUrl)) {
  Write-Host "==> Key Value: using external Redis (no Render Key Value)" -ForegroundColor Cyan
  $redis = $null
  $redisUrl = $ExternalRedisUrl
} else {
Write-Host "==> Key Value (Redis)" -ForegroundColor Cyan
$redis = Get-ByName "/key-value" "qtrust-redis"
if (-not $redis) {
  Write-Host "    creating qtrust-redis ($Plan)"
  $redis = Invoke-Render -Method POST -Path "/key-value" -Body @{
    name = "qtrust-redis"
    ownerId = $ownerId
    plan = $Plan
    region = $Region
    maxmemoryPolicy = "allkeys_lru"
    persistenceMode = "journal_snapshot"
  }
} else {
  Write-Host "    reusing $($redis.id)"
}
if ($redis.status -ne "available") { $redis = Wait-Database "key-value" $redis.id }
$redisInfo = Invoke-Render -Method GET -Path "/key-value/$($redis.id)/connection-info"
$redisUrl = $redisInfo.internalConnectionString
}

# ---------------------------------------------------------------- planner
# An externally hosted planner (local GNN + tunnel) skips the Render planner
# service entirely. Otherwise a private service (paid) or API-key protected
# web service (free tier) is created.
if ([string]::IsNullOrWhiteSpace($ExternalPlannerUrl)) { $ExternalPlannerUrl = $envMap["QTRUST_PLANNER_TUNNEL_URL"] }
if (-not [string]::IsNullOrWhiteSpace($ExternalPlannerUrl)) {
  $plannerUrl = $ExternalPlannerUrl.TrimEnd("/")
  Write-Host "==> Planner: using external planner at $plannerUrl (no Render service)" -ForegroundColor Cyan
} else {
$plannerType = if ($FreeTier) { "web_service" } else { "private_service" }
$plannerLabel = if ($FreeTier) { "web service (API-key protected)" } else { "private service" }
Write-Host "==> Planner $plannerLabel" -ForegroundColor Cyan
$planner = Get-ByName "/services" "qtrust-planner"
if (-not $planner) {
  $planner = Invoke-Render -Method POST -Path "/services" -Body @{
    type = $plannerType
    name = "qtrust-planner"
    ownerId = $ownerId
    repo = $RepoUrl
    branch = $Branch
    autoDeployTrigger = "off"
    envVars = @(
      @{ key = "QTRUST_PLANNER_API_KEY"; value = $envMap["QTRUST_PLANNER_API_KEY"] },
      @{ key = "QTRUST_ENFORCE_MODEL_MANIFEST"; value = "1" },
      @{ key = "QTRUST_DEVICE"; value = "cpu" },
      @{ key = "QTRUST_REDIS_URL"; value = $redisUrl }
    )
    serviceDetails = @{
      runtime = "docker"
      plan = $Plan
      region = $Region
      healthCheckPath = "/health"
      numInstances = 1
      envSpecificDetails = @{
        dockerContext = "./planner"
        dockerfilePath = "Dockerfile"
      }
    }
  }
} else {
  Write-Host "    reusing $($planner.id)"
  Invoke-Render -Method PUT -Path "/services/$($planner.id)/env-vars" -Body @(
    @{ key = "QTRUST_PLANNER_API_KEY"; value = $envMap["QTRUST_PLANNER_API_KEY"] },
    @{ key = "QTRUST_ENFORCE_MODEL_MANIFEST"; value = "1" },
    @{ key = "QTRUST_DEVICE"; value = "cpu" },
    @{ key = "QTRUST_REDIS_URL"; value = $redisUrl }
  ) | Out-Null
}

# Private services get an internal URL such as http://qtrust-planner:8000;
# free-tier web services get a public https://* onrender.com URL (API-key
# protected at the application layer).
$plannerUrl = "http://qtrust-planner:8000"
if ($planner.serviceDetails.url) { $plannerUrl = $planner.serviceDetails.url.TrimEnd("/") }
}

# ---------------------------------------------------------------- backend
Write-Host "==> Backend web service" -ForegroundColor Cyan
$publicUrl = $envMap["QTRUST_PUBLIC_URL"]
if ([string]::IsNullOrWhiteSpace($publicUrl) -or $publicUrl -match 'localhost|trycloudflare\.com') {
  $publicUrl = "https://qtrust-backend.onrender.com"
}
$scanRoot = $envMap["QTRUST_SCAN_ALLOWED_ROOTS"]
if ([string]::IsNullOrWhiteSpace($scanRoot)) { $scanRoot = "/workspace/projects" }
# Free tier cannot attach disks; keep the evidence chain in the (ephemeral)
# container filesystem instead. Paid plans use the persistent disk.
$dataDir = if ($FreeTier) { "/tmp/qtrust" } else { "/var/lib/qtrust" }

$backendEnv = @(
  @{ key = "NODE_ENV"; value = "production" },
  @{ key = "PORT"; value = "3001" },
  @{ key = "QTRUST_PUBLIC_URL"; value = $publicUrl },
  @{ key = "QTRUST_USE_MAINNET"; value = "false" },
  @{ key = "QTRUST_BASE_SEPOLIA_RPC"; value = $envMap["QTRUST_BASE_SEPOLIA_RPC"] },
  @{ key = "QTRUST_RPC_URLS"; value = $envMap["QTRUST_RPC_URLS"] },
  @{ key = "QTRUST_RELAYER_PRIVATE_KEY"; value = $envMap["QTRUST_RELAYER_PRIVATE_KEY"] },
  @{ key = "QTRUST_API_KEYS"; value = $envMap["QTRUST_API_KEYS"] },
  @{ key = "QTRUST_CORS_ORIGINS"; value = $envMap["QTRUST_CORS_ORIGINS"] },
  @{ key = "QTRUST_SCAN_ALLOWED_ROOTS"; value = $scanRoot },
  @{ key = "QTRUST_SCAN_CONTAINER_ROOT"; value = "/workspace/projects" },
  @{ key = "QTRUST_DATA_DIR"; value = $dataDir },
  @{ key = "QTRUST_EVIDENCE_DB_PATH"; value = "$dataDir/evidence_chain.jsonl" },
  @{ key = "QTRUST_PLANNER_URL"; value = $plannerUrl },
  @{ key = "QTRUST_PLANNER_API_KEY"; value = $envMap["QTRUST_PLANNER_API_KEY"] },
  @{ key = "QTRUST_REDIS_URL"; value = $redisUrl },
  @{ key = "QTRUST_PG_URL"; value = $pgUrl },
  @{ key = "QTRUST_ASSET_REGISTRY_ADDRESS"; value = $envMap["QTRUST_ASSET_REGISTRY_ADDRESS"] },
  @{ key = "QTRUST_VENDOR_REGISTRY_ADDRESS"; value = $envMap["QTRUST_VENDOR_REGISTRY_ADDRESS"] },
  @{ key = "QTRUST_MIGRATION_REGISTRY_ADDRESS"; value = $envMap["QTRUST_MIGRATION_REGISTRY_ADDRESS"] },
  @{ key = "QTRUST_AUDIT_REGISTRY_ADDRESS"; value = $envMap["QTRUST_AUDIT_REGISTRY_ADDRESS"] },
  @{ key = "QTRUST_REVOCATION_ANCHOR_ADDRESS"; value = $envMap["QTRUST_REVOCATION_ANCHOR_ADDRESS"] },
  @{ key = "QTRUST_POLICY_COMMITMENT_ADDRESS"; value = $envMap["QTRUST_POLICY_COMMITMENT_ADDRESS"] },
  @{ key = "QTRUST_SCHEMA_REGISTRY_ADDRESS"; value = $envMap["QTRUST_SCHEMA_REGISTRY_ADDRESS"] },
  @{ key = "QTRUST_TRUST_ANCHOR_REGISTRY_ADDRESS"; value = $envMap["QTRUST_TRUST_ANCHOR_REGISTRY_ADDRESS"] },
  @{ key = "QTRUST_INDEXER_FROM_BLOCK"; value = $envMap["QTRUST_INDEXER_FROM_BLOCK"] },
  @{ key = "QTRUST_WEBHOOK_ENC_KEY"; value = $envMap["QTRUST_WEBHOOK_ENC_KEY"] },
  @{ key = "QTRUST_VC_ISSUER_KEY"; value = $envMap["QTRUST_VC_ISSUER_KEY"] },
  @{ key = "QTRUST_WEBHOOKS"; value = "" },
  @{ key = "QTRUST_SENTRY_DSN"; value = "" }
)

$backendDetails = @{
  runtime = "docker"
  plan = $Plan
  region = $Region
  healthCheckPath = "/health"
  numInstances = 1
  envSpecificDetails = @{
    dockerContext = "."
    dockerfilePath = "backend/Dockerfile"
  }
}
if (-not $FreeTier) {
  $backendDetails["disk"] = @{
    name = "qtrust-evidence"
    mountPath = "/var/lib/qtrust"
    sizeGB = 1
  }
}

$backend = Get-ByName "/services" "qtrust-backend"
if (-not $backend) {
  $backend = Invoke-Render -Method POST -Path "/services" -Body @{
    type = "web_service"
    name = "qtrust-backend"
    ownerId = $ownerId
    repo = $RepoUrl
    branch = $Branch
    autoDeployTrigger = "off"
    envVars = $backendEnv
    serviceDetails = $backendDetails
  }
} else {
  Write-Host "    reusing $($backend.id)"
  Invoke-Render -Method PUT -Path "/services/$($backend.id)/env-vars" -Body $backendEnv | Out-Null
}

$backendUrl = $backend.serviceDetails.url
if ([string]::IsNullOrWhiteSpace($backendUrl)) { $backendUrl = $publicUrl }
$backendUrl = $backendUrl.TrimEnd("/")

Write-Host "==> Writing service URLs to .env and frontend/.env.local" -ForegroundColor Cyan
Set-EnvValue $envPath "QTRUST_PUBLIC_URL" $backendUrl
Set-EnvValue $envPath "NEXT_PUBLIC_QTRUST_API_URL" $backendUrl
Set-EnvValue $envPath "QTRUST_BACKEND_URL" $backendUrl
Set-EnvValue $frontendEnvPath "NEXT_PUBLIC_QTRUST_API_URL" $backendUrl
Set-EnvValue $frontendEnvPath "QTRUST_BACKEND_URL" $backendUrl

if (-not $SkipDeployWait) {
  Write-Host "==> Waiting for the backend deploy (this builds the Docker images)" -ForegroundColor Cyan
  $deadline = (Get-Date).AddMinutes(30)
  while ((Get-Date) -lt $deadline) {
    $deploys = Invoke-Render -Method GET -Path "/services/$($backend.id)/deploys?limit=1"
    $deploy = @($deploys)[0]
    if ($null -ne $deploy.deploy) { $deploy = $deploy.deploy }
    $status = $deploy.status
    Write-Host "    backend deploy: $status"
    if ($status -eq "live") { break }
    if ($status -in @("build_failed", "canceled", "deactivated")) {
      throw "Backend deploy failed with status $status. Check the Render logs."
    }
    Start-Sleep -Seconds 20
  }
}

Write-Host ""
Write-Host "Render backend: $backendUrl" -ForegroundColor Green
Write-Host "Planner:        $plannerUrl" -ForegroundColor Green
Write-Host "Postgres:       $(if ($pg) { $pg.id } else { 'external (QTRUST_EXTERNAL_PG_URL)' })" -ForegroundColor Green
Write-Host "Key Value:      $(if ($redis) { $redis.id } else { 'external/none (QTRUST_EXTERNAL_REDIS_URL)' })" -ForegroundColor Green
Write-Host ""
Write-Host "Next: point the Vercel env vars at the backend and redeploy the frontend:" -ForegroundColor Yellow
Write-Host "  QTRUST_BACKEND_URL=$backendUrl" -ForegroundColor Yellow
Write-Host "  NEXT_PUBLIC_QTRUST_API_URL=$backendUrl" -ForegroundColor Yellow

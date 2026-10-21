#requires -Version 5.1
<#
.SYNOPSIS
  Provision the hosted Q-Trust API on Vercel and deploy it.

.DESCRIPTION
  - Creates (or reuses) the <ProjectName> Vercel project for backend/.
  - Syncs every QTRUST_* variable from .env, with hosted-mode overrides:
      QTRUST_PG_URL            hosted Postgres (pooled Neon URL by default)
      QTRUST_PLANNER_URL       planner kept on the operator machine (tunnel)
      QTRUST_SCANNER_PROXY_URL local API tunnel for /v1/scan and /v1/evidence
      QTRUST_PUBLIC_URL        public API base (https://<project>.vercel.app/api)
      QTRUST_DATA_DIR          /tmp/qtrust (ephemeral serverless disk)
  - Writes backend/.vercel/project.json and runs `vercel deploy --prod`.

  Secrets are read from .env / the Vercel CLI auth file and are never echoed.

.PARAMETER ApiTunnel
  Base URL of the locally running API (defaults to the tunnel in .env).

.PARAMETER PlannerTunnel
  Base URL of the locally running planner (defaults to QTRUST_PLANNER_TUNNEL_URL).

.PARAMETER PublicUrl
  Public API base URL. Defaults to https://<ProjectName>.vercel.app/api.

.EXAMPLE
  pwsh -File deploy/vercel-backend.ps1
#>
[CmdletBinding()]
param(
  [string]$ProjectName = 'qtrust-backend',
  [string]$ApiTunnel = '',
  [string]$PlannerTunnel = '',
  [string]$PublicUrl = '',
  [switch]$SkipEnvSync,
  [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Read-EnvFile {
  param([string]$Path)
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $idx = $line.IndexOf('=')
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    # .env files commonly quote values (for example DATABASE_URL, which
    # contains & and ?). Vercel stores the literal string we send, so strip
    # exactly one matching quote pair. Without this, pg receives a connection
    # string wrapped in quotes and fails with ENOTFOUND on every hosted read.
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($key) { $map[$key] = $value }
  }
  return $map
}

function Get-VercelToken {
  $authPath = Join-Path $env:APPDATA 'com.vercel.cli\Data\auth.json'
  if (-not (Test-Path $authPath)) { throw "Vercel CLI auth file not found at $authPath. Run 'vercel login' first." }
  return (Get-Content $authPath -Raw | ConvertFrom-Json).token
}

function Get-TeamId {
  $projectJson = Join-Path $RepoRoot 'frontend\.vercel\project.json'
  if (Test-Path $projectJson) {
    $orgId = (Get-Content $projectJson -Raw | ConvertFrom-Json).orgId
    if ($orgId) { return $orgId }
  }
  return $null
}

function Invoke-VercelApi {
  <#
    Call the Vercel API with the CLI session token. The CLI session expires
    periodically; when that happens the CLI can refresh it silently from its
    stored refresh token. The unattended stack watchdog previously died here
    and left the hosted API pointing at dead tunnels, so refresh once and retry.
  #>
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Uri,
    $Body,
    [Parameter(Mandatory)][hashtable]$Headers
  )

  for ($attempt = 1; $attempt -le 2; $attempt++) {
    try {
      if ($null -ne $Body) {
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -ContentType 'application/json' -Body $Body
      }
      return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers
    } catch {
      $status = $null
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      $detail = ''
      try { $detail = [string]$_.ErrorDetails.Message } catch {}

      $expired = ($status -eq 403 -and $detail -match 'invalidToken')
      if (-not $expired -or $attempt -eq 2) { throw }

      Write-Host 'Vercel: CLI session expired; refreshing it via the Vercel CLI...' -ForegroundColor Yellow
      $vcScript = Join-Path (Split-Path (Get-Command node).Source) 'node_modules\vercel\dist\vc.js'
      if (-not (Test-Path $vcScript)) { throw 'Vercel CLI entrypoint not found; cannot refresh the session. Run vercel login.' }

      $outFile = Join-Path $env:TEMP 'qtrust-vercel-refresh.out.log'
      $errFile = Join-Path $env:TEMP 'qtrust-vercel-refresh.err.log'
      $proc = Start-Process -FilePath (Get-Command node).Source `
        -ArgumentList @($vcScript, 'whoami') `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile
      if ($proc.ExitCode -ne 0) {
        $errText = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue)
        throw "Vercel CLI session refresh failed (exit $($proc.ExitCode)). Run 'vercel login'. $errText"
      }

      $Headers.Authorization = "Bearer $(Get-VercelToken)"
    }
  }
}

$envMap = Read-EnvFile (Join-Path $RepoRoot '.env')
$frontendEnv = Read-EnvFile (Join-Path $RepoRoot 'frontend\.env.local')

# --- resolve hosted values -------------------------------------------------
$neonPooled = $envMap['QTRUST_HOSTED_PG_URL']
if (-not $neonPooled) { $neonPooled = $frontendEnv['DATABASE_URL'] }
if (-not $neonPooled) { throw 'No pooled hosted Postgres URL found (QTRUST_HOSTED_PG_URL or frontend/.env.local DATABASE_URL).' }

$resolvedApiTunnel = $ApiTunnel
if (-not $resolvedApiTunnel) { $resolvedApiTunnel = $envMap['QTRUST_SCANNER_PROXY_URL'] }
if (-not $resolvedApiTunnel -and $envMap['QTRUST_PUBLIC_URL'] -match 'trycloudflare\.com') { $resolvedApiTunnel = $envMap['QTRUST_PUBLIC_URL'] }
if (-not $resolvedApiTunnel) { $resolvedApiTunnel = $envMap['NEXT_PUBLIC_QTRUST_API_URL'] }
if (-not $resolvedApiTunnel) { throw 'No local API tunnel found for QTRUST_SCANNER_PROXY_URL (pass -ApiTunnel).' }

$resolvedPlanner = $PlannerTunnel
if (-not $resolvedPlanner) { $resolvedPlanner = $envMap['QTRUST_PLANNER_URL'] }
if (-not $resolvedPlanner -or $resolvedPlanner -match '^http://(planner|localhost)') { $resolvedPlanner = $envMap['QTRUST_PLANNER_TUNNEL_URL'] }
if (-not $resolvedPlanner) { $resolvedPlanner = $envMap['NEXT_PUBLIC_QTRUST_PLANNER_URL'] }
if (-not $resolvedPlanner) { throw 'No planner URL found (pass -PlannerTunnel).' }

$resolvedPublic = $PublicUrl
if (-not $resolvedPublic) { $resolvedPublic = "https://$ProjectName.vercel.app/api" }
$resolvedPublic = $resolvedPublic.TrimEnd('/')

# --- build the env map -----------------------------------------------------
$skipKeys = @(
  'QTRUST_EXTERNAL_PG_URL', 'QTRUST_COMPOSE_PG_URL', 'QTRUST_PLANNER_TUNNEL_URL',
  'QTRUST_GITHUB_REPO_URL', 'QTRUST_REDIS_URL', 'QTRUST_ALERT_WEBHOOK',
  'QTRUST_SCAN_CONTAINER_ROOT', 'QTRUST_SCAN_HOST_ROOT', 'QTRUST_LOCAL_PG_URL'
)
$envVars = @{}
foreach ($key in $envMap.Keys) {
  if (-not $key.StartsWith('QTRUST_')) { continue }
  if ($skipKeys -contains $key) { continue }
  $value = $envMap[$key]
  if ([string]::IsNullOrWhiteSpace($value)) { continue }
  $envVars[$key] = $value
}

$envVars['QTRUST_PG_URL'] = $neonPooled
$envVars['QTRUST_PLANNER_URL'] = $resolvedPlanner.TrimEnd('/')
$envVars['QTRUST_SCANNER_PROXY_URL'] = $resolvedApiTunnel.TrimEnd('/')
$envVars['QTRUST_PUBLIC_URL'] = $resolvedPublic
$envVars['QTRUST_BACKEND_URL'] = $resolvedPublic
$envVars['QTRUST_CORS_ORIGINS'] = 'http://localhost:3000,https://q-trust-nu.vercel.app'
$envVars['QTRUST_DATA_DIR'] = '/tmp/qtrust'
$envVars['QTRUST_EVIDENCE_DB_PATH'] = '/tmp/qtrust/evidence_chain.jsonl'
$envVars['QTRUST_SCAN_ALLOWED_ROOTS'] = '/workspace/projects'
$envVars['QTRUST_SERVERLESS'] = '1'

# --- create / reuse the project -------------------------------------------
Write-Host "Vercel: resolving project '$ProjectName'..." -ForegroundColor Cyan
$token = Get-VercelToken
$team = Get-TeamId
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
$projectQuery = if ($team) { "?teamId=$team" } else { '' }

$project = $null
try {
  $project = Invoke-VercelApi -Method Post -Uri "https://api.vercel.com/v11/projects$projectQuery" -Headers $headers -Body (@{ name = $ProjectName } | ConvertTo-Json -Compress)
  Write-Host "  created project $($project.id)" -ForegroundColor Green
} catch {
  $status = $null
  try { $status = [int]$_.Exception.Response.StatusCode } catch {}
  if ($status -eq 409) {
    $project = Invoke-VercelApi -Method Get -Uri "https://api.vercel.com/v9/projects/$ProjectName$projectQuery" -Headers $headers
    Write-Host "  reusing project $($project.id)" -ForegroundColor Yellow
  } else {
    throw
  }
}

# --- link the local backend folder ----------------------------------------
$linkDir = Join-Path $RepoRoot 'backend\.vercel'
New-Item -ItemType Directory -Force -Path $linkDir | Out-Null
$link = @{ projectId = $project.id; orgId = $team; projectName = $ProjectName } | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $linkDir 'project.json'), $link)

# --- sync env vars ---------------------------------------------------------
if (-not $SkipEnvSync) {
  Write-Host "Vercel: syncing $($envVars.Count) environment variables..." -ForegroundColor Cyan
  $envQuery = if ($team) { "?teamId=$team&upsert=true" } else { "?upsert=true" }
  $synced = 0
  foreach ($key in ($envVars.Keys | Sort-Object)) {
    $payload = @{
      key    = $key
      value  = [string]$envVars[$key]
      type   = 'encrypted'
      target = @('production', 'preview', 'development')
    } | ConvertTo-Json -Compress
    Invoke-VercelApi -Method Post -Uri "https://api.vercel.com/v10/projects/$($project.id)/env$envQuery" -Headers $headers -Body $payload | Out-Null
    $synced++
  }
  Write-Host "  synced $synced variables" -ForegroundColor Green
  Write-Host "  keys: $((($envVars.Keys | Sort-Object) -join ', '))"
}

# --- deploy ----------------------------------------------------------------
if (-not $SkipDeploy) {
  Write-Host 'Vercel: deploying backend (production)...' -ForegroundColor Cyan
  # Invoke the CLI through node with redirected streams: PowerShell 5.1 turns
  # the CLI's stderr banner into a terminating error otherwise.
  $vcScript = Join-Path (Split-Path (Get-Command node).Source) 'node_modules\vercel\dist\vc.js'
  if (-not (Test-Path $vcScript)) { throw "Vercel CLI entrypoint not found at $vcScript" }
  $outFile = Join-Path $env:TEMP 'qtrust-vercel-deploy.out.log'
  $errFile = Join-Path $env:TEMP 'qtrust-vercel-deploy.err.log'
  $proc = Start-Process -FilePath (Get-Command node).Source `
    -ArgumentList @($vcScript, 'deploy', '--prod', '--yes') `
    -WorkingDirectory (Join-Path $RepoRoot 'backend') `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  $raw = ((Get-Content $outFile -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content $errFile -Raw -ErrorAction SilentlyContinue))
  $clean = $raw -replace "\x1B\[[0-9;]*[A-Za-z]", ''
  Write-Host $clean
  Write-Host "CLI exit code: $($proc.ExitCode)" -ForegroundColor Cyan
  $urls = [regex]::Matches($clean, 'https://[a-z0-9\.\-]+\.vercel\.app') | ForEach-Object { $_.Value } | Select-Object -Unique
  $production = ($clean -split "`n" | Where-Object { $_ -match 'Production:' } | Select-Object -First 1)
  Write-Host ''
  Write-Host 'Deployment URLs:' -ForegroundColor Cyan
  foreach ($u in $urls) { Write-Host "  $u" }
  if ($production) { Write-Host "Production line: $($production.Trim())" }
  Write-Host ''
  Write-Host "Expected API base: $resolvedPublic" -ForegroundColor Cyan
  Write-Host 'If the production URL differs, re-run with -PublicUrl https://<alias>/api -SkipEnvSync:$false (envs) and deploy again.'
}

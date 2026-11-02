#requires -Version 5.1
<#
.SYNOPSIS
  Keep the Q-Trust local dependency stack alive.

.DESCRIPTION
  The hosted deployment (Vercel API + frontend) depends on this machine for:
    - the Python crypto inspector        -> /v1/scan/*, /v1/evidence/*  (API tunnel)
    - the ML model bridge (CPU)          -> /v1/gpu/*
    - the planner                        -> /v1/plans, /v1/gpu/rl/plan (planner tunnel)
    - the Postgres indexer               -> the read model used by the hosted API

  This script is safe to run repeatedly (scheduled every five minutes):
    1. Starts Docker Desktop if it is not running.
    2. Ensures the postgres/redis/api/planner containers are up.
    3. Ensures both cloudflared quick tunnels are running.
    4. If a tunnel URL changed, updates .env and re-syncs + redeploys the
       Vercel backend so QTRUST_SCANNER_PROXY_URL / QTRUST_PLANNER_URL follow it.

  State (tunnel URLs, Docker status) is logged to deploy/logs/stack.log.

.PARAMETER SkipDeploy
  Never touch Vercel; only keep the local stack and .env in sync.

.PARAMETER WaitSeconds
  How long to wait for a freshly started tunnel to publish its URL.

.PARAMETER InstallTask
  Install a Windows Scheduled Task (at logon + every five minutes).
  Requires an elevated PowerShell session.

.PARAMETER InstallStartup
  Install a per-user Startup-folder watcher instead (no admin required). It
  launches this script hidden every five minutes.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy/ensure-local-stack.ps1

.EXAMPLE
  # Install the five-minute watchdog (runs as the current user)
  powershell -ExecutionPolicy Bypass -File deploy/ensure-local-stack.ps1 -InstallStartup
#>
[CmdletBinding()]
param(
  [switch]$SkipDeploy,
  [switch]$InstallTask,
  [switch]$InstallStartup,
  [int]$WaitSeconds = 90
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $PSScriptRoot 'logs'
$EnvPath = Join-Path $RepoRoot '.env'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log {
  param([string]$Message)
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path (Join-Path $LogDir 'stack.log') -Value $line
  Write-Host $line
}

function Read-EnvMap {
  $map = @{}
  if (-not (Test-Path $EnvPath)) { return $map }
  foreach ($line in [IO.File]::ReadAllLines($EnvPath)) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $idx = $line.IndexOf('=')
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if ($key) { $map[$key] = $value }
  }
  return $map
}

function Set-EnvValue {
  param([string]$Key, [string]$Value)
  $lines = @([IO.File]::ReadAllLines($EnvPath))
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line -match ('^' + [regex]::Escape($Key) + '=')) {
      $found = $true
      "$Key=$Value"
    } else {
      $line
    }
  }
  if (-not $found) { $out = @($out) + "$Key=$Value" }
  [IO.File]::WriteAllLines($EnvPath, $out)
}

function Test-Docker {
  cmd /c "docker info >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

function Ensure-Docker {
  if (Test-Docker) { return $true }
  $desktop = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
    'C:\Program Files\Docker\Docker\Docker Desktop.exe',
    (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($desktop) {
    Write-Log "Docker is not running; starting Docker Desktop from $desktop"
    Start-Process -FilePath $desktop | Out-Null
  } else {
    Write-Log 'Docker is not running and Docker Desktop was not found'
    return $false
  }
  for ($i = 0; $i -lt 36; $i++) {
    Start-Sleep -Seconds 5
    if (Test-Docker) {
      Write-Log 'Docker is ready'
      return $true
    }
  }
  Write-Log 'Docker did not become ready in 3 minutes'
  return $false
}

function Ensure-Cloudflared {
  $exe = Join-Path $env:LOCALAPPDATA 'qtrust\bin\cloudflared.exe'
  if (Test-Path $exe) { return $exe }
  New-Item -ItemType Directory -Force -Path (Split-Path $exe) | Out-Null
  Write-Log 'Downloading cloudflared'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $exe
  return $exe
}

function Get-TunnelProcess {
  param([int]$Port)
  return Get-CimInstance Win32_Process -Filter "name like '%cloudflared%'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match ('--url\s+http://(127\.0\.0\.1|localhost):' + $Port + '(\s|$)') } |
    Select-Object -First 1
}

function Get-TunnelUrlFromLog {
  param([string]$Path, [int]$WaitSeconds = 0)
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  do {
    if (Test-Path $Path) {
      $match = Select-String -Path $Path -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
        Select-Object -Last 1
      if ($match) { return $match.Matches[0].Value }
    }
    if ($WaitSeconds -le 0) { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Get-LogPathFromProcess {
  param($Process)
  # Quoted paths with spaces (the normal case on this box) must be captured
  # whole; the old single regex stopped at the first space, so every healthy
  # tunnel looked like it had no URL and the watchdog restarted it.
  if ($Process.CommandLine -match '--logfile\s+"([^"]+)"') { return $Matches[1] }
  if ($Process.CommandLine -match '--logfile\s+(\S+)') { return $Matches[1] }
  return $null
}

# Diagnostics only. A quick tunnel routinely answers 530 for a minute while it
# re-registers its QUIC connection, then recovers on the *same* URL. Restarting
# on the first failed probe changes the URL and forces a Vercel redeploy, which
# is worse than the blip, so Ensure-Tunnel never kills a running process.
function Test-TunnelUrl {
  param([string]$Url)
  if (-not $Url) { return $false }
  try {
    Invoke-WebRequest -Uri ($Url.TrimEnd('/') + '/') -UseBasicParsing -TimeoutSec 12 -ErrorAction Stop | Out-Null
    return $true
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    # 4xx proves Cloudflare reached the origin (e.g. a 404 from Fastify).
    return ($code -ge 200 -and $code -lt 500)
  }
}

function Ensure-Tunnel {
  param(
    [string]$Name,
    [int]$Port,
    [string]$EnvKey,
    [string]$ExistingUrl
  )
  $process = Get-TunnelProcess -Port $Port
  if ($process) {
    $logPath = Get-LogPathFromProcess -Process $process
    $url = $null
    if ($logPath) { $url = Get-TunnelUrlFromLog -Path $logPath }
    if ($url) {
      if ($url -ne $ExistingUrl) {
        Write-Log "$Name tunnel URL changed: $ExistingUrl -> $url"
        return @{ Url = $url; Changed = $true }
      }
      if (-not (Test-TunnelUrl -Url $url)) {
        # A quick tunnel can survive a short 530 blip, but a QUIC connection
        # that has been dead for many minutes will not recover on its own.
        # Restarting changes the URL, which triggers an automatic Vercel env
        # sync and redeploy below, so only do it after a sustained outage.
        $ageMinutes = 0
        try { $ageMinutes = ((Get-Date) - [datetime]$process.CreationDate).TotalMinutes } catch { }
        if ($ageMinutes -lt 15) {
          Write-Log "$Name tunnel URL $url is temporarily unreachable; keeping the process so it can reconnect with the same URL"
          return @{ Url = $url; Changed = $false }
        }
        Write-Log "$Name tunnel URL $url has been unreachable for $([math]::Round($ageMinutes, 1)) minutes; restarting with HTTP/2"
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        $process = $null
      } else {
        return @{ Url = $url; Changed = $false }
      }
    } else {
      Write-Log "$Name tunnel (pid $($process.ProcessId)) is running; no URL in the log yet, keeping it"
      return @{ Url = $ExistingUrl; Changed = $false }
    }
  }

  $exe = Ensure-Cloudflared
  $logPath = Join-Path $LogDir "cloudflared-$Name.log"
  if (Test-Path $logPath) { Remove-Item $logPath -Force -ErrorAction SilentlyContinue }
  Write-Log "Starting $Name tunnel on port $Port"
  Start-Process -FilePath $exe -ArgumentList @(
    'tunnel', '--url', "http://127.0.0.1:$Port", '--no-autoupdate',
    '--edge-ip-version', '4', '--protocol', 'http2',
    '--logfile', ('"{0}"' -f $logPath), '--loglevel', 'info'
  ) -WindowStyle Hidden | Out-Null

  $url = Get-TunnelUrlFromLog -Path $logPath -WaitSeconds $WaitSeconds
  if (-not $url) {
    Write-Log "$Name tunnel did not publish a URL within $WaitSeconds seconds"
    return @{ Url = $ExistingUrl; Changed = $false }
  }
  Write-Log "$Name tunnel URL: $url"
  return @{ Url = $url; Changed = ($url -ne $ExistingUrl) }
}

if ($InstallTask) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f (Join-Path $PSScriptRoot 'ensure-local-stack.ps1'))
  $atLogon = New-ScheduledTaskTrigger -AtLogOn
  $repeat = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName 'QTrustLocalStack' -Action $action -Trigger @($atLogon, $repeat) -Description 'Keeps Q-Trust Docker services and cloudflared tunnels alive' -Force | Out-Null
  Write-Log 'Installed scheduled task QTrustLocalStack (at logon + every 5 minutes)'
  return
}

if ($InstallStartup) {
  $startup = [Environment]::GetFolderPath('Startup')
  $vbsPath = Join-Path $startup 'QTrustLocalStack.vbs'
  $scriptPath = Join-Path $PSScriptRoot 'ensure-local-stack.ps1'
  $vbs = @"
Set shell = CreateObject("WScript.Shell")
Do
  shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$scriptPath""", 0, True
  WScript.Sleep 300000
Loop
"@
  [IO.File]::WriteAllText($vbsPath, $vbs)
  Write-Log "Installed startup watcher: $vbsPath"
  Write-Log 'It runs hidden at every logon and repeats every five minutes.'
  return
}

if (-not (Ensure-Docker)) { exit 1 }

Write-Log 'Ensuring Q-Trust containers'
Push-Location $RepoRoot
try {
  cmd /c "docker compose up -d postgres redis api planner >nul 2>&1"
  if ($LASTEXITCODE -ne 0) { Write-Log 'docker compose up failed; see docker compose logs' }
} finally {
  Pop-Location
}

# Give the API a moment on first boot, then verify it is actually serving.
# Only restart a container that Docker itself reports as dead/unhealthy; a slow
# health probe (for example while a scan is using the CPU) must not bounce it.
$apiReady = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/v1/health' -TimeoutSec 5
    if ($health.status -eq 'ok' -or $health.chainId) { $apiReady = $true; break }
  } catch { }
  if (-not $apiReady) { Start-Sleep -Seconds 3 }
}
if (-not $apiReady) {
  $state = (& docker inspect qtrust-api --format '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>$null)
  if ($state -match 'unhealthy|^exited|^dead') {
    Write-Log "Local API is $state; restarting qtrust-api"
    cmd /c "docker restart qtrust-api >nul 2>&1"
  } else {
    Write-Log "Local API did not answer /v1/health yet (container $state); leaving it running"
  }
}

$envMap = Read-EnvMap
$apiExisting = if ($envMap['QTRUST_SCANNER_PROXY_URL']) { $envMap['QTRUST_SCANNER_PROXY_URL'] } else { $envMap['QTRUST_PUBLIC_URL'] }
$plannerExisting = $envMap['QTRUST_PLANNER_TUNNEL_URL']

$apiTunnel = Ensure-Tunnel -Name 'api' -Port 3001 -EnvKey 'QTRUST_SCANNER_PROXY_URL' -ExistingUrl $apiExisting
$plannerTunnel = Ensure-Tunnel -Name 'planner' -Port 8000 -EnvKey 'QTRUST_PLANNER_TUNNEL_URL' -ExistingUrl $plannerExisting

if ($apiTunnel.Url) {
  if ($envMap['QTRUST_SCANNER_PROXY_URL'] -ne $apiTunnel.Url) { Set-EnvValue -Key 'QTRUST_SCANNER_PROXY_URL' -Value $apiTunnel.Url }
  if ($envMap['QTRUST_PUBLIC_URL'] -ne $apiTunnel.Url) { Set-EnvValue -Key 'QTRUST_PUBLIC_URL' -Value $apiTunnel.Url }
}
if ($plannerTunnel.Url -and $envMap['QTRUST_PLANNER_TUNNEL_URL'] -ne $plannerTunnel.Url) {
  Set-EnvValue -Key 'QTRUST_PLANNER_TUNNEL_URL' -Value $plannerTunnel.Url
}

$urlsChanged = $apiTunnel.Changed -or $plannerTunnel.Changed
if ($urlsChanged -and -not $SkipDeploy) {
  $syncScript = Join-Path $PSScriptRoot 'vercel-backend.ps1'
  if (Test-Path $syncScript) {
    Write-Log 'Tunnel URL changed; re-syncing Vercel environment and redeploying the API'
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -ApiTunnel $apiTunnel.Url -PlannerTunnel $plannerTunnel.Url 2>&1 |
        ForEach-Object { Add-Content -Path (Join-Path $LogDir 'stack.log') -Value $_ }
      Write-Log 'Vercel re-sync finished'
    } catch {
      Write-Log "Vercel re-sync failed: $($_.Exception.Message)"
    }
  }
} elseif ($urlsChanged) {
  Write-Log 'Tunnel URL changed; -SkipDeploy was set, so Vercel was not updated'
}

Write-Log 'Stack check complete'

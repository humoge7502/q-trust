#requires -Version 5.1
<#
.SYNOPSIS
  Publish the local Q-Trust commits to a GitHub repo so Render can build them.

.DESCRIPTION
  Reads a GitHub token from .env (GITHUB_TOKEN or GH_TOKEN) or the process
  environment, verifies it with the GitHub API, creates the target repo if it
  does not exist, adds a "deploy" git remote and pushes the current branch.

  The token is never written to .git/config: the push uses a one-shot URL and
  the remote is reset to the clean HTTPS URL afterwards.

.EXAMPLE
  powershell -File .\deploy\push-repo.ps1
  powershell -File .\deploy\push-repo.ps1 -RepoName q-trust -Private
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RepoName = "q-trust",
  [string]$Owner = "",
  [switch]$Private,
  [string]$Branch = ""
)

$ErrorActionPreference = "Stop"

function Read-DotEnv([string]$Path) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $map }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { continue }
    $map[$line.Substring(0, $idx).Trim()] = $line.Substring($idx + 1).Trim()
  }
  return $map
}

$envMap = Read-DotEnv (Join-Path $RepoRoot ".env")
$token = $envMap["GITHUB_TOKEN"]
if ([string]::IsNullOrWhiteSpace($token)) { $token = $envMap["GH_TOKEN"] }
if ([string]::IsNullOrWhiteSpace($token)) { $token = $env:GITHUB_TOKEN }
if ([string]::IsNullOrWhiteSpace($token)) { $token = $env:GH_TOKEN }
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "No GitHub token found. Add GITHUB_TOKEN=... to .env (repo scope) and rerun."
}

$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "qtrust-deploy"
}

Write-Host "==> Verifying GitHub token" -ForegroundColor Cyan
$me = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers -TimeoutSec 30
$login = $me.login
if ([string]::IsNullOrWhiteSpace($Owner)) { $Owner = $login }
Write-Host "    authenticated as $login; target repo $Owner/$RepoName"

Write-Host "==> Ensuring repository exists" -ForegroundColor Cyan
$repoExists = $true
try {
  $null = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$RepoName" -Headers $headers -TimeoutSec 30
} catch {
  $repoExists = $false
}
if (-not $repoExists) {
  Write-Host "    creating $Owner/$RepoName"
  $body = @{
    name = $RepoName
    description = "Q-Trust full-stack deployment fork (post-quantum migration assurance on Base Sepolia)"
    private = [bool]$Private
    has_issues = $true
    has_wiki = $false
  } | ConvertTo-Json -Compress
  $null = Invoke-RestMethod -Method Post -Uri "https://api.github.com/user/repos" -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 30
  Start-Sleep -Seconds 3
}

if ([string]::IsNullOrWhiteSpace($Branch)) {
  $Branch = (git -C $RepoRoot branch --show-current).Trim()
}
if ([string]::IsNullOrWhiteSpace($Branch)) { throw "Could not determine the current git branch." }

$cleanUrl = "https://github.com/$Owner/$RepoName.git"
$pushUrl = "https://x-access-token:$token@github.com/$Owner/$RepoName.git"

Write-Host "==> Pushing $Branch to $Owner/$RepoName" -ForegroundColor Cyan
$existing = git -C $RepoRoot remote
if ($existing -contains "deploy") {
  git -C $RepoRoot remote set-url deploy $cleanUrl | Out-Null
} else {
  git -C $RepoRoot remote add deploy $cleanUrl | Out-Null
}

git -C $RepoRoot push $pushUrl "refs/heads/$Branch`:refs/heads/$Branch" --force-with-lease 2>&1 | ForEach-Object {
  $_ -replace [regex]::Escape($token), "***"
}
if ($LASTEXITCODE -ne 0) { throw "git push failed with exit code $LASTEXITCODE" }

Write-Host "    pushed; remote 'deploy' -> $cleanUrl"
Write-Host "==> Done. Use -RepoUrl $cleanUrl with deploy/deploy-render.ps1" -ForegroundColor Green

#requires -Version 5.1
<#
.SYNOPSIS
  Deploy the Q-Trust UUPS registries to Base Sepolia and wire the addresses
  into .env and frontend/.env.local.

.DESCRIPTION
  Uses the pinned Foundry Docker image so no local Forge install is required.
  The deployer key is read from .env and never placed on a command line.
  The relayer address is granted the operational roles via QTRUST_DEV_GRANTEE
  so the hosted backend can register assets immediately after deployment.
  Only DEFAULT_ADMIN_ROLE is renounced by the deploy script.

  Run from anywhere:
    pwsh ./deploy/deploy-contracts.ps1
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$envPath = Join-Path $RepoRoot ".env"
$frontendEnvPath = Join-Path $RepoRoot "frontend\.env.local"
$image = "ghcr.io/foundry-rs/foundry:latest"
$logDir = Join-Path $RepoRoot "deploy\logs"
$logPath = Join-Path $logDir "contracts-deploy.log"

function Read-DotEnv([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { continue }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    $map[$key] = $value
  }
  return $map
}

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = @(Get-Content -LiteralPath $Path)
  $found = $false
  $escapedKey = [regex]::Escape($Key)
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$escapedKey\s*=") {
      $lines[$i] = "$Key=$Value"
      $found = $true
    }
  }
  if (-not $found) { $lines += "$Key=$Value" }
  Set-Content -LiteralPath $Path -Value $lines -Encoding utf8
}

function Assert-Filled([hashtable]$Map, [string]$Key) {
  $value = $Map[$Key]
  if ([string]::IsNullOrWhiteSpace($value) -or $value -match '^__FILL') {
    throw "Missing $Key in .env. Fill it before deploying (see deploy/README.md)."
  }
}

function Select-FoundryValue([string]$Text, [string]$Pattern) {
  # Foundry prints migration/deprecation warnings to stderr, which get folded
  # into the captured output. Pull just the value we care about.
  $matches = [regex]::Matches($Text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
  if ($matches.Count -eq 0) { return "" }
  $match = $matches[$matches.Count - 1]
  if ($match.Groups.Count -gt 1) { return $match.Groups[1].Value.Trim() }
  return $match.Value.Trim()
}

function Invoke-Foundry([string]$Command, [hashtable]$ExtraEnv = @{}) {
  $dockerArgs = @(
    "run", "--rm",
    "--env-file", $envPath
  )
  foreach ($key in $ExtraEnv.Keys) {
    $dockerArgs += @("-e", "$key=$($ExtraEnv[$key])")
  }
  $dockerArgs += @(
    "--mount", "type=bind,source=$RepoRoot\contracts,target=/contracts",
    "--workdir", "/contracts",
    "--entrypoint", "sh",
    $image,
    "-c", $Command
  )
  # Docker/Foundry write progress and warnings to stderr. Windows PowerShell
  # turns native stderr into ErrorRecords, and the script-level Stop policy
  # would abort even when the command succeeds. Capture with Continue instead.
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & docker @dockerArgs 2>&1
    $exit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $oldPreference
  }
  return @{ Output = ($output -join "`n"); ExitCode = $exit }
}

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "No .env found at $envPath. Copy .env.example and fill it first."
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$envMap = Read-DotEnv $envPath
Assert-Filled $envMap "QTRUST_DEPLOYER_PRIVATE_KEY"
Assert-Filled $envMap "QTRUST_RELAYER_PRIVATE_KEY"
Assert-Filled $envMap "QTRUST_BASE_SEPOLIA_RPC"

$rpc = $envMap["QTRUST_BASE_SEPOLIA_RPC"]
if ($rpc -notmatch '^https://') {
  throw "QTRUST_BASE_SEPOLIA_RPC must be an https:// endpoint for the hosted backend."
}

Write-Host "==> Checking deployer and relayer on Base Sepolia" -ForegroundColor Cyan
$deployer = Select-FoundryValue (Invoke-Foundry 'cast wallet address --private-key "$QTRUST_DEPLOYER_PRIVATE_KEY"').Output '0x[0-9a-fA-F]{40}'
$relayer = Select-FoundryValue (Invoke-Foundry 'cast wallet address --private-key "$QTRUST_RELAYER_PRIVATE_KEY"').Output '0x[0-9a-fA-F]{40}'

if ($deployer -notmatch '^0x[0-9a-fA-F]{40}$') { throw "Could not derive deployer address: $deployer" }
if ($relayer -notmatch '^0x[0-9a-fA-F]{40}$') { throw "Could not derive relayer address: $relayer" }
if ($deployer -eq $relayer) {
  throw "Deployer and relayer must be different keys (the backend refuses the deployer key at runtime)."
}

$deployerBalance = [decimal](Select-FoundryValue (Invoke-Foundry "cast balance $deployer --rpc-url `"`$QTRUST_BASE_SEPOLIA_RPC`" --ether").Output '^\s*(\d+(?:\.\d+)?)\s*$')
$relayerBalance = [decimal](Select-FoundryValue (Invoke-Foundry "cast balance $relayer --rpc-url `"`$QTRUST_BASE_SEPOLIA_RPC`" --ether").Output '^\s*(\d+(?:\.\d+)?)\s*$')
Write-Host ("    deployer {0}  {1} ETH" -f $deployer, $deployerBalance)
Write-Host ("    relayer  {0}  {1} ETH" -f $relayer, $relayerBalance)

if ($deployerBalance -lt [decimal]0.01) {
  throw "Deployer has less than 0.01 ETH on Base Sepolia. Fund it at https://www.alchemy.com/faucets/base-sepolia"
}
if ($relayerBalance -lt [decimal]0.001) {
  Write-Warning "Relayer has less than 0.001 ETH; attestation broadcasts may fail."
}

if (-not $SkipTests) {
  Write-Host "==> forge test" -ForegroundColor Cyan
  $tests = Invoke-Foundry "forge test"
  $tests.Output | Set-Content -LiteralPath (Join-Path $logDir "contracts-test.log") -Encoding utf8
  if ($tests.ExitCode -ne 0) {
    $tests.Output | Select-Object -Last 40 | Write-Host
    throw "forge test failed; refusing to deploy."
  }
  Write-Host "    contract tests passed"
}

Write-Host "==> Deploying contracts to Base Sepolia" -ForegroundColor Cyan
Write-Host "    operational roles will be granted to relayer $relayer (QTRUST_DEV_GRANTEE)"
$deploy = Invoke-Foundry 'forge script script/Deploy.s.sol --rpc-url "$QTRUST_BASE_SEPOLIA_RPC" --broadcast --chain-id 84532 --slow' @{ QTRUST_DEV_GRANTEE = $relayer }
$deploy.Output | Set-Content -LiteralPath $logPath -Encoding utf8
if ($deploy.ExitCode -ne 0) {
  $deploy.Output | Select-Object -Last 60 | Write-Host
  throw "Contract deployment failed. Full log: $logPath"
}

$patterns = [ordered]@{
  "QTRUST_ASSET_REGISTRY_ADDRESS"           = 'AssetRegistry proxy:\s+(0x[0-9a-fA-F]{40})'
  "QTRUST_VENDOR_REGISTRY_ADDRESS"          = 'VendorRegistry proxy:\s+(0x[0-9a-fA-F]{40})'
  "QTRUST_MIGRATION_REGISTRY_ADDRESS"       = 'MigrationRegistry proxy:\s+(0x[0-9a-fA-F]{40})'
  "QTRUST_AUDIT_REGISTRY_ADDRESS"           = 'AuditRegistry proxy:\s+(0x[0-9a-fA-F]{40})'
  "QTRUST_REVOCATION_ANCHOR_ADDRESS"        = 'RevocationAnchor proxy:\s+(0x[0-9a-fA-F]{40})'
  "QTRUST_POLICY_COMMITMENT_ADDRESS"        = 'PolicyCommitment proxy:\s+(0x[0-9a-fA-F]{40})'
  "QTRUST_SCHEMA_REGISTRY_ADDRESS"          = 'SchemaRegistry proxy:\s+(0x[0-9a-fA-F]{40})'
  "QTRUST_TRUST_ANCHOR_REGISTRY_ADDRESS"    = 'TrustAnchorRegistry proxy:\s+(0x[0-9a-fA-F]{40})'
}

$addresses = @{}
foreach ($key in $patterns.Keys) {
  $match = [regex]::Match($deploy.Output, $patterns[$key])
  if (-not $match.Success) {
    throw "Could not parse $key from deployment output. Full log: $logPath"
  }
  $addresses[$key] = $match.Groups[1].Value
}

# Deployment block: lowest receipt block from the broadcast artifact.
$broadcastPath = Join-Path $RepoRoot "contracts\broadcast\Deploy.s.sol\84532\run-latest.json"
$fromBlock = 0
if (Test-Path -LiteralPath $broadcastPath) {
  $artifact = Get-Content -LiteralPath $broadcastPath -Raw | ConvertFrom-Json
  $blocks = @()
  foreach ($receipt in @($artifact.receipts)) {
    if ($null -eq $receipt -or -not $receipt.blockNumber) { continue }
    $raw = [string]$receipt.blockNumber
    if ($raw -match '^0x') { $blocks += [Convert]::ToInt64($raw.Substring(2), 16) }
    elseif ($raw -match '^\d+$') { $blocks += [int64]$raw }
  }
  if ($blocks.Count -gt 0) { $fromBlock = ($blocks | Measure-Object -Minimum).Minimum }
}
if ($fromBlock -eq 0) {
  $fromBlock = [int64](Select-FoundryValue (Invoke-Foundry 'cast block-number --rpc-url "$QTRUST_BASE_SEPOLIA_RPC"').Output '^\s*(\d+)\s*$')
}

Write-Host "==> Writing addresses to .env and frontend/.env.local" -ForegroundColor Cyan
foreach ($key in $addresses.Keys) {
  Set-EnvValue $envPath $key $addresses[$key]
}
Set-EnvValue $envPath "QTRUST_INDEXER_FROM_BLOCK" $fromBlock

$frontendMap = @{
  "NEXT_PUBLIC_QTRUST_ASSET_REGISTRY_ADDRESS"        = "QTRUST_ASSET_REGISTRY_ADDRESS"
  "NEXT_PUBLIC_QTRUST_VENDOR_REGISTRY_ADDRESS"       = "QTRUST_VENDOR_REGISTRY_ADDRESS"
  "NEXT_PUBLIC_QTRUST_MIGRATION_REGISTRY_ADDRESS"    = "QTRUST_MIGRATION_REGISTRY_ADDRESS"
  "NEXT_PUBLIC_QTRUST_AUDIT_REGISTRY_ADDRESS"        = "QTRUST_AUDIT_REGISTRY_ADDRESS"
}
foreach ($frontKey in $frontendMap.Keys) {
  $value = $addresses[$frontendMap[$frontKey]]
  Set-EnvValue $frontendEnvPath $frontKey $value
  Set-EnvValue $envPath $frontKey $value
}

Write-Host ""
Write-Host "Contracts deployed on Base Sepolia (chain 84532)" -ForegroundColor Green
foreach ($key in $patterns.Keys) {
  Write-Host ("  {0,-42} {1}" -f $key, $addresses[$key])
}
Write-Host ("  {0,-42} {1}" -f "QTRUST_INDEXER_FROM_BLOCK", $fromBlock)
Write-Host ""
Write-Host "Relayer operational roles granted to $relayer" -ForegroundColor Green
Write-Host "Next: deploy the backend + planner (Render) and frontend (Vercel) - see deploy/README.md" -ForegroundColor Yellow

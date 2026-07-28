#Requires -Version 5.1
<#
.SYNOPSIS
  Start the local IBKR HTTP bridge (loopback).
.PARAMETER EnvFile
  Optional path to .env (default: beside this script's package root).
.PARAMETER Mock
  If set, runs with BRIDGE_MOCK_IBKR=1 (no Gateway).
#>
param(
  [string]$EnvFile = "",
  [switch]$Mock
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Test-Path (Join-Path $Root "node_modules\dotenv"))) {
  Write-Host "Installing bridge deps (dotenv)..."
  npm install --no-fund --no-audit
}

$env:BRIDGE_HOST = if ($env:BRIDGE_HOST) { $env:BRIDGE_HOST } else { "127.0.0.1" }
$env:BRIDGE_PORT = if ($env:BRIDGE_PORT) { $env:BRIDGE_PORT } else { "3010" }

if ($Mock) {
  $env:BRIDGE_MOCK_IBKR = "1"
  if (-not $env:LOCAL_BRIDGE_TOKEN) {
    $env:BRIDGE_ALLOW_EPHEMERAL_TOKEN = "1"
  }
}

if ($EnvFile -and (Test-Path $EnvFile)) {
  Write-Host "Loading env from $EnvFile (dotenv also loads ../.env and ./.env)"
}

Write-Host "Starting local-ibkr-bridge from $Root ..."
node server.js
exit $LASTEXITCODE

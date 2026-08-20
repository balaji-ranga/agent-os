#Requires -Version 5.1
<#
.SYNOPSIS
  POST /push-eod-snapshot on the local IBKR bridge (after US close).
  Starts W3 on the cloud ingest URL (then W1) when WEBHOOK_URL is configured.
#>
param(
  [string]$BridgeUrl = "http://127.0.0.1:3010"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env"
if (-not (Test-Path $EnvFile)) {
  Write-Error "Missing $EnvFile"
}
$tok = $null
Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*LOCAL_BRIDGE_TOKEN\s*=\s*(.*)$') { $tok = $Matches[1].Trim() }
}
if (-not $tok) { Write-Error "LOCAL_BRIDGE_TOKEN missing in $EnvFile" }

$uri = ($BridgeUrl.TrimEnd('/')) + '/push-eod-snapshot'
Write-Host "POST $uri"
$res = Invoke-RestMethod -Method POST -Uri $uri -Headers @{ Authorization = "Bearer $tok" } -ContentType "application/json" -Body "{}" -TimeoutSec 60
Write-Host ("ok=" + [string]$res.ok)
exit 0

#Requires -Version 5.1
<#
.SYNOPSIS
  Run a Flolah workflow locally (orchestrator on this machine; state on Flolah).
.PARAMETER InputText
  Optional plain-text trigger input.
.PARAMETER InputJson
  Optional JSON string for structured trigger input.
.PARAMETER ParamsPath
  Path to workflow.params.json (default: beside this script).
#>
param(
  [string]$InputText = "",
  [string]$InputJson = "",
  [string]$ParamsPath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ParamsPath) { $ParamsPath = Join-Path $Root "workflow.params.json" }
$Runner = Join-Path $Root "runner\run.js"
$BundledNode = Join-Path $Root "runtime\node.exe"

if (-not (Test-Path $ParamsPath)) {
  Write-Error "Missing $ParamsPath - re-download the desktop package from Flolah."
}
if (-not (Test-Path $Runner)) {
  Write-Error "Missing runner at $Runner"
}

# Prefer bundled portable Node shipped in the zip (no system install required).
$nodeExe = $null
if (Test-Path $BundledNode) {
  $nodeExe = $BundledNode
  Write-Host "Using bundled Node: $BundledNode"
} else {
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys) {
    $nodeExe = $sys.Source
    Write-Host "Bundled runtime\node.exe missing - falling back to system Node: $nodeExe"
  } else {
    Write-Error "Missing runtime\node.exe and no system Node on PATH. Re-download the package from Flolah."
  }
}

$nodeArgs = @($Runner, "--params", $ParamsPath)
if ($InputJson) {
  $nodeArgs += @("--input-json", $InputJson)
} elseif ($InputText) {
  $nodeArgs += @("--input", $InputText)
}

Write-Host "Flolah desktop workflow - starting local orchestrator..."
& $nodeExe @nodeArgs
exit $LASTEXITCODE

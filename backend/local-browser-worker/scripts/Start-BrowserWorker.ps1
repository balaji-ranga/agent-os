#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Node = Join-Path $Root 'runtime\node.exe'
if (-not (Test-Path $Node)) { $Node = 'node' }

if (-not (Test-Path (Join-Path $Root 'node_modules\playwright'))) {
  Write-Host 'First-run: npm install --omit=dev'
  npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
  Write-Host 'Installing Playwright Chromium…'
  & $Node .\node_modules\playwright\cli.js install chromium
  if ($LASTEXITCODE -ne 0) { throw 'playwright install chromium failed' }
}

Write-Host 'Starting Local Browser Worker (keep this window open)…'
& $Node .\src\server.js

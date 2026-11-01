param([ValidateSet('lab','gateway')][string]$Mode='lab',[string]$Config)
$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or later, then run again.' }
  node ../check-node.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 or later is required.' }
  if (-not (Test-Path node_modules)) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'Edge dependency install failed.' } }
  if (-not (Test-Path ../backend/node_modules)) { npm --prefix ../backend ci; if ($LASTEXITCODE -ne 0) { throw 'Lab dependency install failed.' } }
  if ($Mode -eq 'lab') { npm run lab }
  else { if (-not $Config) { throw 'Use -Mode gateway -Config <protected-gateway.json>' }; npm start -- $Config }
  if ($LASTEXITCODE -ne 0) { throw 'Gateway exited with an error.' }
} finally { Pop-Location }

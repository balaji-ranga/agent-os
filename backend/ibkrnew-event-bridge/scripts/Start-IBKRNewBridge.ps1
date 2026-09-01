$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $PackageRoot '.env'

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Copy-Item -LiteralPath (Join-Path $PackageRoot '.env.example') -Destination $EnvFile
  throw 'Created .env from the example. Fill the bridge credentials and desktop-only IBKR paper account, then run this script again.'
}

$BundledNode = Join-Path $PackageRoot 'runtime\node.exe'
$Node = if (Test-Path -LiteralPath $BundledNode) { $BundledNode } else { (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot 'node_modules'))) {
  throw 'Dependencies are missing. From this folder run npm ci, or download the full IBKRNewBridge package from Flolah Connectors.'
}

Push-Location $PackageRoot
try { & $Node 'src\index.js' } finally { Pop-Location }

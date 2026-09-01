$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $PSScriptRoot
$BundledNode = Join-Path $PackageRoot 'runtime\node.exe'
$Node = if (Test-Path -LiteralPath $BundledNode) { $BundledNode } else { (Get-Command node -ErrorAction Stop).Source }

Push-Location $PackageRoot
try { & $Node 'test\offline.test.js' } finally { Pop-Location }

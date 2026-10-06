$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $PSScriptRoot
$BundledNode = Join-Path $PackageRoot 'runtime\node.exe'
$Node = if (Test-Path -LiteralPath $BundledNode) { $BundledNode } else { (Get-Command node -ErrorAction Stop).Source }

Push-Location $PackageRoot
try {
  foreach ($test in @('test\offline.test.js','test\delivery.test.js','test\readiness.test.js','test\subscriptions.test.js','test\volume-profiles.test.js','test\subscription-selection.test.js')) {
    & $Node $test
    if ($LASTEXITCODE -ne 0) { throw "IBKRNew regression failed: $test" }
  }
} finally { Pop-Location }

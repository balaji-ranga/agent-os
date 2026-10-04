$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $PackageRoot '.env'
$LogDirectory = Join-Path $PackageRoot 'logs'
$SupervisorLog = Join-Path $LogDirectory 'IBKRNew-supervisor.log'
$RuntimeLog = Join-Path $LogDirectory 'IBKRNew-runtime.log'

function Write-SupervisorLog([string]$Message) {
  $timestamp = (Get-Date).ToString('o')
  Add-Content -LiteralPath $SupervisorLog -Value "$timestamp $Message" -Encoding utf8
}

function Rotate-Log([string]$Path) {
  if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).Length -ge 10485760) {
    $archive = "$Path.$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
    Move-Item -LiteralPath $Path -Destination $archive
    Get-ChildItem -LiteralPath (Split-Path -Parent $Path) -File -Filter "$([IO.Path]::GetFileName($Path)).*" |
      Sort-Object LastWriteTime -Descending |
      Select-Object -Skip 5 |
      Remove-Item -Force
  }
}

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Write-SupervisorLog 'Stopped: .env is missing.'
  throw 'IBKRNew bridge .env is missing. Reinstall the owner-scoped package.'
}

$BundledNode = Join-Path $PackageRoot 'runtime\node.exe'
$Node = if (Test-Path -LiteralPath $BundledNode) { $BundledNode } else { (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot 'node_modules'))) {
  Write-SupervisorLog 'Stopped: node_modules is missing.'
  throw 'IBKRNew bridge dependencies are missing. Reinstall the full desktop package.'
}

Set-Location -LiteralPath $PackageRoot
Write-SupervisorLog "Supervisor started with Node $(& $Node --version)."

while ($true) {
  Rotate-Log $SupervisorLog
  Rotate-Log $RuntimeLog
  $startedAt = Get-Date
  Write-SupervisorLog 'Starting dedicated IBKRNew bridge runtime.'
  try {
    & $Node 'src\index.js' *>> $RuntimeLog
    $exitCode = $LASTEXITCODE
    Write-SupervisorLog "Bridge runtime exited with code $exitCode."
  } catch {
    Write-SupervisorLog "Bridge runtime failed: $($_.Exception.Message)"
  }
  $elapsed = (Get-Date) - $startedAt
  $delaySeconds = if ($elapsed.TotalSeconds -lt 30) { 30 } else { 10 }
  Write-SupervisorLog "Restarting in $delaySeconds seconds."
  Start-Sleep -Seconds $delaySeconds
}

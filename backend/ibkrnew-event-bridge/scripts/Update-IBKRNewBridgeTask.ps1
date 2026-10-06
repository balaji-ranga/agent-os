[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Revision,
  [string]$SourceRoot,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Flolah\IBKRNewBridge'),
  [string]$TaskName = 'IBKRNewBridge'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallRoot)
if (-not (Test-Path -LiteralPath (Join-Path $root '.env'))) { throw 'Installed owner-scoped .env is required.' }
$envHash = (Get-FileHash -LiteralPath (Join-Path $root '.env') -Algorithm SHA256).Hash
if ($SourceRoot) {
  $SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
  $sourceRevision = (& git -C $SourceRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $sourceRevision -cne $Revision) { throw 'Local source must match the requested Git revision.' }
  $dirty = & git -C $SourceRoot status --porcelain -- backend/ibkrnew-event-bridge
  if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit the maintained bridge source before installing it.' }
}
$files = @('src/core.js','src/index.js','src/gateway.js','src/session.js','src/market-subscriptions.js','src/volume-profiles.js','scripts/Run-IBKRNewBridgeTask.ps1','scripts/Update-IBKRNewBridgeTask.ps1','scripts/Install-IBKRNewBridgeTask.ps1','scripts/Uninstall-IBKRNewBridgeTask.ps1','scripts/Start-IBKRNewBridge.ps1','scripts/Test-IBKRNewBridge.ps1','scripts/Get-IBKRNewBridgeTaskStatus.ps1','test/offline.test.js','test/delivery.test.js','test/clock.js','test/readiness.test.js','test/subscriptions.test.js','test/volume-profiles.test.js','README.md','package.json','package-lock.json','.env.example','IBKRNew-instrument-profiles.example.json')
$files += @('src/subscription-selection.js','test/subscription-selection.test.js')
$staging = Join-Path $root ('upgrade-' + $Revision)
$checkpoint = $root + '.rollback-' + (Get-Date).ToString('yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $staging -Force | Out-Null
foreach ($file in $files) {
  $target = Join-Path $staging $file
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  if ($SourceRoot) { Copy-Item -LiteralPath (Join-Path $SourceRoot ('backend/ibkrnew-event-bridge/' + $file)) -Destination $target }
  else { Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/balaji-ranga/agent-os/$Revision/backend/ibkrnew-event-bridge/$file" -OutFile $target }
}
$installedLock = ([IO.File]::ReadAllText((Join-Path $root 'package-lock.json'))).Replace("`r`n", "`n").Trim()
$stagedLock = ([IO.File]::ReadAllText((Join-Path $staging 'package-lock.json'))).Replace("`r`n", "`n").Trim()
if ($installedLock -cne $stagedLock) { throw 'Dependencies changed. Install the full package rather than a source upgrade.' }
$node = Join-Path $root 'runtime\node.exe'
Copy-Item -LiteralPath (Join-Path $root 'node_modules') -Destination (Join-Path $staging 'node_modules') -Recurse
& $node (Join-Path $staging 'test\offline.test.js')
if ($LASTEXITCODE -ne 0) { throw 'Bridge offline regression failed; installed task unchanged.' }
& $node (Join-Path $staging 'test\delivery.test.js')
if ($LASTEXITCODE -ne 0) { throw 'Bridge delivery regression failed; installed task unchanged.' }
& $node (Join-Path $staging 'test\readiness.test.js')
if ($LASTEXITCODE -ne 0) { throw 'Bridge readiness regression failed; installed task unchanged.' }
& $node (Join-Path $staging 'test\subscriptions.test.js')
if ($LASTEXITCODE -ne 0) { throw 'Bridge subscription regression failed; installed task unchanged.' }
& $node (Join-Path $staging 'test\volume-profiles.test.js')
if ($LASTEXITCODE -ne 0) { throw 'Bridge volume regression failed; installed task unchanged.' }
& $node (Join-Path $staging 'test\subscription-selection.test.js')
if ($LASTEXITCODE -ne 0) { throw 'Bridge selection regression failed; installed task unchanged.' }
New-Item -ItemType Directory -Path $checkpoint -Force | Out-Null
foreach ($name in @('src','scripts','test','README.md','package.json','package-lock.json')) { Copy-Item -LiteralPath (Join-Path $root $name) -Destination $checkpoint -Recurse }
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$runner = Join-Path $root 'scripts\Run-IBKRNewBridgeTask.ps1'
if (-not (@($task.Actions | Where-Object { $_.Arguments -like ('*' + $runner + '*') }).Count)) { throw 'Task does not belong to this installation.' }
Stop-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($node, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
  $result = Invoke-CimMethod -InputObject $_ -MethodName Terminate
  if ($result.ReturnValue -ne 0) { throw 'Existing bridge process could not be stopped.' }
}
try {
  foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $staging $file) -Destination (Join-Path $root $file) -Force }
  if ((Get-FileHash -LiteralPath (Join-Path $root '.env') -Algorithm SHA256).Hash -ne $envHash) { throw 'Owner configuration checksum changed unexpectedly.' }
  Set-Content -LiteralPath (Join-Path $root 'IBKRNew-source-revision.txt') -Value $Revision -Encoding ascii
} catch {
  foreach ($name in @('src','scripts','test','README.md','package.json','package-lock.json')) { Copy-Item -LiteralPath (Join-Path $checkpoint $name) -Destination $root -Recurse -Force }
  throw
} finally { Start-ScheduledTask -TaskName $TaskName }
[pscustomobject]@{ Revision=$Revision; Checkpoint=$checkpoint; TaskState=(Get-ScheduledTask -TaskName $TaskName).State; EnvPreserved=$true }

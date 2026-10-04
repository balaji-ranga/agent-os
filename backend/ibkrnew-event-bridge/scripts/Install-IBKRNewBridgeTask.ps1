[CmdletBinding()]
param(
  [string]$TaskName = 'IBKRNewBridge',
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Flolah\IBKRNewBridge'),
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$SourceRoot = Split-Path -Parent $PSScriptRoot
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name

function Read-DotEnv([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }
    $parts = $trimmed.Split('=', 2)
    $values[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
  }
  return $values
}

function Protect-InstallAcl([string]$Path) {
  & icacls.exe $Path '/inheritance:e' '/grant:r' "${Identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' '/C' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to protect the IBKRNew installation directory ACL.' }
  if (Get-ChildItem -LiteralPath $Path -Force | Select-Object -First 1) {
    $ChildPattern = Join-Path $Path '*'
    & icacls.exe $ChildPattern '/reset' '/T' '/C' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to propagate the protected IBKRNew installation ACL to package files.' }
  }
}

$SourceEnv = Join-Path $SourceRoot '.env'
if (-not (Test-Path -LiteralPath $SourceEnv)) {
  throw 'The owner-scoped .env is missing. Download a fresh full IBKRNewBridge package from Flolah Connectors.'
}
$Config = Read-DotEnv $SourceEnv
foreach ($required in @('IBKRNEW_API_URL', 'IBKRNEW_BRIDGE_ID', 'IBKRNEW_BRIDGE_TOKEN')) {
  if (-not $Config[$required]) { throw "Required setting $required is missing from .env." }
}
$MockMode = $Config['IBKRNEW_MOCK'] -eq '1'
if (-not $MockMode) {
  if ($Config['IBKRNEW_PAPER_EXECUTION_ENABLED'] -ne '1') { throw 'Set IBKRNEW_PAPER_EXECUTION_ENABLED=1 before installing the paper bridge task.' }
  if ($Config['IBKRNEW_ACCOUNT_ID'] -notmatch '^DU[A-Za-z0-9]+$') { throw 'IBKRNEW_ACCOUNT_ID must contain a local IBKR paper account beginning with DU.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'node_modules'))) {
  throw 'Dependencies are missing. Download the full desktop package or run npm ci before installing.'
}

$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($ExistingTask) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

$ResolvedSource = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$ResolvedInstall = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($ResolvedSource -ne $ResolvedInstall) {
  New-Item -ItemType Directory -Path $ResolvedInstall -Force | Out-Null
  Protect-InstallAcl $ResolvedInstall
  foreach ($item in Get-ChildItem -LiteralPath $ResolvedSource -Force) {
    if ($item.Name -in @('data', 'logs')) { continue }
    Copy-Item -LiteralPath $item.FullName -Destination $ResolvedInstall -Recurse -Force
  }
}

New-Item -ItemType Directory -Path (Join-Path $ResolvedInstall 'data') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $ResolvedInstall 'logs') -Force | Out-Null
Protect-InstallAcl $ResolvedInstall

$BundledNode = Join-Path $ResolvedInstall 'runtime\node.exe'
$Node = if (Test-Path -LiteralPath $BundledNode) { $BundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
$Entrypoint = Join-Path $ResolvedInstall 'src\index.js'
$Action = New-ScheduledTaskAction -Execute $Node -Argument "`"$Entrypoint`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $Identity
$Principal = New-ScheduledTaskPrincipal -UserId $Identity -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -WakeToRun -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description 'Supervises the dedicated Flolah IBKRNew paper-trading bridge. Credentials and the IBKR account identifier remain local.' -Force | Out-Null
if (-not $NoStart) { Start-ScheduledTask -TaskName $TaskName }

$Task = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{
  TaskName = $TaskName
  State = $Task.State
  InstallRoot = $ResolvedInstall
  LastRunTime = $Info.LastRunTime
  LastTaskResult = $Info.LastTaskResult
  Started = -not $NoStart
}

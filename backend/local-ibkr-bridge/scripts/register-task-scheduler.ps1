#Requires -Version 5.1
<#
.SYNOPSIS
  Register Windows Task Scheduler tasks for the local IBKR bridge.
.DESCRIPTION
  Creates:
  - AgentOsIbkrBridge (at logon, keep running)
  Optional note: equity marks run inside the bridge via EQUITY_MARK_INTERVAL_SEC.
  W2 execution workflow is separate (desktop package / another scheduled task).
.PARAMETER TaskName
  Base task name (default AgentOsIbkrBridge).
.PARAMETER RunAtLogon
  Register an AtLogon trigger (default).
#>
param(
  [string]$TaskName = "AgentOsIbkrBridge",
  [switch]$SkipLogonTrigger
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$RunPs1 = Join-Path $ScriptDir "run-bridge.ps1"

if (-not (Test-Path $RunPs1)) {
  Write-Error "Missing $RunPs1"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunPs1`"" `
  -WorkingDirectory $Root

$triggers = @()
if (-not $SkipLogonTrigger) {
  $triggers += New-ScheduledTaskTrigger -AtLogOn
}
if (-not $triggers.Count) {
  # Fallback: daily morning (US open often handled by W2 separately)
  $triggers += New-ScheduledTaskTrigger -Daily -At "08:00"
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "  Action: powershell -File $RunPs1"
Write-Host "  WorkingDirectory: $Root"
Write-Host "Ensure LOCAL_BRIDGE_TOKEN and IBKR_* are set in $Root\.env or backend\.env"
Write-Host "Equity marks: set EQUITY_MARK_INTERVAL_SEC (default 300). EOD: POST /push-eod-snapshot from W2 or a separate daily task."

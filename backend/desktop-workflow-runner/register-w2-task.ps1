#Requires -Version 5.1
<#
.SYNOPSIS
  Register Windows Task Scheduler for monthly trading W2 (US cash open).
.DESCRIPTION
  W2 does not run on the cloud. This task starts the unzipped desktop Run-Workflow.ps1
  at the laptop-local equivalent of 09:30 America/New_York on weekdays.

  Default time 21:30 is Asia/Singapore (09:30 US Eastern). Override -AtLocalTime for other zones.

  Settings: run on battery, wake the PC if allowed, start if the slot was missed (sleep).
.PARAMETER ScriptPath
  Path to Run-Workflow.ps1 (default: beside this script, or the common unzip path).
.PARAMETER AtLocalTime
  Local clock time (HH:mm). Default 21:30.
.PARAMETER TaskName
  Scheduled task name (default AgentOsIbkrW2).
#>
param(
  [string]$ScriptPath = "",
  [string]$AtLocalTime = "21:30",
  [string]$TaskName = "AgentOsIbkrW2"
)

$ErrorActionPreference = "Stop"

if (-not $ScriptPath) {
  $beside = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "Run-Workflow.ps1"
  $unzipped = Join-Path $env:USERPROFILE "ibkr-monthly\w2-execute\Run-Workflow.ps1"
  # Prefer the CEO unzipped package (has workflow.params.json + token) over the repo template.
  if (Test-Path $unzipped) { $ScriptPath = $unzipped }
  elseif (Test-Path $beside) { $ScriptPath = $beside }
  else { Write-Error "Run-Workflow.ps1 not found. Pass -ScriptPath to the unzipped W2 package." }
}

if (-not (Test-Path $ScriptPath)) {
  Write-Error "Missing $ScriptPath"
}

$at = [DateTime]::ParseExact($AtLocalTime, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
  -WorkingDirectory (Split-Path -Parent $ScriptPath)

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $at

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

$info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Host "Registered $TaskName"
Write-Host "  Script: $ScriptPath"
Write-Host "  Weekdays at $AtLocalTime local (US open for Asia/Singapore laptops is 21:30 = 9:30 PM, not 9:30 AM)"
Write-Host "  NextRunTime: $($info.NextRunTime)"
Write-Host "Keep this Windows user logged in; allow wake timers; leave Gateway paper 4002 + the IBKR bridge running."

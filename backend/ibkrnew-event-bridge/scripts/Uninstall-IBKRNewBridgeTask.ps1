[CmdletBinding()]
param([string]$TaskName = 'IBKRNewBridge')

$ErrorActionPreference = 'Stop'
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $Task) {
  Write-Output "Scheduled task $TaskName is not installed."
  exit 0
}
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Output "Scheduled task $TaskName was removed. Local configuration, spool, and logs were retained."

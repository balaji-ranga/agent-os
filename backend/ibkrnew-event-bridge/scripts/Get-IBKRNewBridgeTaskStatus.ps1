[CmdletBinding()]
param([string]$TaskName = 'IBKRNewBridge')

$ErrorActionPreference = 'Stop'
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$Info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{
  TaskName = $TaskName
  State = $Task.State
  LastRunTime = $Info.LastRunTime
  LastTaskResult = $Info.LastTaskResult
  NextRunTime = $Info.NextRunTime
}

# Forwards local 18792 -> OpenClaw chrome relay inside VPS openclaw container.
# Keep this PowerShell window open while using the Chrome Web Store relay extension.
param(
  [string]$HostIp = "76.13.209.30",
  [string]$Key = "$env:USERPROFILE\.ssh\agent-os-vps",
  [int]$LocalPort = 18792
)

Write-Host "Resolving openclaw container IP on $HostIp ..."
$cid = ssh -i $Key -o IdentitiesOnly=yes -o BatchMode=yes "root@$HostIp" "docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' agent-os-openclaw-1"
$cid = $cid.Trim()
if (-not $cid) { throw "Could not resolve openclaw container IP" }
Write-Host "Tunnel: 127.0.0.1:$LocalPort -> ${cid}:18799 (chrome extension relay)"
Write-Host "Leave this window open. In the Store extension Options use Gateway token + port $LocalPort."
Write-Host "Ctrl+C to stop."
ssh -i $Key -o IdentitiesOnly=yes -N -L "${LocalPort}:${cid}:18799" "root@$HostIp"
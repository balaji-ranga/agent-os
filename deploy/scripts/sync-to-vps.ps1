# Sync local repo trees to VPS and run vps-deploy-latest.sh (when VPS cannot git pull).
# Usage (from laptop, PowerShell):
#   .\deploy\scripts\sync-to-vps.ps1
#   .\deploy\scripts\sync-to-vps.ps1 -Services frontend
#   .\deploy\scripts\sync-to-vps.ps1 -HostIp 76.13.209.30 -Key $env:USERPROFILE\.ssh\agent-os-vps
param(
  [string]$HostIp = "76.13.209.30",
  [string]$Key = "$env:USERPROFILE\.ssh\agent-os-vps",
  [string]$RemoteRoot = "/opt/agent-os",
  [string]$Services = "frontend backend openclaw"
)

$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ssh = @("-i", $Key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes")

Write-Host "==> Sync frontend/src + index.html"
ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/frontend/src/components $RemoteRoot/frontend/src/pages $RemoteRoot/deploy/scripts"
scp @ssh `
  "$Repo\frontend\index.html" `
  "root@${HostIp}:$RemoteRoot/frontend/index.html"
scp @ssh -r `
  "$Repo\frontend\src\App.jsx" `
  "$Repo\frontend\src\index.css" `
  "$Repo\frontend\src\components\ChatMessageContent.jsx" `
  "$Repo\frontend\src\components\AuthenticatedMediaImage.jsx" `
  "$Repo\frontend\src\pages\AgentChat.jsx" `
  "$Repo\frontend\src\pages\Login.jsx" `
  "root@${HostIp}:/tmp/aos-fe/"
ssh @ssh "root@$HostIp" @"
set -e
mkdir -p /tmp/aos-fe
cp -f /tmp/aos-fe/App.jsx $RemoteRoot/frontend/src/App.jsx
cp -f /tmp/aos-fe/index.css $RemoteRoot/frontend/src/index.css
cp -f /tmp/aos-fe/ChatMessageContent.jsx $RemoteRoot/frontend/src/components/ChatMessageContent.jsx
cp -f /tmp/aos-fe/AuthenticatedMediaImage.jsx $RemoteRoot/frontend/src/components/AuthenticatedMediaImage.jsx
cp -f /tmp/aos-fe/AgentChat.jsx $RemoteRoot/frontend/src/pages/AgentChat.jsx
cp -f /tmp/aos-fe/Login.jsx $RemoteRoot/frontend/src/pages/Login.jsx
"@

Write-Host "==> Sync deploy scripts + key backend/openclaw paths"
scp @ssh `
  "$Repo\deploy\scripts\vps-deploy-latest.sh" `
  "$Repo\deploy\scripts\vps-verify-frontend-media.sh" `
  "$Repo\deploy\scripts\configure-openclaw-docker.js" `
  "$Repo\deploy\scripts\verify-openclaw-parity.js" `
  "root@${HostIp}:$RemoteRoot/deploy/scripts/"

# Broader sync for backend/openclaw when doing full deploy
if ($Services -match "backend|openclaw") {
  Write-Host "==> Sync backend/src + scripts/lib + openclaw-extensions (rsync-like scp)"
  scp @ssh -r "$Repo\backend\src" "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh -r "$Repo\scripts\lib" "root@${HostIp}:$RemoteRoot/scripts/"
  scp @ssh -r "$Repo\scripts\apply-openclaw-agents-config.js" "root@${HostIp}:$RemoteRoot/scripts/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
}

Write-Host "==> Run vps-deploy-latest.sh"
ssh @ssh "root@$HostIp" "sed -i 's/\r`$//' $RemoteRoot/deploy/scripts/vps-deploy-latest.sh $RemoteRoot/deploy/scripts/vps-verify-frontend-media.sh; SKIP_GIT=1 SERVICES='$Services' bash $RemoteRoot/deploy/scripts/vps-deploy-latest.sh"
Write-Host "SYNC_DEPLOY_DONE"

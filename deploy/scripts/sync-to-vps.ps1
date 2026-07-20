# Sync local repo trees to VPS and run vps-deploy-latest.sh (when VPS cannot git pull).
# Usage (from laptop, PowerShell):
#   .\deploy\scripts\sync-to-vps.ps1
#   .\deploy\scripts\sync-to-vps.ps1 -Services frontend
#   .\deploy\scripts\sync-to-vps.ps1 -HostIp 76.13.209.30 -Key $env:USERPROFILE\.ssh\agent-os-vps
#   .\deploy\scripts\sync-to-vps.ps1 -SkipSmoke   # skip post-deploy smoke + platform verify
#
# Syncs full build contexts: frontend/, backend/src + scripts, deploy/docker, scripts/,
# openclaw extensions/skills/templates — then rebuilds via vps-deploy-latest.sh.
#
# Features covered: Flowlah branding, multi-tenant standups/delegation, Master Data tools/UI,
# notify_ceo + email_send, org sync (ORG.md/AGENTS.md), AgentExchange/A2A, DeepSeek@Ollama,
# notification dismiss, anti-browser content-tools SKILL.md.
param(
  [string]$HostIp = "76.13.209.30",
  [string]$Key = "$env:USERPROFILE\.ssh\agent-os-vps",
  [string]$RemoteRoot = "/opt/agent-os",
  [string]$Services = "frontend backend openclaw",
  [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ssh = @("-i", $Key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes")

Write-Host "==> Sync frontend (full src tree + package files + index.html)"
ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/frontend/src $RemoteRoot/deploy/scripts $RemoteRoot/deploy/docker $RemoteRoot/deploy/nginx $RemoteRoot/backend/scripts $RemoteRoot/scripts"
scp @ssh -r "$Repo\frontend\src" "root@${HostIp}:$RemoteRoot/frontend/"
scp @ssh `
  "$Repo\frontend\index.html" `
  "$Repo\frontend\package.json" `
  "$Repo\frontend\package-lock.json" `
  "root@${HostIp}:$RemoteRoot/frontend/"

Write-Host "==> Sync deploy compose + nginx + dockerfiles + scripts + README"
scp @ssh `
  "$Repo\deploy\docker-compose.yml" `
  "$Repo\deploy\docker-compose.browser.yml" `
  "$Repo\deploy\.env.example" `
  "$Repo\deploy\README.md" `
  "root@${HostIp}:$RemoteRoot/deploy/"
scp @ssh -r "$Repo\deploy\docker" "root@${HostIp}:$RemoteRoot/deploy/"
scp @ssh `
  "$Repo\deploy\nginx\nginx.conf" `
  "$Repo\deploy\nginx\frontend.conf" `
  "root@${HostIp}:$RemoteRoot/deploy/nginx/"
scp @ssh `
  "$Repo\deploy\scripts\vps-deploy-latest.sh" `
  "$Repo\deploy\scripts\vps-verify-platform.sh" `
  "$Repo\deploy\scripts\vps-verify-frontend-media.sh" `
  "$Repo\deploy\scripts\vps-smoke-new-features.sh" `
  "$Repo\deploy\scripts\vps-smoke-deepseek-brain.sh" `
  "$Repo\deploy\scripts\vps-rebuild-frontend.sh" `
  "$Repo\deploy\scripts\ensure-deepseek-env.sh" `
  "$Repo\deploy\scripts\vps-deploy-coo-org-fix.sh" `
  "$Repo\deploy\scripts\configure-openclaw-docker.js" `
  "$Repo\deploy\scripts\verify-openclaw-parity.js" `
  "$Repo\deploy\scripts\up.sh" `
  "root@${HostIp}:$RemoteRoot/deploy/scripts/"

# Remove obsolete DeepSeek cloud proxy artifacts on VPS
ssh @ssh "root@$HostIp" "rm -f $RemoteRoot/deploy/docker/deepseek-proxy.js $RemoteRoot/deploy/docker/deepseek-proxy.Dockerfile; docker rm -f agent-os-deepseek-1 2>/dev/null || true"

# Broader sync for backend/openclaw when doing full deploy
if ($Services -match "backend|openclaw") {
  Write-Host "==> Sync backend/src + package files + backend/scripts + scripts/ + openclaw-*"
  scp @ssh -r "$Repo\backend\src" "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh `
    "$Repo\backend\package.json" `
    "$Repo\backend\package-lock.json" `
    "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh `
    "$Repo\backend\scripts\vps-smoke-new-features.js" `
    "$Repo\backend\scripts\test-email-send-tool.js" `
    "$Repo\backend\scripts\test-notify-ceo-tool.js" `
    "$Repo\backend\scripts\test-notify-ceo-delegated.js" `
    "$Repo\backend\scripts\sync-org-context-ceo.js" `
    "$Repo\backend\scripts\test-tenancy-notify-new-agent-e2e.js" `
    "$Repo\backend\scripts\test-workflow-a2a-publish.js" `
    "$Repo\backend\scripts\test-coo-email-send-calendar.js" `
    "$Repo\backend\scripts\test-deepseek-brain-workflow.js" `
    "$Repo\backend\scripts\test-broadcast-notify-ceo.js" `
    "$Repo\backend\scripts\test-master-data-content-tools.js" `
    "root@${HostIp}:$RemoteRoot/backend/scripts/"
  scp @ssh -r "$Repo\scripts" "root@${HostIp}:$RemoteRoot/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-bootstrap-watcher" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
  Write-Host "==> Sync workspace templates (COO + TechResearcher) + skills"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/openclaw-workspace-templates/balserve $RemoteRoot/openclaw-workspace-templates/techresearcher $RemoteRoot/openclaw-skills/agent-os-content-tools $RemoteRoot/openclaw-skills/agent-send"
  scp @ssh `
    "$Repo\openclaw-workspace-templates\balserve\AGENTS.md" `
    "$Repo\openclaw-workspace-templates\balserve\TOOLS.md" `
    "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/balserve/"
  scp @ssh `
    "$Repo\openclaw-workspace-templates\techresearcher\TOOLS.md" `
    "$Repo\openclaw-workspace-templates\techresearcher\SOUL.md" `
    "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/techresearcher/"
  scp @ssh -r "$Repo\openclaw-skills\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-skills/"
  scp @ssh -r "$Repo\openclaw-skills\agent-send" "root@${HostIp}:$RemoteRoot/openclaw-skills/"
}

$smokeEnv = if ($SkipSmoke) { "SKIP_SMOKE=1" } else { "SKIP_SMOKE=0" }
Write-Host "==> Run vps-deploy-latest.sh (SERVICES=$Services $smokeEnv)"
ssh @ssh "root@$HostIp" @"
sed -i 's/\r`$//' \
  $RemoteRoot/deploy/scripts/vps-deploy-latest.sh \
  $RemoteRoot/deploy/scripts/vps-verify-platform.sh \
  $RemoteRoot/deploy/scripts/vps-verify-frontend-media.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-new-features.sh \
  $RemoteRoot/deploy/scripts/vps-rebuild-frontend.sh \
  $RemoteRoot/deploy/scripts/up.sh
SKIP_GIT=1 $smokeEnv SERVICES='$Services' bash $RemoteRoot/deploy/scripts/vps-deploy-latest.sh
"@
Write-Host "SYNC_DEPLOY_DONE"

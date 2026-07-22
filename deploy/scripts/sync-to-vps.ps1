# Sync local repo trees to VPS and run vps-deploy-latest.sh (when VPS cannot git pull).
# Usage (from laptop, PowerShell):
#   .\deploy\scripts\sync-to-vps.ps1
#   .\deploy\scripts\sync-to-vps.ps1 -Services frontend
#   .\deploy\scripts\sync-to-vps.ps1 -HostIp 76.13.209.30 -Key $env:USERPROFILE\.ssh\agent-os-vps
#   .\deploy\scripts\sync-to-vps.ps1 -SkipSmoke   # skip post-deploy smoke + platform verify
#   .\deploy\scripts\sync-to-vps.ps1 -NoCache     # force docker compose build --no-cache
#
# Syncs full build contexts: frontend/, backend/src + scripts, deploy/docker, scripts/,
# openclaw extensions/skills/templates — then rebuilds via vps-deploy-latest.sh.
#
# Features covered: Flolah branding, hPanel light theme (collapsible nav + profile menu),
# workflow editor fullscreen (shell-focus-mode), Register MCP/Agents primary CTAs,
# multi-tenant standups/delegation, Kanban owner_user_id isolation (no shared-agent leak),
# lean Kanban board (no Job applications filter / pipeline status banner),
# lean CEO onboard (COO + Workflow Builder + Platform Help), OrgDesigner dashboard,
# Master Data + RAG tools, Platform Help agent + help corpus,
# notify_ceo + email_send, Broadcast (intent-based notify + paced fan-out), AGENTS.md intent
# COO specialty delegation, peer specialty referral, chat tool-call icons, notification tooltips,
# org sync (tenant ORG.md/AGENTS.md), AgentExchange/A2A (public + OAuth client credentials),
# DeepSeek@Ollama, shared notification dismiss.
param(
  [string]$HostIp = "76.13.209.30",
  [string]$Key = "$env:USERPROFILE\.ssh\agent-os-vps",
  [string]$RemoteRoot = "/opt/agent-os",
  [string]$Services = "frontend backend openclaw",
  [switch]$SkipSmoke,
  [switch]$NoCache
)

$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ssh = @("-i", $Key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes")

Write-Host "==> Sync frontend (full src tree + package files + index.html)"
ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/frontend/src $RemoteRoot/deploy/scripts $RemoteRoot/deploy/docker $RemoteRoot/deploy/nginx $RemoteRoot/backend/scripts $RemoteRoot/scripts"
scp @ssh "$Repo\README.md" "root@${HostIp}:$RemoteRoot/"
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
  "$Repo\deploy\scripts\vps-smoke-broadcast-notify.sh" `
  "$Repo\deploy\scripts\vps-smoke-deepseek-brain.sh" `
  "$Repo\deploy\scripts\vps-smoke-brain-mcp.sh" `
  "$Repo\deploy\scripts\vps-smoke-openconnector.sh" `
  "$Repo\deploy\scripts\vps-smoke-openconnector-real.sh" `
  "$Repo\deploy\scripts\vps-smoke-openconnector-selfservice.sh" `
  "$Repo\deploy\scripts\vps-enable-real-openconnector.sh" `
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
    "$Repo\backend\scripts\vps-test-platform-help.js" `
    "$Repo\backend\scripts\seed-workflow-builder-agent.js" `
    "$Repo\backend\scripts\seed-platform-help-agent.js" `
    "$Repo\backend\scripts\test-platform-help-seed.js" `
    "$Repo\backend\scripts\reupload-platform-help-docs.js" `
    "$Repo\backend\scripts\test-platform-help-rag.js" `
    "$Repo\backend\scripts\test-platform-help-chat.js" `
    "$Repo\backend\scripts\vps-smoke-new-features.js" `
    "$Repo\backend\scripts\test-email-send-tool.js" `
    "$Repo\backend\scripts\test-notify-ceo-tool.js" `
    "$Repo\backend\scripts\test-notify-ceo-delegated.js" `
    "$Repo\backend\scripts\sync-org-context-ceo.js" `
    "$Repo\backend\scripts\test-tenancy-notify-new-agent-e2e.js" `
    "$Repo\backend\scripts\test-workflow-a2a-publish.js" `
    "$Repo\backend\scripts\test-workflow-a2a-oauth.js" `
    "$Repo\backend\scripts\test-coo-email-send-calendar.js" `
    "$Repo\backend\scripts\test-deepseek-brain-workflow.js" `
    "$Repo\backend\scripts\test-broadcast-notify-ceo.js" `
    "$Repo\backend\scripts\test-master-data-content-tools.js" `
    "$Repo\backend\scripts\heal-agent-workspace-paths.js" `
    "$Repo\backend\scripts\test-broadcast-routing.js" `
    "$Repo\backend\scripts\test-coo-reach-me-delegation.js" `
    "$Repo\backend\scripts\test-kanban-delegation-sync.js" `
    "$Repo\backend\scripts\test-kanban-owner-isolation.js" `
    "$Repo\backend\scripts\heal-stuck-kanban-delegations.js" `
    "$Repo\backend\scripts\refresh-coo-workspace-docs.js" `
    "$Repo\backend\scripts\test-openconnector-connectors-e2e.js" `
    "$Repo\backend\scripts\test-openconnector-selfservice.js" `
    "$Repo\backend\scripts\provision-openconnector-ceos.js" `
    "$Repo\backend\scripts\vps-test-balaji-agents-kanban.js" `
    "$Repo\backend\scripts\vps-test-coo-biryani-delegate.js" `
    "$Repo\backend\scripts\vps-test-coo-moon-fuel.js" `
    "$Repo\backend\scripts\vps-test-application-masterdata-notify.js" `
    "$Repo\backend\scripts\onboard-vedic-astrology-agent.js" `
    "$Repo\backend\scripts\vps-onboard-specialty-agents-bala.js" `
    "$Repo\backend\scripts\test-weather-agent-ui-onboard-e2e.js" `
    "$Repo\backend\scripts\test-master-data-office-extract.js" `
    "root@${HostIp}:$RemoteRoot/backend/scripts/"
  scp @ssh -r "$Repo\scripts" "root@${HostIp}:$RemoteRoot/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-bootstrap-watcher" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
  Write-Host "==> Sync workspace templates (COO + TechResearcher + ApplicationAgent + Workflow Builder + Platform Help) + skills + platform-help KB"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/openclaw-workspace-templates $RemoteRoot/openclaw-skills/agent-os-content-tools $RemoteRoot/openclaw-skills/agent-send"
  scp @ssh -r "$Repo\openclaw-workspace-templates\balserve" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\techresearcher" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\applicationagent" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\workflowbuilder" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\platformhelp" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/knowledgebase"
  scp @ssh -r "$Repo\knowledgebase\platform-help" "root@${HostIp}:$RemoteRoot/knowledgebase/"
  scp @ssh "$Repo\README.md" "root@${HostIp}:$RemoteRoot/README.md"
  scp @ssh -r "$Repo\openclaw-skills\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-skills/"
  scp @ssh -r "$Repo\openclaw-skills\agent-send" "root@${HostIp}:$RemoteRoot/openclaw-skills/"
}

$smokeEnv = if ($SkipSmoke) { "SKIP_SMOKE=1" } else { "SKIP_SMOKE=0" }
$cacheEnv = if ($NoCache) { "NO_CACHE=1" } else { "NO_CACHE=0" }
Write-Host "==> Run vps-deploy-latest.sh (SERVICES=$Services $smokeEnv $cacheEnv)"
ssh @ssh "root@$HostIp" @"
sed -i 's/\r`$//' \
  $RemoteRoot/deploy/scripts/vps-deploy-latest.sh \
  $RemoteRoot/deploy/scripts/vps-verify-platform.sh \
  $RemoteRoot/deploy/scripts/vps-verify-frontend-media.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-new-features.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-broadcast-notify.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-deepseek-brain.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-brain-mcp.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-openconnector.sh \
  $RemoteRoot/deploy/scripts/ensure-deepseek-env.sh \
  $RemoteRoot/deploy/scripts/vps-rebuild-frontend.sh \
  $RemoteRoot/deploy/scripts/up.sh
SKIP_GIT=1 $smokeEnv $cacheEnv SERVICES='$Services' bash $RemoteRoot/deploy/scripts/vps-deploy-latest.sh
"@
Write-Host "SYNC_DEPLOY_DONE"

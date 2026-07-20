# Sync local repo trees to VPS and run vps-deploy-latest.sh (when VPS cannot git pull).
# Usage (from laptop, PowerShell):
#   .\deploy\scripts\sync-to-vps.ps1
#   .\deploy\scripts\sync-to-vps.ps1 -Services frontend
#   .\deploy\scripts\sync-to-vps.ps1 -HostIp 76.13.209.30 -Key $env:USERPROFILE\.ssh\agent-os-vps
#   .\deploy\scripts\sync-to-vps.ps1 -SkipSmoke   # skip post-deploy smoke (email_send / notify_ceo / org sync / A2A)
#
# Keeps VPS aligned with: notify_ceo, email_send, Dashboard org resync (ORG.md/AGENTS.md),
# tenant session keys, AgentExchange/A2A, Master Data content tools + UI, per-CEO delegation,
# OpenClaw content-tools allowlists + anti-browser SKILL.md guidance.
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

Write-Host "==> Sync frontend (Dashboard org resync, Master Data UI, notify_ceo, email_send, A2A, AgentExchange)"
ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/frontend/src/components/workflow $RemoteRoot/frontend/src/components $RemoteRoot/frontend/src/pages $RemoteRoot/frontend/src/utils $RemoteRoot/deploy/scripts $RemoteRoot/deploy/docker $RemoteRoot/deploy/nginx $RemoteRoot/backend/scripts $RemoteRoot/scripts/lib"
scp @ssh `
  "$Repo\frontend\index.html" `
  "root@${HostIp}:$RemoteRoot/frontend/index.html"
scp @ssh `
  "$Repo\frontend\src\App.jsx" `
  "$Repo\frontend\src\api.js" `
  "$Repo\frontend\src\index.css" `
  "$Repo\frontend\src\components\AppNavMenu.jsx" `
  "$Repo\frontend\src\components\ChatMessageContent.jsx" `
  "$Repo\frontend\src\components\AuthenticatedMediaImage.jsx" `
  "$Repo\frontend\src\components\ChatComposeInput.jsx" `
  "$Repo\frontend\src\components\AgentChatPanel.jsx" `
  "$Repo\frontend\src\components\NotificationBell.jsx" `
  "$Repo\frontend\src\components\OrgChart.jsx" `
  "$Repo\frontend\src\components\MaskedSecretInput.jsx" `
  "$Repo\frontend\src\components\DepartmentPicker.jsx" `
  "$Repo\frontend\src\utils\chatCompose.js" `
  "$Repo\frontend\src\utils\departmentsMasterData.js" `
  "$Repo\frontend\src\utils\orgHierarchy.js" `
  "$Repo\frontend\src\components\workflow\PublishA2AModal.jsx" `
  "$Repo\frontend\src\components\workflow\WorkflowAgentChat.jsx" `
  "$Repo\frontend\src\components\workflow\workflowTaskMeta.js" `
  "$Repo\frontend\src\pages\AgentExchange.jsx" `
  "$Repo\frontend\src\pages\AgentChat.jsx" `
  "$Repo\frontend\src\pages\Dashboard.jsx" `
  "$Repo\frontend\src\pages\Kanban.jsx" `
  "$Repo\frontend\src\pages\AgentWorkflowEditor.jsx" `
  "$Repo\frontend\src\pages\Register.jsx" `
  "$Repo\frontend\src\pages\UserProfile.jsx" `
  "$Repo\frontend\src\pages\Login.jsx" `
  "$Repo\frontend\src\pages\MasterData.jsx" `
  "root@${HostIp}:/tmp/aos-fe/"
ssh @ssh "root@$HostIp" @"
set -e
mkdir -p /tmp/aos-fe $RemoteRoot/frontend/src/components/workflow $RemoteRoot/frontend/src/components $RemoteRoot/frontend/src/pages $RemoteRoot/frontend/src/utils
cp -f /tmp/aos-fe/App.jsx $RemoteRoot/frontend/src/App.jsx
cp -f /tmp/aos-fe/api.js $RemoteRoot/frontend/src/api.js
cp -f /tmp/aos-fe/index.css $RemoteRoot/frontend/src/index.css
cp -f /tmp/aos-fe/AppNavMenu.jsx $RemoteRoot/frontend/src/components/AppNavMenu.jsx
cp -f /tmp/aos-fe/ChatMessageContent.jsx $RemoteRoot/frontend/src/components/ChatMessageContent.jsx
cp -f /tmp/aos-fe/AuthenticatedMediaImage.jsx $RemoteRoot/frontend/src/components/AuthenticatedMediaImage.jsx
cp -f /tmp/aos-fe/ChatComposeInput.jsx $RemoteRoot/frontend/src/components/ChatComposeInput.jsx
cp -f /tmp/aos-fe/AgentChatPanel.jsx $RemoteRoot/frontend/src/components/AgentChatPanel.jsx
cp -f /tmp/aos-fe/NotificationBell.jsx $RemoteRoot/frontend/src/components/NotificationBell.jsx
cp -f /tmp/aos-fe/OrgChart.jsx $RemoteRoot/frontend/src/components/OrgChart.jsx
cp -f /tmp/aos-fe/MaskedSecretInput.jsx $RemoteRoot/frontend/src/components/MaskedSecretInput.jsx
cp -f /tmp/aos-fe/DepartmentPicker.jsx $RemoteRoot/frontend/src/components/DepartmentPicker.jsx
cp -f /tmp/aos-fe/chatCompose.js $RemoteRoot/frontend/src/utils/chatCompose.js
cp -f /tmp/aos-fe/departmentsMasterData.js $RemoteRoot/frontend/src/utils/departmentsMasterData.js
cp -f /tmp/aos-fe/orgHierarchy.js $RemoteRoot/frontend/src/utils/orgHierarchy.js
cp -f /tmp/aos-fe/PublishA2AModal.jsx $RemoteRoot/frontend/src/components/workflow/PublishA2AModal.jsx
cp -f /tmp/aos-fe/WorkflowAgentChat.jsx $RemoteRoot/frontend/src/components/workflow/WorkflowAgentChat.jsx
cp -f /tmp/aos-fe/workflowTaskMeta.js $RemoteRoot/frontend/src/components/workflow/workflowTaskMeta.js
cp -f /tmp/aos-fe/AgentExchange.jsx $RemoteRoot/frontend/src/pages/AgentExchange.jsx
cp -f /tmp/aos-fe/AgentChat.jsx $RemoteRoot/frontend/src/pages/AgentChat.jsx
cp -f /tmp/aos-fe/Dashboard.jsx $RemoteRoot/frontend/src/pages/Dashboard.jsx
cp -f /tmp/aos-fe/Kanban.jsx $RemoteRoot/frontend/src/pages/Kanban.jsx
cp -f /tmp/aos-fe/AgentWorkflowEditor.jsx $RemoteRoot/frontend/src/pages/AgentWorkflowEditor.jsx
cp -f /tmp/aos-fe/Register.jsx $RemoteRoot/frontend/src/pages/Register.jsx
cp -f /tmp/aos-fe/UserProfile.jsx $RemoteRoot/frontend/src/pages/UserProfile.jsx
cp -f /tmp/aos-fe/Login.jsx $RemoteRoot/frontend/src/pages/Login.jsx
cp -f /tmp/aos-fe/MasterData.jsx $RemoteRoot/frontend/src/pages/MasterData.jsx
"@

Write-Host "==> Sync deploy compose + nginx + scripts + README"
scp @ssh `
  "$Repo\deploy\docker-compose.yml" `
  "$Repo\deploy\docker-compose.browser.yml" `
  "$Repo\deploy\.env.example" `
  "$Repo\deploy\README.md" `
  "root@${HostIp}:$RemoteRoot/deploy/"
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
  Write-Host "==> Sync backend/src + backend/scripts + scripts/lib + openclaw-extensions"
  scp @ssh -r "$Repo\backend\src" "root@${HostIp}:$RemoteRoot/backend/"
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
    "$Repo\backend\scripts\test-master-data-content-tools.js" `
    "root@${HostIp}:$RemoteRoot/backend/scripts/"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/scripts/lib"
  scp @ssh `
    "$Repo\scripts\lib\content-tools-allow.js" `
    "$Repo\scripts\lib\openclaw-paths.js" `
    "root@${HostIp}:$RemoteRoot/scripts/lib/"
  scp @ssh "$Repo\scripts\apply-openclaw-agents-config.js" "root@${HostIp}:$RemoteRoot/scripts/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-bootstrap-watcher" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
  Write-Host "==> Sync COO workspace templates + content-tools + agent-send skills"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/openclaw-workspace-templates/balserve $RemoteRoot/openclaw-skills/agent-os-content-tools $RemoteRoot/openclaw-skills/agent-send"
  scp @ssh `
    "$Repo\openclaw-workspace-templates\balserve\AGENTS.md" `
    "$Repo\openclaw-workspace-templates\balserve\TOOLS.md" `
    "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/balserve/"
  scp @ssh -r "$Repo\openclaw-skills\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-skills/"
  scp @ssh -r "$Repo\openclaw-skills\agent-send" "root@${HostIp}:$RemoteRoot/openclaw-skills/"
}

$smokeEnv = if ($SkipSmoke) { "SKIP_SMOKE=1" } else { "SKIP_SMOKE=0" }
Write-Host "==> Run vps-deploy-latest.sh (SERVICES=$Services $smokeEnv)"
ssh @ssh "root@$HostIp" "sed -i 's/\r`$//' $RemoteRoot/deploy/scripts/vps-deploy-latest.sh $RemoteRoot/deploy/scripts/vps-verify-platform.sh $RemoteRoot/deploy/scripts/vps-verify-frontend-media.sh $RemoteRoot/deploy/scripts/vps-smoke-new-features.sh $RemoteRoot/deploy/scripts/up.sh; SKIP_GIT=1 $smokeEnv SERVICES='$Services' bash $RemoteRoot/deploy/scripts/vps-deploy-latest.sh"
Write-Host "SYNC_DEPLOY_DONE"

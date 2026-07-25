# Sync local repo trees to VPS and run vps-deploy-latest.sh (when VPS cannot git pull).
# Usage (from laptop, PowerShell):
#   .\deploy\scripts\sync-to-vps.ps1
#   .\deploy\scripts\sync-to-vps.ps1 -Services frontend
#   .\deploy\scripts\sync-to-vps.ps1 -HostIp 76.13.209.30 -Key $env:USERPROFILE\.ssh\agent-os-vps
#   .\deploy\scripts\sync-to-vps.ps1 -SkipSmoke   # skip post-deploy smoke + platform verify
#   .\deploy\scripts\sync-to-vps.ps1 -NoCache     # force docker compose build --no-cache
#
# Syncs full build contexts: frontend/, backend/src + backend/desktop-workflow-runner + scripts,
# deploy/docker + compose overlays (incl. docker-compose.vps-client-ip.yml for real client IP / A2A whitelist),
# scripts/, openclaw extensions/skills/templates — then rebuilds via vps-deploy-latest.sh.
#
# Features covered: Kanban orphan watcher (re-pend stuck processing + reinitiate specialty cards),
# Kanban All view (default) aligned with status_checker all-ages counts,
# private A2A publications reachable from COO delegation when registered as an
# External Agent (loopback endpoints invoke in-process instead of self-HTTP 403),
# Kanban platform-timezone dates (PLATFORM_TIMEZONE) + task activity that survives
# archived agent chats (chat_context), Admin Crons console (/admin/crons pause/resume/run now, persisted pause state),
# platform API logging (PLATFORM_LOG_LEVEL=off|error|info + secret redaction),
# Brave Search MCP BYOK wrapper (tools/brave-search-mcp-byok, profile optional-brave-mcp),
# cron reference block in deploy/.env (ensure-cron-env.sh) + platform-help 19
# (scheduled jobs / retention), Org Storage (MB), COO status_checker report, data retention purge,
# Flolah branding, hPanel light theme (collapsible nav + profile menu),
# workflow editor fullscreen (shell-focus-mode), Register MCP/Agents primary CTAs,
# multi-tenant standups/delegation, Kanban owner_user_id isolation (no shared-agent leak),
# lean Kanban board (no Job applications filter / pipeline status banner),
# lean CEO onboard (COO + Workflow Builder + Platform Help), OrgDesigner dashboard,
# Master Data + RAG tools, Platform Help agent + help corpus,
# notify_ceo + email_send, Broadcast (intent-based notify + paced fan-out), AGENTS.md intent
# COO specialty delegation, peer specialty referral, chat tool-call icons,
# notification tooltips + datetime, deploy smokes self-clean (no CEO standup/notify pollution),
# CEO Policies/guardrails (POLICY.md + Brain prepend), org sync (tenant ORG.md/AGENTS.md/POLICY.md),
# AgentExchange/A2A (Test agent UI; sync/async + callback/enquire; deny_all default IP;
# Admin A2A invocation logs; allow/whitelist via vps-client-ip compose on VPS; owner unpublish),
# workflow API/MCP/A2A auth templates ({{nodeId.path}} bearer/headers — static or from prior step),
# Brave Search MCP BYOK (no platform BRAVE_API_KEY fallback; workflow headers only),
# Admin refresh default agents MD+tools, Master Data office extract (pdf/docx/xlsx),
# DeepSeek@Ollama, shared notification dismiss,
# chat paperclip attach → Master Data RAG, Vedic Astrology + generate_chart (JSON chart_spec),
# Workflow autonomous certify (Maker/Checker; LLM Checker default OFF — WORKFLOW_CERTIFY_*),
# Desktop Windows packages (PS1 + optional portable Node 18; token + IP whitelist; ASCII-safe PS1),
# COO AGENTS.md org-generated marker (workspace template sync no longer clobbers leaf members),
# department purpose + monthly_token_budget, agent monthly token/error budgets (token_usage ledger,
# warn-then-block; internal COO delegation budget gate), Brain token attribution to a2a leaf members,
# Efficiency View Org / Department / Agent tabs + Reset usage (MTD tokens → 0) + leaf n/a KPIs,
# standup "Get work from team" fan-out to agents under the COO,
# Org Storage (MB) metric, COO status_checker (standup + HTML email; daily cron + Dashboard button),
# data retention days on profile (30/60/90/120/365) + daily purge cron + Dashboard/Profile purge,
# external/A2A agents as org leaf members
# (Add to org / Remove from org on chart + cards; delete/unpublish clears org placement; ORG.md sync manual),
# COO delegation to them (budgets enforced before enqueue/cron), A2A visibility public|private (private = org COO/reports-to only),
# Master Data Purge all uploads (CEO uploads only; Platform Help + User Guide protected from delete/purge),
# agent delete cascade (transactional, clears kanban assignments) + deleted_agents tombstone
# (startup catalog re-grant and OpenClaw sync no longer resurrect a deleted agent).
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
  "$Repo\deploy\docker-compose.vps-client-ip.yml" `
  "$Repo\deploy\.env.example" `
  "$Repo\deploy\README.md" `
  "root@${HostIp}:$RemoteRoot/deploy/"
scp @ssh -r "$Repo\deploy\docker" "root@${HostIp}:$RemoteRoot/deploy/"
scp @ssh `
  "$Repo\deploy\nginx\nginx.conf" `
  "$Repo\deploy\nginx\nginx.host-network.conf" `
  "$Repo\deploy\nginx\frontend.conf" `
  "root@${HostIp}:$RemoteRoot/deploy/nginx/"
scp @ssh `
  "$Repo\deploy\scripts\vps-deploy-latest.sh" `
  "$Repo\deploy\scripts\vps-verify-platform.sh" `
  "$Repo\deploy\scripts\vps-verify-a2a-private.sh" `
  "$Repo\deploy\scripts\vps-verify-org-delegation.sh" `
  "$Repo\deploy\scripts\vps-verify-frontend-media.sh" `
  "$Repo\deploy\scripts\vps-smoke-new-features.sh" `
  "$Repo\deploy\scripts\vps-smoke-broadcast-notify.sh" `
  "$Repo\deploy\scripts\vps-smoke-deepseek-brain.sh" `
  "$Repo\deploy\scripts\vps-smoke-brain-mcp.sh" `
  "$Repo\deploy\scripts\vps-smoke-openconnector.sh" `
  "$Repo\deploy\scripts\vps-smoke-openconnector-real.sh" `
  "$Repo\deploy\scripts\vps-smoke-openconnector-selfservice.sh" `
  "$Repo\deploy\scripts\vps-smoke-budgets-org-members.sh" `
  "$Repo\deploy\scripts\vps-verify-status-retention-ui.sh" `
  "$Repo\deploy\scripts\vps-inspect-frontend-bundle.sh" `
  "$Repo\deploy\scripts\vps-regression-full.sh" `
  "$Repo\deploy\scripts\vps-enable-real-openconnector.sh" `
  "$Repo\deploy\scripts\vps-rebuild-frontend.sh" `
  "$Repo\deploy\scripts\ensure-deepseek-env.sh" `
  "$Repo\deploy\scripts\ensure-workflow-certify-env.sh" `
  "$Repo\deploy\scripts\ensure-cron-env.sh" `
  "$Repo\deploy\scripts\vps-deploy-coo-org-fix.sh" `
  "$Repo\deploy\scripts\vps-smoke-brave-byok.sh" `
  "$Repo\deploy\scripts\configure-openclaw-docker.js" `
  "$Repo\deploy\scripts\verify-openclaw-parity.js" `
  "$Repo\deploy\scripts\up.sh" `
  "root@${HostIp}:$RemoteRoot/deploy/scripts/"

# Remove obsolete DeepSeek cloud proxy artifacts on VPS
ssh @ssh "root@$HostIp" "rm -f $RemoteRoot/deploy/docker/deepseek-proxy.js $RemoteRoot/deploy/docker/deepseek-proxy.Dockerfile; docker rm -f agent-os-deepseek-1 2>/dev/null || true"

# Broader sync for backend/openclaw when doing full deploy
if ($Services -match "backend|openclaw") {
  Write-Host "==> Sync backend/src + desktop-workflow-runner + package files + backend/scripts + scripts/ + openclaw-*"
  scp @ssh -r "$Repo\backend\src" "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh -r "$Repo\backend\desktop-workflow-runner" "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh `
    "$Repo\backend\package.json" `
    "$Repo\backend\package-lock.json" `
    "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh `
    "$Repo\backend\scripts\test-workflow-desktop-package.js" `
    "$Repo\backend\scripts\vps-test-platform-help.js" `
    "$Repo\backend\scripts\seed-workflow-builder-agent.js" `
    "$Repo\backend\scripts\seed-platform-help-agent.js" `
    "$Repo\backend\scripts\test-platform-help-seed.js" `
    "$Repo\backend\scripts\reupload-platform-help-docs.js" `
    "$Repo\backend\scripts\test-platform-help-rag.js" `
    "$Repo\backend\scripts\test-platform-help-chat.js" `
    "$Repo\backend\scripts\vps-smoke-new-features.js" `
    "$Repo\backend\scripts\vps-test-status-retention.js" `
    "$Repo\backend\scripts\test-standup-get-work-from-team.js" `
    "$Repo\backend\scripts\test-email-send-tool.js" `
    "$Repo\backend\scripts\test-notify-ceo-tool.js" `
    "$Repo\backend\scripts\test-notify-ceo-delegated.js" `
    "$Repo\backend\scripts\sync-org-context-ceo.js" `
    "$Repo\backend\scripts\test-tenancy-notify-new-agent-e2e.js" `
    "$Repo\backend\scripts\test-workflow-a2a-publish.js" `
    "$Repo\backend\scripts\test-workflow-a2a-oauth.js" `
    "$Repo\backend\scripts\test-workflow-a2a-async-publish.js" `
    "$Repo\backend\scripts\vps-publish-async-a2a-callback-test.js" `
    "$Repo\backend\scripts\check-a2a-callback-inbox.js" `
    "$Repo\backend\scripts\laptop-test-a2a-async-callback.js" `
    "$Repo\backend\scripts\test-a2a-agent-exchange-security.js" `
    "$Repo\backend\scripts\vps-test-agent-exchange-security.js" `
    "$Repo\backend\scripts\vps-test-agent-exchange-test-invoke.js" `
    "$Repo\backend\scripts\test-workflow-input-schema.js" `
    "$Repo\backend\scripts\test-workflow-input-schema-e2e.js" `
    "$Repo\backend\scripts\test-coo-email-send-calendar.js" `
    "$Repo\backend\scripts\test-deepseek-brain-workflow.js" `
    "$Repo\backend\scripts\test-broadcast-notify-ceo.js" `
    "$Repo\backend\scripts\test-master-data-content-tools.js" `
    "$Repo\backend\scripts\heal-agent-workspace-paths.js" `
    "$Repo\backend\scripts\test-broadcast-routing.js" `
    "$Repo\backend\scripts\test-coo-reach-me-delegation.js" `
    "$Repo\backend\scripts\apply-platform-standard-to-bala.js" `
    "$Repo\backend\scripts\repair-bala-ops-after-standard-apply.js" `
    "$Repo\backend\scripts\test-ceo-guardrails.js" `
    "$Repo\backend\scripts\test-kanban-delegation-sync.js" `
    "$Repo\backend\scripts\test-kanban-owner-isolation.js" `
    "$Repo\backend\scripts\test-kanban-timezone-and-chat-context.js" `
    "$Repo\backend\scripts\test-a2a-private-local-delegation.js" `
    "$Repo\backend\scripts\test-kanban-orphan-watcher.js" `
    "$Repo\backend\scripts\test-a2a-leaf-kanban-complete.js" `
    "$Repo\backend\scripts\vps-test-private-ops-echo-delegation.js" `
    "$Repo\backend\scripts\test-org-member-delegation-e2e.js" `
    "$Repo\backend\scripts\test-help-doc-accuracy.js" `
    "$Repo\backend\scripts\heal-platform-help-docs.js" `
    "$Repo\backend\scripts\heal-stuck-kanban-delegations.js" `
    "$Repo\backend\scripts\refresh-coo-workspace-docs.js" `
    "$Repo\backend\scripts\test-openconnector-connectors-e2e.js" `
    "$Repo\backend\scripts\test-openconnector-selfservice.js" `
    "$Repo\backend\scripts\provision-openconnector-ceos.js" `
    "$Repo\backend\scripts\vps-test-balaji-agents-kanban.js" `
    "$Repo\backend\scripts\vps-test-coo-biryani-delegate.js" `
    "$Repo\backend\scripts\vps-test-coo-moon-fuel.js" `
    "$Repo\backend\scripts\vps-test-application-masterdata-notify.js" `
    "$Repo\backend\scripts\offboard-users-except-keepers.js" `
    "$Repo\backend\scripts\onboard-vedic-astrology-agent.js" `
    "$Repo\backend\scripts\vps-onboard-specialty-agents-bala.js" `
    "$Repo\backend\scripts\test-vedic-compute-chart.js" `
    "$Repo\backend\scripts\test-generate-chart.js" `
    "$Repo\backend\scripts\test-weather-agent-ui-onboard-e2e.js" `
    "$Repo\backend\scripts\test-workflow-builder-until-success.js" `
    "$Repo\backend\scripts\test-workflow-certify.js" `
    "$Repo\backend\scripts\test-workflow-certify-ibkr-e2e.js" `
    "$Repo\backend\scripts\test-master-data-office-extract.js" `
    "$Repo\backend\scripts\test-purge-all-documents.js" `
    "$Repo\backend\scripts\test-agent-delete-cascade.js" `
    "$Repo\backend\scripts\test-learnings-cache.js" `
    "$Repo\backend\scripts\test-history-summary-cache.js" `
    "$Repo\backend\scripts\test-workflow-auth-templates.js" `
    "$Repo\backend\scripts\seed-brave-search-mcp.js" `
    "$Repo\backend\scripts\seed-balaji-brave-byok-workflow.js" `
    "$Repo\backend\scripts\test-balaji-brave-byok-workflow.js" `
    "$Repo\backend\scripts\seed-brain-brave-search-workflow.js" `
    "$Repo\backend\scripts\test-brain-brave-search-workflow.js" `
    "$Repo\backend\scripts\verify-budgets-org-members.js" `
    "$Repo\backend\scripts\verify-module-graph.js" `
    "$Repo\backend\scripts\verify-agent-view-api.js" `
    "$Repo\backend\scripts\test-org-member-delegation-e2e.js" `
    "$Repo\backend\scripts\test-a2a-private-visibility.js" `
    "$Repo\backend\scripts\test-balaji-org-delegation-live.js" `
    "$Repo\backend\scripts\repair-live-echo-workflows.js" `
    "$Repo\backend\scripts\test-coo-agents-md-preserved.js" `
    "$Repo\backend\scripts\test-coo-agents-md-merge.js" `
    "$Repo\backend\scripts\test-intent-agents-md-parse.js" `
    "$Repo\backend\scripts\test-brain-token-attribution.js" `
    "$Repo\backend\scripts\test-internal-delegation-budget-gate.js" `
    "$Repo\backend\scripts\test-department-efficiency.js" `
    "$Repo\backend\scripts\test-token-usage-reset.js" `
    "$Repo\backend\scripts\test-kanban-status-only-reply.js" `
    "$Repo\backend\scripts\test-delegation-status-only-retry.js" `
    "$Repo\backend\scripts\vps-test-coo-rag-kanban-flow.js" `
    "$Repo\backend\scripts\test-kanban-chat-status-guidance.js" `
    "$Repo\backend\scripts\test-ceo-profile-tool.js" `
    "$Repo\backend\scripts\verify-coo-agents-md.js" `
    "$Repo\backend\scripts\cleanup-agents-md-backups.js" `
    "$Repo\backend\scripts\probe-get-work-from-team.js" `
    "$Repo\backend\scripts\probe-balaji-org.js" `
    "$Repo\backend\scripts\probe-balaji-live-artifacts.js" `
    "$Repo\backend\scripts\probe-budgets-org-ready.js" `
    "$Repo\backend\scripts\list-ceos.js" `
    "root@${HostIp}:$RemoteRoot/backend/scripts/"
  Write-Host "==> Sync tests/ (regression packs)"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/tests/lib"
  scp @ssh `
    "$Repo\tests\regression-full.js" `
    "$Repo\tests\regression-minimal.js" `
    "$Repo\tests\api-smoke.js" `
    "$Repo\tests\api-full.js" `
    "root@${HostIp}:$RemoteRoot/tests/"
  scp @ssh "$Repo\tests\lib\ceo-session.js" "root@${HostIp}:$RemoteRoot/tests/lib/"
  scp @ssh -r "$Repo\scripts" "root@${HostIp}:$RemoteRoot/"
  Write-Host "==> Sync Brave BYOK MCP tool source (compose build context)"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/tools/brave-search-mcp-byok"
  scp @ssh "$Repo\tools\brave-search-mcp-byok\server.js" "root@${HostIp}:$RemoteRoot/tools/brave-search-mcp-byok/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-bootstrap-watcher" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
  Write-Host "==> Sync workspace templates (shared ops + COO + TechResearcher + ApplicationAgent + Workflow Builder + Platform Help + Vedic Astrology) + skills + platform-help KB"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/openclaw-workspace-templates $RemoteRoot/openclaw-skills/agent-os-content-tools $RemoteRoot/openclaw-skills/agent-send"
  scp @ssh -r "$Repo\openclaw-workspace-templates\_shared" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\balserve" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\techresearcher" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\applicationagent" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\workflowbuilder" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\platformhelp" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\vedic-astrology" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\socialasstant" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\expensemanager" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\fitscorer" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\jobdiscovery" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\resumetailor" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\bala" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/knowledgebase"
  scp @ssh -r "$Repo\knowledgebase\platform-help" "root@${HostIp}:$RemoteRoot/knowledgebase/"
  scp @ssh "$Repo\knowledgebase\README.md" "root@${HostIp}:$RemoteRoot/knowledgebase/README.md"
  scp @ssh "$Repo\README.md" "root@${HostIp}:$RemoteRoot/README.md"
  scp @ssh -r "$Repo\openclaw-skills\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-skills/"
  scp @ssh -r "$Repo\openclaw-skills\agent-send" "root@${HostIp}:$RemoteRoot/openclaw-skills/"
}

$smokeEnv = if ($SkipSmoke) { "SKIP_SMOKE=1" } else { "SKIP_SMOKE=0" }
$cacheEnv = if ($NoCache) { "NO_CACHE=1" } else { "NO_CACHE=0" }
Write-Host "==> Run vps-deploy-latest.sh (SERVICES=$Services $smokeEnv $cacheEnv)"
# docker compose logs progress on stderr; with ErrorActionPreference=Stop that would abort the
# deploy mid-flight, so fold stderr into stdout and gate on the remote exit code instead.
$ErrorActionPreference = "Continue"
ssh @ssh "root@$HostIp" @"
sed -i 's/\r`$//' \
  $RemoteRoot/deploy/scripts/vps-deploy-latest.sh \
  $RemoteRoot/deploy/scripts/vps-verify-platform.sh \
  $RemoteRoot/deploy/scripts/vps-verify-frontend-media.sh \
  $RemoteRoot/deploy/scripts/vps-verify-org-delegation.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-new-features.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-broadcast-notify.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-deepseek-brain.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-brain-mcp.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-openconnector.sh \
  $RemoteRoot/deploy/scripts/vps-smoke-budgets-org-members.sh \
  $RemoteRoot/deploy/scripts/vps-regression-full.sh \
  $RemoteRoot/deploy/scripts/ensure-deepseek-env.sh \
  $RemoteRoot/deploy/scripts/vps-rebuild-frontend.sh \
  $RemoteRoot/deploy/scripts/up.sh
SKIP_GIT=1 $smokeEnv $cacheEnv SERVICES='$Services' bash $RemoteRoot/deploy/scripts/vps-deploy-latest.sh
"@ 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "vps-deploy-latest.sh failed with exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}
Write-Host "SYNC_DEPLOY_DONE"

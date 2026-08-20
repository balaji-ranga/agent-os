# Sync local repo trees to VPS and run vps-deploy-latest.sh (when VPS cannot git pull).
# Usage (from laptop, PowerShell):
#   .\deploy\scripts\sync-to-vps.ps1
#   .\deploy\scripts\sync-to-vps.ps1 -Services frontend
#   .\deploy\scripts\sync-to-vps.ps1 -HostIp 76.13.209.30 -Key $env:USERPROFILE\.ssh\agent-os-vps
#   .\deploy\scripts\sync-to-vps.ps1 -SkipSmoke   # skip post-deploy smoke + platform verify
#   .\deploy\scripts\sync-to-vps.ps1 -NoCache     # force docker compose build --no-cache
#
# After each rebuild, vps-deploy-latest.sh runs docker-disk-hygiene.sh (BuildKit cache
# older than 72h + dangling images + leftover oc-fix-ep). Override with SKIP_DOCKER_PRUNE=1
# or DOCKER_BUILDER_PRUNE_ALL=1 / DOCKER_BUILDER_PRUNE_UNTIL=24h on the remote deploy env.
#
# Syncs full build contexts: frontend/, backend/src + backend/desktop-workflow-runner +
# backend/local-ibkr-bridge + scripts,
# deploy/docker + compose overlays (incl. docker-compose.vps-client-ip.yml for real client IP / A2A whitelist),
# scripts/, openclaw extensions/skills/templates — then rebuilds via vps-deploy-latest.sh.
#
# Features covered: Kanban orphan watcher (re-pend stuck processing + reinitiate specialty cards),
# Kanban Weekly-default board + agent filter + Select all + task ID deep-link,
# Global search task id / workflow run id (GET /api/home/search),
# Scheduled goals (hourly|daily|weekdays|weekly, create/edit/pause; Generate draft COO-only;
#   other employees Save & schedule; BD Act handoff via Kanban orphan watcher; SCHEDULED_GOALS_CRON
#   + GOAL_PLAN_* in compose; vps-verify-scheduled-goals.sh + _smoke-scheduled-goals.mjs, help 28/42),
# Home OEI (operational_effectiveness API/tool; scheduled_goal_runs fire counts; help 36),
# Company setup (/company-setup, platform-help 29),
# TOTP first-login QR + security key (Login/Register enrollment),
# Legal register accept + /legal static pages (AGENT_OS_TERMS_VERSION / AGENT_OS_PRIVACY_VERSION),
#   THIRD_PARTY_NOTICES.md (OpenSearch, Open Connector, Node.js, Docker, OpenClaw, npm, optional Twenty/ERPNext),
# Left nav sections collapsed by default (AppNavMenu agent-os-nav-section-v2),
# Kanban All view (default) aligned with status_checker all-ages counts,
# private A2A publications reachable from COO delegation when registered as an
# External Agent (loopback endpoints invoke in-process instead of self-HTTP 403),
# Kanban platform-timezone dates (PLATFORM_TIMEZONE) + task activity that survives
# archived agent chats (chat_context), Admin Crons console (/admin/crons pause/resume/run now, persisted pause state),
# platform API logging (PLATFORM_LOG_LEVEL=off|error|info + secret redaction),
# Brave Search MCP BYOK wrapper (tools/brave-search-mcp-byok, profile optional-brave-mcp),
# Meta Graph MCP (tools/meta-graph-mcp, profile optional-meta-graph-mcp) + Connectors MCPs OAuth,
# Business Core MCP (tools/business-core-mcp → mcp-flolah-crm / mcp-flolah-erp),
# content studio: content-publish-social + content-comments-ingest/community triage (workflow mcp_tool/brain nodes;
#   not one-off content_comments_* tools), day0+day1 blueprint snapshot/publish/export with secret scrub
#   (API keys, bridge tokens, OAuth secrets scrubbed on Admin publish + zip; vault *Ref kept; zip export v2),
#   validate-company-blueprint-export.mjs,
#   complete-content-ops-pipeline,
# ensure-platform-mcps.sh seeds mcp-brave-search + mcp-meta-graph + mcp-flolah-crm + mcp-flolah-erp + mcp-social-research + mcp-web-scrape (is_platform=1),
# Business Core prefab Maker/Checker agents when Profile CRM=twenty / ERP=erpnext,
# SEED_CONTENT_MEDIA_OWNER (optional) post-deploy seeds publish+comments workflows for that CEO,
# Brave agent tool brave_web_search (backend BRAVE_API_KEY + vault BRAVE_SEARCH_BYOK),
# cron reference block in deploy/.env (ensure-cron-env.sh) + platform-help 19 (+ SCHEDULED_GOALS_CRON, TOOL_API_RATE_LIMIT_RESET_CRON)
# (scheduled jobs / retention incl. Content Explorer media hard-delete), Org Storage (MB)
# (tenant + media/generated/<ceo>), COO status_checker report, data retention purge,
# Content Explorer (/content-explorer list/download/delete), Profile LLM catalog (provider+model),
# Onboarding Helper bridge (onboarding_save/apply_proposal + /onboarding selective Review; E2E prompts in help 27),
# Published Scenes + public VR (/p/vr/:slug), Slack/WhatsApp agent channels wizard,
# free STT/TTS optional-voice (ensure-voice-env.sh → SPEECH_* + whisper/piper),
# Flolah branding, hPanel shell + light/dark theme (ThemeToggle, data-theme),
# Agent Workspaces Add agent (AddAgentForm), Tools nav label (/content-tools),
# Tools → Model + Tools → Rate limits (per-user daily/monthly API call caps; help 11),
# workflow editor fullscreen (shell-focus-mode), run audit fullscreen (/workflows/runs/:id),
# Register MCP/Agents primary CTAs,
# multi-tenant standups/delegation, Kanban owner_user_id isolation (no shared-agent leak),
# lean Kanban board (no Job applications filter / pipeline status banner),
# lean CEO onboard (COO + Workflow Builder + Platform Help), OrgDesigner dashboard,
# Master Data + RAG tools, Platform Help agent + help corpus,
# notify_ceo + email_send, Broadcast (intent-based notify + paced fan-out), AGENTS.md intent
# COO specialty delegation, peer specialty referral, chat tool-call icons,
# notification tooltips + datetime, deploy smokes dry-run get_work_from_team (no CEO standup/Kanban/bell),
# CEO Policies/guardrails (POLICY.md + Brain prepend), org sync (tenant ORG.md/AGENTS.md/POLICY.md),
# AgentExchange/A2A (Test agent UI; sync/async + callback/enquire; deny_all default IP;
# Admin A2A invocation logs; allow/whitelist via vps-client-ip compose on VPS; owner unpublish),
# workflow API/MCP/A2A auth templates ({{nodeId.path}} bearer/headers — static or from prior step),
# Brave Search MCP BYOK (workflow headers only; no BRAVE_API_KEY in MCP container),
# Brave agent tool brave_web_search (backend gets BRAVE_API_KEY; vault BRAVE_SEARCH_BYOK for BYOK Profiles),
# Admin refresh default agents MD+tools, Master Data office extract (pdf/docx/xlsx),
# DeepSeek@Ollama, shared notification dismiss,
# chat paperclip attach → Master Data RAG, Vedic Astrology + generate_chart (JSON chart_spec),
# Workflow autonomous certify (Maker/Checker; LLM Checker default OFF — WORKFLOW_CERTIFY_*),
# Desktop Windows packages (PS1 + optional portable Node 18; token + IP whitelist; ASCII-safe PS1),
# Local IBKR bridge Connectors zip + monthly trading W1–W5 + bridge-order-events learnings ingest,
# laptop poll + ingest /api/ibkr-trading/local-bridge-webhook (W3 secret; W3 graph on EOD) → W1 cache; IBKR Summary UI + clear APIs,
# openclaw.json safe writers (openclaw-config-safe.js) + deploy chatCompletions gate
# (ensure-openclaw-gateway-config.js + vps-verify-openclaw-chat.sh) so Agent Chat never goes 404,
# COO AGENTS.md org-generated marker (workspace template sync no longer clobbers leaf members),
# agent_workflow_runs tool (COO/WB/Content Orchestrator; never ibkr_order_learnings for workflow run status),
# mixed internal+leaf COO specialty refine (Session-keys table no longer drops internals),
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
# OpenSearch document RAG (compose opensearch + dashboards; per-user + platform indices;
# Admin Documents RAG + /opensearch/ BFF; ensure-opensearch-env.sh; local Qwen embeddings),
# agent delete cascade (transactional, clears kanban assignments) + deleted_agents tombstone
# (startup catalog re-grant and OpenClaw sync no longer resurrect a deleted agent),
# Browser Session + browse_* tools (recipe list/run, browser-cdp, Client Chrome relay),
# Admin Tools Onboarding (docker.sock overlay, privileged OTP session, registry allow-list,
# Admin AgentSystem recovery (OTP 30-min session, drain/restart/repair; help 43),
# content-tool register + OpenClaw reload; Admin Crons last_run persists),
# CEO home chat + My Org, collapsible chat history/browser panes (icon toggles),
# Home KPI cards + right snapshot pane + global search (Ctrl+K) + mobile Kanban list UX,
# User/agent profile images (default robot avatar), API Keys Reseed BYOK slots, Flolah SEO meta,
# COO SOUL + org-context channel inbound index → master_data_rag.
# List API server pagination (limit/offset + has_more) for Content Explorer, workflows,
# Kanban tasks, standups, chat history, Master Data docs, AgentExchange, admin users, job spreadsheet.
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

Write-Host "==> Sync frontend (full src tree + package files + index.html + public)"
ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/frontend/src $RemoteRoot/frontend/public $RemoteRoot/deploy/scripts $RemoteRoot/deploy/docker $RemoteRoot/deploy/nginx $RemoteRoot/backend/scripts $RemoteRoot/scripts"
scp @ssh "$Repo\README.md" "root@${HostIp}:$RemoteRoot/"
if (Test-Path "$Repo\THIRD_PARTY_NOTICES.md") {
  scp @ssh "$Repo\THIRD_PARTY_NOTICES.md" "root@${HostIp}:$RemoteRoot/"
}
if (Test-Path "$Repo\LICENSE") {
  scp @ssh "$Repo\LICENSE" "root@${HostIp}:$RemoteRoot/"
}
Write-Host "==> Sync GitHub blueprint secret-scan + CodeQL JS workflows"
ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/.github/workflows $RemoteRoot/.github/codeql"
if (Test-Path "$Repo\.github\workflows\blueprint-secret-scan.yml") {
  scp @ssh "$Repo\.github\workflows\blueprint-secret-scan.yml" "root@${HostIp}:$RemoteRoot/.github/workflows/"
}
if (Test-Path "$Repo\.github\workflows\codeql-javascript.yml") {
  scp @ssh "$Repo\.github\workflows\codeql-javascript.yml" "root@${HostIp}:$RemoteRoot/.github/workflows/"
}
if (Test-Path "$Repo\.github\codeql\codeql-config.yml") {
  scp @ssh "$Repo\.github\codeql\codeql-config.yml" "root@${HostIp}:$RemoteRoot/.github/codeql/"
}
scp @ssh -r "$Repo\frontend\src" "root@${HostIp}:$RemoteRoot/frontend/"
if (Test-Path "$Repo\frontend\public") {
  scp @ssh -r "$Repo\frontend\public" "root@${HostIp}:$RemoteRoot/frontend/"
}
scp @ssh `
  "$Repo\frontend\index.html" `
  "$Repo\frontend\package.json" `
  "$Repo\frontend\package-lock.json" `
  "$Repo\frontend\vite.config.js" `
  "root@${HostIp}:$RemoteRoot/frontend/"
if (Test-Path "$Repo\frontend\scripts") {
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/frontend/scripts"
  scp @ssh -r "$Repo\frontend\scripts" "root@${HostIp}:$RemoteRoot/frontend/"
}

Write-Host "==> Sync deploy compose + nginx + dockerfiles + scripts + README"
scp @ssh `
  "$Repo\deploy\docker-compose.yml" `
  "$Repo\deploy\docker-compose.browser.yml" `
  "$Repo\deploy\docker-compose.vps-client-ip.yml" `
  "$Repo\deploy\docker-compose.docker-tools.yml" `
  "$Repo\deploy\docker-compose.business-core.yml" `
  "$Repo\deploy\docker-compose.ollama-gpu.yml" `
  "$Repo\deploy\.env.example" `
  "$Repo\deploy\README.md" `
  "root@${HostIp}:$RemoteRoot/deploy/"
scp @ssh -r "$Repo\deploy\docker" "root@${HostIp}:$RemoteRoot/deploy/"
Write-Host "==> Sync deploy/business-core docs"
ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/deploy/business-core"
scp @ssh -r "$Repo\deploy\business-core" "root@${HostIp}:$RemoteRoot/deploy/"
Write-Host "==> Sync deploy/assets (OpenClaw chrome-extension pack)"
ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/deploy/assets"
scp @ssh -r "$Repo\deploy\assets" "root@${HostIp}:$RemoteRoot/deploy/"
scp @ssh "$Repo\deploy\scripts\sync-openclaw-chrome-extension.sh" "root@${HostIp}:$RemoteRoot/deploy/scripts/"
scp @ssh `
  "$Repo\deploy\nginx\nginx.conf" `
  "$Repo\deploy\nginx\nginx.host-network.conf" `
  "$Repo\deploy\nginx\frontend.conf" `
  "root@${HostIp}:$RemoteRoot/deploy/nginx/"
Write-Host "==> Sync deploy/static (flolah homepage + CRM/ERP SSO handoffs)"
ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/deploy/static/flolah-home/assets $RemoteRoot/deploy/static/crm-handoff $RemoteRoot/deploy/static/erp-handoff"
scp @ssh -r "$Repo\deploy\static\flolah-home" "root@${HostIp}:$RemoteRoot/deploy/static/"
if (Test-Path "$Repo\deploy\static\crm-handoff") {
  scp @ssh -r "$Repo\deploy\static\crm-handoff" "root@${HostIp}:$RemoteRoot/deploy/static/"
}
if (Test-Path "$Repo\deploy\static\erp-handoff") {
  scp @ssh -r "$Repo\deploy\static\erp-handoff" "root@${HostIp}:$RemoteRoot/deploy/static/"
}
# nginx worker needs world-readable trees (scp often leaves 700 dirs → 403 on /flolah-handoff/)
ssh @ssh "root@$HostIp" "chmod -R a+rX $RemoteRoot/deploy/static/flolah-home; chmod 755 $RemoteRoot/deploy/static/crm-handoff $RemoteRoot/deploy/static/erp-handoff 2>/dev/null; chmod 644 $RemoteRoot/deploy/static/crm-handoff/* $RemoteRoot/deploy/static/erp-handoff/* 2>/dev/null; true"

Write-Host "==> Sync docs-site (public Docusaurus source)"
ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/docs-site/docs $RemoteRoot/docs-site/src/css $RemoteRoot/docs-site/static/img"
scp @ssh `
  "$Repo\docs-site\package.json" `
  "$Repo\docs-site\docusaurus.config.js" `
  "$Repo\docs-site\sidebars.js" `
  "$Repo\docs-site\babel.config.js" `
  "$Repo\docs-site\README.md" `
  "root@${HostIp}:$RemoteRoot/docs-site/"
if (Test-Path "$Repo\docs-site\package-lock.json") {
  scp @ssh "$Repo\docs-site\package-lock.json" "root@${HostIp}:$RemoteRoot/docs-site/"
}
scp @ssh -r "$Repo\docs-site\docs" "root@${HostIp}:$RemoteRoot/docs-site/"
scp @ssh -r "$Repo\docs-site\src" "root@${HostIp}:$RemoteRoot/docs-site/"
scp @ssh -r "$Repo\docs-site\static" "root@${HostIp}:$RemoteRoot/docs-site/"
scp @ssh `
  "$Repo\deploy\scripts\vps-deploy-latest.sh" `
  "$Repo\deploy\scripts\build-public-docs.sh" `
  "$Repo\deploy\scripts\compose-file-defaults.sh" `
  "$Repo\deploy\scripts\assert-vps-ingress.sh" `
  "$Repo\deploy\scripts\vps-expand-login-cert.sh" `
  "$Repo\deploy\scripts\docker-disk-hygiene.sh" `
  "$Repo\deploy\scripts\vps-verify-platform.sh" `
  "$Repo\deploy\scripts\vps-verify-scheduled-goals.sh" `
  "$Repo\deploy\scripts\vps-verify-crm-sso.sh" `
  "$Repo\deploy\scripts\vps-verify-a2a-private.sh" `
  "$Repo\deploy\scripts\vps-verify-org-delegation.sh" `
  "$Repo\deploy\scripts\vps-verify-frontend-media.sh" `
  "$Repo\deploy\scripts\vps-verify-media-delivery.sh" `
  "$Repo\deploy\scripts\vps-verify-agent-channels.sh" `
  "$Repo\deploy\scripts\vps-verify-openclaw-chat.sh" `
  "$Repo\deploy\scripts\ensure-openclaw-gateway-config.js" `
  "$Repo\deploy\scripts\restore-openclaw-channel-routing.js" `
  "$Repo\deploy\scripts\ensure-openclaw-channel-plugins.sh" `
  "$Repo\deploy\scripts\vps-smoke-new-features.sh" `
  "$Repo\deploy\scripts\vps-smoke-broadcast-notify.sh" `
  "$Repo\deploy\scripts\vps-smoke-deepseek-brain.sh" `
  "$Repo\deploy\scripts\vps-smoke-brain-mcp.sh" `
  "$Repo\deploy\scripts\vps-smoke-openconnector.sh" `
  "$Repo\deploy\scripts\vps-smoke-openconnector-real.sh" `
  "$Repo\deploy\scripts\vps-smoke-openconnector-selfservice.sh" `
  "$Repo\deploy\scripts\vps-smoke-budgets-org-members.sh" `
  "$Repo\deploy\scripts\vps-verify-status-retention-ui.sh" `
  "$Repo\deploy\scripts\vps-regression-full.sh" `
  "$Repo\deploy\scripts\vps-enable-real-openconnector.sh" `
  "$Repo\deploy\scripts\vps-rebuild-frontend.sh" `
  "$Repo\deploy\scripts\vps-bootstrap.sh" `
  "$Repo\deploy\scripts\vps-bringup.sh" `
  "$Repo\deploy\scripts\vps-build.sh" `
  "$Repo\deploy\scripts\ensure-deepseek-env.sh" `
  "$Repo\deploy\scripts\ensure-local-openclaw-ollama.sh" `
  "$Repo\deploy\scripts\ensure-workflow-certify-env.sh" `
  "$Repo\deploy\scripts\ensure-cron-env.sh" `
  "$Repo\deploy\scripts\ensure-opensearch-env.sh" `
  "$Repo\deploy\scripts\ensure-docker-tools-env.sh" `
  "$Repo\deploy\scripts\ensure-voice-env.sh" `
  "$Repo\deploy\scripts\ensure-embeddings-env.sh" `
  "$Repo\deploy\scripts\ensure-platform-mcps.sh" `
  "$Repo\deploy\scripts\ensure-business-core-env.sh" `
  "$Repo\deploy\scripts\enable-docker-tools-on-vps.sh" `
  "$Repo\deploy\scripts\vps-smoke-brave-byok.sh" `
  "$Repo\deploy\scripts\vps-smoke-meta-graph-mcp.sh" `
  "$Repo\deploy\scripts\vps-smoke-social-research.sh" `
  "$Repo\deploy\scripts\configure-openclaw-docker.js" `
  "$Repo\deploy\scripts\verify-openclaw-parity.js" `
  "$Repo\deploy\scripts\up.sh" `
  "$Repo\deploy\scripts\vps-expand-login-cert.sh" `
  "$Repo\deploy\scripts\vps-expand-crm-cert.sh" `
  "$Repo\deploy\scripts\vps-ensure-crm-workspace-dns-cert.sh" `
  "$Repo\deploy\scripts\vps-refresh-tls-certs.sh" `
  "root@${HostIp}:$RemoteRoot/deploy/scripts/"

# Remove obsolete DeepSeek cloud proxy artifacts on VPS
ssh @ssh "root@$HostIp" "rm -f $RemoteRoot/deploy/docker/deepseek-proxy.js $RemoteRoot/deploy/docker/deepseek-proxy.Dockerfile; docker rm -f agent-os-deepseek-1 2>/dev/null || true"

# Broader sync for backend/openclaw when doing full deploy
if ($Services -match "backend|openclaw") {
  Write-Host "==> Sync backend/src + desktop-workflow-runner + local-ibkr-bridge + package files + backend/scripts + scripts/ + openclaw-*"
  scp @ssh -r "$Repo\backend\src" "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh -r "$Repo\backend\desktop-workflow-runner" "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh -r "$Repo\backend\local-ibkr-bridge" "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh -r "$Repo\backend\local-browser-worker" "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh `
    "$Repo\backend\package.json" `
    "$Repo\backend\package-lock.json" `
    "$Repo\backend\.env.example" `
    "root@${HostIp}:$RemoteRoot/backend/"
  scp @ssh `
    "$Repo\backend\scripts\sync-agent-channels-to-openclaw.js" `
    "$Repo\backend\scripts\test-media-url.js" `
    "$Repo\backend\scripts\test-ssrf-outbound.js" `
    "$Repo\backend\scripts\seed-inbound-media-summarize-workflow.js" `
    "$Repo\backend\scripts\test-workflow-desktop-package.js" `
    "$Repo\backend\scripts\test-local-ibkr-bridge-package.js" `
    "$Repo\backend\scripts\vps-test-platform-help.js" `
    "$Repo\backend\scripts\seed-workflow-builder-agent.js" `
    "$Repo\backend\scripts\seed-platform-help-agent.js" `
    "$Repo\backend\scripts\seed-onboarding-helper-agent.js" `
    "$Repo\backend\scripts\e2e-onboarding-wf-prompts.mjs" `
    "$Repo\backend\scripts\export-video-tours.js" `
    "$Repo\backend\scripts\video-tours-storyboards.js" `
    "$Repo\backend\scripts\video-tours-render-slides.js" `
    "$Repo\backend\scripts\_smoke-scheduled-goals.mjs" `
    "$Repo\backend\scripts\test-phase1-management-layer.mjs" `
    "$Repo\backend\scripts\test-t123-acceptance.mjs" `
    "$Repo\backend\scripts\test-phase2-pipeline-stress.mjs" `
    "$Repo\backend\scripts\test-gate-bc-live.mjs" `
    "$Repo\backend\scripts\test-agent-channel-announce.mjs" `
    "$Repo\backend\scripts\test-openclaw-delivery-noise.mjs" `
    "$Repo\backend\scripts\test-platform-help-seed.js" `
    "$Repo\backend\scripts\test-totp-enrollment-fields.js" `
    "$Repo\backend\scripts\reupload-platform-help-docs.js" `
    "$Repo\backend\scripts\test-platform-help-rag.js" `
    "$Repo\backend\scripts\test-platform-help-merge-rag.js" `
    "$Repo\backend\scripts\test-opensearch-rag-smoke.js" `
    "$Repo\backend\scripts\test-opensearch-agent-rag-e2e.js" `
    "$Repo\backend\scripts\test-docker-tool-onboarding-vps.js" `
    "$Repo\backend\scripts\test-admin-privileged-session.js" `
    "$Repo\backend\scripts\test-techresearcher-echo-probe-grant.js" `
    "$Repo\backend\scripts\test-master-data-e2e.js" `
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
    "$Repo\backend\scripts\test-market-data-tools.js" `
    "$Repo\backend\scripts\monthly-trading-seed-variables.js" `
    "$Repo\backend\scripts\seed-monthly-trading-w1-workflow.js" `
    "$Repo\backend\scripts\export-standard-ibkr-workflows.js" `
    "$Repo\backend\scripts\seed-monthly-trading-w2-workflow.js" `
    "$Repo\backend\scripts\seed-monthly-trading-w3-workflow.js" `
    "$Repo\backend\scripts\seed-monthly-trading-w5-workflow.js" `
    "$Repo\backend\scripts\seed-monthly-trading-workflows.js" `
    "$Repo\backend\scripts\test-monthly-trading-seeds.js" `
    "$Repo\backend\scripts\test-monthly-trading-paper-e2e.js" `
    "$Repo\backend\scripts\certify-monthly-trading-workflows.js" `
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
    "$Repo\backend\scripts\test-org-people.js" `
    "$Repo\backend\scripts\test-help-doc-accuracy.js" `
    "$Repo\backend\scripts\heal-platform-help-docs.js" `
    "$Repo\backend\scripts\heal-stuck-kanban-delegations.js" `
    "$Repo\backend\scripts\refresh-coo-workspace-docs.js" `
    "$Repo\backend\scripts\refresh-business-core-workspace-docs.js" `
    "$Repo\backend\scripts\test-openconnector-connectors-e2e.js" `
    "$Repo\backend\scripts\test-openconnector-selfservice.js" `
    "$Repo\backend\scripts\test-openconnector-oauth-override.js" `
    "$Repo\backend\scripts\probe-oc-custom-oauth.js" `
    "$Repo\backend\scripts\provision-openconnector-ceos.js" `
    "$Repo\backend\scripts\vps-test-balaji-agents-kanban.js" `
    "$Repo\backend\scripts\vps-test-coo-biryani-delegate.js" `
    "$Repo\backend\scripts\vps-test-coo-moon-fuel.js" `
    "$Repo\backend\scripts\vps-test-application-masterdata-notify.js" `
    "$Repo\backend\scripts\offboard-users-except-keepers.js" `
    "$Repo\backend\scripts\offboard-users-by-name-prefix.js" `
    "$Repo\backend\scripts\test-admin-user-insights.js" `
    "$Repo\backend\scripts\test-living-twenty-crm-holds.js" `
    "$Repo\backend\scripts\test-twenty-sso-handoff.js" `
    "$Repo\backend\scripts\vps-verify-crm-sso.js" `
    "$Repo\backend\scripts\e2e-crm-embed-ui.mjs" `
    "$Repo\backend\scripts\test-cert-san-covers.js" `
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
    "$Repo\backend\scripts\seed-meta-graph-mcp.js" `
    "$Repo\backend\scripts\seed-business-core-mcp.js" `
    "$Repo\backend\scripts\seed-social-research-mcp.js" `
    "$Repo\backend\scripts\seed-social-research-agents.js" `
    "$Repo\backend\scripts\seed-web-scrape-mcp.js" `
    "$Repo\backend\scripts\seed-web-scrape-instagram-workflow.js" `
    "$Repo\backend\scripts\test-web-scrape-instagram-workflow.js" `
    "$Repo\backend\scripts\vps-test-social-research.mjs" `
    "$Repo\backend\scripts\e2e-tampines-discover.mjs" `
    "$Repo\backend\scripts\test-places-parse-text.mjs" `
    "$Repo\backend\scripts\test-goal-plan-specialty-orchestrator.mjs" `
    "$Repo\backend\scripts\seed-business-core-maker-checker-workflows.js" `
    "$Repo\backend\scripts\publish-balaji-demo-blueprint.js" `
    "$Repo\backend\scripts\patch-demo-blueprint-ibkr-quote-band.js" `
    "$Repo\backend\scripts\publish-brightbox-and-regenerate-standard.js" `
    "$Repo\backend\scripts\publish-education-demo-blueprint.js" `
    "$Repo\backend\scripts\export-workspace-templates-from-owner.js" `
    "$Repo\backend\scripts\seed-content-publish-social-workflow.js" `
    "$Repo\backend\scripts\seed-content-comments-ingest.js" `
    "$Repo\backend\scripts\seed-video-content-workflows.js" `
    "$Repo\backend\scripts\test-video-content-blueprint-merge.js" `
    "$Repo\backend\scripts\test-video-content-phase1.js" `
    "$Repo\backend\scripts\test-video-storyboard-ceo-approval.js" `
    "$Repo\backend\scripts\grant-video-orch-workflow-tools.mjs" `
    "$Repo\backend\scripts\verify-video-orch-workflow-tools.mjs" `
    "$Repo\backend\scripts\heal-openclaw-runtime-tools.mjs" `
    "$Repo\backend\scripts\heal-stuck-scheduled-goals.mjs" `
    "$Repo\backend\scripts\e2e-video-content-ui-phase1.mjs" `
    "$Repo\backend\scripts\complete-content-ops-pipeline.js" `
    "$Repo\backend\scripts\test-content-ops-org-e2e.js" `
    "$Repo\backend\scripts\republish-content-ops-blueprint.js" `
    "$Repo\backend\scripts\validate-company-blueprint-export.mjs" `
    "$Repo\backend\scripts\scan-blueprint-secrets.js" `
    "$Repo\backend\scripts\test-blueprint-secret-sanitize.js" `
    "$Repo\backend\scripts\bootstrap-content-publish-phase01.js" `
    "$Repo\backend\scripts\bootstrap-education-demo-ceo.js" `
    "$Repo\backend\scripts\e2e-content-publish-social-li.js" `
    "$Repo\backend\scripts\create-content-media-ceo.mjs" `
    "$Repo\backend\scripts\seed-balaji-brave-byok-workflow.js" `
    "$Repo\backend\scripts\test-balaji-brave-byok-workflow.js" `
    "$Repo\backend\scripts\seed-brain-brave-search-workflow.js" `
    "$Repo\backend\scripts\test-brain-brave-search-workflow.js" `
    "$Repo\backend\scripts\verify-budgets-org-members.js" `
    "$Repo\backend\scripts\verify-module-graph.js" `
    "$Repo\backend\scripts\verify-agent-view-api.js" `
    "$Repo\backend\scripts\test-org-member-delegation-e2e.js" `
    "$Repo\backend\scripts\test-org-people.js" `
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
    "$Repo\backend\scripts\test-tool-api-rate-limits.js" `
    "$Repo\backend\scripts\test-kanban-status-only-reply.js" `
    "$Repo\backend\scripts\test-delegation-status-only-retry.js" `
    "$Repo\backend\scripts\vps-test-coo-rag-kanban-flow.js" `
    "$Repo\backend\scripts\test-kanban-chat-status-guidance.js" `
    "$Repo\backend\scripts\test-ceo-profile-tool.js" `
    "$Repo\backend\scripts\test-legal-register-accept.js" `
    "$Repo\backend\scripts\test-coo-refine-allocation.js" `
    "$Repo\backend\scripts\test-coo-native-file-skip.js" `
    "$Repo\backend\scripts\test-agent-workflow-runs-tool.js" `
    "$Repo\backend\scripts\verify-coo-agents-md.js" `
    "$Repo\backend\scripts\cleanup-agents-md-backups.js" `
    "$Repo\backend\scripts\probe-get-work-from-team.js" `
    "$Repo\backend\scripts\probe-balaji-org.js" `
    "$Repo\backend\scripts\probe-balaji-live-artifacts.js" `
    "$Repo\backend\scripts\probe-budgets-org-ready.js" `
    "$Repo\backend\scripts\list-ceos.js" `
    "root@${HostIp}:$RemoteRoot/backend/scripts/"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/backend/scripts/lib $RemoteRoot/backend/scripts/samples"
  scp @ssh `
    "$Repo\backend\scripts\lib\trading-strategy-prompt.js" `
    "$Repo\backend\scripts\lib\trading-checker-prompt.js" `
    "$Repo\backend\scripts\lib\write-standard-ibkr-workflows.js" `
    "root@${HostIp}:$RemoteRoot/backend/scripts/lib/"
  scp @ssh `
    "$Repo\backend\scripts\samples\monthly-trading-hard-gates.js" `
    "$Repo\backend\scripts\samples\monthly-trading-event-parse.js" `
    "$Repo\backend\scripts\samples\monthly-trading-weekly-digest.js" `
    "$Repo\backend\scripts\samples\ibkr-parse-checker.js" `
    "root@${HostIp}:$RemoteRoot/backend/scripts/samples/"
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
  Write-Host "==> Sync platform MCP tool sources (Brave + Meta Graph + Business Core + Social Research)"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/tools/brave-search-mcp-byok $RemoteRoot/tools/meta-graph-mcp $RemoteRoot/tools/business-core-mcp $RemoteRoot/tools/social-research-mcp $RemoteRoot/tools/instaloader-sidecar $RemoteRoot/tools/web-scrape-mcp"
  scp @ssh "$Repo\tools\brave-search-mcp-byok\server.js" "root@${HostIp}:$RemoteRoot/tools/brave-search-mcp-byok/"
  scp @ssh "$Repo\tools\meta-graph-mcp\server.js" "root@${HostIp}:$RemoteRoot/tools/meta-graph-mcp/"
  scp @ssh "$Repo\tools\business-core-mcp\server.js" "root@${HostIp}:$RemoteRoot/tools/business-core-mcp/"
  scp @ssh "$Repo\tools\social-research-mcp\server.js" "root@${HostIp}:$RemoteRoot/tools/social-research-mcp/"
  scp @ssh "$Repo\tools\instaloader-sidecar\server.py" "root@${HostIp}:$RemoteRoot/tools/instaloader-sidecar/"
  scp @ssh `
    "$Repo\tools\web-scrape-mcp\package.json" `
    "$Repo\tools\web-scrape-mcp\server.js" `
    "$Repo\tools\web-scrape-mcp\crawler.js" `
    "$Repo\tools\web-scrape-mcp\ssrf.js" `
    "root@${HostIp}:$RemoteRoot/tools/web-scrape-mcp/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
  scp @ssh -r "$Repo\openclaw-extensions\agent-os-bootstrap-watcher" "root@${HostIp}:$RemoteRoot/openclaw-extensions/"
  Write-Host "==> Sync workspace templates (shared ops + lean + Business Core CRM/ERP + specialty agents) + skills + platform-help KB"
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/openclaw-workspace-templates $RemoteRoot/openclaw-skills/agent-os-content-tools $RemoteRoot/openclaw-skills/agent-send"
  scp @ssh -r "$Repo\openclaw-workspace-templates\_shared" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\balserve" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\techresearcher" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\applicationagent" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\workflowbuilder" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\platformhelp" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\onboardinghelper" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\vedic-astrology" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\video-orchestrator" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\video-story" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\video-scene" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\video-prompt" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\socialasstant" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\socialresearcher" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\businessdiscovery" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\expensemanager" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\fitscorer" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\jobdiscovery" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\resumetailor" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  scp @ssh -r "$Repo\openclaw-workspace-templates\bala" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  foreach ($callerTpl in @('slow-caller','realtime-caller')) {
    $src = Join-Path $Repo "openclaw-workspace-templates\$callerTpl"
    if (Test-Path $src) {
      scp @ssh -r $src "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
    } else {
      Write-Warning "Missing workspace template folder: $callerTpl"
    }
  }
  if (Test-Path "$Repo\openclaw-workspace-templates\hireable-roles.json") {
    scp @ssh "$Repo\openclaw-workspace-templates\hireable-roles.json" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  }
  # Business Core maker/checker (role-stable templates; runtime ids are crm-s1-{slug}, erp-ap-{slug}, …)
  foreach ($bcTpl in @(
    'crm-maker-a','crm-maker-b','crm-checker',
    'erp-maker-a','erp-maker-b','erp-checker','erp-pnl','erp-invoice','erp-project'
  )) {
    $src = Join-Path $Repo "openclaw-workspace-templates\$bcTpl"
    if (Test-Path $src) {
      scp @ssh -r $src "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
    } else {
      Write-Warning "Missing workspace template folder: $bcTpl"
    }
  }
  if (Test-Path "$Repo\openclaw-workspace-templates\business-core-template-map.json") {
    scp @ssh "$Repo\openclaw-workspace-templates\business-core-template-map.json" "root@${HostIp}:$RemoteRoot/openclaw-workspace-templates/"
  }
  ssh @ssh "root@$HostIp" "mkdir -p $RemoteRoot/knowledgebase"
  scp @ssh -r "$Repo\knowledgebase\platform-help" "root@${HostIp}:$RemoteRoot/knowledgebase/"
  scp @ssh "$Repo\knowledgebase\README.md" "root@${HostIp}:$RemoteRoot/knowledgebase/README.md"
  scp @ssh "$Repo\knowledgebase\TESTING.md" "root@${HostIp}:$RemoteRoot/knowledgebase/TESTING.md"
  if (Test-Path "$Repo\knowledgebase\AI-COMPANY-OS.md") {
    scp @ssh "$Repo\knowledgebase\AI-COMPANY-OS.md" "root@${HostIp}:$RemoteRoot/knowledgebase/AI-COMPANY-OS.md"
  }
  scp @ssh `
    "$Repo\knowledgebase\AUTOMATED-PNL.md" `
    "$Repo\knowledgebase\MANAGEMENT-LAYER-PHASE1.md" `
    "$Repo\knowledgebase\MANAGEMENT-LAYER-PHASE2.md" `
    "$Repo\knowledgebase\LOCAL-OPENCLAW-OLLAMA.md" `
    "$Repo\knowledgebase\ONBOARDING-HELPER-PLAN.md" `
    "$Repo\knowledgebase\VIDEO-TOURS-CEO-CURRICULUM.md" `
    "$Repo\knowledgebase\CONTENT-CREATION-ORG-BLUEPRINT.md" `
    "$Repo\knowledgebase\VIDEO-CONTENT-GENERATION-PLAN.md" `
    "$Repo\knowledgebase\BUSINESS-CORE-WORKSPACE-PLAN.md" `
    "root@${HostIp}:$RemoteRoot/knowledgebase/"
  if (Test-Path "$Repo\knowledgebase\video-tours") {
    scp @ssh -r "$Repo\knowledgebase\video-tours" "root@${HostIp}:$RemoteRoot/knowledgebase/"
  }
  scp @ssh `
    "$Repo\knowledgebase\IBKR-LOCAL-BRIDGE.md" `
    "$Repo\knowledgebase\IBKR-MONTHLY-WORKFLOWS.md" `
    "$Repo\knowledgebase\IBKR-MONTHLY-TRADING-PLAN.md" `
    "$Repo\knowledgebase\IBKR-MONTHLY-EXECUTION-MODEL.md" `
    "$Repo\knowledgebase\IBKR-MONTHLY-MAKER-TOOLS.md" `
    "$Repo\knowledgebase\IBKR-MONTHLY-MAKER-PROMPT.md" `
    "$Repo\knowledgebase\IBKR-MONTHLY-CHECKER-PROMPT.md" `
    "$Repo\knowledgebase\IBKR-MONTHLY-PHASE4.md" `
    "$Repo\knowledgebase\IBKR-TRADING-WORKFLOW.md" `
    "root@${HostIp}:$RemoteRoot/knowledgebase/"
  scp @ssh "$Repo\README.md" "root@${HostIp}:$RemoteRoot/README.md"
  if (Test-Path "$Repo\THIRD_PARTY_NOTICES.md") {
    scp @ssh "$Repo\THIRD_PARTY_NOTICES.md" "root@${HostIp}:$RemoteRoot/THIRD_PARTY_NOTICES.md"
  }
  scp @ssh -r "$Repo\openclaw-skills\agent-os-content-tools" "root@${HostIp}:$RemoteRoot/openclaw-skills/"
  scp @ssh -r "$Repo\openclaw-skills\agent-send" "root@${HostIp}:$RemoteRoot/openclaw-skills/"
}

$smokeEnv = if ($SkipSmoke) { "SKIP_SMOKE=1" } else { "SKIP_SMOKE=0" }
$cacheEnv = if ($NoCache) { "NO_CACHE=1" } else { "NO_CACHE=0" }
Write-Host "==> Run vps-deploy-latest.sh (SERVICES=$Services $smokeEnv $cacheEnv)"
# docker compose logs progress on stderr; with ErrorActionPreference=Stop that would abort the
# deploy mid-flight, so fold stderr into stdout and gate on the remote exit code instead.
# Do not use a multiline remote here-doc with `\` continuations: scp from Windows leaves CRLF,
# and a CR after `\` makes bash treat each listed script as a command (bash\r / Permission denied).
$ErrorActionPreference = "Continue"
$remoteDeploy = "for f in $RemoteRoot/deploy/scripts/*.sh; do tr -d '\r' < `$f > /tmp/crlf-strip.sh && cat /tmp/crlf-strip.sh > `$f && chmod +x `$f; done; SKIP_GIT=1 $smokeEnv $cacheEnv SERVICES='$Services' bash $RemoteRoot/deploy/scripts/vps-deploy-latest.sh"
ssh @ssh "root@$HostIp" $remoteDeploy 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "vps-deploy-latest.sh failed with exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}
Write-Host "SYNC_DEPLOY_DONE"

#!/usr/bin/env bash
# Post-deploy platform verification: multi-tenant, Master Data, notifications, Flolah branding.
#
# Usage (on VPS):
#   bash /opt/agent-os/deploy/scripts/vps-verify-platform.sh
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
# shellcheck source=compose-file-defaults.sh
source "$ROOT/deploy/scripts/compose-file-defaults.sh"
export_vps_compose_file "$ROOT/deploy/.env"

echo "==> platform verify $(date -Is)"

echo "==> VPS ingress (login path / loopback ports)"
bash "$ROOT/deploy/scripts/assert-vps-ingress.sh"

echo "==> services"
docker compose ps backend frontend openclaw --format '{{.Service}} {{.Status}}'

echo "==> source on disk"
check() {
  local label="$1"
  shift
  printf '    %-28s ' "$label"
  if "$@"; then echo OK; else echo MISSING; fi
}
check "kanban cron sync" grep -q completePipelineKanbanForDelegation "$ROOT/backend/src/routes/standups.js"
check "kanban in_progress mark" grep -q markKanbanInProgressForDelegation "$ROOT/backend/src/services/delegation-queue.js"
check "kanban stuck heal" grep -q healStuckKanbanForCompletedDelegations "$ROOT/backend/src/index.js"
check "kanban owner SQL filter" grep -q kanbanOwnerSqlFilter "$ROOT/backend/src/services/kanban-user-scope.js"
check "kanban owner list route" grep -q kanbanOwnerSqlFilter "$ROOT/backend/src/routes/kanban.js"
check "kanban owner stamp create" grep -q 'owner_user_id' "$ROOT/backend/src/routes/kanban.js"
check "kanban owner schema" grep -q 'ALTER TABLE kanban_tasks ADD COLUMN owner_user_id' "$ROOT/backend/src/db/schema.js"
check "a2a auth_mode schema" grep -q 'ALTER TABLE workflow_a2a_publications ADD COLUMN auth_mode' "$ROOT/backend/src/db/schema.js"
check "a2a access tokens schema" grep -q 'workflow_a2a_access_tokens' "$ROOT/backend/src/db/schema.js"
check "a2a oauth token route" grep -q 'oauth/token' "$ROOT/backend/src/routes/workflow-a2a.js"
check "a2a issueA2AAccessToken" grep -q 'issueA2AAccessToken' "$ROOT/backend/src/services/workflow-a2a-publish.js"
check "lean onboard defaults" grep -q DEFAULT_ONBOARD_AGENT_IDS "$ROOT/backend/src/services/users.js"
check "prune shared grants" grep -q pruneSharedStandardAgentGrants "$ROOT/backend/src/index.js"
check "OrgDesigner UI" test -f "$ROOT/frontend/src/components/OrgDesigner.jsx"
check "COO chat reach-me hook" grep -q tryHandleCooReachMeRequest "$ROOT/backend/src/routes/agents.js"
check "standup reach-me hook" grep -q tryHandleCooReachMeRequest "$ROOT/backend/src/routes/standups.js"
check "notify_ceo COO rewrite" grep -q tryRewriteCooNotifyAsSpecialist "$ROOT/backend/src/routes/tools.js"
check "notify_ceo chat link" grep -q '/agents/' "$ROOT/backend/src/services/notify-ceo.js"
check "COO reach-me guard" grep -q 'Do \*\*NOT\*\* call \*\*notify_ceo\*\* yourself' "$ROOT/openclaw-workspace-templates/balserve/AGENTS.md" || grep -q 'Do NOT call' "$ROOT/backend/src/services/org-context.js"
check "COO SOUL inbound index rule" grep -q 'Channel / inbound files (required)' "$ROOT/openclaw-workspace-templates/balserve/SOUL.md"
check "COO SOUL master_data_index" grep -q 'master_data_index_document' "$ROOT/openclaw-workspace-templates/balserve/SOUL.md"
check "COO refuse delegation helper" grep -q 'isRefuseDelegationRequest' "$ROOT/backend/src/services/coo-specialty-delegation.js"
check "COO native file work" grep -q 'download|find|locate|fetch' "$ROOT/backend/src/services/coo-specialty-delegation.js"
check "list_inbound paste_in_chat" grep -q 'paste_in_chat' "$ROOT/backend/src/services/master-data-tools.js"
check "chat pane icon CSS" grep -q 'chat-pane-icon-btn' "$ROOT/frontend/src/index.css"
check "chat side panes default hide" grep -q 'showHistoryPanel' "$ROOT/frontend/src/pages/AgentChat.jsx"
check "marketing homepage tree" test -f "$ROOT/deploy/static/flolah-home/index.html"
check "marketing vision page" test -f "$ROOT/deploy/static/flolah-home/vision.html"
check "marketing legal terms" test -f "$ROOT/deploy/static/flolah-home/legal/terms.html"
check "marketing legal privacy" test -f "$ROOT/deploy/static/flolah-home/legal/privacy.html"
check "marketing legal cookies" test -f "$ROOT/deploy/static/flolah-home/legal/cookies.html"
check "marketing legal open-source" test -f "$ROOT/deploy/static/flolah-home/legal/open-source.html"
check "marketing legal THIRD_PARTY_NOTICES" test -f "$ROOT/deploy/static/flolah-home/legal/THIRD_PARTY_NOTICES.md"
check "repo THIRD_PARTY_NOTICES" test -f "$ROOT/THIRD_PARTY_NOTICES.md"
check "notices name Open Connector" grep -q 'oomol-lab/open-connector' "$ROOT/THIRD_PARTY_NOTICES.md"
check "notices name OpenSearch" grep -q 'opensearch-project/OpenSearch' "$ROOT/THIRD_PARTY_NOTICES.md"
check "frontend public legal notices" test -f "$ROOT/frontend/public/legal/THIRD_PARTY_NOTICES.md"
check "public docs site source" test -f "$ROOT/docs-site/docusaurus.config.js"
check "public docs welcome" test -f "$ROOT/docs-site/docs/start/welcome.md"
check "public docs no OpenClaw" test -z "$(grep -Rli --include='*.md' --include='*.js' 'openclaw' "$ROOT/docs-site/docs" "$ROOT/docs-site/docusaurus.config.js" "$ROOT/docs-site/sidebars.js" 2>/dev/null || true)"
check "nginx public docs route" grep -q 'location ^~ /docs/' "$ROOT/deploy/nginx/nginx.conf"
check "nginx host-network public docs" grep -q 'location ^~ /docs/' "$ROOT/deploy/nginx/nginx.host-network.conf"
check "marketing Docs nav" grep -q 'href="/docs/"' "$ROOT/deploy/static/flolah-home/index.html"
check "build-public-docs script" test -f "$ROOT/deploy/scripts/build-public-docs.sh"
check "frontend public legal terms" test -f "$ROOT/frontend/public/legal/terms.html"
check "legal-terms service" test -f "$ROOT/backend/src/services/legal-terms.js"
check "auth legal-versions route" grep -q 'legal-versions' "$ROOT/backend/src/routes/auth.js"
check "terms columns schema" grep -q 'terms_accepted_at' "$ROOT/backend/src/db/schema.js"
check "register accept terms UI" grep -q 'acceptTerms' "$ROOT/frontend/src/pages/Register.jsx"
check "nginx marketing legal route" grep -q 'location ^~ /legal/' "$ROOT/deploy/nginx/nginx.conf"
check "nginx legal markdown type" grep -q 'text/plain md' "$ROOT/deploy/nginx/nginx.conf"
check "nginx login legal route" grep -q 'root /usr/share/nginx/flolah-home' "$ROOT/deploy/nginx/nginx.conf" && grep -A2 'location ^~ /legal/' "$ROOT/deploy/nginx/nginx.host-network.conf" | grep -q flolah-home
check "sync frontend public" grep -q 'frontend\\\\public\|frontend/public\|frontend\\public' "$ROOT/deploy/scripts/sync-to-vps.ps1" || grep -q 'frontend\\public' "$ROOT/deploy/scripts/sync-to-vps.ps1" || grep -q 'frontend/public' "$ROOT/deploy/scripts/sync-to-vps.ps1"
check "marketing CTA login host" grep -q 'https://login.flolah.cloud' "$ROOT/deploy/static/flolah-home/index.html"
check "nginx marketing vision route" grep -q 'location = /vision' "$ROOT/deploy/nginx/nginx.conf"
check "nginx apex vhost" grep -q 'server_name flolah.cloud www.flolah.cloud' "$ROOT/deploy/nginx/nginx.conf"
check "nginx login vhost" grep -q 'server_name login.flolah.cloud' "$ROOT/deploy/nginx/nginx.conf"
check "nginx host-network apex" grep -q 'server_name flolah.cloud www.flolah.cloud' "$ROOT/deploy/nginx/nginx.host-network.conf"
check "nginx host-network login" grep -q 'server_name login.flolah.cloud' "$ROOT/deploy/nginx/nginx.host-network.conf"
check "nginx CRM SSO apply" grep -q 'location = /flolah-crm-sso' "$ROOT/deploy/nginx/nginx.host-network.conf"
check "nginx CRM SSO apply backend" grep -q 'crm-sso-apply' "$ROOT/deploy/nginx/nginx.host-network.conf"
check "nginx CRM SSO header buffers" grep -A20 'location = /flolah-crm-sso' "$ROOT/deploy/nginx/nginx.host-network.conf" | grep -q 'proxy_buffer_size 32k'
check "CRM SSO apply handoff" grep -q 'handoffUrlsForTokenApply' "$ROOT/backend/src/services/twenty-sso.js"
check "CRM SSO apply-handoff log" grep -q 'apply-handoff' "$ROOT/backend/src/services/twenty-sso.js"
check "CRM SSO verify script" test -f "$ROOT/backend/scripts/vps-verify-crm-sso.js"
check "CRM SSO verify deploy" test -f "$ROOT/deploy/scripts/vps-verify-crm-sso.sh"
check "Twenty enterprise key compose" grep -q 'ENTERPRISE_KEY: \${TWENTY_ENTERPRISE_KEY' "$ROOT/deploy/docker-compose.business-core.yml"
check "CRM SAN covers helper" grep -q 'export function certSanCoversHost' "$ROOT/backend/src/services/tls-cert-admin.js"
check "CRM SAN not apex-cover-all" grep -q 'on_cert: certSanCoversHost' "$ROOT/backend/src/services/tls-cert-admin.js"
check "compose marketing volume" grep -q 'static/flolah-home' "$ROOT/deploy/docker-compose.yml"
check "vps-client-ip marketing volume" grep -q 'static/flolah-home' "$ROOT/deploy/docker-compose.vps-client-ip.yml"
check "expand login cert script" test -f "$ROOT/deploy/scripts/vps-expand-login-cert.sh"
check "expand login cert uses acme ALPN" grep -q 'acme.sh' "$ROOT/deploy/scripts/vps-expand-login-cert.sh" && grep -q -- '--alpn' "$ROOT/deploy/scripts/vps-expand-login-cert.sh"
check "nginx dual-stack IPv6 listen" grep -q 'listen \[::\]:443' "$ROOT/deploy/nginx/nginx.conf" && grep -q 'listen \[::\]:443' "$ROOT/deploy/nginx/nginx.host-network.conf"
check "workspace heal startup" grep -q healAgentWorkspacePaths "$ROOT/backend/src/index.js"
check "AgentWorkspace UI" grep -q workspace_root "$ROOT/frontend/src/pages/AgentWorkspace.jsx" || grep -q agentWorkspaceFiles "$ROOT/frontend/src/pages/AgentWorkspace.jsx"
check "master_data routes" grep -q master-data-list-tables "$ROOT/backend/src/routes/tools.js"
check "master-data-tools.js" test -f "$ROOT/backend/src/services/master-data-tools.js"
check "standups owner scope" grep -q 'owner_user_id = ?' "$ROOT/backend/src/routes/standups.js"
check "notification dismiss API" grep -q 'notifications/dismiss' "$ROOT/backend/src/routes/standups.js"
check "user_feed_dismissals" grep -q user_feed_dismissals "$ROOT/backend/src/db/schema.js"
check "agent dismiss service" grep -q dismissAgentResponseNotifications "$ROOT/backend/src/services/agent-response-notifications.js"
check "composite dismiss keys" grep -q agentStandupDismissKey "$ROOT/backend/src/services/agent-response-notifications.js"
check "api standupNotificationsDismiss" grep -q standupNotificationsDismiss "$ROOT/frontend/src/api.js"
check "NotificationProvider" grep -q NotificationProvider "$ROOT/frontend/src/App.jsx"
check "NotificationContext" test -f "$ROOT/frontend/src/context/NotificationContext.jsx"
check "ThemeProvider" grep -q ThemeProvider "$ROOT/frontend/src/main.jsx"
check "ThemeContext" test -f "$ROOT/frontend/src/context/ThemeContext.jsx"
check "ThemeToggle UI" test -f "$ROOT/frontend/src/components/ThemeToggle.jsx"
check "theme-toggle CSS" grep -q theme-toggle-btn "$ROOT/frontend/src/index.css"
check "dark theme token" grep -q '#0f1115' "$ROOT/frontend/src/index.css"
check "Tools nav label" grep -q 'label="Tools"' "$ROOT/frontend/src/components/AppNavMenu.jsx"
check "AddAgentForm component" test -f "$ROOT/frontend/src/components/AddAgentForm.jsx"
check "Workspace Add agent" grep -q AddAgentForm "$ROOT/frontend/src/pages/Workspace.jsx"
printf '    %-28s ' "Dashboard no AddAgentForm"
if grep -q AddAgentForm "$ROOT/frontend/src/pages/Dashboard.jsx" 2>/dev/null; then echo MISSING; else echo OK; fi
check "shared bell dismiss" grep -q standupNotificationsDismiss "$ROOT/frontend/src/context/NotificationContext.jsx"
check "broadcast route" grep -q "/api/broadcast" "$ROOT/backend/src/routes/broadcast.js" || test -f "$ROOT/backend/src/routes/broadcast.js"
check "broadcast CEO session" grep -q registerOpenClawSessionOwner "$ROOT/backend/src/routes/broadcast.js"
check "Broadcast UI" grep -q Broadcast "$ROOT/frontend/src/pages/Broadcast.jsx" || grep -q '/broadcast' "$ROOT/frontend/src/App.jsx"
check "tool-owner-scope fix" grep -q SESSION_USER_PREFIXES "$ROOT/backend/src/services/tool-owner-scope.js"
check "Master Data UI purpose" grep -q 'Purpose / description' "$ROOT/frontend/src/pages/MasterData.jsx"
check "Master Data Purge all UI" grep -q 'Purge all uploads' "$ROOT/frontend/src/pages/MasterData.jsx"
check "api masterDataDocumentsPurgeAll" grep -q masterDataDocumentsPurgeAll "$ROOT/frontend/src/api.js"
check "OpenSearch compose service" grep -q 'opensearch:' "$ROOT/deploy/docker-compose.yml"
check "OpenSearch Dashboards compose" grep -q 'opensearch-dashboards:' "$ROOT/deploy/docker-compose.yml"
check "OpenSearch ensure-env script" test -f "$ROOT/deploy/scripts/ensure-opensearch-env.sh"
check "OpenSearch env in deploy/.env" grep -qE '^OPENSEARCH_URL=' "$ROOT/deploy/.env"
check "ensure-embeddings-env script" test -f "$ROOT/deploy/scripts/ensure-embeddings-env.sh"
check "qwen-embeddings Dockerfile" test -f "$ROOT/deploy/docker/qwen-embeddings.Dockerfile"
check "qwen-embeddings server" test -f "$ROOT/deploy/docker/qwen-embeddings/server.py"
check "optional-embeddings compose" grep -q 'optional-embeddings' "$ROOT/deploy/docker-compose.yml"
check "embeddings env BASE_URL" grep -qE '^OPENSEARCH_EMBEDDING_BASE_URL=http://embeddings' "$ROOT/deploy/.env" || grep -q 'embeddings:8080' "$ROOT/deploy/docker-compose.yml"
check "embeddings client no OpenAI default" grep -q 'embeddings:8080' "$ROOT/backend/src/services/opensearch/embeddings.js"
check "embeddings default model Qwen" grep -q 'Qwen/Qwen3-Embedding-0.6B' "$ROOT/backend/src/services/opensearch/embeddings.js"
check "OpenSearch nginx BFF" grep -q 'location /opensearch/' "$ROOT/deploy/nginx/nginx.conf"
check "OpenSearch host-network nginx" grep -q 'location /opensearch/' "$ROOT/deploy/nginx/nginx.host-network.conf"
check "opensearch client service" test -f "$ROOT/backend/src/services/opensearch/client.js"
check "opensearch documents service" test -f "$ROOT/backend/src/services/opensearch/documents.js"
check "admin platform-documents route" test -f "$ROOT/backend/src/routes/admin-platform-docs.js"
check "opensearch console launch route" test -f "$ROOT/backend/src/routes/opensearch-console.js"
check "Admin Documents RAG page" test -f "$ROOT/frontend/src/pages/AdminPlatformDocuments.jsx"
check "Admin Documents RAG nav" grep -q '/admin/documents-rag' "$ROOT/frontend/src/components/AppNavMenu.jsx"
check "api opensearchConsoleLaunch" grep -q opensearchConsoleLaunch "$ROOT/frontend/src/api.js"
check "opensearch rag smoke script" test -f "$ROOT/backend/scripts/test-opensearch-rag-smoke.js"
check "opensearch agent e2e script" test -f "$ROOT/backend/scripts/test-opensearch-agent-rag-e2e.js"
check "platform help merge rag script" test -f "$ROOT/backend/scripts/test-platform-help-merge-rag.js"
check "specialist rag merges platform help" grep -q 'includes_platform_help' "$ROOT/backend/src/services/master-data-tools.js"
check "protected docs helper" test -f "$ROOT/backend/src/services/master-data-protected-docs.js"
check "purgeAllUserDocuments" grep -q purgeAllUserDocuments "$ROOT/backend/src/services/master-data.js"
check "purge-all route" grep -q 'documents/purge-all' "$ROOT/backend/src/routes/master-data.js"
check "purge-all unit test" test -f "$ROOT/backend/scripts/test-purge-all-documents.js"
check "agent delete cascade service" grep -q deleteAgentCascade "$ROOT/backend/src/services/agent-delete.js"
check "agent delete uses cascade" grep -q deleteAgentCascade "$ROOT/backend/src/routes/agents.js"
check "deleted_agents table" grep -q 'CREATE TABLE IF NOT EXISTS deleted_agents' "$ROOT/backend/src/db/schema.js"
check "openclaw sync honours tombstones" grep -q isAgentTombstoned "$ROOT/backend/src/routes/openclaw.js"
check "agent delete unit test" test -f "$ROOT/backend/scripts/test-agent-delete-cascade.js"
check "Flolah title" grep -q 'Flolah - An Agent Company Setup' "$ROOT/frontend/index.html"
check "api masterDataTableUpdate" grep -q masterDataTableUpdate "$ROOT/frontend/src/api.js"
check "SKILL anti-browser" grep -q 'never browser' "$ROOT/openclaw-skills/agent-os-content-tools/SKILL.md"
check "TOOLS anti-browser" grep -q 'browser tool for Master Data' "$ROOT/openclaw-workspace-templates/balserve/TOOLS.md"
check "platform-help docs on disk" test -f "$ROOT/knowledgebase/platform-help/01-getting-started.md"
check "help 20 IBKR ingest vs W3" grep -q 'Ingest URL vs W3 run' "$ROOT/knowledgebase/platform-help/20-ibkr-monthly-trading.md"
check "help 16 IBKR ingest URL" grep -q 'api/ibkr-trading/local-bridge-webhook' "$ROOT/knowledgebase/platform-help/16-connectors-openconnector.md"
check "deploy env example IBKR ingest" grep -q 'W3 workflow runs on eod_snapshot' "$ROOT/deploy/.env.example"
check "bridge README ingest URL" grep -q 'api/ibkr-trading/local-bridge-webhook' "$ROOT/backend/local-ibkr-bridge/README.md"
check "help TOTP QR + security key" grep -q 'security key' "$ROOT/knowledgebase/platform-help/01-getting-started.md"
check "TOTP enrollment UI" test -f "$ROOT/frontend/src/components/TotpEnrollmentDetails.jsx"
check "platform-help cron/retention doc" test -f "$ROOT/knowledgebase/platform-help/19-scheduled-jobs-and-crons.md"
check "platform-help agent channels doc" test -f "$ROOT/knowledgebase/platform-help/24-agent-channels.md"
check "platform-help speech/published scenes doc" test -f "$ROOT/knowledgebase/platform-help/25-speech-and-published-scenes.md"
check "cron env reference in deploy/.env" grep -q 'COO_STATUS_CHECKER_CRON' "$ROOT/deploy/.env"
check "retention cron env reference" grep -q 'DATA_RETENTION_CRON' "$ROOT/deploy/.env"
check "scheduled goals cron in compose" grep -q 'SCHEDULED_GOALS_CRON' "$ROOT/deploy/docker-compose.yml"
check "scheduled goals service" test -f "$ROOT/backend/src/services/scheduled-goals.js"
check "scheduled goals routes" test -f "$ROOT/backend/src/routes/scheduled-goals.js"
check "scheduled goals FE page" test -f "$ROOT/frontend/src/pages/ScheduledGoals.jsx"
check "scheduled goals api client" grep -q scheduledGoalsList "$ROOT/frontend/src/api.js"
check "scheduled goals FE edit API" grep -q scheduledGoalsUpdate "$ROOT/frontend/src/api.js"
check "scheduled goals hourly service" grep -q hourly "$ROOT/backend/src/services/scheduled-goals.js"
check "scheduled goals verify script" test -f "$ROOT/deploy/scripts/vps-verify-scheduled-goals.sh"
check "ensure-voice-env script" test -f "$ROOT/deploy/scripts/ensure-voice-env.sh"
check "SPEECH_STT_URL in deploy/.env" grep -qE '^SPEECH_STT_URL=' "$ROOT/deploy/.env"
check "SPEECH_TTS_URL in deploy/.env" grep -qE '^SPEECH_TTS_URL=' "$ROOT/deploy/.env"
check "optional-voice whisper compose" grep -q 'optional-voice' "$ROOT/deploy/docker-compose.yml"
check "piper Dockerfile" test -f "$ROOT/deploy/docker/piper-tts.Dockerfile"
check "public-vr route file" test -f "$ROOT/backend/src/routes/public-vr.js"
check "public-vr mounted" grep -q "public/vr" "$ROOT/backend/src/index.js"
check "speech route file" test -f "$ROOT/backend/src/routes/speech.js"
check "speech mounted" grep -q "speechRoutes\|'/speech'" "$ROOT/backend/src/index.js"
check "agent-channels route file" test -f "$ROOT/backend/src/routes/agent-channels.js"
check "agent-channels mounted" grep -q "agent-channels" "$ROOT/backend/src/index.js"
check "ceo-agent-channels service" test -f "$ROOT/backend/src/services/ceo-agent-channels.js"
check "channel routing sidecar helper" test -f "$ROOT/scripts/lib/openclaw-channel-routing.js"
check "restore channel routing script" test -f "$ROOT/deploy/scripts/restore-openclaw-channel-routing.js"
check "sync agent channels script" test -f "$ROOT/backend/scripts/sync-agent-channels-to-openclaw.js"
check "verify agent channels script" test -f "$ROOT/deploy/scripts/vps-verify-agent-channels.sh"
check "verify openclaw chat script" test -f "$ROOT/deploy/scripts/vps-verify-openclaw-chat.sh"
check "ensure openclaw gateway script" test -f "$ROOT/deploy/scripts/ensure-openclaw-gateway-config.js"
check "openclaw-config-safe service" test -f "$ROOT/backend/src/services/openclaw-config-safe.js"
check "configure chatCompletions" grep -q "chatCompletions" "$ROOT/deploy/scripts/configure-openclaw-docker.js"
check "entrypoint ensure gateway" grep -q "ensure-openclaw-gateway-config" "$ROOT/deploy/docker/openclaw-entrypoint.sh"
check "deploy latest openclaw chat gate" grep -q "vps-verify-openclaw-chat" "$ROOT/deploy/scripts/vps-deploy-latest.sh"
check "verify media delivery script" test -f "$ROOT/deploy/scripts/vps-verify-media-delivery.sh"
check "syncEnabledAgentChannelsToOpenClaw export" grep -q "syncEnabledAgentChannelsToOpenClaw" "$ROOT/backend/src/services/ceo-agent-channels.js"
check "configure preserves channel routing" grep -q "ensureChannelRoutingOnConfig" "$ROOT/deploy/scripts/configure-openclaw-docker.js"
check "entrypoint restores channel routing" grep -q "restore-openclaw-channel-routing" "$ROOT/deploy/docker/openclaw-entrypoint.sh"
check "openclaw-channels-config" test -f "$ROOT/backend/src/services/openclaw-channels-config.js"
check "WhatsApp From: prefix helper" test -f "$ROOT/scripts/lib/openclaw-whatsapp-from-prefix.js"
check "configure WhatsApp From: prefix" grep -q "applyWhatsAppFromPrefixToChannel" "$ROOT/deploy/scripts/configure-openclaw-docker.js"
check "agent-workflow-speech service" test -f "$ROOT/backend/src/services/agent-workflow-speech.js"
check "PublicVirtualRoom page" test -f "$ROOT/frontend/src/pages/PublicVirtualRoom.jsx"
check "PublishedScenes page" test -f "$ROOT/frontend/src/pages/PublishedScenes.jsx"
check "AgentChannels page" test -f "$ROOT/frontend/src/pages/AgentChannels.jsx"
check "api publicVrGet" grep -q publicVrGet "$ROOT/frontend/src/api.js"
check "api speechStt" grep -q speechStt "$ROOT/frontend/src/api.js"
check "api agentChannelsList" grep -q agentChannelsList "$ROOT/frontend/src/api.js"
check "Published Scenes nav" grep -q '/published-scenes' "$ROOT/frontend/src/components/AppNavMenu.jsx"
check "guest /p/vr route" grep -q '/p/vr/:slug' "$ROOT/frontend/src/App.jsx"
check "platformhelp SOUL template" test -f "$ROOT/openclaw-workspace-templates/platformhelp/SOUL.md"
check "platformhelp seed script" test -f "$ROOT/backend/scripts/seed-platform-help-agent.js"
check "platformhelp startup seed" grep -q seedPlatformHelpAgent "$ROOT/backend/src/index.js"
check "backend Dockerfile help COPY" grep -q 'knowledgebase/platform-help' "$ROOT/deploy/docker/backend.Dockerfile"
check "ceo guardrails schema" grep -q 'CREATE TABLE IF NOT EXISTS ceo_guardrails' "$ROOT/backend/src/db/schema.js"
check "ceo guardrails service" test -f "$ROOT/backend/src/services/ceo-guardrails.js"
check "ceo guardrails route" grep -q ceo-guardrails "$ROOT/backend/src/index.js"
check "POLICY.md workspace map" grep -q "policy: 'POLICY.md'" "$ROOT/backend/src/workspace/adapter.js"
check "org sync writes POLICY" grep -q formatCeoPolicyMd "$ROOT/backend/src/services/org-context.js"
check "Brain prepends CEO policy" grep -q prependCeoGuardrailsToSystemPrompt "$ROOT/backend/src/services/agent-workflow-brain.js"
check "Policies UI" test -f "$ROOT/frontend/src/pages/Policies.jsx"
check "Policies nav" grep -q '/policies' "$ROOT/frontend/src/components/AppNavMenu.jsx"
check "api ceoGuardrailsSave" grep -q ceoGuardrailsSave "$ROOT/frontend/src/api.js"
check "bootstrap POLICY.md" grep -q 'POLICY.md' "$ROOT/openclaw-extensions/agent-os-bootstrap-watcher/index.js"
check "chat attachments util" test -f "$ROOT/frontend/src/utils/chatAttachments.js"
check "generate_chart tool" grep -q generate_chart "$ROOT/backend/src/routes/tools.js"
check "chart-spec service" test -f "$ROOT/backend/src/services/chart-spec.js"
check "vedic template SOUL" test -f "$ROOT/openclaw-workspace-templates/vedic-astrology/SOUL.md"
check "slow-caller template SOUL" test -f "$ROOT/openclaw-workspace-templates/slow-caller/SOUL.md"
check "realtime-caller template SOUL" test -f "$ROOT/openclaw-workspace-templates/realtime-caller/SOUL.md"
check "hireable roles catalog" test -f "$ROOT/openclaw-workspace-templates/hireable-roles.json"
check "voice sessions service" test -f "$ROOT/backend/src/services/agent-voice-sessions.js"
check "voice caller help 46" test -f "$ROOT/knowledgebase/platform-help/46-voice-caller-employees.md"
check "MCP auth templates" grep -q 'renderHttpHeadersJson' "$ROOT/backend/src/services/mcp-auth.js"
check "A2A auth override merge" grep -q mergeExternalAgentAuthHeaders "$ROOT/backend/src/services/external-agents.js"
check "A2A node auth UI" grep -q 'Bearer token override' "$ROOT/frontend/src/pages/AgentWorkflowEditor.jsx"
check "workflow auth templates smoke script" test -f "$ROOT/backend/scripts/test-workflow-auth-templates.js"
check "Brave BYOK MCP server" test -f "$ROOT/tools/brave-search-mcp-byok/server.js"
check "Brave BYOK Dockerfile" grep -q 'brave-search-mcp-byok' "$ROOT/deploy/docker/brave-search-mcp.Dockerfile"
# MCP service must not receive platform BRAVE_API_KEY; backend may (brave_web_search content tool).
check "Brave MCP compose (no BRAVE_API_KEY on mcp service)" \
  ! sed -n '/^  brave-search-mcp:/,/^  [a-zA-Z0-9_-]\+:/p' "$ROOT/deploy/docker-compose.yml" | grep -q 'BRAVE_API_KEY'
check "Brave API key on backend env" grep -q 'BRAVE_API_KEY: \${BRAVE_API_KEY' "$ROOT/deploy/docker-compose.yml"
check "BRAVE_MCP_URL on backend env" grep -q 'BRAVE_MCP_URL: \${BRAVE_MCP_URL' "$ROOT/deploy/docker-compose.yml"
check "brave_web_search content tool seed" test -f "$ROOT/backend/src/db/seed-brave-search-tool.js"
check "brave_web_search config helper" grep -q 'getBraveSearchConfig' "$ROOT/backend/src/config/tools.js"
check "Brave Search MCP seed script" test -f "$ROOT/backend/scripts/seed-brave-search-mcp.js"
check "Meta Graph MCP server" test -f "$ROOT/tools/meta-graph-mcp/server.js"
check "Meta Graph MCP Dockerfile" grep -q 'meta-graph-mcp' "$ROOT/deploy/docker/meta-graph-mcp.Dockerfile"
check "Meta Graph MCP compose profile" grep -q 'optional-meta-graph-mcp' "$ROOT/deploy/docker-compose.yml"
check "META_GRAPH_MCP_URL on backend env" grep -q 'META_GRAPH_MCP_URL: \${META_GRAPH_MCP_URL' "$ROOT/deploy/docker-compose.yml"
check "FACEBOOK_APP_ID on backend env" grep -q 'FACEBOOK_APP_ID: \${FACEBOOK_APP_ID' "$ROOT/deploy/docker-compose.yml"
check "MCP OAuth callback env" grep -q 'MCP_OAUTH_CALLBACK_URL' "$ROOT/deploy/docker-compose.yml"
check "MCP OAuth service" test -f "$ROOT/backend/src/services/mcp-oauth.js"
check "MCP OAuth routes" test -f "$ROOT/backend/src/routes/mcp-integrations.js"
check "MCP OAuth CEO override API" grep -q 'oauth/override' "$ROOT/backend/src/routes/mcp-integrations.js"
check "OpenConnector CEO OAuth override API" grep -q 'oauth/overrides' "$ROOT/backend/src/routes/openconnector.js"
check "OpenConnector tip image pin" grep -q 'OPENCONNECTOR_IMAGE_TAG' "$ROOT/deploy/docker-compose.yml"
check "OpenConnector oauth override service" test -f "$ROOT/backend/src/services/openconnector-oauth-override.js"
check "MCP OAuth resolveOauthConfig" grep -q 'resolveOauthConfig' "$ROOT/backend/src/services/mcp-oauth.js"
check "MCP OAuth owner_user_id composite" grep -q "owner_user_id TEXT NOT NULL DEFAULT" "$ROOT/backend/src/db/schema.js"
check "Platform help MCP OAuth doc 31" test -f "$ROOT/knowledgebase/platform-help/31-mcp-connectors-oauth.md"
check "Meta Graph MCP seed script" test -f "$ROOT/backend/scripts/seed-meta-graph-mcp.js"
check "ensure-platform-mcps script" test -f "$ROOT/deploy/scripts/ensure-platform-mcps.sh"
check "Meta Graph MCP smoke script" test -f "$ROOT/deploy/scripts/vps-smoke-meta-graph-mcp.sh"
check "Connectors MCP panel UI" test -f "$ROOT/frontend/src/components/connectors/McpConnectorsPanel.jsx"
check "Connectors tabs MCPs" grep -q 'MCPs' "$ROOT/frontend/src/pages/Connectors.jsx"
check "mcp_oauth schema tables" grep -q 'mcp_oauth_configs' "$ROOT/backend/src/db/schema.js"
check "Balaji Brave BYOK seed" test -f "$ROOT/backend/scripts/seed-balaji-brave-byok-workflow.js"
check "Balaji Brave BYOK test" test -f "$ROOT/backend/scripts/test-balaji-brave-byok-workflow.js"
check "Brain apiKey templates" grep -q "renderWorkflowTemplates(String(renderedCfg" "$ROOT/backend/src/services/agent-workflow-brain.js"
check "platform cron registry" test -f "$ROOT/backend/src/services/platform-cron-registry.js"
check "admin crons routes" grep -q "'/crons'" "$ROOT/backend/src/routes/admin.js"
check "Admin Crons UI" test -f "$ROOT/frontend/src/pages/AdminCrons.jsx"
check "Admin Crons nav" grep -q '/admin/crons' "$ROOT/frontend/src/components/AppNavMenu.jsx"
check "department efficiency service" test -f "$ROOT/backend/src/services/department-efficiency.js"
check "efficiency departments route" grep -q "'/departments'" "$ROOT/backend/src/routes/efficiency.js"
check "efficiency usage reset route" grep -q "'/usage/reset'" "$ROOT/backend/src/routes/efficiency.js"
check "platform logger" test -f "$ROOT/backend/src/utils/logger.js"
check "PLATFORM_LOG_LEVEL in compose" grep -q 'PLATFORM_LOG_LEVEL' "$ROOT/deploy/docker-compose.yml"
check "secret redaction util" test -f "$ROOT/backend/src/utils/redact-secrets.js"
check "redaction unit tests" test -f "$ROOT/backend/scripts/test-security-hardening-unit.js"
check "blueprint secret sanitize tests" test -f "$ROOT/backend/scripts/test-blueprint-secret-sanitize.js"
check "blueprint secret scan script" test -f "$ROOT/backend/scripts/scan-blueprint-secrets.js"
check "github blueprint secret scan workflow" test -f "$ROOT/.github/workflows/blueprint-secret-scan.yml"
check "blueprint secret sanitize module" test -f "$ROOT/backend/src/services/company-blueprints/secret-sanitize.js"
check "help doc: scheduled goals" test -f "$ROOT/knowledgebase/platform-help/28-scheduled-goals.md"
check "help doc: company setup" test -f "$ROOT/knowledgebase/platform-help/29-company-setup.md"
check "help catalog scheduled goals" grep -q '28-scheduled-goals.md' "$ROOT/backend/src/services/ceo-default-master-data.js"
check "help catalog company setup" grep -q '29-company-setup.md' "$ROOT/backend/src/services/ceo-default-master-data.js"
check "help doc: AgentSystem recovery" test -f "$ROOT/knowledgebase/platform-help/43-admin-agentsystem-recovery.md"
check "help catalog AgentSystem recovery" grep -q '43-admin-agentsystem-recovery.md' "$ROOT/backend/src/services/ceo-default-master-data.js"
check "help doc: web scrape" test -f "$ROOT/knowledgebase/platform-help/44-web-scrape.md"
check "help catalog web scrape" grep -q '44-web-scrape.md' "$ROOT/backend/src/services/ceo-default-master-data.js"
check "web scrape MCP sidecar" test -f "$ROOT/tools/web-scrape-mcp/server.js"
check "web scrape Dockerfile" test -f "$ROOT/deploy/docker/web-scrape-mcp.Dockerfile"
check "web scrape compose profile" grep -q 'optional-web-scrape-mcp' "$ROOT/deploy/docker-compose.yml"
check "web scrape node catalog" grep -q "type: 'web_scrape'" "$ROOT/backend/src/services/agent-workflow-task-catalog.js"
check "help Twenty CRM SME" grep -q 'Twenty CRM SME' "$ROOT/knowledgebase/platform-help/40-twenty-crm-help-tier-a.md"
check "help Twenty Lead to Order process" grep -q 'Lead → Prospect → Qualified opportunity' "$ROOT/knowledgebase/platform-help/40-twenty-crm-help-tier-a.md"
check "help troubleshooting CRM no help docs" grep -q 'CRM / ERP agent says it has no help docs' "$ROOT/knowledgebase/platform-help/12-troubleshooting.md"
check "help ERPNext SME" grep -q 'ERPNext SME' "$ROOT/knowledgebase/platform-help/39-erpnext-help-tier-a.md"
check "help ERPNext O2C process" grep -q 'order-to-cash' "$ROOT/knowledgebase/platform-help/39-erpnext-help-tier-a.md"
check "shared Twenty CRM SME card" test -f "$ROOT/openclaw-workspace-templates/_shared/TWENTY-CRM-SME.md"
check "shared ERPNext SME card" test -f "$ROOT/openclaw-workspace-templates/_shared/ERPNEXT-SME.md"
check "CRM maker SOUL SME" grep -q 'Domain SME' "$ROOT/openclaw-workspace-templates/crm-maker-a/SOUL.md"
check "ERP maker SOUL SME" grep -q 'ERPNext SME' "$ROOT/openclaw-workspace-templates/erp-maker-a/SOUL.md"
check "DOMAIN.md copy helper" grep -q 'copySharedDomainKnowledge' "$ROOT/backend/src/services/openclaw-tenant.js"
check "refresh business-core workspace docs" test -f "$ROOT/backend/scripts/refresh-business-core-workspace-docs.js"
check "help catalog Twenty CRM SME title" grep -q 'Twenty CRM SME Docs' "$ROOT/backend/src/services/ceo-default-master-data.js"
check "Admin AgentSystem recovery UI" test -f "$ROOT/frontend/src/pages/AdminOpenclawRecovery.jsx"
check "Admin recovery nav" grep -q '/admin/openclaw-recovery' "$ROOT/frontend/src/components/AppNavMenu.jsx"
check "help nav AgentSystem recovery" grep -q '/admin/openclaw-recovery' "$ROOT/knowledgebase/platform-help/02-navigation-and-chrome.md"
check "privileged session service" test -f "$ROOT/backend/src/services/admin-privileged-session.js"
check "compose privileged session TTL" grep -q 'ADMIN_PRIVILEGED_SESSION_TTL_MS' "$ROOT/deploy/docker-compose.yml"
check "help doc: admin crons nav" grep -q '/admin/crons' "$ROOT/knowledgebase/platform-help/02-navigation-and-chrome.md"
check "help doc: Department tab" grep -q 'Department tab' "$ROOT/knowledgebase/platform-help/11-content-tools-scripts-profile.md"
check "help doc: scheduled jobs" test -f "$ROOT/knowledgebase/platform-help/19-scheduled-jobs-and-crons.md"
check "help doc: browser session" test -f "$ROOT/knowledgebase/platform-help/22-browser-session-and-recipes.md"
check "help nav Browser Session" grep -q "Browser Session" "$ROOT/knowledgebase/platform-help/02-navigation-and-chrome.md"
check "seed browse_recipe_run" grep -q "browse_recipe_run" "$ROOT/backend/src/db/seed-browser-session-tools.js"
check "configure browser-cdp" grep -q "BROWSER_CDP_AGENT_ID" "$ROOT/deploy/scripts/configure-openclaw-docker.js"
check "compose BROWSER_TASK_CDP" grep -q "BROWSER_TASK_CDP_AGENT_ID" "$ROOT/deploy/docker-compose.yml"
check "project guide Browser Session" grep -q "browse_recipe_run" "$ROOT/knowledgebase/PROJECT.md"
check "knowledgebase index synced" test -f "$ROOT/knowledgebase/README.md"
check "project guide log level" grep -q 'PLATFORM_LOG_LEVEL' "$ROOT/knowledgebase/PROJECT.md"
check "project guide Admin crons" grep -q '/admin/crons' "$ROOT/knowledgebase/PROJECT.md"
check "project guide AgentSystem recovery" grep -q '/admin/openclaw-recovery' "$ROOT/knowledgebase/PROJECT.md"
check "root README is short landing" grep -q 'Apache License 2.0' "$ROOT/README.md"
check "LICENSE is Apache-2.0" grep -q 'Apache License' "$ROOT/LICENSE"
check "compose injects GOAL_PLAN_MAX_SPECIALTY" grep -q 'GOAL_PLAN_MAX_SPECIALTY' "$ROOT/deploy/docker-compose.yml"
check "compose injects SCHEDULED_GOAL_CHAT_TIMEOUT_MS" grep -q 'SCHEDULED_GOAL_CHAT_TIMEOUT_MS' "$ROOT/deploy/docker-compose.yml"
check "compose injects WORKFLOW_TERMINAL_WATCH_CRON" grep -q 'WORKFLOW_TERMINAL_WATCH_CRON' "$ROOT/deploy/docker-compose.yml"
check "help 28 COO-only Generate draft" grep -q 'COO vs other employees' "$ROOT/knowledgebase/platform-help/28-scheduled-goals.md"
check "compose injects DATA_RETENTION_CRON" grep -q 'DATA_RETENTION_CRON' "$ROOT/deploy/docker-compose.yml"
check "compose injects TZ into backend" grep -qE '^\s+TZ: \$\{TZ' "$ROOT/deploy/docker-compose.yml"
check "status-only Kanban gate" grep -q 'shouldCompleteKanbanForReply' "$ROOT/backend/src/services/kanban-workflow-stage.js"
check "status-only Kanban unit test" test -f "$ROOT/backend/scripts/test-kanban-status-only-reply.js"
check "status-only auto-requeue service" test -f "$ROOT/backend/src/services/delegation-status-only-retry.js"
check "status-only auto-requeue unit test" test -f "$ROOT/backend/scripts/test-delegation-status-only-retry.js"
check "ceo_profile service" test -f "$ROOT/backend/src/services/ceo-profile.js"
check "ceo_profile unit test" test -f "$ROOT/backend/scripts/test-ceo-profile-tool.js"
check "ceo_profile OPS guidance" grep -q 'ceo_profile' "$ROOT/openclaw-workspace-templates/_shared/AGENT-OS-OPS.md"
check "agent_workflow_runs endpoint" grep -q "agent-workflow-runs" "$ROOT/backend/src/routes/tools.js"
check "agent_workflow_runs in COO allow" grep -q "agent_workflow_runs" "$ROOT/scripts/lib/content-tools-allow.js"
check "kanban_get_task full content" grep -q 'loadKanbanTaskContent\|delegation_response' "$ROOT/backend/src/routes/tools.js"
check "kanban_get_task content loader" grep -q 'export function loadKanbanTaskContent' "$ROOT/backend/src/services/kanban-watch.js"
check "kanban_get_task OPS guidance" grep -q 'kanban_get_task' "$ROOT/openclaw-workspace-templates/_shared/AGENT-OS-OPS.md"
check "kanban_get_task COO TOOLS" grep -q 'deliverable' "$ROOT/openclaw-workspace-templates/balserve/TOOLS.md"
check "mixed internal+leaf refine fix" grep -q 'parseAgentsFromAgentsMd' "$ROOT/backend/src/services/coo-specialty-delegation.js"
check "mixed internal+leaf unit test" test -f "$ROOT/backend/scripts/test-coo-refine-allocation.js"

echo "==> frontend bundle"
if docker compose exec -T frontend sh -c 'grep -Rql "Purpose / description" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    Master Data purpose UI in bundle OK"
else
  echo "    WARN: Purpose / description not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Flolah - An Agent Company Setup" /usr/share/nginx/html/index.html 2>/dev/null'; then
  echo "    Flolah title in index.html OK"
else
  echo "    WARN: Flolah title not in deployed index.html"
fi
if docker compose exec -T frontend sh -c 'grep -Rql NotificationProvider /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    NotificationProvider (shared bell feed) in bundle OK"
else
  echo "    WARN: NotificationProvider not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql standupNotificationsDismiss /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    Notification dismiss API client in bundle OK"
else
  echo "    WARN: standupNotificationsDismiss not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "org-leaf-badge\|External / A2A leaf" /usr/share/nginx/html/assets/*.js /usr/share/nginx/html/assets/*.css 2>/dev/null'; then
  echo "    frontend assets: org chart leaf members (External/A2A) OK"
else
  echo "    WARN: org chart leaf-member badges not found in frontend assets"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "New department" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    OrgDesigner dashboard in bundle OK"
else
  echo "    WARN: OrgDesigner not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Platform crons" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    Admin Crons console in bundle OK"
else
  echo "    WARN: Platform crons page not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Reset all usage" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    Efficiency Reset usage controls in bundle OK"
else
  echo "    WARN: Reset all usage not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql chat-attach-icon-btn /usr/share/nginx/html/assets/*.js 2>/dev/null || cat /usr/share/nginx/html/assets/*.css 2>/dev/null | grep -q chat-attach-icon-btn'; then
  echo "    Chat attach paperclip icon in bundle OK"
else
  echo "    WARN: chat-attach-icon-btn not found in frontend assets (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Bearer token override" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    A2A External Agent auth override UI in bundle OK"
else
  echo "    WARN: Bearer token override not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T backend node scripts/test-workflow-auth-templates.js >/dev/null 2>&1; then
  echo "    Workflow MCP/A2A auth templates smoke OK"
else
  echo "    WARN: test-workflow-auth-templates.js failed"
fi

echo "==> DB runtime"
docker compose exec -T backend node <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const db = getDb();
const mdTools = db.prepare("SELECT COUNT(*) AS c FROM content_tools_meta WHERE name LIKE 'master_data_%'").get().c;
const mdGrants = db.prepare("SELECT COUNT(*) AS c FROM agent_tool_grants WHERE tool_name LIKE 'master_data_%'").get().c;
const delCols = db.prepare('PRAGMA table_info(agent_delegation_tasks)').all().map((c) => c.name);
const standupCols = db.prepare('PRAGMA table_info(standups)').all().map((c) => c.name);
const dismissTbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_feed_dismissals'").get();
console.log('    master_data tools meta:', mdTools, 'grants:', mdGrants);
console.log('    delegation owner_user_id:', delCols.includes('owner_user_id') ? 'OK' : 'MISSING');
console.log('    standups owner_user_id:', standupCols.includes('owner_user_id') ? 'OK' : 'MISSING');
const kanbanCols = db.prepare('PRAGMA table_info(kanban_tasks)').all().map((c) => c.name);
console.log('    kanban_tasks owner_user_id:', kanbanCols.includes('owner_user_id') ? 'OK' : 'MISSING');
if (!kanbanCols.includes('owner_user_id')) throw new Error('kanban_tasks.owner_user_id column missing');
const a2aCols = db.prepare('PRAGMA table_info(workflow_a2a_publications)').all().map((c) => c.name);
for (const col of ['auth_mode', 'client_id', 'client_secret_hash']) {
  console.log(`    workflow_a2a_publications.${col}:`, a2aCols.includes(col) ? 'OK' : 'MISSING');
  if (!a2aCols.includes(col)) throw new Error(`workflow_a2a_publications.${col} missing`);
}
const a2aTok = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_a2a_access_tokens'").get();
console.log('    workflow_a2a_access_tokens table:', a2aTok ? 'OK' : 'MISSING');
if (!a2aTok) throw new Error('workflow_a2a_access_tokens table missing');
console.log('    user_feed_dismissals table:', dismissTbl ? 'OK' : 'MISSING');
const platformHelp = db.prepare(`SELECT id, name, agent_type FROM agents WHERE id = 'platformhelp'`).get();
console.log('    platformhelp agent:', platformHelp ? `${platformHelp.name} (${platformHelp.agent_type})` : 'MISSING');
const helpDocs = db
  .prepare(`SELECT COUNT(*) AS c FROM master_data_documents WHERE title LIKE 'Flolah Help —%' OR title LIKE 'Flolah Help -%'`)
  .get().c;
console.log('    Flolah Help Master Data docs:', helpDocs);
const helpGrants = db
  .prepare(
    `SELECT COUNT(*) AS c FROM agent_tool_grants WHERE agent_id = 'platformhelp' AND tool_name IN ('master_data_rag','master_data_list_documents')`
  )
  .get().c;
console.log('    platformhelp RAG grants:', helpGrants);
if (mdTools < 7) throw new Error('expected at least 7 master_data tools in content_tools_meta');
if (!dismissTbl) throw new Error('user_feed_dismissals table missing');
if (!platformHelp) throw new Error('platformhelp agent missing from agents table');
if (helpGrants < 2) throw new Error('platformhelp missing master_data_rag / list_documents grants');
NODE

echo "==> blueprint secret scan (committed packs + export zips)"
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-blueprint-secret-sanitize.js
docker compose exec -T -w /opt/agent-os/backend backend node scripts/scan-blueprint-secrets.js
docker compose exec -T backend sh -c 'test -f /opt/agent-os/knowledgebase/platform-help/07-workflow-nodes-reference.md'
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-opensearch-rag-smoke.js
# Legacy per-CEO SQLite help smoke may WARN after OpenSearch migration — keep soft.
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-platform-help-rag.js \
  || echo "WARN: legacy platform-help RAG script failed (platform docs live in OpenSearch now)"
echo "==> specialist Flolah Help merge RAG (CRM Maker Twenty SME)"
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-platform-help-merge-rag.js
echo "==> master_data invoke smoke"
docker compose exec -T backend node <<'NODE'
import { initDb } from './src/db/schema.js';
import { getBalaCeoAuthId } from './src/services/job-applicant-ceo.js';
import { listRowsForAgent } from './src/services/master-data-tools.js';
initDb();
const owner = getBalaCeoAuthId();
const out = listRowsForAgent(owner, { table_name: 'departments', limit: 5 });
const names = (out.rows || []).map((r) => r.data?.name).filter(Boolean);
console.log('    departments sample:', names.slice(0, 5).join(', ') || '(none)');
NODE

echo "==> agent workspace MD smoke"
docker compose exec -T backend node <<'NODE'
import { existsSync } from 'fs';
import { initDb, getDb } from './src/db/schema.js';
import { resolveAgentWorkspaceRoot, listWorkspaceFiles, readWorkspaceFile } from './src/workspace/adapter.js';
initDb();
const agent = getDb().prepare(`SELECT * FROM agents WHERE is_coo = 1 OR id = 'balserve' ORDER BY is_coo DESC LIMIT 1`).get();
if (!agent) throw new Error('no COO agent');
const root = resolveAgentWorkspaceRoot(agent, { healDb: false });
const listed = await listWorkspaceFiles(root);
const soul = await readWorkspaceFile('soul', { workspaceRoot: root });
console.log('    agent:', agent.id, 'root:', root);
console.log('    files:', (listed.files || []).map((f) => f.name).join(', ') || '(none)');
console.log('    SOUL.md bytes:', (soul.text || '').length, existsSync(root) ? 'dir OK' : 'dir MISSING');
if (!existsSync(root)) throw new Error('workspace root missing: ' + root);
if (!(soul.text || '').trim()) throw new Error('SOUL.md empty or missing at ' + root);
NODE

echo "==> broadcast routing smoke"
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-broadcast-routing.js

echo "==> Kanban delegation sync smoke (self-cleaning; no CEO Dashboard standup left behind)"
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-kanban-delegation-sync.js

echo "==> Kanban owner isolation smoke"
if [[ -f "$ROOT/backend/scripts/test-kanban-owner-isolation.js" ]]; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-kanban-owner-isolation.js
else
  echo "    WARN: test-kanban-owner-isolation.js missing on disk (sync scripts?)"
fi

echo "==> A2A OAuth client-credentials smoke"
if [[ -f "$ROOT/backend/scripts/test-workflow-a2a-oauth.js" ]]; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-workflow-a2a-oauth.js
else
  echo "    WARN: test-workflow-a2a-oauth.js missing on disk (sync scripts?)"
fi

echo "==> COO reach-me delegation smoke (self-cleaning; deletes smoke SocialAgent notifications)"
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-coo-reach-me-delegation.js

echo "==> CEO guardrails smoke (POLICY.md sync + Brain prepend; restores prior policy)"
if [[ -f "$ROOT/backend/scripts/test-ceo-guardrails.js" ]]; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-ceo-guardrails.js
else
  echo "    WARN: test-ceo-guardrails.js missing on disk (sync scripts?)"
fi

echo "==> OpenClaw allowlists (master_data)"
docker compose exec -T -w /opt/agent-os openclaw node -e "
import { REQUIRED_GLOBAL_CONTENT_TOOLS, COO_CONTENT_TOOLS_ALLOW } from './scripts/lib/content-tools-allow.js';
const md = [
  'master_data_list_tables','master_data_list_rows','master_data_insert_row',
  'master_data_update_row','master_data_delete_row','master_data_list_documents','master_data_rag',
];
for (const t of md) {
  if (!REQUIRED_GLOBAL_CONTENT_TOOLS.includes(t)) { console.error('missing REQUIRED_GLOBAL', t); process.exit(2); }
  if (!COO_CONTENT_TOOLS_ALLOW.includes(t)) { console.error('missing COO allow', t); process.exit(3); }
}
console.log('    master_data tools in REQUIRED_GLOBAL + COO allowlists OK');
"

echo "PLATFORM_VERIFY_DONE $(date -Is)"

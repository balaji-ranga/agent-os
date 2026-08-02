#!/usr/bin/env bash
# Rebuild frontend image on VPS, refresh nginx upstream, verify key UI markers.
#
# Redeploy checklist (also covered by vps-deploy-latest.sh SERVICES=frontend):
#   - hPanel shell + light/dark theme: app-topbar, profile-menu, theme-toggle-btn,
#     --bg #f7f8f9 / #0f1115, ThemeToggle / agent-os-theme
#   - Agent Workspaces Add agent: AddAgentForm, agent-workspace-card
#   - Tools nav UI (route /content-tools): label Tools in AppNavMenu
#   - Workflow fullscreen: shell-focus-mode, Exit to workflows, wf-editor-exit
#   - Run audit fullscreen: /workflows/runs/:id, wf-run-audit-layout, Exit run audit
#   - Primary CTAs: Register MCP, Register Agents, page-hero
#   - Existing: Resync ORG, Master Data purpose, Purge all uploads, NotificationProvider, Broadcast, Flolah title
#
#   - Agent channels: WhatsApp groupPolicy disabled/allowlist (DM allowFrom does not cover groups)
#   - CEO home chat (COO default picker), My Org (/org), Profile role_title
#
# Frontend sources must be UTF-8 (not UTF-16). Windows editors that write UTF-16 LE
# break `vite build` with "Expected ; but found \x00". Use:
#   node scripts/check-frontend-utf8.mjs
# Stale Docker COPY layers: rebuild with NO_CACHE=1 / sync-to-vps.ps1 -NoCache.
#
# Usage:
#   bash /opt/agent-os/deploy/scripts/vps-rebuild-frontend.sh
# Laptop:
#   .\deploy\scripts\sync-to-vps.ps1 -Services frontend
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "==> Rebuild frontend (+ nginx so upstream IP refreshes)"
docker compose build frontend
docker compose up -d --force-recreate frontend nginx
sleep 4
curl -kfsS https://127.0.0.1/api/health
echo
curl -kfsS -o /dev/null -w "register_http=%{http_code}\n" https://127.0.0.1/register
curl -kfsS -o /dev/null -w "home_http=%{http_code}\n" https://127.0.0.1/ || true

echo "==> frontend JS / HTML markers"
for marker in \
  'Resync ORG' \
  'Purpose / description' \
  NotificationProvider \
  standupNotificationsDismiss \
  Broadcast \
  'Exit to workflows' \
  'Register MCP' \
  'Register Agents' \
  agent-os-theme \
  'Switch to dark' \
  'Reports to (COO default)' \
  'My Org' \
  'role_title' \
  'WhatsApp groups' \
  'Good to see you' \
  'Flolah - An Agent Company Setup'
do
  if [[ "$marker" == 'Flolah - An Agent Company Setup' ]]; then
    if docker compose exec -T frontend sh -c "grep -q '$marker' /usr/share/nginx/html/index.html 2>/dev/null"; then
      echo "    $marker OK (index.html)"
    else
      echo "    WARN: $marker missing from index.html"
    fi
  elif docker compose exec -T frontend sh -c "grep -Rql '$marker' /usr/share/nginx/html/assets/*.js 2>/dev/null"; then
    echo "    $marker OK"
  else
    echo "    WARN: $marker not in frontend JS bundle"
  fi
done

echo "==> hPanel / theme / fullscreen / hero CSS markers"
for css_marker in \
  app-topbar \
  profile-menu \
  theme-toggle-btn \
  nav-section-chevron \
  shell-focus-mode \
  page-hero \
  wf-editor-exit \
  wf-run-audit-layout \
  agent-workspace-card \
  '#f7f8f9' \
  '#0f1115'
do
  if docker compose exec -T frontend sh -c "cat /usr/share/nginx/html/assets/*.css" 2>/dev/null | grep -q "$css_marker"; then
    echo "    CSS $css_marker OK"
  else
    echo "    WARN: CSS $css_marker missing (rebuild frontend? try NO_CACHE=1)"
  fi
done

echo FRONTEND_DONE

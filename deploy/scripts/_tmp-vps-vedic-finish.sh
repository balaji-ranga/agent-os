#!/usr/bin/env bash
set -euo pipefail
# Backend image bakes scripts at /opt/agent-os/backend — copy host sync into running container
docker cp /opt/agent-os/backend/scripts/vps-onboard-specialty-agents-bala.js \
  agent-os-backend-1:/opt/agent-os/backend/scripts/vps-onboard-specialty-agents-bala.js
docker cp /opt/agent-os/backend/scripts/onboard-vedic-astrology-agent.js \
  agent-os-backend-1:/opt/agent-os/backend/scripts/onboard-vedic-astrology-agent.js
docker cp /opt/agent-os/backend/scripts/test-vedic-compute-chart.js \
  agent-os-backend-1:/opt/agent-os/backend/scripts/test-vedic-compute-chart.js
docker cp /opt/agent-os/openclaw-workspace-templates/vedic-astrology \
  agent-os-backend-1:/opt/agent-os/openclaw-workspace-templates/

cd /opt/agent-os/deploy
docker compose exec -T backend node scripts/vps-onboard-specialty-agents-bala.js
docker compose exec -T backend node scripts/test-vedic-compute-chart.js
docker compose exec -T frontend sh -c 'grep -Rql chat_attachments /usr/share/nginx/html/assets/*.js && echo ChatAttach=OK || echo ChatAttach=MISSING'
docker compose exec -T frontend sh -c 'grep -Rql "Attach image or document" /usr/share/nginx/html/assets/*.js && echo AttachBtn=OK || echo AttachBtn=MISSING'
SOUL=$(find /var/lib/docker/volumes/agent-os_openclaw_home/_data -path '*workspace-vedic-astrology/SOUL.md' 2>/dev/null | head -1 || true)
if [[ -n "$SOUL" ]]; then
  echo "==> $SOUL"
  head -12 "$SOUL"
else
  echo "SOUL not found in openclaw volume"
fi
echo VPS_VEDIC_DONE

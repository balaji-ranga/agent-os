#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
# Ensure latest script is in container (image bake + host sync)
docker cp /opt/agent-os/backend/scripts/offboard-users-except-keepers.js \
  agent-os-backend-1:/opt/agent-os/backend/scripts/offboard-users-except-keepers.js 2>/dev/null || true
docker cp /opt/agent-os/backend/src/services/user-offboard.js \
  agent-os-backend-1:/opt/agent-os/backend/src/services/user-offboard.js 2>/dev/null || true
docker cp /opt/agent-os/backend/src/routes/admin.js \
  agent-os-backend-1:/opt/agent-os/backend/src/routes/admin.js 2>/dev/null || true

echo "==> dry-run"
docker compose exec -T backend node scripts/offboard-users-except-keepers.js --dry-run
echo "==> confirm offboard"
docker compose exec -T backend node scripts/offboard-users-except-keepers.js --confirm
echo "==> remaining users"
docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const rows = getDb().prepare(`SELECT id, name, email, role, enabled FROM platform_users ORDER BY role, name`).all();
console.log(JSON.stringify(rows, null, 2));
NODE
docker compose exec -T frontend sh -c 'grep -Rql "Offboard & delete all data" /usr/share/nginx/html/assets/*.js && echo OffboardUI=OK || echo OffboardUI=MISSING'
echo OFFBOARD_DONE

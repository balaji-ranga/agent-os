#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy

echo "== containers =="
docker compose ps

echo "== backend access helpers =="
grep -n "normalizeA2AVisibility\|isA2APrivate\|setA2AVisibility" /opt/agent-os/backend/src/services/workflow-a2a-access.js | head -20

echo "== schema visibility ALTER =="
grep -n "visibility TEXT DEFAULT" /opt/agent-os/backend/src/db/schema.js | head -5

echo "== frontend Private UI =="
docker compose exec -T frontend sh -c 'grep -Rql "Private (org only)" /usr/share/nginx/html/assets/*.js && echo FRONTEND_OK'

echo "== help on disk =="
grep -c "Visibility (Public vs Private)" /opt/agent-os/knowledgebase/platform-help/09-a2a-agent-exchange.md || true

echo "== README =="
grep -c "visibility: public|private\|visibility\` \`public\`" /opt/agent-os/README.md || grep -n "Visibility" /opt/agent-os/README.md | head -5

echo "== e2e script =="
test -f /opt/agent-os/backend/scripts/test-a2a-private-visibility.js && echo SCRIPT_OK

echo "== runtime DB column =="
docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE'
import { getDb, initDb } from './src/db/schema.js';
initDb();
const cols = getDb().prepare('PRAGMA table_info(workflow_a2a_publications)').all().map((c) => c.name);
console.log('visibility_col', cols.includes('visibility'));
NODE

echo "== e2e =="
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-a2a-private-visibility.js | tail -8

echo VPS_PROPAGATION_CHECK_DONE

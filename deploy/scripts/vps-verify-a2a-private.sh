#!/usr/bin/env bash
# VPS verify for A2A private visibility (run from /opt/agent-os/deploy).
set -euo pipefail
cd /opt/agent-os/deploy

echo "== frontend Private UI =="
if docker compose exec -T frontend sh -c 'grep -Rql "Private (org only)" /usr/share/nginx/html/assets/*.js'; then
  echo FRONTEND_PRIVATE_UI_OK
else
  echo FRONTEND_PRIVATE_UI_MISSING
  exit 1
fi

echo "== help doc on disk =="
grep -n "Visibility (Public vs Private)" /opt/agent-os/knowledgebase/platform-help/09-a2a-agent-exchange.md | head -3

echo "== schema visibility =="
docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE'
import { getDb, initDb } from './src/db/schema.js';
initDb();
const db = getDb();
const cols = db.prepare('PRAGMA table_info(workflow_a2a_publications)').all().map((c) => c.name);
console.log('visibility_col', cols.includes('visibility'));
if (!cols.includes('visibility')) process.exit(1);
NODE

echo "== refresh Platform Help Master Data =="
docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import { ensurePlatformHelpDocuments } from './src/services/ceo-default-master-data.js';
initDb();
const ceos = getDb().prepare("SELECT id FROM platform_users WHERE role='ceo' AND enabled=1").all();
let updated = 0;
let created = 0;
for (const c of ceos) {
  const r = await ensurePlatformHelpDocuments(c.id, { refresh: true });
  updated += r?.updated || 0;
  created += r?.created || 0;
  console.log('help_seed', c.id, JSON.stringify(r));
}
console.log('HELP_REFRESH_DONE', { tenants: ceos.length, updated, created });
NODE

echo "== private visibility e2e =="
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-a2a-private-visibility.js

echo "== Master Data help 09 Private content =="
HELP_HITS=$(docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE' 2>/dev/null || echo 0
import { initDb, getDb } from './src/db/schema.js';
import { listDocuments, getDocumentFile } from './src/services/master-data.js';
initDb();
const ceos = getDb().prepare("SELECT id FROM platform_users WHERE role='ceo' AND enabled=1").all();
let hits = 0;
for (const c of ceos) {
  try {
    const docs = listDocuments(c.id) || [];
    const doc = docs.find(
      (d) =>
        String(d.title || '').includes('A2A AgentExchange') ||
        String(d.filename || '').includes('09-a2a')
    );
    if (!doc) continue;
    const file = getDocumentFile(c.id, doc.id);
    const text = Buffer.isBuffer(file?.buffer) ? file.buffer.toString('utf8') : '';
    if (text.includes('Visibility (Public vs Private)')) hits += 1;
  } catch {
    /* tenant db missing */
  }
}
process.stdout.write(String(hits));
NODE
)
if [[ "${HELP_HITS}" =~ ^[0-9]+$ ]] && [[ "${HELP_HITS}" -gt 0 ]]; then
  echo "    Master Data help 09 Private visibility seeded (${HELP_HITS} CEOs) OK"
else
  echo "    FAIL: help 09 Private visibility not in Master Data (count=${HELP_HITS})"
  exit 1
fi

echo VPS_A2A_PRIVATE_VERIFY_DONE

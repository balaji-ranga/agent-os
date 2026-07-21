/**
 * Local smoke: seed Platform Help agent + ensure Platform Help Master Data docs for all CEOs.
 * Usage (from backend): node scripts/test-platform-help-seed.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { seedPlatformHelpAgent } from './seed-platform-help-agent.js';
import {
  ensureCeoDefaultMasterDataForAllCeos,
  PLATFORM_HELP_TITLE_PREFIX,
  resolvePlatformHelpDir,
} from '../src/services/ceo-default-master-data.js';
import { listDocuments } from '../src/services/master-data.js';
import { getAgentToolGrants } from '../src/services/openclaw-agent-tools.js';

initDb();
const db = getDb();

const dir = resolvePlatformHelpDir();
if (!dir) {
  console.error('FAIL: platform-help directory not found');
  process.exit(1);
}
console.log('Platform help dir:', dir);

const agent = seedPlatformHelpAgent();
if (!agent || agent.id !== 'platformhelp') {
  console.error('FAIL: platformhelp agent not seeded');
  process.exit(1);
}
const grants = getAgentToolGrants('platformhelp');
const need = ['master_data_rag', 'master_data_list_documents'];
for (const t of need) {
  if (!grants.includes(t)) {
    console.error('FAIL: missing grant', t, 'got', grants);
    process.exit(1);
  }
}
console.log('OK agent', agent.name, 'grants:', grants.join(', '));

const ceos = db.prepare(`SELECT id, email FROM platform_users WHERE role = 'ceo'`).all();
if (!ceos.length) {
  console.warn('WARN: no CEO users — skip Master Data backfill check');
  process.exit(0);
}

const md = ensureCeoDefaultMasterDataForAllCeos(
  ceos.map((c) => c.id),
  { refresh: true }
);
console.log('Master data backfill:', md);

const sampleCeo = ceos[0].id;
const docs = listDocuments(sampleCeo).filter((d) =>
  String(d.title || '').startsWith(PLATFORM_HELP_TITLE_PREFIX)
);
console.log(`CEO ${sampleCeo}: ${docs.length} Platform Help document(s)`);
for (const d of docs.slice(0, 5)) {
  console.log(' -', d.title, `(${d.filename})`);
}
if (docs.length < 5) {
  console.error('FAIL: expected several Platform Help docs, got', docs.length);
  process.exit(1);
}

console.log('PASS platform-help seed + Master Data docs');

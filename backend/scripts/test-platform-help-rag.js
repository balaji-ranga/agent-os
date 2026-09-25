/**
 * Verify Platform Help is a standard agent, granted to CEOs, and RAG retrieves node docs.
 * Usage: node scripts/test-platform-help-rag.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { grantStandardAgents, listStandardAgentIds } from '../src/services/users.js';
import { ragDocuments, listDocuments } from '../src/services/master-data.js';
import { PLATFORM_HELP_TITLE_PREFIX } from '../src/services/ceo-default-master-data.js';
import { PLATFORM_OWNER_ID } from '../src/services/opensearch/indices.js';
import { seedPlatformHelpAgent } from './seed-platform-help-agent.js';

initDb();
seedPlatformHelpAgent();
const db = getDb();

const ids = listStandardAgentIds();
console.log('standard agents:', ids.join(', '));
if (!ids.includes('platformhelp')) {
  console.error('FAIL: platformhelp not standard');
  process.exit(1);
}

const ceo = db.prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1`).get();
if (!ceo) {
  console.error('FAIL: no enabled CEO');
  process.exit(1);
}
grantStandardAgents(ceo.id);
const granted = db
  .prepare('SELECT 1 AS ok FROM user_agents WHERE user_id = ? AND agent_id = ?')
  .get(ceo.id, 'platformhelp');
if (!granted?.ok) {
  console.error('FAIL: platformhelp not in user_agents for', ceo.id);
  process.exit(1);
}
console.log('OK granted to', ceo.id);

const allDocs = await listDocuments(PLATFORM_OWNER_ID);
const docs = allDocs.filter((d) => String(d.title || '').startsWith(PLATFORM_HELP_TITLE_PREFIX));
console.log('help docs:', docs.length);
if (docs.length < 5) {
  console.error('FAIL: too few help docs');
  process.exit(1);
}
for (const filename of ['platform-help-52-governed-gmail-operations.md', 'platform-help-53-announcements-and-mcp-universe.md']) {
  if (!docs.some((doc) => String(doc.filename || '').toLowerCase() === filename)) {
    console.error('FAIL: missing recent help document', filename);
    process.exit(1);
  }
}
if (!allDocs.some((doc) => String(doc.filename || '').toLowerCase() === 'public-guide-systems--social-publishing.md')) {
  console.error('FAIL: public static guide is not mirrored into Platform Help RAG');
  process.exit(1);
}

const rag = await ragDocuments(PLATFORM_OWNER_ID, {
  query: 'IF node operators approved rejected workflow',
  topK: 5,
  summarize: false,
});
const text = JSON.stringify(rag);
console.log('RAG payload keys:', Object.keys(rag || {}));
if (!/IF|approved|operator|ceo_approval/i.test(text)) {
  console.error('FAIL: RAG did not return node reference content');
  console.log(text.slice(0, 2000));
  process.exit(1);
}
console.log('PASS grant + RAG');
console.log(text.slice(0, 800));

for (const [label, query, expectedPatterns] of [
  ['Gmail Operations', 'Gmail Operations immutable cleanup plan Trash reply draft connector action grant', [/cleanup|trash|draft|connector action/i]],
  ['Goal execution controls', 'Goal Plan planning live progress Cancel execution Retry execution partial success recovery', [/cancel execution|retry execution|partial success|recovery/i]],
  ['Facebook publishing typo', 'how to eate a facebook post', [/browser recipe/i, /meta graph|create_page_post|facebook page/i]],
]) {
  const recent = await ragDocuments(PLATFORM_OWNER_ID, { query, topK: 8, summarize: false });
  const payload = JSON.stringify(recent);
  if (!recent.hit_count || !expectedPatterns.every((pattern) => pattern.test(payload))) {
    console.error(`FAIL: RAG did not retrieve ${label}`, payload.slice(0, 2000));
    process.exit(1);
  }
  console.log(`OK recent help RAG: ${label}`, `hits=${recent.hit_count}`);
}

/**
 * Push updated TOOLS/SOUL for standard agents + refresh summarize_url purpose.
 * Usage: node scripts/push-agent-ops-guidance.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { forcePushTemplateDocs, tenantWorkspacePath } from '../src/services/openclaw-tenant.js';
import { grantLearningsSummaryToAllAgents } from '../src/services/agent-feedback.js';

initDb();
const db = getDb();

db.prepare(
  `UPDATE content_tools_meta SET purpose = ? WHERE name = 'summarize_url'`
).run(
  'Fetch a web page (HTTPS) and return a short summary and title. Retired URLs (e.g. old nasa.gov/mission_pages) may auto-remap; on 404 returns hint + suggested_url — try that or browser. Never invent page content.'
);

const granted = grantLearningsSummaryToAllAgents();
console.log('learnings_grants', granted);

const agents = [
  'techresearcher',
  'expensemanager',
  'socialasstant',
  'balserve',
  'workflowbuilder',
  'platformhelp',
  'vedic-astrology',
];
const forceIdentity = new Set(['techresearcher', 'expensemanager', 'socialasstant']);
const ceos = db.prepare(`SELECT id FROM platform_users WHERE role = 'ceo'`).all().map((r) => r.id);
let pushed = 0;
let errors = 0;
for (const ceo of ceos) {
  for (const agentId of agents) {
    try {
      const dest = tenantWorkspacePath(ceo, agentId);
      const r = forcePushTemplateDocs(agentId, dest, {
        forceIdentity: forceIdentity.has(agentId),
      });
      if (r.copied?.length) {
        pushed += 1;
        console.log('pushed', ceo, agentId, r.copied.join(','));
      } else {
        console.warn('empty', ceo, agentId);
      }
    } catch (e) {
      errors += 1;
      console.warn('ERR', ceo, agentId, e.message);
    }
  }
}
console.log(JSON.stringify({ ok: true, pushed, errors, ceos: ceos.length, learnings_granted: granted }));

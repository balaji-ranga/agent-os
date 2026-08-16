/**
 * Specialists (CRM Maker-shaped agent id) must retrieve Flolah Help Twenty CRM SME
 * via master_data_list_documents / master_data_rag. Platform Help stays help-only.
 *
 * Run: node scripts/test-platform-help-merge-rag.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  ragDocumentsForAgent,
  listDocumentsForAgent,
} from '../src/services/master-data-tools.js';
import { PLATFORM_OWNER_ID } from '../src/services/opensearch/index.js';

initDb();
const db = getDb();
const ceo = db
  .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1`)
  .get();
if (!ceo?.id) {
  console.error('FAIL: no enabled CEO');
  process.exit(1);
}

const crmAgentId = `t-${ceo.id}--crm-s1-maya`;
const list = await listDocumentsForAgent(ceo.id, { agentId: crmAgentId });
const helpTitles = (list.documents || []).map((d) => String(d.title || ''));
const hasTwenty = helpTitles.some((t) => /twenty crm sme/i.test(t));
if (!list.includes_platform_help || !hasTwenty) {
  console.error('FAIL: CRM-shaped list_documents missing Twenty CRM SME', {
    count: list.count,
    includes_platform_help: list.includes_platform_help,
    sample: helpTitles.slice(0, 12),
  });
  process.exit(1);
}
console.log('OK list includes Twenty CRM SME', `help=${list.platform_help_count}`);

const rag = await ragDocumentsForAgent(ceo.id, {
  agentId: crmAgentId,
  query: 'Twenty CRM lead prospect opportunity order process stages',
  top_k: 8,
  summarize: false,
});
const blob = JSON.stringify(rag.chunks || []).toLowerCase();
if (
  !rag.includes_platform_help ||
  (rag.platform_help_hit_count || 0) < 1 ||
  !/twenty/.test(blob) ||
  !/lead|prospect|order/.test(blob)
) {
  console.error('FAIL: CRM-shaped RAG missing Twenty CRM process help', {
    hit_count: rag.hit_count,
    platform_help_hit_count: rag.platform_help_hit_count,
    ceo_hit_count: rag.ceo_hit_count,
    titles: (rag.chunks || []).map((c) => c.title),
  });
  process.exit(1);
}
console.log('OK CRM-shaped RAG Twenty SME', `help_hits=${rag.platform_help_hit_count}`);

const ph = await ragDocumentsForAgent(ceo.id, {
  agentId: `t-${ceo.id}--platformhelp`,
  query: 'Twenty CRM people companies opportunities stages',
  top_k: 5,
  summarize: false,
});
if (ph.owner_user_id !== PLATFORM_OWNER_ID) {
  console.error('FAIL: platformhelp RAG owner not platform', ph.owner_user_id);
  process.exit(1);
}
console.log('OK platformhelp still platform-only', `hits=${ph.hit_count}`);
console.log('PASS specialist Flolah Help merge');

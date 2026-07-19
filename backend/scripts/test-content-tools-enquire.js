/**
 * Smoke-test content_tools_enquire scoring + seed registration.
 * Usage: node scripts/test-content-tools-enquire.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { seedWorkflowToolsIfMissing } from '../src/db/seed-content-tools-meta.js';
import { enquireContentTools, listEnabledContentTools } from '../src/services/content-tools-meta.js';
import { seedWorkflowBuilderAgent } from './seed-workflow-builder-agent.js';
import { tryContentToolsQueryResponse } from '../src/services/agent-workflow-builder-catalog.js';

initDb();
seedWorkflowToolsIfMissing();
seedWorkflowBuilderAgent();

const all = listEnabledContentTools();
console.log('enabled content tools:', all.length);
if (all.length < 5) {
  console.error('FAIL: expected several content tools');
  process.exit(1);
}

const ranked = enquireContentTools('summarize a web page', { limit: 5 });
console.log('top for summarize:', ranked.top_recommendation?.name, ranked.tools.map((t) => t.name));
if (ranked.top_recommendation?.name !== 'summarize_url') {
  console.error('FAIL: expected summarize_url top recommendation');
  process.exit(1);
}

const ibkr = enquireContentTools('IBKR order cancels and fills learnings', { limit: 5 });
console.log('top for IBKR learnings:', ibkr.top_recommendation?.name);
if (!String(ibkr.top_recommendation?.name || '').includes('ibkr')) {
  console.error('FAIL: expected an ibkr_* recommendation');
  process.exit(1);
}

const fast = tryContentToolsQueryResponse('which content tool for summarizing a URL?');
if (!fast?.reply?.includes('summarize_url')) {
  console.error('FAIL: fast path missing summarize_url');
  process.exit(1);
}

const meta = getDb().prepare(`SELECT name FROM content_tools_meta WHERE name = 'content_tools_enquire'`).get();
if (!meta) {
  console.error('FAIL: content_tools_enquire not in meta');
  process.exit(1);
}

const grant = getDb()
  .prepare(`SELECT 1 AS ok FROM agent_tool_grants WHERE agent_id = 'workflowbuilder' AND tool_name = 'content_tools_enquire'`)
  .get();
if (!grant) {
  console.error('FAIL: content_tools_enquire not granted to workflowbuilder');
  process.exit(1);
}

console.log('OK: content tools enquire + workflow builder grant');

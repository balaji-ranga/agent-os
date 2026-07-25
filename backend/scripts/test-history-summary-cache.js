/**
 * Unit test for the daily summary cache on ibkr_order_learnings + brain_history,
 * and for the master_data_rag summarize=false default.
 *
 * Isolated temp DB + stubbed global.fetch so LLM calls are counted, never real.
 * Run: node scripts/test-history-summary-cache.js
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'agentos-histcache-'));
process.env.AGENT_OS_DATA_DIR = tmp;
process.env.ORDER_LEARNINGS_FULL_REBUILD_DAYS = '7';
process.env.BRAIN_HISTORY_FULL_REBUILD_DAYS = '7';
process.env.OPENAI_PRIMARY_BASE_URL = 'https://stub.local/v1';
process.env.OPENAI_BASE_URL = 'https://stub.local/v1';
process.env.OPENAI_PRIMARY_API_KEY = 'stub-key';
process.env.OPENAI_API_KEY = 'stub-key';
process.env.OPENCLAW_MODEL_PRIMARY = 'stub-model';

let llmCalls = 0;
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/chat/completions')) {
    llmCalls += 1;
    const text = `STUB SUMMARY v${llmCalls}`;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: text } }] }),
      text: async () => text,
    };
  }
  return realFetch ? realFetch(url, opts) : { ok: false, status: 500, text: async () => 'no fetch' };
};

const { initDb, getDb } = await import('../src/db/schema.js');
initDb();
const db = getDb();

const OWNER = 'ceo-cache-test';
let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  OK:', msg);
  else {
    failures += 1;
    console.error('  FAIL:', msg);
  }
}

/** Force the cached row to look like it was built on an earlier day. */
function ageValidDate(kind, date = '2000-01-01') {
  db.prepare(`UPDATE tool_summary_cache SET valid_date = ? WHERE kind = ?`).run(date, kind);
}
function ageBase(kind) {
  db.prepare(
    `UPDATE tool_summary_cache SET valid_date = '2000-01-01', base_generated_at = '2000-01-01T00:00:00.000Z' WHERE kind = ?`
  ).run(kind);
}

try {
  const { recordOrderEvent, getOrderHistory } = await import('../src/services/ibkr-order-events.js');

  console.log('\n=== ibkr_order_learnings ===');

  console.log('== 1. No events → canned, no LLM ==');
  let r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 7 });
  check(r.cache_mode === 'no_data', `cache_mode=no_data (got ${r.cache_mode})`);
  check(llmCalls === 0, `no LLM call (calls=${llmCalls})`);

  console.log('== 2. First call with events → rebuild, 1 LLM call ==');
  recordOrderEvent({
    owner_user_id: OWNER,
    symbol_key: 'NASDAQ:AMD',
    side: 'BUY',
    status: 'cancelled',
    reason_text: 'Commission-free order rejected',
    source: 'test',
  });
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 7 });
  check(r.cache_mode === 'rebuild', `cache_mode=rebuild (got ${r.cache_mode})`);
  check(r.cache_reason === 'no_cache', `reason=no_cache (got ${r.cache_reason})`);
  check(llmCalls === 1, `1 LLM call (calls=${llmCalls})`);
  check(r.cached === false, 'cached=false on build');
  check(/STUB SUMMARY/.test(r.summary), 'summary is LLM text');

  console.log('== 3. Same day, same data → cache hit, NO LLM ==');
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 7 });
  check(r.cache_mode === 'cache_hit', `cache_mode=cache_hit (got ${r.cache_mode})`);
  check(r.cached === true, 'cached=true');
  check(llmCalls === 1, `still 1 LLM call (calls=${llmCalls})`);

  console.log('== 4. Different scope (days=30) → separate cache entry, 1 new LLM ==');
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 30 });
  check(r.cache_mode === 'rebuild', `cache_mode=rebuild for new scope (got ${r.cache_mode})`);
  check(llmCalls === 2, `2 LLM calls (calls=${llmCalls})`);
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 30 });
  check(r.cache_mode === 'cache_hit', 'days=30 scope now cached');
  check(llmCalls === 2, `still 2 LLM calls (calls=${llmCalls})`);

  console.log('== 5. New order event same day → rebuild (trading correctness) ==');
  recordOrderEvent({
    owner_user_id: OWNER,
    symbol_key: 'NASDAQ:NVDA',
    side: 'BUY',
    status: 'rejected',
    reason_text: 'New reject arrived today',
    source: 'test',
  });
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 7 });
  check(r.cache_mode === 'rebuild', `cache_mode=rebuild on new data (got ${r.cache_mode})`);
  check(r.cache_reason === 'new_data', `reason=new_data (got ${r.cache_reason})`);
  check(llmCalls === 3, `3 LLM calls (calls=${llmCalls})`);

  console.log('== 6. Force refresh → rebuild even same day ==');
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 7, force: true });
  check(r.cache_mode === 'rebuild', `cache_mode=rebuild on force (got ${r.cache_mode})`);
  check(r.cache_reason === 'force', `reason=force (got ${r.cache_reason})`);
  check(llmCalls === 4, `4 LLM calls (calls=${llmCalls})`);

  console.log('== 7. Next day, no new events → no_new, NO LLM ==');
  ageValidDate('order_learnings');
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 7 });
  check(r.cache_mode === 'no_new', `cache_mode=no_new (got ${r.cache_mode})`);
  check(llmCalls === 4, `still 4 LLM calls (calls=${llmCalls})`);
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 7 });
  check(r.cache_mode === 'cache_hit', 'validity extended to today');
  check(llmCalls === 4, `still 4 LLM calls (calls=${llmCalls})`);

  console.log('== 8. Stale base (>7d) → rebuild ==');
  ageBase('order_learnings');
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 7 });
  check(r.cache_mode === 'rebuild', `cache_mode=rebuild on stale base (got ${r.cache_mode})`);
  check(r.cache_reason === 'stale_base', `reason=stale_base (got ${r.cache_reason})`);
  check(llmCalls === 5, `5 LLM calls (calls=${llmCalls})`);

  console.log('== 9. response_type=actual never calls the LLM ==');
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'actual', days: 7 });
  check(llmCalls === 5, `still 5 LLM calls (calls=${llmCalls})`);
  check(r.summary === null, 'actual mode has no summary');
  check(Array.isArray(r.events) && r.events.length > 0, 'actual mode returns full events');

  console.log('== 10. Response shape preserved on cache hit ==');
  r = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 7 });
  check(r.cache_mode === 'cache_hit', 'cache hit again');
  check(Array.isArray(r.events), 'events sample present');
  check(!!r.order_learnings && typeof r.order_learnings.event_count === 'number', 'order_learnings present');
  check(r.context_text === r.summary && r.bodyText === r.summary, 'context_text/bodyText mirror summary');

  // ---------------------------------------------------------------- brain history
  console.log('\n=== brain_history ===');
  const ordersLlm = llmCalls;

  db.prepare(
    `INSERT OR REPLACE INTO agent_workflow_definitions (id, name, owner_user_id, status)
     VALUES ('wf-cache-test', 'Cache Test WF', ?, 'published')`
  ).run(OWNER);
  const runId = Number(
    db
      .prepare(
        `INSERT INTO agent_workflow_runs (run_number, definition_id, owner_user_id, status, completed_at)
         VALUES (1, 'wf-cache-test', ?, 'completed', datetime('now'))`
      )
      .run(OWNER).lastInsertRowid
  );
  const addStep = (nodeId, text) =>
    db
      .prepare(
        `INSERT INTO agent_workflow_run_steps
           (run_id, node_id, node_type, status, input_json, output_json, started_at, completed_at)
         VALUES (?, ?, 'brain', 'completed', ?, ?, datetime('now'), datetime('now'))`
      )
      .run(runId, nodeId, JSON.stringify({ resolved: { userMessage: 'plan' } }), JSON.stringify({ text }));

  addStep('maker', 'bought AMD');

  const { getBrainHistory } = await import('../src/services/agent-workflow-brain-history.js');
  const brainArgs = {
    ownerUserId: OWNER,
    workflowIds: 'wf-cache-test',
    nodeIds: 'maker',
    responseType: 'summarized',
  };

  console.log('== 11. First call → rebuild, 1 LLM call ==');
  r = await getBrainHistory(brainArgs);
  check(r.cache_mode === 'rebuild', `cache_mode=rebuild (got ${r.cache_mode})`);
  check(llmCalls === ordersLlm + 1, `1 new LLM call (calls=${llmCalls})`);

  console.log('== 12. Same day, same data → cache hit, NO LLM ==');
  r = await getBrainHistory(brainArgs);
  check(r.cache_mode === 'cache_hit', `cache_mode=cache_hit (got ${r.cache_mode})`);
  check(llmCalls === ordersLlm + 1, `no new LLM call (calls=${llmCalls})`);
  check(r.entry_count === 1, `entry_count=1 (got ${r.entry_count})`);

  console.log('== 13. New brain step same day → rebuild ==');
  addStep('maker', 'sold NVDA');
  r = await getBrainHistory(brainArgs);
  check(r.cache_mode === 'rebuild', `cache_mode=rebuild on new step (got ${r.cache_mode})`);
  check(r.cache_reason === 'new_data', `reason=new_data (got ${r.cache_reason})`);
  check(llmCalls === ordersLlm + 2, `2 new LLM calls (calls=${llmCalls})`);

  console.log('== 14. Next day, no new steps → no_new, NO LLM ==');
  ageValidDate('brain_history');
  r = await getBrainHistory(brainArgs);
  check(r.cache_mode === 'no_new', `cache_mode=no_new (got ${r.cache_mode})`);
  check(llmCalls === ordersLlm + 2, `no new LLM call (calls=${llmCalls})`);

  console.log('== 15. Force → rebuild ==');
  r = await getBrainHistory({ ...brainArgs, force: true });
  check(r.cache_mode === 'rebuild', `cache_mode=rebuild on force (got ${r.cache_mode})`);
  check(llmCalls === ordersLlm + 3, `3 new LLM calls (calls=${llmCalls})`);

  console.log('== 16. actual mode never calls LLM ==');
  const before = llmCalls;
  r = await getBrainHistory({ ...brainArgs, responseType: 'actual' });
  check(llmCalls === before, `no LLM call in actual mode (calls=${llmCalls})`);

  // ------------------------------------------------------- master_data_rag default
  console.log('\n=== master_data_rag summarize default ===');
  const md = await import('../src/services/master-data.js');
  const mdTools = await import('../src/services/master-data-tools.js');
  await md.uploadDocument(OWNER, {
    title: 'Leave Policy',
    filename: 'leave.txt',
    contentText:
      'Annual leave is 20 days per year. Sick leave is 14 days. Carry over is capped at 5 days.',
  });

  console.log('== 17. Agent tool omits summarize → no LLM call ==');
  const beforeRag = llmCalls;
  let rag = await mdTools.ragDocumentsForAgent(OWNER, { query: 'annual leave days' });
  check(llmCalls === beforeRag, `no LLM call (calls=${llmCalls})`);
  check(rag.hit_count > 0, `hit_count>0 (got ${rag.hit_count})`);
  check(Array.isArray(rag.chunks) && rag.chunks.length > 0, 'chunks returned for agent to read');
  check(/Annual leave/.test(rag.summary || ''), 'summary falls back to raw excerpts');

  console.log('== 18. Explicit summarize=true → 1 LLM call ==');
  rag = await mdTools.ragDocumentsForAgent(OWNER, { query: 'annual leave days', summarize: true });
  check(llmCalls === beforeRag + 1, `1 LLM call (calls=${llmCalls})`);
  check(/STUB SUMMARY/.test(rag.summary), 'summary is LLM text');

  console.log('== 19. summarize="true" string also opts in ==');
  rag = await mdTools.ragDocumentsForAgent(OWNER, { query: 'sick leave', summarize: 'true' });
  check(llmCalls === beforeRag + 2, `2 LLM calls (calls=${llmCalls})`);

  console.log('== 20. Service default is false ==');
  const beforeSvc = llmCalls;
  await md.ragDocuments(OWNER, { query: 'carry over cap' });
  check(llmCalls === beforeSvc, `service default made no LLM call (calls=${llmCalls})`);
} finally {
  global.fetch = realFetch;
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(
  `\n=== Done: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} (LLM calls total=${llmCalls}) ===`
);
process.exit(failures === 0 ? 0 : 1);

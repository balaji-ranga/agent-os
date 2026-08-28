/**
 * Unit test for learnings_summary daily cache + incremental rebuild.
 * Uses an isolated temp SQLite tenant DB and a stubbed global.fetch (so no real
 * LLM/network) to count LLM invocations and exercise every cache path.
 * Run: node scripts/test-learnings-cache.js
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Isolate tenant DB + point LLM at a stub endpoint BEFORE importing modules.
const tmp = mkdtempSync(join(tmpdir(), 'agentos-learn-'));
process.env.AGENT_OS_DATA_DIR = tmp;
process.env.LEARNINGS_FULL_REBUILD_DAYS = '7';
process.env.OPENAI_PRIMARY_BASE_URL = 'https://stub.local/v1';
process.env.OPENAI_BASE_URL = 'https://stub.local/v1';
process.env.OPENAI_PRIMARY_API_KEY = 'stub-key';
process.env.OPENAI_API_KEY = 'stub-key';
process.env.OPENCLAW_MODEL_PRIMARY = 'stub-model';

let llmCalls = 0;
let emptyNext = false;
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/chat/completions')) {
    llmCalls += 1;
    let incremental = false;
    try {
      const body = JSON.parse(opts.body || '{}');
      incremental = /UPDATING an AI agent/.test(body?.messages?.[1]?.content || '');
    } catch {
      /* ignore */
    }
    const text = emptyNext ? '' :
      (incremental ? 'INCREMENTAL SUMMARY v' : 'FULL SUMMARY v') +
      llmCalls +
      '\n1. Disliked: X\n2. Liked: Y\n3. Do/Dont: Z';
    emptyNext = false;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: text } }] }),
      text: async () => text,
    };
  }
  return realFetch ? realFetch(url, opts) : { ok: false, status: 500, text: async () => 'no fetch' };
};

const fb = await import('../src/services/agent-feedback.js');
const { storeFeedback, summarizeLearnings } = fb;
const { getDbForCeo } = await import('../src/db/request-db.js');

const OWNER = 'ceo-test';
const AGENT = 'techresearcher';
let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  OK:', msg);
  else {
    failures += 1;
    console.error('  FAIL:', msg);
  }
}
function addFeedback(rating, content, comment = '') {
  return storeFeedback({ ownerUserId: OWNER, agentId: AGENT, source: 'chat', messageContent: content, rating, comment });
}

const db = getDbForCeo(OWNER);
const staleDay = (date) =>
  db.prepare(`UPDATE agent_learnings_cache SET valid_date=? WHERE owner_user_id=?`).run(date, OWNER);

try {
  console.log('== 1. No data → canned, no LLM ==');
  let r = await summarizeLearnings({ ownerUserId: OWNER, agentId: AGENT, topic: 'space' });
  check(r.mode === 'no_data', `mode=no_data (got ${r.mode})`);
  check(llmCalls === 0, `no LLM call (calls=${llmCalls})`);

  console.log('== 2. First real call → full rebuild, 1 LLM call ==');
  addFeedback('down', 'Bad generic overview of space', 'want current news + ISRO');
  addFeedback('up', 'Great methodology breakdown');
  r = await summarizeLearnings({ ownerUserId: OWNER, agentId: AGENT, topic: 'space technology' });
  check(r.mode === 'full', `mode=full (got ${r.mode})`);
  check(llmCalls === 1, `1 LLM call total (calls=${llmCalls})`);
  check(/FULL SUMMARY/.test(r.summary), 'summary is full-rebuild text');
  check(r.summary.includes('Focus for this request: "space technology"'), 'topic note appended (hybrid)');
  check(r.cached === false, 'cached=false on build');

  console.log('== 3. Same-day repeat, different topic → cache hit, NO new LLM call ==');
  r = await summarizeLearnings({ ownerUserId: OWNER, agentId: AGENT, topic: 'AI' });
  check(r.mode === 'cache_hit', `mode=cache_hit (got ${r.mode})`);
  check(llmCalls === 1, `still 1 LLM call (calls=${llmCalls})`);
  check(r.summary.includes('Focus for this request: "AI"'), 'topic note reflects NEW topic without LLM');

  console.log('== 4. Force refresh → rebuild even same day ==');
  r = await summarizeLearnings({ ownerUserId: OWNER, agentId: AGENT, topic: 'x', force: true });
  check(r.mode === 'full', `mode=full on force (got ${r.mode})`);
  check(llmCalls === 2, `2 LLM calls (calls=${llmCalls})`);

  console.log('== 5. Next day, no new feedback → no_new, NO LLM call ==');
  staleDay('2000-01-01');
  r = await summarizeLearnings({ ownerUserId: OWNER, agentId: AGENT, topic: 'space' });
  check(r.mode === 'no_new', `mode=no_new (got ${r.mode})`);
  check(llmCalls === 2, `still 2 LLM calls (calls=${llmCalls})`);

  console.log('== 6. Next day WITH new feedback → incremental, 1 LLM call ==');
  staleDay('2000-01-01');
  addFeedback('down', 'Used a hallucinated 404 URL isro.gov.in/launchers', 'Verify every source URL before citing it');
  r = await summarizeLearnings({ ownerUserId: OWNER, agentId: AGENT, topic: 'space' });
  check(r.mode === 'incremental', `mode=incremental (got ${r.mode})`);
  check(llmCalls === 3, `3 LLM calls (calls=${llmCalls})`);
  check(/INCREMENTAL SUMMARY/.test(r.summary), 'summary is incremental text');

  console.log('== 7. Stale base (>7d) + new day → FULL rebuild ==');
  db.prepare(
    `UPDATE agent_learnings_cache SET valid_date='2000-01-01', base_generated_at='2000-01-01T00:00:00.000Z' WHERE owner_user_id=?`
  ).run(OWNER);
  addFeedback('up', 'Nice ISRO + NASA comparison');
  r = await summarizeLearnings({ ownerUserId: OWNER, agentId: AGENT, topic: 'space' });
  check(r.mode === 'full', `mode=full after stale base (got ${r.mode})`);
  check(llmCalls === 4, `4 LLM calls (calls=${llmCalls})`);

  console.log('== 8. Response shape preserved ==');
  check(typeof r.feedback_count === 'number' && r.feedback_count > 0, 'feedback_count present');
  check(Array.isArray(r.feedback_sample), 'feedback_sample is array');
  check(Array.isArray(r.kanban_actions_sample), 'kanban_actions_sample is array');
  check('summary' in r, 'summary present');

  console.log('== 9. Empty model output → meaningful deterministic fallback, never poison cache ==');
  emptyNext = true;
  r = await summarizeLearnings({ ownerUserId: OWNER, agentId: AGENT, topic: 'space', force: true });
  check(/raw fallback/i.test(r.summary), 'empty model response uses deterministic fallback');
  check(!/Unable to produce summary text/i.test(r.summary), 'invalid placeholder is never persisted');
} finally {
  global.fetch = realFetch;
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(`\n=== Done: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} (LLM calls total=${llmCalls}) ===`);
process.exit(failures === 0 ? 0 : 1);

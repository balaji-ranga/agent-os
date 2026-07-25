/**
 * Verifies LLM-backed platform tools route through the CEO's BYOK endpoint
 * instead of the platform .env key.
 *
 * Platform .env endpoint  -> https://platform.local/v1
 * User BYOK endpoint      -> https://byok.local/v1  (provider ollama_free)
 *
 * Each tool is invoked with an owner that has BYOK selected; the stubbed fetch
 * records which base URL was hit. Run: node scripts/test-tool-byok-routing.js
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'agentos-byok-'));
process.env.AGENT_OS_DATA_DIR = tmp;
process.env.OPENAI_PRIMARY_BASE_URL = 'https://platform.local/v1';
process.env.OPENAI_BASE_URL = 'https://platform.local/v1';
process.env.OPENAI_PRIMARY_API_KEY = 'platform-key';
process.env.OPENAI_API_KEY = 'platform-key';
process.env.OPENCLAW_MODEL_PRIMARY = 'stub-model';
process.env.OPENAI_SECONDARY_BASE_URL = '';
process.env.OPENAI_SECONDARY_API_KEY = '';
process.env.OPENAI_SECONDARY_MODEL = '';
process.env.OLLAMA_BASE_URL = 'https://byok.local';
process.env.OLLAMA_MODEL = 'byok-model';

const BYOK_HOST = 'byok.local';
const PLATFORM_HOST = 'platform.local';

let lastHost = null;
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/chat/completions')) {
    lastHost = new URL(u).host;
    const text = '{"fit_score": 70, "fit_rationale": "stub", "recommended_status": "shortlisted"}';
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

const OWNER = 'ceo-byok-test';
db.prepare(
  `INSERT OR REPLACE INTO platform_users (id, email, name, role, password_hash, llm_provider)
   VALUES (?, ?, ?, 'ceo', 'x', 'ollama_free')`
).run(OWNER, 'byok@test.local', 'BYOK Test');

let failures = 0;
function expectByok(tool) {
  if (lastHost === BYOK_HOST) {
    console.log(`  OK: ${tool} -> BYOK endpoint (${lastHost})`);
  } else {
    failures += 1;
    console.error(`  FAIL: ${tool} -> ${lastHost} (expected ${BYOK_HOST})`);
  }
  lastHost = null;
}

console.log('\n[1] ibkr_order_learnings (summarized)');
{
  const { recordOrderEvent, getOrderHistory } = await import('../src/services/ibkr-order-events.js');
  recordOrderEvent({
    owner_user_id: OWNER,
    symbol_key: 'NASDAQ:AMD',
    side: 'BUY',
    status: 'cancelled',
    reason_text: 'Commission-free order rejected',
    source: 'test',
  });
  const out = await getOrderHistory({ ownerUserId: OWNER, responseType: 'summarized', days: 7 });
  if (!out.summary) {
    failures += 1;
    console.error('  FAIL: no summary produced');
  }
  expectByok('ibkr_order_learnings');
}

console.log('\n[2] brain_history (summarized)');
{
  db.prepare(
    `INSERT OR REPLACE INTO agent_workflow_definitions (id, name, owner_user_id, status)
     VALUES ('wf-byok-test', 'BYOK Test WF', ?, 'published')`
  ).run(OWNER);
  const runInfo = db
    .prepare(
      `INSERT INTO agent_workflow_runs (run_number, definition_id, owner_user_id, status, completed_at)
       VALUES (1, 'wf-byok-test', ?, 'completed', datetime('now'))`
    )
    .run(OWNER);
  db.prepare(
    `INSERT INTO agent_workflow_run_steps
       (run_id, node_id, node_type, status, input_json, output_json, started_at, completed_at)
     VALUES (?, 'maker', 'brain', 'completed', ?, ?, datetime('now'), datetime('now'))`
  ).run(
    Number(runInfo.lastInsertRowid),
    JSON.stringify({ resolved: { userMessage: 'plan the day' } }),
    JSON.stringify({ text: 'bought AMD' })
  );

  const { getBrainHistory } = await import('../src/services/agent-workflow-brain-history.js');
  const out = await getBrainHistory({
    ownerUserId: OWNER,
    workflowIds: 'wf-byok-test',
    nodeIds: 'maker',
    responseType: 'summarized',
  });
  if (out.entry_count !== 1) {
    failures += 1;
    console.error(`  FAIL: expected 1 entry, got ${out.entry_count}`);
  }
  expectByok('brain_history');
}

console.log('\n[3] job applicant fit_score');
{
  const { scoreJobForProfile } = await import('../src/services/job-applicant-fit-score.js');
  await scoreJobForProfile({
    profile: { id: 'prof-1', ceo_user_id: OWNER, display_name: 'Test', intake: { fit_threshold: 60 } },
    job: { job_id: 'job-1', title: 'Staff Engineer', company: 'Acme', job_description: 'Build things.' },
    updateRow: false,
  });
  expectByok('job fit_score');
}

console.log('\n[4] control: no owner falls back to platform key');
{
  const { chatCompletions } = await import('../src/config/llm.js');
  await chatCompletions({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 10 });
  if (lastHost === PLATFORM_HOST) {
    console.log(`  OK: anonymous call -> platform endpoint (${lastHost})`);
  } else {
    failures += 1;
    console.error(`  FAIL: anonymous call -> ${lastHost} (expected ${PLATFORM_HOST})`);
  }
  lastHost = null;
}

try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll BYOK routing checks passed');

/**
 * E2E: BYOK (new + existing user) + feedback loop + learnings_summary tool.
 * Usage: node scripts/test-byok-and-feedback-e2e.js
 * Requires backend on AGENT_OS_API_URL (default http://127.0.0.1:3001).
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { getDbForCeo } from '../src/db/request-db.js';
import { resolveLlmConfigForUser, syncUserLlmToOpenClaw, byokProviderId } from '../src/services/user-llm-settings.js';
import { getOpenClawConfigPath } from '../src/config/openclaw-paths.js';
import { storeFeedback, listFeedback, summarizeLearnings, ensureFeedbackTable } from '../src/services/agent-feedback.js';
import { getLlmConfig } from '../src/config/llm.js';
import { seedLearningsToolsIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantLearningsSummaryToAllAgents } from '../src/services/agent-feedback.js';

const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const stamp = Date.now().toString(36);
const password = `ByokTest!${stamp}`;

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    passed += 1;
    console.log('OK:', msg);
  }
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

initDb();
seedLearningsToolsIfMissing();
grantLearningsSummaryToAllAgents();

console.log('\n=== 0) Health ===');
const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
assert(!!health?.ok, 'backend up');

console.log('\n=== 1) Register NEW CEO with OpenAI preference (key after login via vault) ===');
const emailNew = `byok.new.${stamp}@example.com`;
const fakeKey = `sk-test-byok-${stamp}-abcdefghijklmnopqrstuvwxyz`;
const reg = await api('POST', '/api/auth/register', {
  email: emailNew,
  password,
  name: `BYOK New ${stamp}`,
  db_mode: 'tenant',
  mfa_policy: 'off',
  llm_provider: 'openai',
  llm_model: 'gpt-4o-mini',
});
assert(reg.status === 201 || reg.status === 200, `register status ${reg.status} ${reg.data?.error || ''}`);
const newUser = reg.data.user || reg.data.session?.user;
const newToken = reg.data.session?.token || reg.data.token;
assert(!!newToken, 'new user session token');
assert(newUser?.llm_provider === 'openai' || reg.data.user?.llm_provider === 'openai', 'new user llm_provider=openai');
assert(
  (newUser?.llm_model || reg.data.user?.llm_model) === 'gpt-4o-mini',
  'new user default model gpt-4o-mini'
);

const newId = newUser?.id || reg.data.user?.id;
assert(!!newId, `new user id=${newId}`);

// Put Platform_BYOK in vault (registration never accepts raw keys)
const listKeys = await api('GET', '/api/user-api-keys', null, newToken);
const slot = (listKeys.data?.keys || []).find(
  (k) => String(k.key_name || '') === 'Platform_BYOK'
);
if (slot?.id) {
  const patchVault = await api(
    'PATCH',
    `/api/user-api-keys/${slot.id}`,
    { api_key: fakeKey },
    newToken
  );
  assert(patchVault.status < 400, `vault patch Platform_BYOK ${patchVault.status}`);
} else {
  const created = await api(
    'POST',
    '/api/user-api-keys',
    { key_name: 'Platform_BYOK', api_key: fakeKey },
    newToken
  );
  assert(created.status < 400, `vault create Platform_BYOK ${created.status}`);
}

const resolvedNew = resolveLlmConfigForUser(newId);
assert(resolvedNew.using_byok === true, 'new user resolve using_byok after vault key');
assert(resolvedNew.primary.apiKey === fakeKey, 'new user key takes precedence over env');
assert(resolvedNew.primary.baseUrl.includes('openai.com'), 'new user openai base url');

const llmCfg = getLlmConfig(newId);
assert(llmCfg.using_byok === true && llmCfg.primary.apiKey === fakeKey, 'getLlmConfig(owner) uses BYOK');

const syncNew = syncUserLlmToOpenClaw(newId);
assert(syncNew.ok && !syncNew.cleared, 'openclaw sync for new BYOK user');
if (existsSync(getOpenClawConfigPath())) {
  const oc = JSON.parse(readFileSync(getOpenClawConfigPath(), 'utf8'));
  const pk = byokProviderId(newId);
  assert(!!oc.models?.providers?.[pk]?.apiKey, `openclaw models.providers.${pk} set`);
}

// Reject key on register body
const regReject = await api('POST', '/api/auth/register', {
  email: `byok.reject.${stamp}@example.com`,
  password,
  name: 'Reject key',
  mfa_policy: 'off',
  llm_provider: 'openai',
  llm_api_key: fakeKey,
});
assert(regReject.status >= 400, 'register rejects llm_api_key on body');


console.log('\n=== 2) EXISTING user — register once, then PATCH profile to OpenRouter BYOK ===');
const emailExisting = `byok.existing.${stamp}@example.com`;
const regEx = await api('POST', '/api/auth/register', {
  email: emailExisting,
  password,
  name: `BYOK Existing ${stamp}`,
  db_mode: 'shared',
  mfa_policy: 'off',
  llm_provider: 'platform_decided',
});
assert(regEx.status === 201 || regEx.status === 200, `existing-user register ${regEx.status}`);
const existingToken = regEx.data.session?.token || regEx.data.token;
const existingId = regEx.data.user?.id || regEx.data.session?.user?.id;
assert(!!existingToken && !!existingId, `existing user session id=${existingId}`);
assert(
  (regEx.data.user?.llm_provider || 'platform_decided') === 'platform_decided',
  'existing starts as platform_decided'
);

const orKey = `or-test-byok-${stamp}`;
const patch = await api(
  'PATCH',
  '/api/auth/me',
  { llm_provider: 'openrouter', llm_api_key: orKey },
  existingToken
);
assert(patch.status === 200, `existing profile patch ${patch.status} ${patch.data.error || ''}`);
assert(patch.data.user?.llm_provider === 'openrouter', 'existing llm_provider=openrouter');
assert(patch.data.user?.llm_api_key_set === true, 'existing key marked set');

const resolvedEx = resolveLlmConfigForUser(existingId);
assert(resolvedEx.using_byok && resolvedEx.provider === 'openrouter', 'existing openrouter byok');
assert(resolvedEx.primary.apiKey === orKey, 'existing key precedence over env');
assert(resolvedEx.primary.baseUrl.includes('openrouter'), 'openrouter base');

const syncEx = syncUserLlmToOpenClaw(existingId);
assert(syncEx.ok && syncEx.provider === 'openrouter', 'openclaw sync existing openrouter');

const reset = await api(
  'PATCH',
  '/api/auth/me',
  { llm_provider: 'ollama_free' },
  existingToken
);
assert(reset.status === 200, 'existing can switch to ollama_free');
assert(resolveLlmConfigForUser(existingId).provider === 'ollama_free', 'ollama_free resolved');
assert(resolveLlmConfigForUser(existingId).using_byok === true, 'ollama_free is user choice not env');

console.log('\n=== 3) Feedback store/list (user tenancy) ===');
const fb = await api(
  'POST',
  '/api/feedback',
  {
    agent_id: 'balserve',
    source: 'chat',
    message_content: 'Here is a draft standup summary that was too vague.',
    rating: 'down',
    comment: 'Be more specific next time',
    context: { test: stamp },
  },
  newToken
);
assert(fb.status === 201, `feedback create ${fb.status} ${fb.data.error || ''}`);
assert(fb.data.owner_user_id === newId, 'feedback owner matches new user');
assert(fb.data.agent_id === 'balserve', 'feedback agent_id');

const list = await api('GET', `/api/feedback?agent_id=balserve&days=30`, null, newToken);
assert(list.status === 200, 'feedback list');
assert((list.data.feedback || []).some((r) => r.id === fb.data.id), 'feedback listed for owner');

// Direct service path (tenant DB)
ensureFeedbackTable(getDbForCeo(newId));
storeFeedback({
  ownerUserId: newId,
  agentId: 'techresearcher',
  source: 'kanban',
  messageContent: 'Research was excellent',
  rating: 'up',
  comment: 'Keep this depth',
});
const listed = listFeedback({ ownerUserId: newId, days: 30, limit: 20 });
assert(listed.length >= 2, `service listFeedback count=${listed.length}`);

console.log('\n=== 4) learnings_summary tool API (tenant-scoped) ===');
const learnRes = await fetch(`${BASE}/api/tools/learnings-summary`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${newToken}`,
    'x-openclaw-agent-id': `t-${newId}--balserve`,
  },
  body: JSON.stringify({ topic: 'standup summaries', days: 30 }),
  signal: AbortSignal.timeout(90000),
});
const learnData = await learnRes.json().catch(() => ({}));
assert(learnRes.ok || learnRes.status === 200, `learnings-summary HTTP ${learnRes.status} ${learnData.error || ''}`);
assert(learnData.owner_user_id === newId, 'learnings owner tenancy');
assert(typeof learnData.summary === 'string' && learnData.summary.length > 10, 'learnings summary text');
assert(learnData.feedback_count >= 1, `learnings feedback_count=${learnData.feedback_count}`);

const meta = getDb().prepare(`SELECT name FROM content_tools_meta WHERE name = 'learnings_summary'`).get();
assert(!!meta, 'learnings_summary in content_tools_meta');
const grant = getDb()
  .prepare(`SELECT 1 AS ok FROM agent_tool_grants WHERE agent_id = 'balserve' AND tool_name = 'learnings_summary'`)
  .get();
assert(!!grant, 'learnings_summary granted to balserve');

console.log('\n=== 5) Service summarizeLearnings (includes empty kanban window ok) ===');
const summary = await summarizeLearnings({
  ownerUserId: newId,
  agentId: 'balserve',
  topic: 'standup',
  days: 30,
});
assert(summary.feedback_count >= 1, 'summarizeLearnings feedback');
assert(!!summary.summary, 'summarizeLearnings summary');

console.log(`\n=== Done: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);

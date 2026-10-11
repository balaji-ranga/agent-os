import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-dual-byok-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.OPENCLAW_DIR = join(root, 'openclaw');
process.env.OPENAI_BASE_URL = 'https://platform-primary.test/v1';
process.env.OPENAI_API_KEY = 'platform-primary-key';
process.env.OPENAI_PRIMARY_MODEL = 'platform-primary-model';
process.env.OPENAI_SECONDARY_BASE_URL = 'https://platform-secondary.test/v1';
process.env.OPENAI_SECONDARY_API_KEY = 'platform-secondary-key';
process.env.OPENAI_SECONDARY_MODEL = 'platform-secondary-model';
process.env.MODEL_GATEWAY_ENABLED = '0';
mkdirSync(process.env.OPENCLAW_DIR, { recursive: true });
writeFileSync(
  join(process.env.OPENCLAW_DIR, 'openclaw.json'),
  JSON.stringify({ gateway: { mode: 'local' }, agents: { defaults: { model: { primary: 'platform/default' } }, list: [] }, models: { providers: {} } })
);

const { getDb } = await import('../src/db/schema.js');
const {
  createUserApiKey,
  PLATFORM_BYOK_KEY_NAME,
  PLATFORM_BYOK_SECONDARY_KEY_NAME,
} = await import('../src/services/user-api-keys.js');
const {
  updateUserLlmSettings,
  resolveLlmConfigForUser,
  userLlmPublic,
} = await import('../src/services/user-llm-settings.js');
const { chatCompletions, resolveChatCompletionsConfig } = await import('../src/config/llm.js');

const db = getDb();
function addUser(id) {
  db.prepare(
    `INSERT INTO platform_users (id, email, password_hash, name, role, enabled)
     VALUES (?, ?, 'test-hash', ?, 'ceo', 1)`
  ).run(id, `${id}@example.test`, id);
}

addUser('dual-user');
createUserApiKey('dual-user', { keyName: PLATFORM_BYOK_KEY_NAME, apiKey: 'primary-user-key' });
createUserApiKey('dual-user', { keyName: PLATFORM_BYOK_SECONDARY_KEY_NAME, apiKey: 'secondary-user-key' });
const updated = updateUserLlmSettings('dual-user', {
  llm_provider: 'openai',
  llm_model: 'gpt-4.1-mini',
  llm_secondary_provider: 'openrouter',
  llm_secondary_model: 'anthropic/claude-3.5-haiku',
});
assert.equal(updated.llm_secondary_provider, 'openrouter');
assert.equal(updated.llm_secondary_api_key_set, true);

const dual = resolveLlmConfigForUser('dual-user');
assert.equal(dual.primary.apiKey, 'primary-user-key');
assert.equal(dual.primary.model, 'gpt-4.1-mini');
assert.equal(dual.secondary.apiKey, 'secondary-user-key');
assert.equal(dual.secondary.model, 'anthropic/claude-3.5-haiku');
assert.match(dual.secondary.baseUrl, /openrouter/i);

const primaryConfig = await resolveChatCompletionsConfig({ ownerUserId: 'dual-user', endpointPreference: 'primary' });
const secondaryConfig = await resolveChatCompletionsConfig({ ownerUserId: 'dual-user', endpointPreference: 'secondary' });
assert.equal(primaryConfig.cfg.primary.apiKey, 'primary-user-key');
assert.equal(secondaryConfig.cfg.primary.apiKey, 'secondary-user-key');

const calls = [];
let failUserPrimary = false;
global.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body || '{}');
  const auth = init.headers?.Authorization || '';
  calls.push({ url: String(url), auth, model: body.model });
  if (failUserPrimary && auth === 'Bearer primary-user-key') {
    return new Response('primary unavailable', { status: 503 });
  }
  return Response.json({
    model: body.model,
    choices: [{ message: { content: `ok:${body.model}` }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
};

await chatCompletions({ ownerUserId: 'dual-user', endpointPreference: 'primary', messages: [{ role: 'user', content: 'maker' }] });
await chatCompletions({ ownerUserId: 'dual-user', endpointPreference: 'secondary', messages: [{ role: 'user', content: 'checker' }] });
assert.equal(calls.at(-2).auth, 'Bearer primary-user-key');
assert.equal(calls.at(-1).auth, 'Bearer secondary-user-key');

failUserPrimary = true;
const failover = await chatCompletions({ ownerUserId: 'dual-user', messages: [{ role: 'user', content: 'fail over' }] });
assert.equal(failover.modelUsed, 'anthropic/claude-3.5-haiku');
assert.equal(calls.at(-1).auth, 'Bearer secondary-user-key');
failUserPrimary = false;

addUser('legacy-user');
createUserApiKey('legacy-user', { keyName: PLATFORM_BYOK_KEY_NAME, apiKey: 'legacy-primary-key' });
updateUserLlmSettings('legacy-user', { llm_provider: 'openai', llm_model: 'gpt-4o-mini' });
const legacy = resolveLlmConfigForUser('legacy-user');
assert.equal(legacy.secondary.apiKey, 'legacy-primary-key');
assert.equal(legacy.secondary.model, 'gpt-4o-mini');
const legacyChecker = await resolveChatCompletionsConfig({ ownerUserId: 'legacy-user', endpointPreference: 'secondary' });
assert.equal(legacyChecker.cfg.primary.apiKey, 'legacy-primary-key');

addUser('platform-user');
const platform = resolveLlmConfigForUser('platform-user');
assert.equal(platform.primary.apiKey, 'platform-primary-key');
assert.equal(platform.secondary.apiKey, 'platform-secondary-key');
await chatCompletions({ ownerUserId: 'platform-user', endpointPreference: 'primary', messages: [{ role: 'user', content: 'platform maker' }] });
await chatCompletions({ ownerUserId: 'platform-user', endpointPreference: 'secondary', messages: [{ role: 'user', content: 'platform checker' }] });
assert.equal(calls.at(-2).auth, 'Bearer platform-primary-key');
assert.equal(calls.at(-1).auth, 'Bearer platform-secondary-key');

const publicView = userLlmPublic(db.prepare('SELECT * FROM platform_users WHERE id = ?').get('dual-user'));
assert.equal(publicView.llm_api_key_set, true);
assert.equal(publicView.llm_secondary_api_key_set, true);
assert.equal(JSON.stringify(publicView).includes('primary-user-key'), false);
assert.equal(JSON.stringify(publicView).includes('secondary-user-key'), false);

const openclawConfig = JSON.parse(readFileSync(join(root, 'openclaw', 'openclaw.json'), 'utf8'));
assert.ok(openclawConfig.models.providers['byok-dual-user']);
assert.ok(openclawConfig.models.providers['byok-dual-user-secondary']);

console.log('Dual BYOK E2E passed: profile, primary/checker routing, failover, legacy mirror, platform defaults, and OpenClaw providers.');

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDb } from '../src/db/schema.js';
import { createUserApiKey, PLATFORM_BYOK_KEY_NAME, PLATFORM_BYOK_SECONDARY_KEY_NAME } from '../src/services/user-api-keys.js';
import { resolveLlmConfigForUser, updateUserLlmSettings } from '../src/services/user-llm-settings.js';
import { chatCompletions } from '../src/config/llm.js';

function endpoint(prefix) {
  const baseUrl = String(process.env[`${prefix}_BASE_URL`] || '').trim().replace(/\/$/, '');
  const apiKey = String(process.env[`${prefix}_API_KEY`] || '').trim();
  const model = String(process.env[`${prefix}_MODEL`] || '').trim();
  let host = '';
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch {}
  const provider = host.includes('openrouter')
    ? 'openrouter'
    : host.includes('openai')
      ? 'openai'
      : host.includes('deepseek')
        ? 'deepseek_cloud'
        : '';
  return { baseUrl, apiKey, model, host, provider };
}

const primary = endpoint('OPENAI_PRIMARY');
const secondary = endpoint('OPENAI_SECONDARY');
console.log(JSON.stringify({
  platform: {
    primary: { host: primary.host, model: primary.model, keySet: !!primary.apiKey, byokProvider: primary.provider || null },
    secondary: { host: secondary.host, model: secondary.model, keySet: !!secondary.apiKey, byokProvider: secondary.provider || null },
  },
}));

if (process.argv.includes('--inspect')) process.exit(0);
assert.ok(primary.apiKey && primary.model && primary.provider, 'Platform primary is not directly representable by the current BYOK provider catalog');
assert.ok(secondary.apiKey && secondary.model && secondary.provider, 'Platform secondary is not directly representable by the current BYOK provider catalog');

const db = getDb();
const reuseArg = process.argv.find(arg => arg.startsWith('--reuse='));
const reusedUserId = reuseArg ? reuseArg.slice('--reuse='.length).trim() : '';
const suffix = randomUUID().slice(0, 8);
const userId = reusedUserId || `ceo-dual-byok-e2e-${suffix}`;
let email;
if (reusedUserId) {
  const user = db.prepare('SELECT id, email FROM platform_users WHERE id = ?').get(userId);
  assert.ok(user, `Reusable test user not found: ${userId}`);
  email = user.email;
} else {
  email = `dual-byok-e2e-${suffix}@flolah.test`;
  db.prepare(
    `INSERT INTO platform_users (id, email, password_hash, name, role, enabled, industry, business_name)
     VALUES (?, ?, 'live-e2e-no-login', 'Dual BYOK E2E', 'ceo', 1, 'technology', 'Flolah BYOK E2E')`
  ).run(userId, email);

  createUserApiKey(userId, { keyName: PLATFORM_BYOK_KEY_NAME, apiKey: primary.apiKey });
  createUserApiKey(userId, { keyName: PLATFORM_BYOK_SECONDARY_KEY_NAME, apiKey: secondary.apiKey });
  updateUserLlmSettings(userId, {
    llm_provider: primary.provider,
    llm_model: primary.model,
    llm_secondary_provider: secondary.provider,
    llm_secondary_model: secondary.model,
  });
}

const resolved = resolveLlmConfigForUser(userId);
assert.equal(resolved.primary.apiKey, primary.apiKey);
assert.equal(resolved.secondary.apiKey, secondary.apiKey);
assert.equal(resolved.primary.model, primary.model);
assert.equal(resolved.secondary.model, secondary.model);

const prompt = 'Reply with exactly DUAL_BYOK_OK and nothing else.';
const maker = await chatCompletions({
  ownerUserId: userId,
  endpointPreference: 'primary',
  messages: [{ role: 'user', content: prompt }],
  maxTokens: 32,
  source: 'dual_byok_live_primary',
});
const secondaryScenarios = {};
for (const source of ['goal_plan_checker', 'agent_turn_adjudicator', 'steering_completion_validation']) {
  secondaryScenarios[source] = await chatCompletions({
    ownerUserId: userId,
    endpointPreference: 'secondary',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 32,
    source,
  });
}
const normal = await chatCompletions({
  ownerUserId: userId,
  messages: [{ role: 'user', content: prompt }],
  maxTokens: 32,
  source: 'dual_byok_live_default',
});

for (const [name, result] of Object.entries({ maker, ...secondaryScenarios, normal })) {
  assert.match(String(result.content || ''), /DUAL_BYOK_OK/i, `${name} did not return the expected live response`);
}

console.log(JSON.stringify({
  ok: true,
  testUser: { id: userId, email },
  primary: { modelUsed: maker.modelUsed, endpointHost: maker.endpointHost },
  secondaryScenarios: Object.fromEntries(Object.entries(secondaryScenarios).map(([name, result]) => [name, {
    modelUsed: result.modelUsed,
    endpointHost: result.endpointHost,
  }])),
  default: { modelUsed: normal.modelUsed, endpointHost: normal.endpointHost },
  credentialsMatchedPlatform: { primary: true, secondary: true },
}));

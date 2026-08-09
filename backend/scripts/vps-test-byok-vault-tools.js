/**
 * VPS BYOK vault seed + tool entitlement test.
 *
 * Usage (inside backend container):
 *   node scripts/vps-test-byok-vault-tools.js
 */
import { randomBytes } from 'crypto';
import { initDb, getDb } from '../src/db/schema.js';
import { offboardAllExceptProtected } from '../src/services/user-offboard.js';
import { registerCeoUser } from '../src/services/users.js';
import {
  listUserApiKeys,
  ensureByokVaultSlots,
  PLATFORM_BYOK_KEY_NAME,
  REPLICATE_BYOK_KEY_NAME,
  BRAVE_SEARCH_BYOK_KEY_NAME,
  ELEVENLABS_BYOK_KEY_NAME,
  getUserApiKeyRow,
  updateUserApiKey,
  createUserApiKey,
  isUnsetApiKeyRow,
} from '../src/services/user-api-keys.js';
import { getImageConfig, getBraveSearchConfig } from '../src/config/tools.js';
import { createSession } from '../src/services/auth/session.js';

const EXPECTED_SLOTS = [
  PLATFORM_BYOK_KEY_NAME,
  REPLICATE_BYOK_KEY_NAME,
  BRAVE_SEARCH_BYOK_KEY_NAME,
  ELEVENLABS_BYOK_KEY_NAME,
];

function ok(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK', msg);
}

function stamp() {
  return randomBytes(3).toString('hex');
}

async function callTool(path, { token, body }) {
  const base = String(process.env.AGENT_OS_INTERNAL_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const res = await fetch(base + '/api/tools/' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function setVaultSecret(ownerId, keyName, secret) {
  const row = getUserApiKeyRow(ownerId, keyName);
  if (!row) {
    createUserApiKey(ownerId, { keyName, apiKey: secret });
    return 'created';
  }
  updateUserApiKey(ownerId, row.id, { apiKey: secret });
  return 'updated';
}

async function main() {
  initDb();
  const db = getDb();

  console.log('\\n=== 1) Offboard non-keepers ===');
  const dry = offboardAllExceptProtected({
    dryRun: true,
    actor: { id: 'system', name: 'vps-test-byok-vault-tools' },
  });
  console.log('Would keep', dry.kept.map((u) => u.name + '<' + u.email + '>/' + u.role).join(' | '));
  console.log('Would remove', dry.removed.length, 'users');
  const off = offboardAllExceptProtected({
    dryRun: false,
    actor: { id: 'system', name: 'vps-test-byok-vault-tools' },
  });
  ok(off.errors.length === 0, 'offboard errors=' + off.errors.length);
  console.log('Kept:', off.kept.map((u) => u.name + ' (' + u.role + ')').join(', '));
  console.log('Removed:', off.removed.length);

  const remaining = db.prepare('SELECT id, name, email, role FROM platform_users ORDER BY role, name').all();
  console.log('Remaining users:', remaining.length);
  for (const u of remaining) console.log(' ', u.role, u.name, u.email);

  console.log('\\n=== 2) Register BYOK user (ollama_free) ===');
  const email = 'byok-test-' + stamp() + '@example.com';
  const password = 'ByokTest-' + stamp() + '!aA1';
  const user = await registerCeoUser({
    accept_terms: true,
    email,
    password,
    name: 'BYOK Test ' + stamp(),
    llm_provider: 'ollama_free',
    industry: 'personal',
  });
  ok(!!user?.id, 'registered ' + email + ' id=' + user.id);
  ok(user.llm_provider === 'ollama_free', 'provider=' + user.llm_provider);

  console.log('\\n=== 3) Vault seed placeholders ===');
  ensureByokVaultSlots(user.id, 'ollama_free');
  const keys = listUserApiKeys(user.id);
  const names = keys.map((k) => k.key_name).sort();
  console.log('Vault keys:', keys.map((k) => k.key_name + '=' + (k.key_hint || '?') + ' unset=' + !!k.is_unset).join(', '));
  for (const slot of EXPECTED_SLOTS) {
    const row = keys.find((k) => k.key_name === slot);
    ok(!!row, 'seeded slot ' + slot);
    ok(row.is_unset === true || row.key_hint === 'unset', slot + ' is unset placeholder');
  }

  const session = createSession(user.id);
  const token = session?.token || session;
  ok(typeof token === 'string' && token.length > 10, 'session token');

  console.log('\\n=== 4) Tools FAIL without filled BYOK ===');
  const imgCfgFail = getImageConfig(user.id);
  ok(!!imgCfgFail.error, 'getImageConfig error: ' + (imgCfgFail.error_code || imgCfgFail.error));
  const braveCfgFail = getBraveSearchConfig(user.id);
  ok(!!braveCfgFail.error, 'getBraveSearchConfig error: ' + (braveCfgFail.error_code || braveCfgFail.error));

  const imgFail = await callTool('generate-image', {
    token,
    body: { prompt: 'a red apple on a white table' },
  });
  ok(imgFail.status >= 400, 'generate-image HTTP ' + imgFail.status + ' body=' + JSON.stringify(imgFail.data).slice(0, 180));
  ok(/Platform_BYOK|not configured|BYOK/i.test(String(imgFail.data?.error || '')), 'generate-image error mentions BYOK: ' + imgFail.data?.error);

  const braveFail = await callTool('brave-web-search', {
    token,
    body: { query: 'flolah agent os', count: 3 },
  });
  ok(braveFail.status >= 400, 'brave-web-search HTTP ' + braveFail.status);
  ok(/BRAVE_SEARCH_BYOK|BYOK/i.test(String(braveFail.data?.error || '')), 'brave error mentions BRAVE_SEARCH_BYOK: ' + braveFail.data?.error);

  console.log('\n=== 5) Fill vault from env ===');
  // Image BYOK hits api.openai.com for ollama_free — prefer OpenAI secondary over DeepSeek primary.
  const secondaryKey = String(process.env.OPENAI_SECONDARY_API_KEY || '').trim();
  const secondaryBase = String(process.env.OPENAI_SECONDARY_BASE_URL || '').trim();
  const primaryKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
  let openaiKey = primaryKey;
  let openaiFrom = process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : 'OPENAI_PRIMARY_API_KEY';
  const secondaryLooksOpenAi =
    !!secondaryKey &&
    (/openai\.com/i.test(secondaryBase) ||
      /^sk-(proj-)?/.test(secondaryKey) ||
      secondaryKey.length >= 40);
  if (secondaryLooksOpenAi) {
    openaiKey = secondaryKey;
    openaiFrom = 'OPENAI_SECONDARY_API_KEY';
  }
  const braveKey = String(process.env.BRAVE_API_KEY || '').trim();
  ok(!!openaiKey, 'OpenAI-capable key present in backend env (' + openaiFrom + ')');
  ok(!!braveKey, 'BRAVE_API_KEY present in backend env');
  console.log(
    'Filling Platform_BYOK from ' +
      openaiFrom +
      ' (len=' +
      openaiKey.length +
      ' hint=...' +
      openaiKey.slice(-4) +
      ')'
  );
  console.log('Filling BRAVE_SEARCH_BYOK from BRAVE_API_KEY (len=' + braveKey.length + ' hint=...' + braveKey.slice(-4) + ')');
  console.log('set Platform_BYOK:', setVaultSecret(user.id, PLATFORM_BYOK_KEY_NAME, openaiKey));
  console.log('set BRAVE_SEARCH_BYOK:', setVaultSecret(user.id, BRAVE_SEARCH_BYOK_KEY_NAME, braveKey));

  const after = listUserApiKeys(user.id);
  const pb = after.find((k) => k.key_name === PLATFORM_BYOK_KEY_NAME);
  const bb = after.find((k) => k.key_name === BRAVE_SEARCH_BYOK_KEY_NAME);
  ok(pb && !pb.is_unset, 'Platform_BYOK set hint=' + pb?.key_hint);
  ok(bb && !bb.is_unset, 'BRAVE_SEARCH_BYOK set hint=' + bb?.key_hint);

  console.log('\\n=== 6) Tools SUCCEED with vault keys ===');
  const imgCfgOk = getImageConfig(user.id);
  ok(!imgCfgOk.error && !!imgCfgOk.primary?.apiKey, 'getImageConfig has key');
  const braveCfgOk = getBraveSearchConfig(user.id);
  ok(!braveCfgOk.error && !!braveCfgOk.apiKey, 'getBraveSearchConfig has key');

  const imgOk = await callTool('generate-image', {
    token,
    body: { prompt: 'a simple blue circle icon' },
  });
  if (imgOk.status !== 200) {
    console.log('generate-image fail body:', JSON.stringify(imgOk.data).slice(0, 500));
  }
  ok(
    imgOk.status === 200 && (imgOk.data?.url || imgOk.data?.media_uri || imgOk.data?.public_url),
    'generate-image ok status=' + imgOk.status + ' keys=' + Object.keys(imgOk.data || {}).join(',')
  );
  console.log('image url/media:', String(imgOk.data?.media_uri || imgOk.data?.url || '').slice(0, 120));

  const braveOk = await callTool('brave-web-search', {
    token,
    body: { query: 'OpenAI API', count: 3 },
  });
  ok(braveOk.status === 200, 'brave-web-search status=' + braveOk.status + ' err=' + (braveOk.data?.error || ''));
  const results = braveOk.data?.results || braveOk.data?.web?.results || braveOk.data?.items || [];
  const hitCount = Array.isArray(results) ? results.length : Number(braveOk.data?.count || braveOk.data?.hit_count || 0);
  ok(hitCount > 0 || !!braveOk.data?.ok || !!braveOk.data?.query, 'brave returned data: ' + JSON.stringify(braveOk.data).slice(0, 200));

  console.log('\\nPASS: BYOK vault seed + tools fail-then-succeed');
  console.log(JSON.stringify({
    user_id: user.id,
    email,
    password,
    llm_provider: 'ollama_free',
    seeded: names,
    kept_users: off.kept.map((u) => u.name),
    removed_count: off.removed.length,
  }, null, 2));
}

main().catch((e) => {
  console.error('FAILED', e.message);
  console.error(e.stack);
  process.exit(1);
});

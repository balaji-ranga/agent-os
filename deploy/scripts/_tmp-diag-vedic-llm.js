#!/usr/bin/env node
/**
 * VPS diag: platform LLM + openclaw for Balaji / vedic
 * Run inside backend or openclaw container as needed.
 */
const fs = require('fs');
const path = require('path');

const mode = process.argv[2] || 'all';

function maskKey(k) {
  if (!k || !String(k).trim()) return { set: 0, masked: '' };
  const s = String(k).trim();
  if (s.length <= 8) return { set: 1, masked: '(short)' };
  return { set: 1, masked: `${s.slice(0, 4)}...${s.slice(-4)}` };
}

function diagDb() {
  let Database;
  try {
    // Prefer app install when script is copied to /tmp
    const Module = require('module');
    const orig = Module._nodeModulePaths;
    Module._nodeModulePaths = function (from) {
      return ['/opt/agent-os/backend/node_modules', ...orig.call(this, from)];
    };
    Database = require('better-sqlite3');
  } catch (e1) {
    try {
      Database = require('/opt/agent-os/backend/node_modules/better-sqlite3');
    } catch (e2) {
      console.error('better-sqlite3 not available', e1.message, e2.message);
      process.exit(1);
    }
  }
  const dbPath = process.env.AGENT_OS_DB || '/data/agent-os/agent-os.db';
  console.log('========== 1. platform_users Balaji ==========');
  console.log('dbPath', dbPath);
  const db = new Database(dbPath, { readonly: true });
  const cols = db.prepare('PRAGMA table_info(platform_users)').all().map((c) => c.name);
  console.log('cols:', cols.join(', '));
  const selectBits = [
    'id',
    'coalesce(email,"") as email',
    'coalesce(name,"") as name',
  ];
  if (cols.includes('username')) selectBits.push('coalesce(username,"") as username');
  if (cols.includes('tenant_id')) selectBits.push('coalesce(tenant_id,"") as tenant_id');
  if (cols.includes('ceo_id')) selectBits.push('coalesce(ceo_id,"") as ceo_id');
  selectBits.push('coalesce(llm_provider,"") as llm_provider');
  selectBits.push('llm_api_key');
  const q = `
SELECT ${selectBits.join(', ')}
FROM platform_users
WHERE lower(coalesce(name,"")) LIKE "%balaji%"
   OR lower(coalesce(email,"")) LIKE "%balaji%"
   OR lower(coalesce(name,"")) LIKE "%ranganathan%"
   OR id LIKE "%bala%"
   OR id LIKE "%ceo-bala%"
`;
  const rows = db.prepare(q).all().map((r) => {
    const m = maskKey(r.llm_api_key);
    const { llm_api_key, ...rest } = r;
    return { ...rest, llm_api_key_set: m.set, key_masked: m.masked };
  });
  console.log(JSON.stringify(rows, null, 2));

  console.log('========== 2. platform_settings llm* ==========');
  try {
    const settings = db
      .prepare(
        `SELECT key, value, updated_at FROM platform_settings
         WHERE key LIKE "%llm%" OR key LIKE "%endpoint%"`
      )
      .all();
    console.log(JSON.stringify(settings, null, 2));
  } catch (e) {
    console.log('err', e.message);
  }
}

async function diagStatus() {
  console.log('========== 3. getPlatformLlmStatusPublic ==========');
  const candidates = [
    '/app/src/services/platform-llm-settings.js',
    '/opt/agent-os/backend/src/services/platform-llm-settings.js',
    path.resolve(process.cwd(), 'src/services/platform-llm-settings.js'),
  ];
  let mod;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      mod = await import(p);
      console.log('imported', p);
      break;
    } catch (e) {
      console.log('import fail', p, e.message);
    }
  }
  if (!mod) {
    console.error('cannot import platform-llm-settings');
    return;
  }
  console.log(JSON.stringify(mod.getPlatformLlmStatusPublic(), null, 2));
  console.log('active_endpoint_raw=', mod.getPlatformLlmActiveEndpoint());
}

function diagOpenclaw() {
  console.log('========== 4. openclaw.json ==========');
  const paths = [
    process.env.OPENCLAW_CONFIG_PATH,
    '/root/.openclaw/openclaw.json',
    '/home/node/.openclaw/openclaw.json',
  ].filter(Boolean);
  const cfgPath = paths.find((p) => fs.existsSync(p));
  if (!cfgPath) {
    console.log('NO CONFIG found in', paths);
    return;
  }
  console.log('cfgPath', cfgPath);
  const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const def = c.agents?.defaults?.model || {};
  console.log('agents.defaults.model =', JSON.stringify(def, null, 2));
  const list = Array.isArray(c.agents?.list) ? c.agents.list : [];
  const matches = list.filter((a) => {
    const id = String(a.id || a.name || '');
    return /vedic|ceo-bala/i.test(id);
  });
  console.log('matching agents count', matches.length);
  for (const a of matches) {
    console.log(JSON.stringify({ id: a.id, name: a.name, model: a.model }, null, 2));
  }
  // Also show any agent with explicit deepseek model
  const deepseekAgents = list.filter((a) => {
    const m = a.model;
    const s = typeof m === 'string' ? m : JSON.stringify(m || {});
    return /deepseek/i.test(s);
  });
  console.log('agents with deepseek in model field:', deepseekAgents.length);
  for (const a of deepseekAgents.slice(0, 40)) {
    console.log(JSON.stringify({ id: a.id, model: a.model }, null, 2));
  }
  const providers = Object.keys(c.models?.providers || {});
  console.log('models.providers keys:', providers.join(', '));
  for (const k of providers) {
    const p = c.models.providers[k];
    const models = (p.models || [])
      .map((m) => (typeof m === 'string' ? m : m.id))
      .slice(0, 10);
    console.log(
      `  provider ${k} baseUrl=${p.baseUrl || '(none)'} api=${p.api || ''} models=${models.join(',')}`
    );
  }
}

(async () => {
  if (mode === 'db' || mode === 'all') diagDb();
  if (mode === 'status' || mode === 'all') await diagStatus();
  if (mode === 'openclaw' || mode === 'oc') diagOpenclaw();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

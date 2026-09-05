/**
 * Repair openclaw.json so the HTTP chat API cannot silently disappear.
 *
 * Always ensures:
 *   gateway.mode / port / http.endpoints.chatCompletions.enabled
 *   gateway.auth.token from OPENCLAW_GATEWAY_TOKEN when set
 *   tools / plugins / browser present (restored from openclaw.json.bak* if wiped)
 *   models.providers catalog restored from bak when empty (empty catalog → Agent Chat 502 Unknown model)
 *   agents.defaults.model.primary when missing
 *
 * Run from openclaw or backend container, or host with OPENCLAW_CONFIG_PATH set.
 *   node deploy/scripts/ensure-openclaw-gateway-config.js
 *
 * Exit 0 when parseable (best-effort repair). Exit 1 only if config missing/unreadable.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { resolveOpenClawDir } from '../../scripts/lib/openclaw-paths.js';

const OPENCLAW_DIR = resolveOpenClawDir();
const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || join(OPENCLAW_DIR, 'openclaw.json');
const TOKEN = String(process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
const GATEWAY_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT || 18789);
const PRIMARY =
  String(process.env.OPENCLAW_MODEL_PRIMARY || '').trim() || 'openai/deepseek-v4-flash';

const CRITICAL = ['gateway', 'tools', 'plugins', 'browser'];

function providersEmpty(models) {
  const p = models?.providers;
  if (!p || typeof p !== 'object') return true;
  const names = Object.keys(p);
  if (!names.length) return true;
  return names.every((n) => !Array.isArray(p[n]?.models) || p[n].models.length === 0);
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function findBakWithGateway() {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir)
    .filter((n) => n.startsWith('openclaw.json') && n !== 'openclaw.json' && !n.endsWith('.tmp'))
    .map((n) => join(dir, n));
  let best = null;
  let bestSize = 0;
  for (const p of names) {
    const c = loadJson(p);
    if (!c?.gateway || typeof c.gateway !== 'object') continue;
    try {
      const size = statSync(p).size;
      if (size >= bestSize) {
        best = c;
        bestSize = size;
      }
    } catch {
      best = c;
    }
  }
  return best;
}

function isEmptyObj(v) {
  return v == null || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

if (!existsSync(CONFIG_PATH)) {
  console.error('[ensure-openclaw-gateway] missing', CONFIG_PATH);
  process.exit(1);
}

const originalConfigText = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, 'utf8') : '';
let config = loadJson(CONFIG_PATH);
if (!config || typeof config !== 'object') {
  console.error('[ensure-openclaw-gateway] unreadable', CONFIG_PATH);
  process.exit(1);
}

const beforeKeys = Object.keys(config).sort().join(',');
const bak = findBakWithGateway();
const repairs = [];

for (const key of CRITICAL) {
  if (isEmptyObj(config[key]) && bak && !isEmptyObj(bak[key])) {
    config[key] = clone(bak[key]);
    repairs.push('restored ' + key + ' from bak');
  }
}

if (!config.gateway || typeof config.gateway !== 'object') {
  config.gateway = {};
  repairs.push('created gateway');
}
const gw = config.gateway;
if (!gw.mode) {
  gw.mode = 'local';
  repairs.push('gateway.mode=local');
}
gw.port = GATEWAY_PORT;
if (!gw.http || typeof gw.http !== 'object') gw.http = {};
if (!gw.http.endpoints || typeof gw.http.endpoints !== 'object') gw.http.endpoints = {};
const chat = gw.http.endpoints.chatCompletions || {};
if (chat.enabled !== true) {
  chat.enabled = true;
  repairs.push('chatCompletions.enabled=true');
}
gw.http.endpoints.chatCompletions = chat;
if (TOKEN) {
  gw.auth = { ...(gw.auth || {}), token: TOKEN };
} else if (!gw.auth?.token) {
  repairs.push('WARN: no OPENCLAW_GATEWAY_TOKEN and no gateway.auth.token');
}
function dockerDefaultGateway() {
  try {
    const rows = readFileSync('/proc/net/route', 'utf8').trim().split(/\r?\n/).slice(1);
    const route = rows.map((line) => line.trim().split(/\s+/)).find((cols) => cols[1] === '00000000');
    const hex = route?.[2];
    if (!/^[0-9A-Fa-f]{8}$/.test(hex || '')) return '';
    return [6, 4, 2, 0].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join('.');
  } catch {
    return '';
  }
}

const configuredTrustedProxies = String(process.env.OPENCLAW_TRUSTED_PROXIES || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const exactGateway = dockerDefaultGateway();
gw.trustedProxies = [...new Set(
  configuredTrustedProxies.length > 0
    ? configuredTrustedProxies
    : ['127.0.0.1', '::1', exactGateway].filter(Boolean)
)];

if (!config.tools || typeof config.tools !== 'object') {
  config.tools = { sessions: { visibility: process.env.OPENCLAW_SESSION_VISIBILITY || 'agent' } };
  repairs.push('created tools');
} else if (!config.tools.sessions) {
  config.tools.sessions = { visibility: process.env.OPENCLAW_SESSION_VISIBILITY || 'agent' };
}

if (!config.plugins || typeof config.plugins !== 'object') {
  config.plugins = { entries: {}, allow: [] };
  repairs.push('created plugins shell');
}

if (!config.browser || typeof config.browser !== 'object') {
  config.browser = {
    enabled: true,
    defaultProfile: 'openclaw',
    profiles: { openclaw: { cdpPort: 18800 } },
    headless: true,
    noSandbox: true,
  };
  repairs.push('created browser');
}
if (config.plugins?.entries?.codex) {
  delete config.plugins.entries.codex;
  repairs.push('removed plugins.entries.codex');
}
if (!config.plugins.entries || typeof config.plugins.entries !== 'object') config.plugins.entries = {};
if (String(process.env.OPENCLAW_ENABLE_DEEPSEEK_PLUGIN || '0') !== '1') {
  config.plugins.entries.deepseek = { enabled: false };
}
if (Array.isArray(config.plugins?.allow)) {
  const withoutCodex = config.plugins.allow.filter((id) => id !== 'codex');
  if (withoutCodex.length !== config.plugins.allow.length) {
    config.plugins.allow = withoutCodex;
    repairs.push('removed codex from plugins.allow');
  }
}
if (config.browser?.profiles?.openclaw) {
  delete config.browser.profiles.openclaw.color;
}

if (providersEmpty(config.models) && bak?.models && !providersEmpty(bak.models)) {
  config.models = clone(bak.models);
  repairs.push('restored models from bak');
}

if (!config.agents || typeof config.agents !== 'object') config.agents = { list: [] };
if (config.agents.entries && typeof config.agents.entries === 'object') {
  config.agents.ownership = 'explicit';
}

// Preserve Agent OS custom tool support on OpenClaw 2026.8+, whose implicit
// policy otherwise selects the optional Codex harness for official OpenAI.
if (config.models?.providers?.openai && typeof config.models.providers.openai === 'object') {
  const currentRuntime = config.models.providers.openai.agentRuntime?.id;
  if (currentRuntime !== 'openclaw') {
    config.models.providers.openai.agentRuntime = { id: 'openclaw' };
    repairs.push('models.providers.openai.agentRuntime=openclaw');
  }
}
if (!config.agents.defaults || typeof config.agents.defaults !== 'object') {
  if (bak?.agents?.defaults) {
    config.agents.defaults = clone(bak.agents.defaults);
    repairs.push('restored agents.defaults from bak');
  } else {
    config.agents.defaults = { model: { primary: PRIMARY, fallbacks: [] } };
    repairs.push('created agents.defaults');
  }
}
const md = config.agents.defaults.model || {};
if (!md.primary) {
  md.primary = PRIMARY;
  config.agents.defaults.model = md;
  repairs.push('agents.defaults.model.primary');
}

const after = JSON.stringify(config, null, 2) + '\n';
if (after.trim() !== originalConfigText.trim()) {
  writeFileSync(CONFIG_PATH, after, 'utf8');
}
try {
  writeFileSync(CONFIG_PATH + '.last-good', after, 'utf8');
} catch {
  /* best-effort */
}

const afterKeys = Object.keys(config).sort().join(',');
console.log(
  JSON.stringify({
    ok: true,
    path: CONFIG_PATH,
    repairs,
    beforeKeys,
    afterKeys,
    chatCompletions: gw.http.endpoints.chatCompletions,
  })
);
process.exit(0);

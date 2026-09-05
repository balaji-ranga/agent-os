/**
 * Safe read/write helpers for ~/.openclaw/openclaw.json.
 * Preserve critical gateway sections so partial rewrites never disable chatCompletions.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { getOpenClawConfigPath, getOpenClawDir } from '../config/openclaw-paths.js';

/** Sections that must not disappear when Agent OS rewrites openclaw.json. */
const CRITICAL_SECTIONS = ['gateway', 'tools', 'plugins', 'browser'];

/** True when an AgentSystem model slug still points at this models.providers key. */
function providerStillReferenced(config, providerKey) {
  const key = String(providerKey || '').trim();
  if (!key) return false;
  const needle = `${key}/`;
  const hit = (slug) => {
    const s = String(slug || '').trim();
    return s === key || s.startsWith(needle);
  };
  const walk = (model) => {
    if (!model || typeof model !== 'object') return false;
    if (hit(model.primary)) return true;
    return Array.isArray(model.fallbacks) && model.fallbacks.some(hit);
  };
  if (walk(config?.agents?.defaults?.model)) return true;
  for (const entry of config?.agents?.list || []) {
    if (walk(entry?.model)) return true;
  }
  for (const entry of Object.values(config?.agents?.entries || {})) {
    if (walk(entry?.model)) return true;
  }
  return false;
}

function entriesToList(entries) {
  return Object.entries(entries || {}).map(([id, entry]) => ({ id, ...(entry || {}) }));
}

function listToEntries(list) {
  return Object.fromEntries(
    (list || []).map((entry) => {
      const { id, ...value } = entry || {};
      return [String(id || '').trim(), value];
    }).filter(([id]) => id)
  );
}

function readDiskConfig() {
  const path = getOpenClawConfigPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch (e) {
    console.warn('[openclaw-config] parse failed (will not wipe from disk):', e?.message || e);
    return null;
  }
}

/**
 * Merge missing critical sections from disk into nextConfig.
 * Also forces gateway.http.endpoints.chatCompletions.enabled when gateway is present.
 */
export function preserveOpenClawCriticalSections(nextConfig) {
  const c = nextConfig && typeof nextConfig === 'object' ? { ...nextConfig } : {};
  const prev = readDiskConfig();
  if (prev) {
    for (const key of CRITICAL_SECTIONS) {
      const cur = c[key];
      const empty =
        cur == null ||
        (typeof cur === 'object' && !Array.isArray(cur) && Object.keys(cur).length === 0);
      if (empty && prev[key] != null) {
        c[key] = prev[key];
        console.warn('[openclaw-config] restored missing section from disk: %s', key);
      }
    }
    if (!c.agents || typeof c.agents !== 'object') c.agents = prev.agents || { list: [] };
    if (!c.agents.defaults && prev.agents?.defaults) {
      c.agents = { ...c.agents, defaults: prev.agents.defaults };
      console.warn('[openclaw-config] restored agents.defaults from disk');
    }
    const prevProviders = prev.models?.providers;
    if (prevProviders && typeof prevProviders === 'object') {
      if (!c.models || typeof c.models !== 'object') c.models = { ...(prev.models || {}), providers: {} };
      if (!c.models.providers || typeof c.models.providers !== 'object') {
        c.models.providers = { ...prevProviders };
        console.warn('[openclaw-config] restored models.providers from disk');
      } else {
        for (const [k, v] of Object.entries(prevProviders)) {
          if (c.models.providers[k] == null && v != null) {
            if (String(k).startsWith('byok-') && !providerStillReferenced(c, k)) {
              console.info('[openclaw-config] skip restore unused byok provider %s', k);
              continue;
            }
            c.models.providers[k] = v;
            console.warn('[openclaw-config] restored missing models.providers.%s from disk', k);
          }
        }
      }
    }
  }

  // OpenClaw 2026.9 persists agents as an entries map, while existing Flolah
  // services operate on a list. Treat list as a compatibility view and always
  // write back in the schema already used on disk. This keeps every existing
  // org-sync/add/delete path working without allowing one writer to clobber
  // the runtime roster.
  if (prev?.agents?.entries && typeof prev.agents.entries === 'object') {
    if (!c.agents || typeof c.agents !== 'object') c.agents = {};
    if (Array.isArray(c.agents.list)) {
      c.agents.entries = listToEntries(c.agents.list);
      delete c.agents.list;
    } else if (!c.agents.entries) {
      c.agents.entries = { ...prev.agents.entries };
    }
    c.agents.ownership = 'explicit';
  }

  if (c.gateway && typeof c.gateway === 'object') {
    const gw = { ...c.gateway };
    const http = { ...(gw.http || {}) };
    const endpoints = { ...(http.endpoints || {}) };
    const chat = { ...(endpoints.chatCompletions || {}) };
    if (chat.enabled !== true) {
      chat.enabled = true;
      console.warn('[openclaw-config] forced gateway.http.endpoints.chatCompletions.enabled=true');
    }
    endpoints.chatCompletions = chat;
    http.endpoints = endpoints;
    gw.http = http;
    if (!gw.mode) gw.mode = 'local';
    if (!gw.port) gw.port = 18789;
    c.gateway = gw;
  }

  return c;
}

export function readOpenClawConfigSafe() {
  const disk = readDiskConfig();
  if (disk) {
    if (
      disk.agents?.entries &&
      typeof disk.agents.entries === 'object' &&
      !Array.isArray(disk.agents.list)
    ) {
      disk.agents.list = entriesToList(disk.agents.entries);
    }
    return disk;
  }
  return { agents: { list: [] }, channels: {}, bindings: [] };
}

export function writeOpenClawConfigSafe(config) {
  const dir = getOpenClawDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const prev = readDiskConfig();
  const merged = preserveOpenClawCriticalSections(config);
  const agents = merged?.agents;
  const hasAgents =
    agents &&
    typeof agents === 'object' &&
    (agents.defaults || Array.isArray(agents.list) || (agents.entries && typeof agents.entries === 'object'));
  if (!merged?.gateway || !hasAgents) {
    console.error(
      '[openclaw-config] refuse to write incomplete config (gateway=%s agents.defaults=%s list=%s)',
      Boolean(merged?.gateway),
      Boolean(agents?.defaults),
      Array.isArray(agents?.list) ? agents.list.length : 'n/a'
    );
    return prev || merged;
  }
  const path = getOpenClawConfigPath();
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

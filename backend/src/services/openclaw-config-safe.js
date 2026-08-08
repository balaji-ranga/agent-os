/**
 * Safe read/write helpers for ~/.openclaw/openclaw.json.
 * Preserve critical gateway sections so partial rewrites never disable chatCompletions.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { getOpenClawConfigPath, getOpenClawDir } from '../config/openclaw-paths.js';

/** Sections that must not disappear when Agent OS rewrites openclaw.json. */
const CRITICAL_SECTIONS = ['gateway', 'tools', 'plugins', 'browser'];

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
  if (disk) return disk;
  return { agents: { list: [] }, channels: {}, bindings: [] };
}

export function writeOpenClawConfigSafe(config) {
  const dir = getOpenClawDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const merged = preserveOpenClawCriticalSections(config);
  const path = getOpenClawConfigPath();
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}
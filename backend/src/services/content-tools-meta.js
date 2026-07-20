/**
 * Content tools metadata: read/write DB and write OpenClaw tools list file for the plugin.
 */
import { getDb } from '../db/schema.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getOpenClawDir } from '../config/openclaw-paths.js';

const OPENCLAW_DIR = getOpenClawDir();
const DEFAULT_TOOLS_LIST_PATH = join(OPENCLAW_DIR, 'agent-os-tools.json');

export function getToolsListPath() {
  return process.env.OPENCLAW_TOOLS_LIST_PATH || DEFAULT_TOOLS_LIST_PATH;
}

export function listToolsMeta() {
  const db = getDb();
  return db.prepare('SELECT name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin, created_at FROM content_tools_meta ORDER BY is_builtin DESC, name').all();
}

/** Enabled tools as a compact catalog for Workflow Builder / enquire. */
export function listEnabledContentTools() {
  return listToolsMeta()
    .filter((t) => t.enabled !== 0 && t.enabled !== false)
    .map((t) => ({
      name: t.name,
      display_name: t.display_name,
      endpoint: t.endpoint,
      method: t.method || 'POST',
      purpose: t.purpose || '',
      model_used: t.model_used || '',
      is_builtin: !!t.is_builtin,
    }));
}

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreContentToolMatch(tool, queryNorm, tokens) {
  const hay = normText([tool.name, tool.display_name, tool.purpose, tool.endpoint].join(' '));
  let score = 0;
  if (!queryNorm) return 0;
  if (hay.includes(queryNorm)) score += 10;
  if (normText(tool.name) === queryNorm) score += 12;
  if (normText(tool.name).includes(queryNorm)) score += 8;
  if (normText(tool.display_name).includes(queryNorm)) score += 7;
  if (normText(tool.purpose).includes(queryNorm)) score += 6;
  for (const t of tokens) {
    if (t.length < 2) continue;
    if (hay.includes(t)) score += 2;
  }
  return score;
}

/**
 * List or search content tools by natural language (name / display / purpose).
 * @param {string} query
 * @param {{ all?: boolean, limit?: number, enabledOnly?: boolean }} [opts]
 */
export function enquireContentTools(query, opts = {}) {
  const { all = false, enabledOnly = true } = opts;
  const hasLimit = Object.prototype.hasOwnProperty.call(opts, 'limit') && opts.limit != null && opts.limit !== '';
  const tools = enabledOnly
    ? listEnabledContentTools()
    : listToolsMeta().map((t) => ({
        name: t.name,
        display_name: t.display_name,
        endpoint: t.endpoint,
        method: t.method || 'POST',
        purpose: t.purpose || '',
        model_used: t.model_used || '',
        is_builtin: !!t.is_builtin,
        enabled: t.enabled !== 0 && t.enabled !== false,
      }));

  const queryNorm = normText(query);
  const tokens = queryNorm.split(/\s+/).filter(Boolean);
  const lim = Math.min(Math.max(Number(hasLimit ? opts.limit : all ? tools.length : 15) || 15, 1), 200);

  if (all || !queryNorm) {
    const slice = tools.slice(0, all && !hasLimit ? tools.length : lim);
    return {
      query: query || '',
      all: true,
      count: tools.length,
      tools: slice.map((t) => ({
        ...t,
        score: null,
        recommendation: t.purpose
          ? `Use \`${t.name}\` when: ${t.purpose}`
          : `Use \`${t.name}\` (${t.display_name})`,
      })),
    };
  }

  const ranked = tools
    .map((t) => {
      const score = scoreContentToolMatch(t, queryNorm, tokens);
      return {
        ...t,
        score,
        recommendation:
          score > 0
            ? `Recommended for "${query}": \`${t.name}\` — ${t.purpose || t.display_name}`
            : null,
      };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, lim);

  return {
    query: String(query || '').trim(),
    all: false,
    count: ranked.length,
    tools: ranked,
    top_recommendation: ranked[0]
      ? {
          name: ranked[0].name,
          display_name: ranked[0].display_name,
          purpose: ranked[0].purpose,
          score: ranked[0].score,
          how_to_use: `Add a workflow node with node_type "tool" and toolName "${ranked[0].name}" (or call the content tool directly when chatting with an agent that has it granted).`,
        }
      : null,
  };
}

export function getToolMeta(name) {
  const db = getDb();
  return db.prepare('SELECT name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin, created_at, auth_header FROM content_tools_meta WHERE name = ?').get(name);
}

export function updateToolMeta(name, patch) {
  const db = getDb();
  const allowed = ['display_name', 'endpoint', 'method', 'purpose', 'model_used', 'enabled', 'auth_header'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      if (key === 'enabled') {
        updates.push('enabled = ?');
        values.push(patch[key] ? 1 : 0);
      } else {
        updates.push(`${key} = ?`);
        values.push(patch[key]);
      }
    }
  }
  if (updates.length === 0) return getToolMeta(name);
  values.push(name);
  db.prepare(`UPDATE content_tools_meta SET ${updates.join(', ')} WHERE name = ?`).run(...values);
  writeOpenClawToolsList();
  return getToolMeta(name);
}

export function createToolMeta(record) {
  const db = getDb();
  const { name, display_name, endpoint, method = 'POST', purpose = '', model_used = '', auth_header = '' } = record;
  if (!name || !display_name || !endpoint) throw new Error('name, display_name, and endpoint are required');
  const normalized = name.trim().toLowerCase().replace(/\s+/g, '_');
  const auth = (auth_header || '').trim();
  db.prepare(
    `INSERT INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin, auth_header) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)`
  ).run(normalized, display_name.trim(), endpoint.trim(), method, purpose.trim(), (model_used || '').trim(), auth || null);
  writeOpenClawToolsList();
  return getToolMeta(normalized);
}

/**
 * Keep openclaw.plugin.json contracts.tools in sync so OpenClaw 2026.7+ can
 * discover tool ownership without loading plugin runtime.
 */
function syncContentToolsPluginContracts(toolNames) {
  const pluginPath = join(OPENCLAW_DIR, 'extensions', 'agent-os-content-tools', 'openclaw.plugin.json');
  if (!existsSync(pluginPath)) return;
  try {
    const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
    const names = (toolNames || []).filter((n) => typeof n === 'string' && n.trim());
    plugin.contracts = { ...(plugin.contracts || {}), tools: names };
    plugin.activation = { ...(plugin.activation || {}), onStartup: true };
    const toolMetadata = { ...(plugin.toolMetadata || {}) };
    for (const name of names) {
      toolMetadata[name] = { ...(toolMetadata[name] || {}), optional: true };
    }
    plugin.toolMetadata = toolMetadata;
    writeFileSync(pluginPath, JSON.stringify(plugin, null, 2), 'utf8');
  } catch (_) {
    /* best-effort; plugin still loads from tools list at runtime */
  }
}

/**
 * Keep openclaw.json tools.allow in sync so OpenClaw core does not strip
 * plugin tools that are granted per-agent but missing from the global allow list.
 */
function syncGlobalToolsAllow(toolNames) {
  const configPath = join(OPENCLAW_DIR, 'openclaw.json');
  if (!existsSync(configPath)) return;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.tools = config.tools || {};
    if (!Array.isArray(config.tools.allow)) config.tools.allow = [];
    let changed = false;
    for (const name of toolNames || []) {
      if (typeof name !== 'string' || !name.trim()) continue;
      if (!config.tools.allow.includes(name)) {
        config.tools.allow.push(name);
        changed = true;
      }
    }
    if (changed) writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (_) {
    /* best-effort */
  }
}

/**
 * Write enabled tools to a JSON file for the OpenClaw plugin to read.
 */
export function writeOpenClawToolsList() {
  const db = getDb();
  const rows = db.prepare('SELECT name, display_name, endpoint, method, purpose FROM content_tools_meta WHERE enabled = 1 ORDER BY is_builtin DESC, name').all();
  const path = getToolsListPath();
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(rows, null, 2), 'utf8');
  const names = rows.map((r) => r.name);
  syncContentToolsPluginContracts(names);
  syncGlobalToolsAllow(names);
}

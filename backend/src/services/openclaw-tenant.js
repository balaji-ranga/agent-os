/**
 * Per-CEO OpenClaw runtime identity + workspace isolation (single OpenClaw process).
 *
 * Logical agent (DB): balserve
 * Runtime OpenClaw id: t-{ceoUserId}--{baseOcId}
 * Workspace: {OPENCLAW_DIR}/tenants/{ceoUserId}/workspace-{baseOcId}
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/schema.js';
import { getOpenClawDir, getOpenClawConfigPath } from '../config/openclaw-paths.js';
import * as workspace from '../workspace/adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_TEMPLATES = join(__dirname, '..', '..', '..', 'openclaw-workspace-templates');
const NATIVE_OPENCLAW_TOOLS = new Set(['browser', 'image', 'cron', 'cron_add']);

function sanitizeIdPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function baseOcIdFromAgent(agent) {
  return String(agent?.openclaw_agent_id || agent?.id || '')
    .trim()
    .toLowerCase();
}

function grantsForAgentId(agentId) {
  return getDb()
    .prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? ORDER BY tool_name')
    .all(agentId)
    .map((r) => r.tool_name);
}

/** Runtime OpenClaw agent id for a CEO + logical agent. */
export function tenantOpenClawAgentId(ceoUserId, baseOpenClawId) {
  return `t-${sanitizeIdPart(ceoUserId)}--${sanitizeIdPart(baseOpenClawId)}`;
}

/** Parse `t-{ceo}--{base}` → { ceoUserId, baseOpenClawId } or null. */
export function parseTenantOpenClawAgentId(openClawAgentId) {
  const raw = String(openClawAgentId || '').trim().toLowerCase();
  const m = raw.match(/^t-(.+)--([a-z0-9_-]+)$/);
  if (!m) return null;
  return { ceoUserId: m[1], baseOpenClawId: m[2] };
}

export function tenantWorkspacePath(ceoUserId, baseOpenClawId) {
  return join(
    getOpenClawDir(),
    'tenants',
    sanitizeIdPart(ceoUserId),
    `workspace-${sanitizeIdPart(baseOpenClawId)}`
  );
}

export function baseOpenClawAgentIdForAgent(agent) {
  return baseOcIdFromAgent(agent);
}

function readOpenClawConfig() {
  const path = getOpenClawConfigPath();
  if (!existsSync(path)) return { agents: { list: [] } };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { agents: { list: [] } };
  }
}

function writeOpenClawConfig(config) {
  const dir = getOpenClawDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getOpenClawConfigPath(), JSON.stringify(config, null, 2), 'utf8');
}

function copyTemplateWorkspace(baseId, destDir) {
  const candidates = [join(REPO_TEMPLATES, baseId), join(REPO_TEMPLATES, 'balserve')];
  const src = candidates.find((p) => existsSync(p));
  mkdirSync(destDir, { recursive: true });
  if (!src) return;
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(destDir, name);
    if (!existsSync(to)) cpSync(from, to, { recursive: true });
  }
}

/** Keep COO/agent skill docs in sync — OpenClaw may seed a stub TOOLS.md that hides API tools. */
function syncEssentialWorkspaceDocs(baseId, destDir) {
  const candidates = [join(REPO_TEMPLATES, baseId), join(REPO_TEMPLATES, 'balserve')];
  const src = candidates.find((p) => existsSync(p));
  if (!src) return;
  mkdirSync(destDir, { recursive: true });
  for (const name of ['TOOLS.md', 'AGENTS.md', 'SOUL.md', 'MEMORY.md', 'IDENTITY.md']) {
    const from = join(src, name);
    if (!existsSync(from)) continue;
    const to = join(destDir, name);
    let shouldWrite = !existsSync(to);
    if (!shouldWrite) {
      try {
        const existing = readFileSync(to, 'utf8');
        const looksLikeStub =
          /Local Notes|Who Am I\?|Fill this in during your first conversation|You're not a chatbot\. You're becoming someone/i.test(
            existing
          ) ||
          (name === 'TOOLS.md' &&
            !/agent_workflow_list|kanban_move_status|Granted tools/i.test(existing) &&
            existing.length < 2000) ||
          (name === 'SOUL.md' && !/BalServe|COO/i.test(existing)) ||
          (name === 'AGENTS.md' && !/Operating contract|COO/i.test(existing));
        // Always keep TOOLS/AGENTS/SOUL aligned with product templates for standard agents
        shouldWrite =
          looksLikeStub ||
          name === 'TOOLS.md' ||
          name === 'AGENTS.md' ||
          name === 'SOUL.md';
      } catch {
        shouldWrite = true;
      }
    }
    if (shouldWrite) cpSync(from, to, { recursive: true });
  }
}

function mergeNativeTools(existingAllow = [], contentGrants = []) {
  const merged = [...new Set([...(existingAllow || []), ...contentGrants, ...NATIVE_OPENCLAW_TOOLS])];
  return merged.filter((t) => t !== 'image');
}

/**
 * Ensure per-CEO OpenClaw agent + isolated workspace exist; return runtime ids.
 * Idempotent — safe on every chat.
 */
export function ensureTenantOpenClawAgent(agent, ceoUserId) {
  if (!agent?.id) throw new Error('agent required');
  if (!ceoUserId) throw new Error('ceoUserId required');

  const baseOcId = baseOcIdFromAgent(agent);
  const runtimeOcId = tenantOpenClawAgentId(ceoUserId, baseOcId);
  const workspacePath = tenantWorkspacePath(ceoUserId, baseOcId);
  const workspacePosix = workspacePath.replace(/\\/g, '/');

  if (!existsSync(workspacePath) || readdirSync(workspacePath).length === 0) {
    copyTemplateWorkspace(baseOcId, workspacePath);
  } else {
    mkdirSync(workspacePath, { recursive: true });
  }
  syncEssentialWorkspaceDocs(baseOcId, workspacePath);

  const grants = grantsForAgentId(agent.id);
  const config = readOpenClawConfig();
  if (!Array.isArray(config.agents?.list)) config.agents = { list: [] };

  let entry = config.agents.list.find((a) => String(a.id || '').toLowerCase() === runtimeOcId);
  if (!entry) {
    entry = {
      id: runtimeOcId,
      name: `${agent.name || baseOcId} (${ceoUserId})`,
      workspace: workspacePosix,
      tools: { allow: [], deny: ['image'] },
    };
    config.agents.list.push(entry);
  } else {
    entry.workspace = workspacePosix;
    entry.name = entry.name || `${agent.name || baseOcId} (${ceoUserId})`;
  }
  entry.tools = entry.tools || {};
  entry.tools.allow = mergeNativeTools(entry.tools.allow, grants);
  if (!entry.tools.deny) entry.tools.deny = ['image'];
  writeOpenClawConfig(config);

  const allowPath = join(getOpenClawDir(), 'agent-tool-allowlists.json');
  let allow = {};
  if (existsSync(allowPath)) {
    try {
      allow = JSON.parse(readFileSync(allowPath, 'utf8'));
    } catch {
      allow = {};
    }
  }
  allow[runtimeOcId] = grants;
  writeFileSync(allowPath, JSON.stringify(allow, null, 2), 'utf8');

  return {
    agentId: agent.id,
    ceoUserId: String(ceoUserId),
    baseOpenClawId: baseOcId,
    openclawAgentId: runtimeOcId,
    workspacePath,
  };
}

/** Resolve DB agent row from a runtime or logical OpenClaw agent id. */
export function resolveAgentFromOpenClawCallerId(callerId) {
  if (!callerId) return null;
  const db = getDb();
  const parsed = parseTenantOpenClawAgentId(callerId);
  const key = parsed ? parsed.baseOpenClawId : callerId;
  return (
    db
      .prepare(
        `SELECT * FROM agents
         WHERE LOWER(id) = LOWER(?) OR LOWER(openclaw_agent_id) = LOWER(?)`
      )
      .get(key, key) || null
  );
}

/**
 * Expand allowlists with every CEO×agent grant (tenant runtime keys).
 * Preserves any legacy base keys already in `baseAllowlists`.
 */
export function syncTenantAllowlists(baseAllowlists = {}) {
  const db = getDb();
  const out = { ...baseAllowlists };
  const rows = db
    .prepare(
      `SELECT ua.user_id, a.id AS agent_id, a.openclaw_agent_id
       FROM user_agents ua
       JOIN agents a ON a.id = ua.agent_id
       WHERE ua.enabled = 1`
    )
    .all();

  for (const row of rows) {
    const grants = grantsForAgentId(row.agent_id);
    if (!grants.length) continue;
    const base = baseOcIdFromAgent({
      id: row.agent_id,
      openclaw_agent_id: row.openclaw_agent_id,
    });
    out[tenantOpenClawAgentId(row.user_id, base)] = grants;
  }
  return out;
}

export async function writeTenantToolsMd(agent, ceoUserId, buildToolsMdContent) {
  const ensured = ensureTenantOpenClawAgent(agent, ceoUserId);
  const grants = grantsForAgentId(agent.id);
  const text =
    typeof buildToolsMdContent === 'function'
      ? buildToolsMdContent(grants)
      : `# TOOLS\n\n${grants.map((g) => `- ${g}`).join('\n')}\n`;
  await workspace.writeWorkspaceFile('tools', text, { workspaceRoot: ensured.workspacePath });
  return { ...ensured, toolsMd: text };
}

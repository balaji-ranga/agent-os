/**
 * Per-agent content tool grants — DB source of truth, hot-sync to OpenClaw without gateway restart.
 * - agent_tool_grants table
 * - ~/.openclaw/agent-tool-allowlists.json (plugin reads on each tool factory call)
 * - openclaw.json agents.list[].tools.allow (persistence / fallback)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/schema.js';
import * as meta from './content-tools-meta.js';
import * as workspace from '../workspace/adapter.js';
import { getOpenClawDir, getOpenClawConfigPath } from '../config/openclaw-paths.js';
import {
  parseTenantOpenClawAgentId,
  resolveAgentFromOpenClawCallerId,
  syncTenantAllowlists,
  ensureTenantOpenClawAgent,
} from './openclaw-tenant.js';
import { COO_CONTENT_TOOLS_ALLOW } from '../lib/content-tools-allow.js';
import { readOpenClawConfigSafe, writeOpenClawConfigSafe } from './openclaw-config-safe.js';
import {
  NATIVE_OPENCLAW_TOOLS as NATIVE_OPENCLAW_TOOLS_LIST,
  mergeOpenClawAllowList,
} from './openclaw-runtime-tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_TEMPLATES = join(__dirname, '..', '..', '..', 'openclaw-workspace-templates');

const OPENCLAW_DIR = getOpenClawDir();
const CONFIG_PATH = getOpenClawConfigPath();
const ALLOWLISTS_PATH = join(OPENCLAW_DIR, 'agent-tool-allowlists.json');
const home = process.env.USERPROFILE || process.env.HOME || '';

const NATIVE_OPENCLAW_TOOLS = new Set(NATIVE_OPENCLAW_TOOLS_LIST);
export const MANDATORY_AGENT_EVIDENCE_TOOLS = Object.freeze([
  'agent_work_history',
  'company_objectives_query',
  'objective_deviation_record',
]);

function readConfig() {
  const c = readOpenClawConfigSafe();
  if (!c.agents) c.agents = { list: [] };
  if (!c.tools) c.tools = { allow: [] };
  return c;
}

function writeConfig(config) {
  writeOpenClawConfigSafe(config);
}

export function resolveOpenClawAgentId(agent) {
  return String(agent?.openclaw_agent_id || agent?.id || '').trim().toLowerCase();
}

function contentToolNamesSet() {
  return new Set(meta.listToolsMeta().map((t) => t.name));
}

export function grantCooDelegationToolsIfMissing() {
  const db = getDb();
  const coo = db.prepare('SELECT id FROM agents WHERE is_coo = 1 LIMIT 1').get();
  if (!coo) return 0;
  const existing = new Set(getAgentToolGrants(coo.id));
  let added = 0;
  const ins = db.prepare('INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)');
  for (const tool of COO_CONTENT_TOOLS_ALLOW) {
    if (!existing.has(tool)) {
      ins.run(coo.id, tool);
      added += 1;
    }
  }
  if (added) syncAllowlistsFile();
  return added;
}

export function grantOrchestratorGoalToolsIfMissing() {
  const db = getDb();
  const orchestrators = db
    .prepare(`SELECT id FROM agents WHERE COALESCE(is_orchestrator, 0) = 1 OR is_coo = 1`)
    .all();
  const tools = ['agent_goal_create', 'agent_goal_list', 'agent_goal_status', 'agent_goal_complete_step', 'intent_classify_and_delegate'];
  const available = contentToolNamesSet();
  const ins = db.prepare('INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)');
  let added = 0;
  for (const agent of orchestrators) {
    for (const tool of tools) {
      if (!available.has(tool)) continue;
      const out = ins.run(agent.id, tool);
      added += Number(out.changes || 0);
    }
  }
  if (added) syncAllowlistsFile();
  return added;
}

export function getAgentToolGrants(agentId) {
  const db = getDb();
  return db
    .prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? ORDER BY tool_name')
    .all(agentId)
    .map((r) => r.tool_name);
}

function openClawAllowForAgent(ocId) {
  const config = readConfig();
  const entry = (config.agents?.list || []).find((a) => String(a.id || '').toLowerCase() === String(ocId).toLowerCase());
  return Array.isArray(entry?.tools?.allow) ? entry.tools.allow : null;
}

export function isToolGrantedToAgent(agentOpenClawId, toolName) {
  if (!agentOpenClawId || !toolName) return false;
  if (NATIVE_OPENCLAW_TOOLS.has(toolName)) return true;
  const allowlists = readAllowlistsFile();
  const key = String(agentOpenClawId).toLowerCase();
  const list = allowlists[key];
  if (Array.isArray(list)) return list.includes(toolName);
  const fromConfig = openClawAllowForAgent(key);
  if (Array.isArray(fromConfig)) return fromConfig.includes(toolName);
  return false;
}

/** Enforce per-agent grants on /api/tools/invoke (skip when caller is unknown non-tenant). */
export function assertCallerMayUseTool(source, toolName) {
  if (!source || !toolName) return { ok: true };
  if (NATIVE_OPENCLAW_TOOLS.has(toolName)) return { ok: true };

  const parsed = parseTenantOpenClawAgentId(source);
  const caller = resolveAgentFromOpenClawCallerId(source);

  if (parsed) {
    if (!caller) {
      return { ok: false, error: `Unknown tenant AgentSystem agent "${source}"` };
    }
    const entitled = getDb()
      .prepare(
        `SELECT 1 AS ok FROM user_agents WHERE user_id = ? AND agent_id = ? AND enabled = 1`
      )
      .get(parsed.ceoUserId, caller.id);
    if (!entitled) {
      return {
        ok: false,
        error: `Agent "${caller.id}" is not granted to tenant "${parsed.ceoUserId}"`,
      };
    }
    if (isToolGrantedToAgent(source, toolName)) return { ok: true };
    if (getAgentToolGrants(caller.id).includes(toolName)) return { ok: true };
    return { ok: false, error: `Tool "${toolName}" is not granted to agent "${source}"` };
  }

  if (!caller) return { ok: true };
  const ocId = resolveOpenClawAgentId(caller);
  if (isToolGrantedToAgent(ocId, toolName) || isToolGrantedToAgent(source, toolName)) return { ok: true };
  if (getAgentToolGrants(caller.id).includes(toolName)) return { ok: true };
  return { ok: false, error: `Tool "${toolName}" is not granted to agent "${ocId}"` };
}

export function readAllowlistsFile() {
  if (!existsSync(ALLOWLISTS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(ALLOWLISTS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** Write hot-reload file consumed by the OpenClaw plugin (no gateway restart). */
export function syncAllowlistsFile() {
  const db = getDb();
  const agents = db.prepare('SELECT id, openclaw_agent_id FROM agents').all();
  let out = {};
  for (const a of agents) {
    const grants = getAgentToolGrants(a.id);
    if (!grants.length) continue;
    const ocId = resolveOpenClawAgentId(a);
    if (ocId) out[ocId] = prioritizeCoreAgentTools(grants);
  }
  out = syncTenantAllowlists(out);
  if (!existsSync(OPENCLAW_DIR)) mkdirSync(OPENCLAW_DIR, { recursive: true });
  writeFileSync(ALLOWLISTS_PATH, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

/** Keep multi-intent goal tools near the front of allow lists (visibility under tool caps). */
const CORE_PRIORITY_TOOLS = [
  'company_objectives_query',
  'objective_deviation_record',
  'company_goal_link_objective',
  'agent_goal_create',
  'agent_goal_list',
  'agent_goal_status',
  'agent_goal_complete_step',
  'agent_workflow_list',
  'agent_workflow_enquire',
  'agent_workflow_trigger',
  'agent_workflow_runs',
  'agent_workflow_watch',
  'agent_workflow_watch_tick',
  'notify_ceo',
];

function prioritizeCoreAgentTools(names = []) {
  const list = [...new Set((names || []).map((t) => String(t)))];
  const rank = new Map(CORE_PRIORITY_TOOLS.map((t, i) => [t, i]));
  return list.sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : 1000;
    const rb = rank.has(b) ? rank.get(b) : 1000;
    return ra - rb || a.localeCompare(b);
  });
}

function mergeNativeTools(existingAllow = [], contentGrants = []) {
  return prioritizeCoreAgentTools(
    mergeOpenClawAllowList(existingAllow, contentGrants, { dropImage: true, dropBrowser: true })
  );
}

/** Preserve an explicitly enabled native browser without granting it to new agents. */
export function mergeAgentRuntimeAllowlist(existingAllow = [], contentGrants = []) {
  const merged = mergeNativeTools(existingAllow, contentGrants);
  const hadBrowser = (existingAllow || []).some((t) => String(t) === 'browser');
  return hadBrowser ? prioritizeCoreAgentTools([...merged, 'browser']) : merged;
}

export function syncOpenClawJsonForAgent(agent) {
  const ocId = resolveOpenClawAgentId(agent);
  if (!ocId) return null;
  const cdpId = String(process.env.BROWSER_TASK_CDP_AGENT_ID || 'browser-cdp').trim().toLowerCase() || 'browser-cdp';
  if (ocId === cdpId || ocId.endsWith(`--${cdpId}`)) {
    // Backend CDP runner uses profile + alsoAllow (no tools.allow). Never overwrite.
    return null;
  }
  const grants = getAgentToolGrants(agent.id);
  const config = readConfig();
  if (!Array.isArray(config.agents?.list)) config.agents = { list: [] };
  let entry = config.agents.list.find((a) => String(a.id || '').toLowerCase() === ocId);
  if (!entry) {
    entry = {
      id: ocId,
      name: agent.name || ocId,
      workspace: agent.workspace_path || join(OPENCLAW_DIR, `workspace-${ocId}`).replace(/\\/g, '/'),
    };
    config.agents.list.push(entry);
  }
  const prevAllow = Array.isArray(entry.tools?.allow) ? entry.tools.allow : [];
  entry.tools = entry.tools || {};
  entry.tools.allow = mergeAgentRuntimeAllowlist(prevAllow, grants);
  delete entry.tools.alsoAllow;
  if (!entry.tools.deny) entry.tools.deny = ['image'];
  writeConfig(config);
  return entry.tools.allow;
}

/** Import grants from openclaw.json when DB has none for an agent. */
export function importGrantsFromOpenClawConfig() {
  const config = readConfig();
  const db = getDb();
  const agents = db.prepare('SELECT * FROM agents').all();
  const contentSet = contentToolNamesSet();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let imported = 0;
  for (const agent of agents) {
    const existing = getAgentToolGrants(agent.id);
    if (existing.length) continue;
    const ocId = resolveOpenClawAgentId(agent);
    const entry = (config.agents?.list || []).find((a) => String(a.id || '').toLowerCase() === ocId);
    const allow = entry?.tools?.allow || [];
    for (const t of allow) {
      if (contentSet.has(t)) {
        ins.run(agent.id, t);
        imported++;
      }
    }
  }
  if (imported) syncAllowlistsFile();
  return imported;
}

/** COO / Workflow Builder workflow-orchestration tools — specialists must not hold these (API rejects them). Goal plan tools (agent_goal_*) are grant-gated instead. */
const COO_OR_WORKFLOW_BUILDER_TOOLS = [
  'agent_workflow_list',
  'agent_workflow_enquire',
  'agent_workflow_trigger',
  'agent_workflow_runs',
  'agent_workflow_watch',
  'agent_workflow_watch_tick',
  'agent_workflow_retry',
];

/** Content Orchestrator (video_content pack) may keep these owner-scoped workflow tools. */
export const VIDEO_CONTENT_ORCHESTRATOR_WORKFLOW_TOOLS = [
  'agent_workflow_list',
  'agent_workflow_enquire',
  'agent_workflow_trigger',
  'agent_workflow_runs',
  'agent_workflow_watch',
];

const WORKFLOW_BUILDER_ONLY_TOOLS = [
  'agent_workflow_get_draft',
  'agent_workflow_mutate',
  'agent_workflow_certify_start',
  'agent_workflow_certify_status',
  'agent_workflow_certify_resume',
];

/** Video Content Orchestrator — chat front door for storyboard workflows (not COO / WFB). */
export function isVideoContentOrchestratorAgent(agent) {
  if (!agent) return false;
  const id = String(agent.id || agent.openclaw_agent_id || '')
    .trim()
    .toLowerCase();
  const name = String(agent.name || '')
    .trim()
    .toLowerCase();
  if (id.startsWith('video-orch-') || id.includes('video-orchestrator')) return true;
  if (name === 'content orchestrator' || /^content\s+orchestrator\b/.test(name)) return true;
  return false;
}

/**
 * Strip role-restricted tools: workflow catalog/trigger tools from unauthorized
 * agents, plus every registry tool declared "COO only" from non-COO agents.
 * Prevents a stale blueprint/grant from advertising a tool its API will reject.
 */
export function revokeUnauthorizedWorkflowToolGrants() {
  const db = getDb();
  const agents = db.prepare('SELECT id, name, is_coo FROM agents').all();
  const del = db.prepare('DELETE FROM agent_tool_grants WHERE agent_id = ? AND tool_name = ?');
  const cooOnlyTools = meta.listToolsMeta()
    .filter((t) => /\bCOO\s+only\b/i.test(String(t.purpose || '')))
    .map((t) => t.name);
  const orchAllow = new Set(VIDEO_CONTENT_ORCHESTRATOR_WORKFLOW_TOOLS);
  let revoked = 0;
  for (const agent of agents) {
    const id = String(agent.id || '').toLowerCase();
    const isCoo = !!agent.is_coo;
    const isWfb = id === 'workflowbuilder';
    const isVideoOrch = isVideoContentOrchestratorAgent(agent);
    const strip = [];
    if (!isCoo && !isWfb) {
      if (isVideoOrch) {
        strip.push(...COO_OR_WORKFLOW_BUILDER_TOOLS.filter((t) => !orchAllow.has(t)));
      } else {
        strip.push(...COO_OR_WORKFLOW_BUILDER_TOOLS);
      }
    }
    if (!isWfb) strip.push(...WORKFLOW_BUILDER_ONLY_TOOLS);
    if (!isCoo) strip.push(...cooOnlyTools);
    for (const tool of strip) {
      const r = del.run(agent.id, tool);
      if (r.changes) revoked += 1;
    }
  }
  if (revoked) syncAllowlistsFile();
  return revoked;
}

export function listToolsCatalogForAgent(agentId) {
  const granted = new Set(getAgentToolGrants(agentId));
  return meta
    .listToolsMeta()
    .filter((t) => t.enabled)
    .map((t) => ({
      name: t.name,
      display_name: t.display_name,
      purpose: t.purpose,
      is_builtin: !!t.is_builtin,
      granted: granted.has(t.name),
    }));
}

export function setAgentToolGrants(agent, toolNames) {
  const db = getDb();
  const contentSet = contentToolNamesSet();
  const cooOnlyTools = new Set(
    meta.listToolsMeta()
      .filter((t) => /\bCOO\s+only\b/i.test(String(t.purpose || '')))
      .map((t) => t.name)
  );
  const normalized = [...new Set(
    [...(toolNames || []), ...MANDATORY_AGENT_EVIDENCE_TOOLS]
      .map((t) => String(t).trim())
      .filter((t) => contentSet.has(t))
      .filter((t) => !!agent?.is_coo || !cooOnlyTools.has(t))
  )];
  db.prepare('DELETE FROM agent_tool_grants WHERE agent_id = ?').run(agent.id);
  const ins = db.prepare('INSERT INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)');
  for (const t of normalized) ins.run(agent.id, t);
  syncAllowlistsFile();
  const allow = syncOpenClawJsonForAgent(agent);
  // Refresh tenant runtime projections for CEOs that have this agent
  const ceos = db
    .prepare(`SELECT user_id FROM user_agents WHERE agent_id = ? AND enabled = 1`)
    .all(agent.id);
  for (const { user_id } of ceos) {
    try {
      ensureTenantOpenClawAgent(agent, user_id);
    } catch (_) {}
  }
  return { grants: normalized, openclaw_allow: allow };
}

/** Build TOOLS.md body from granted tools + optional template extras. */
export function buildToolsMdContent(grantedToolNames) {
  const lines = [
    '# TOOLS — Agent OS tools',
    '',
    'When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or run as shell commands.',
    '',
    '---',
    '',
    '## Granted tools',
    '',
  ];
  const metaByName = Object.fromEntries(meta.listToolsMeta().map((t) => [t.name, t]));
  for (const name of grantedToolNames.sort()) {
    const t = metaByName[name];
    if (!t) continue;
    const label = t.display_name || name;
    const purpose = (t.purpose || '').split('.')[0];
    lines.push(`- **${name}** — ${label}${purpose ? `: ${purpose}` : ''}`);
  }
  lines.push(
    '',
    '---',
    '',
    '## Choosing the right tool',
    '',
    '- **Match the tool to the request:** Read the user\'s message and choose the tool whose purpose best fits.',
    '- **If a tool\'s result is not good enough:** Try the next most relevant granted tool before giving up.',
    '- **Evidence is mandatory:** For factual, historical, external-action, API, browser, workflow, CRM, or ERP outcomes, call the relevant granted tool and base the answer on its returned evidence. Never use memory as proof.',
    '- **Status/work history:** Call `agent_work_history` with the requested `days`. Use the returned `evidence_id`, counts, and items. Do not substitute `learnings_summary` or communications history.',
    '- **Objective alignment:** Before non-trivial work, call `company_objectives_query` with `{ "status": "active" }`. Use the returned objective, key-result, initiative, scheduled-goal, and goal-plan IDs as evidence; do not delegate an objective lookup to another agent.',
    '- **Objective linkage:** If the user explicitly asks to link a goal, preserve their objective/initiative IDs. COO/orchestrator calls `company_goal_link_objective` with `goal_run_id`, `objective_id`, optional `initiative_id`, and optional `key_result_ids`.',
    '- **Deviations:** If a request materially departs from active objectives or initiatives, call `objective_deviation_record` with the exact request and rationale, then continue. This audit is non-blocking. Never claim it was recorded unless the tool returns `ok: true` together with the table/row and `recorded_at` evidence.',
    '- **Completion:** Include material tool evidence or record/execution identifiers in the deliverable. Writing-only work is evidenced by the concrete returned content itself.',
    '',
    '---',
    '',
    '## Browser automation (OpenClaw + Playwright)',
    '',
    'You have the **browser** tool when enabled in AgentSystem config.',
    '',
    '- **Always use `profile="openclaw"`** for managed Playwright/Chromium.',
    ''
  );
  return lines.join('\n');
}

export async function writeAgentToolsMd(agent, grantedToolNames) {
  const root = workspace.resolveAgentWorkspaceRoot(agent, { healDb: false });
  const text = buildToolsMdContent(grantedToolNames);
  await workspace.writeWorkspaceFile('tools', text, { workspaceRoot: root });
  return text;
}

export async function syncToolsMdFromTemplate(agent, templateId = null) {
  const tid = templateId || agent.id;
  let templatePath = join(REPO_TEMPLATES, tid, 'TOOLS.md');
  if (!existsSync(templatePath)) templatePath = join(REPO_TEMPLATES, 'balserve', 'TOOLS.md');
  if (!existsSync(templatePath)) throw new Error(`No TOOLS.md template for ${tid}`);
  const text = readFileSync(templatePath, 'utf8');
  const root = workspace.resolveAgentWorkspaceRoot(agent, { healDb: false });
  await workspace.writeWorkspaceFile('tools', text, { workspaceRoot: root });
  return text;
}

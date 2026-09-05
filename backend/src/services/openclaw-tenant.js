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
import {
  applyByokModelToAgentEntry,
  applyByokAuthToProvisionedAgent,
  ensureByokProviderInConfig,
} from './user-llm-settings.js';
import { COO_CONTENT_TOOLS_ALLOW } from '../lib/content-tools-allow.js';
import { syncOrgContextToWorkspace, isGeneratedCooAgentsMd } from './org-context.js';
import { readOpenClawConfigSafe, writeOpenClawConfigSafe } from './openclaw-config-safe.js';
import { resolveWorkspaceTemplateBaseId } from './company-blueprints/standard-prefabs.js';
import {
  NATIVE_OPENCLAW_TOOLS as NATIVE_OPENCLAW_TOOLS_LIST,
  mergeOpenClawAllowList,
} from './openclaw-runtime-tools.js';
import { applyIdentityNameToAgentEntry } from '../../../scripts/lib/openclaw-whatsapp-from-prefix.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_TEMPLATES = join(__dirname, '..', '..', '..', 'openclaw-workspace-templates');
const NATIVE_OPENCLAW_TOOLS = new Set(NATIVE_OPENCLAW_TOOLS_LIST);

function sanitizeIdPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

export function baseOcIdFromAgent(agent) {
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

/** OpenClaw sessions_send / sessions_history key for a CEO-scoped agent. */
export function tenantSessionKeyForAgent(ceoUserId, agentOrBaseId) {
  const base =
    typeof agentOrBaseId === 'string'
      ? agentOrBaseId
      : agentOrBaseId?.openclaw_agent_id || agentOrBaseId?.id;
  return `agent::${tenantOpenClawAgentId(ceoUserId, base)}:main`;
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
  const c = readOpenClawConfigSafe();
  if (!c.agents) c.agents = { list: [] };
  return c;
}

function writeOpenClawConfig(config) {
  writeOpenClawConfigSafe(config);
}

function copyTemplateWorkspace(baseId, destDir) {
  const ownTpl = join(REPO_TEMPLATES, baseId);
  const hasOwnTemplate = existsSync(ownTpl);
  const src = hasOwnTemplate ? ownTpl : join(REPO_TEMPLATES, 'balserve');
  mkdirSync(destDir, { recursive: true });
  if (!existsSync(src)) return;
  // Custom agents without a product template must not inherit BalServe COO identity files.
  const skipIdentity = !hasOwnTemplate
    ? new Set(['SOUL.md', 'MEMORY.md', 'IDENTITY.md', 'soul.md', 'memory.md', 'identity.md'])
    : null;
  for (const name of readdirSync(src)) {
    if (skipIdentity?.has(name)) continue;
    const from = join(src, name);
    const to = join(destDir, name);
    if (!existsSync(to)) cpSync(from, to, { recursive: true });
  }
  copySharedDomainKnowledge(baseId, destDir);
}

const EVIDENCE_GUIDANCE_START = '<!-- FLOLAH_EVIDENCE_POLICY_START -->';
const EVIDENCE_GUIDANCE_END = '<!-- FLOLAH_EVIDENCE_POLICY_END -->';

function upsertEvidenceGuidance(filePath, body) {
  if (!existsSync(filePath)) return;
  const current = readFileSync(filePath, 'utf8');
  const block = `${EVIDENCE_GUIDANCE_START}\n${body.trim()}\n${EVIDENCE_GUIDANCE_END}`;
  const start = current.indexOf(EVIDENCE_GUIDANCE_START);
  const end = current.indexOf(EVIDENCE_GUIDANCE_END);
  const next = start >= 0 && end >= start
    ? `${current.slice(0, start)}${block}${current.slice(end + EVIDENCE_GUIDANCE_END.length)}`
    : `${current.trimEnd()}\n\n${block}\n`;
  if (next !== current) writeFileSync(filePath, next, 'utf8');
}

/** Every runtime workspace receives the evidence rule even when its role pack is custom. */
export function syncEvidenceGuidance(destDir) {
  upsertEvidenceGuidance(join(destDir, 'TOOLS.md'), `## Evidence tools\n\n- **agent_work_history** — For reports about your own prior work, call with the requested \`days\` and report its \`evidence_id\`, counts, and material items.\n- Factual, historical, API, browser, workflow, CRM, ERP, and external-action outcomes require current-run tool evidence. Include material evidence/record/run/artifact identifiers. Never use memory, learnings, or Kanban status as proof.`);
  upsertEvidenceGuidance(join(destDir, 'AGENTS.md'), `## Mandatory evidence contract\n\nEvery goal or task outcome must be evidence-backed. Invoke the relevant granted tool yourself; the goal executor will not call agent-specific tools merely to manufacture evidence. For status/work-history requests call \`agent_work_history\`. If required evidence is unavailable, report the precise blocker and do not claim completion. Follow **AGENT-OS-OPS.md**.`);
}

/** Keep standard-agent skill docs in sync. Never overwrite custom-agent identity with balserve. */
export function syncEssentialWorkspaceDocs(baseId, destDir) {
  const ownTpl = join(REPO_TEMPLATES, baseId);
  const hasOwnTemplate = existsSync(ownTpl);

  // Shared ops doc is platform-owned (not agent-editable) and every TOOLS.md points at it,
  // so refresh it for custom agents too — before the no-template bail-out below.
  const sharedOps = join(REPO_TEMPLATES, '_shared', 'AGENT-OS-OPS.md');
  if (existsSync(sharedOps)) {
    try {
      mkdirSync(destDir, { recursive: true });
      cpSync(sharedOps, join(destDir, 'AGENT-OS-OPS.md'), { recursive: true });
    } catch {
      /* non-fatal — agent still has TOOLS.md guidance */
    }
  }
  copySharedDomainKnowledge(baseId, destDir);
  syncEvidenceGuidance(destDir);

  // No agent-specific template ⇒ custom/onboarded agent. Do not sync from balserve fallback.
  if (!hasOwnTemplate) return;

  const src = ownTpl;
  // Platform Help is platform-owned product desk copy — force full MD bundle so every tenant
  // receives answer-first help rules (not only TOOLS/AGENTS).
  const forceIdentityBundle = String(baseId || '').toLowerCase() === 'platformhelp';
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
            existing.length < 2000);
        // Refresh product TOOLS/AGENTS for standard templates; SOUL/MEMORY usually left alone
        // (except platformhelp — force full desk guidance for all CEOs).
        shouldWrite =
          looksLikeStub ||
          name === 'TOOLS.md' ||
          name === 'AGENTS.md' ||
          (forceIdentityBundle && (name === 'SOUL.md' || name === 'MEMORY.md' || name === 'IDENTITY.md'));
        // Product-template employees (not COO): keep SOUL/MEMORY aligned when the file still
        // uses the template title (operators have not customized identity).
        if (
          !shouldWrite &&
          (name === 'SOUL.md' || name === 'MEMORY.md') &&
          String(baseId || '').toLowerCase() !== 'balserve'
        ) {
          try {
            const tpl = readFileSync(from, 'utf8');
            const tplTitle = (tpl.match(/^#\s+.+$/m) || [''])[0].trim();
            if (tplTitle && existing.includes(tplTitle.slice(0, Math.min(40, tplTitle.length)))) {
              shouldWrite = true;
            }
          } catch {
            /* keep existing */
          }
        }
        // The COO's AGENTS.md is generated from the live org (internal agents + external/A2A leaf
        // members). The template only carries a fixed internal list, so copying it over would drop
        // every leaf member from the delegation table until the next org sync.
        if (name === 'AGENTS.md' && isGeneratedCooAgentsMd(existing)) shouldWrite = false;
      } catch {
        shouldWrite = true;
      }
    }
    if (shouldWrite) cpSync(from, to, { recursive: true });
  }
  syncEvidenceGuidance(destDir);
}

/**
 * Admin / ops: force-copy template MD files into a tenant workspace.
 * @param {string} baseId - template folder name (balserve, workflowbuilder, platformhelp, …)
 * @param {string} destDir - tenant workspace path
 * @param {{ forceIdentity?: boolean }} [opts] - when true, also overwrite SOUL/MEMORY/IDENTITY
 */
export function forcePushTemplateDocs(baseId, destDir, { forceIdentity = true } = {}) {
  const ownTpl = join(REPO_TEMPLATES, baseId);
  if (!existsSync(ownTpl)) {
    throw new Error(`No workspace template for agent "${baseId}"`);
  }
  mkdirSync(destDir, { recursive: true });
  const names = ['TOOLS.md', 'AGENTS.md'];
  if (forceIdentity) names.push('SOUL.md', 'MEMORY.md', 'IDENTITY.md');
  const copied = [];
  for (const name of names) {
    const from = join(ownTpl, name);
    if (!existsSync(from)) continue;
    const to = join(destDir, name);
    cpSync(from, to, { recursive: true });
    copied.push(name);
  }
  // Shared ops doc (Kanban / learnings / summarize_url) — always refresh when present
  const sharedOps = join(REPO_TEMPLATES, '_shared', 'AGENT-OS-OPS.md');
  if (existsSync(sharedOps)) {
    cpSync(sharedOps, join(destDir, 'AGENT-OS-OPS.md'), { recursive: true });
    copied.push('AGENT-OS-OPS.md');
  }
  syncEvidenceGuidance(destDir);
  if (copySharedDomainKnowledge(baseId, destDir)) copied.push('DOMAIN.md');
  return { template: ownTpl, copied };
}

/**
 * CRM/ERP Maker-Checker (and ERP specialists): platform-owned Twenty / ERPNext SME card.
 * Copied as DOMAIN.md so agents have vendor+Flolah decision rules without bloating SOUL.
 * @returns {boolean} true when DOMAIN.md was written
 */
export function copySharedDomainKnowledge(baseId, destDir) {
  const id = String(baseId || '').toLowerCase();
  let srcName = null;
  if (id.startsWith('crm-')) srcName = 'TWENTY-CRM-SME.md';
  else if (id.startsWith('erp-')) srcName = 'ERPNEXT-SME.md';
  if (!srcName) return false;
  const from = join(REPO_TEMPLATES, '_shared', srcName);
  if (!existsSync(from) || !destDir) return false;
  try {
    mkdirSync(destDir, { recursive: true });
    cpSync(from, join(destDir, 'DOMAIN.md'), { recursive: true });
    return true;
  } catch (e) {
    console.warn(
      '[openclaw-tenant] DOMAIN.md copy failed template=%s dest=%s err=%s',
      baseId,
      destDir,
      e?.message || e
    );
    return false;
  }
}

const GOAL_PRIORITY_TOOLS = [
  'agent_goal_create',
  'agent_goal_list',
  'agent_goal_status',
  'agent_goal_complete_step',
  'agent_workflow_trigger',
  'agent_workflow_list',
  'agent_workflow_enquire',
  'agent_workflow_runs',
  'notify_ceo',
];

function prioritizeGoalToolsFirst(names = []) {
  const rank = new Map(GOAL_PRIORITY_TOOLS.map((t, i) => [t, i]));
  return [...new Set(names)].sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : 1000;
    const rb = rank.has(b) ? rank.get(b) : 1000;
    return ra - rb || String(a).localeCompare(String(b));
  });
}

function mergeNativeTools(existingAllow = [], contentGrants = []) {
  return prioritizeGoalToolsFirst(
    mergeOpenClawAllowList(existingAllow, contentGrants, { dropImage: true, dropBrowser: false })
  );
}

/**
 * Ensure per-CEO OpenClaw agent + isolated workspace exist; return runtime ids.
 * Idempotent — safe on every chat.
 */
export function ensureTenantOpenClawAgent(agent, ceoUserId) {
  if (!agent?.id) throw new Error('agent required');
  if (!ceoUserId) throw new Error('ceoUserId required');

  const baseOcId = baseOcIdFromAgent(agent);
  const templateBaseId = resolveWorkspaceTemplateBaseId(agent);
  const runtimeOcId = tenantOpenClawAgentId(ceoUserId, baseOcId);
  const workspacePath = tenantWorkspacePath(ceoUserId, baseOcId);
  const workspacePosix = workspacePath.replace(/\\/g, '/');

  if (!existsSync(workspacePath) || readdirSync(workspacePath).length === 0) {
    copyTemplateWorkspace(templateBaseId, workspacePath);
  } else {
    mkdirSync(workspacePath, { recursive: true });
  }
  syncEssentialWorkspaceDocs(templateBaseId, workspacePath);

  let grants = grantsForAgentId(agent.id);
  if (!grants.length && agent.is_coo) {
    grants = [...COO_CONTENT_TOOLS_ALLOW];
  }

  let config = readOpenClawConfig();
  if (!Array.isArray(config.agents?.list)) config.agents = { list: [] };
  config = ensureByokProviderInConfig(config, ceoUserId);

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
  applyIdentityNameToAgentEntry(entry, agent.name || baseOcId);
  applyByokModelToAgentEntry(entry, ceoUserId);
  writeOpenClawConfig(config);

  try {
    applyByokAuthToProvisionedAgent(runtimeOcId, ceoUserId);
  } catch (e) {
    console.warn('[openclaw-tenant] BYOK auth sync:', e?.message || e);
  }

  const allowPath = join(getOpenClawDir(), 'agent-tool-allowlists.json');
  let allow = {};
  if (existsSync(allowPath)) {
    try {
      allow = JSON.parse(readFileSync(allowPath, 'utf8'));
    } catch {
      allow = {};
    }
  }
  allow[runtimeOcId] = mergeNativeTools([], grants);
  writeFileSync(allowPath, JSON.stringify(allow, null, 2), 'utf8');

  syncOrgContextToWorkspace(agent, ceoUserId, workspacePath).catch((e) => {
    console.warn('[openclaw-tenant] org sync:', e?.message || e);
  });

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

/** Ensure every agent granted to a CEO has a tenant OpenClaw runtime entry (for sessions_send + tools). */
export function ensureAllTenantOpenClawAgentsForCeo(ceoUserId) {
  if (!ceoUserId) return 0;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.* FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1`
    )
    .all(ceoUserId);
  let n = 0;
  for (const agent of rows) {
    try {
      ensureTenantOpenClawAgent(agent, ceoUserId);
      n += 1;
    } catch (e) {
      console.warn('[openclaw-tenant] ensure failed', agent.id, ceoUserId, e?.message || e);
    }
  }
  return n;
}

export function ensureAllTenantOpenClawAgentsForAllCeos() {
  const ceos = getDb()
    .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all();
  let total = 0;
  for (const { id } of ceos) total += ensureAllTenantOpenClawAgentsForCeo(id);
  return total;
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

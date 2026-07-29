/**
 * Create a full agent for a CEO (SaaS): DB row + tenant OpenClaw runtime under that CEO.
 * When ownerUserId is set, OpenClaw entry is t-{ceo}--{id} with workspace under tenants/{ceo}/.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/schema.js';
import * as workspace from '../workspace/adapter.js';
import { setAgentToolGrants, syncAllowlistsFile } from './openclaw-agent-tools.js';
import { grantUserAgent } from './users.js';
import {
  ensureTenantOpenClawAgent,
  tenantOpenClawAgentId,
  tenantSessionKeyForAgent,
  tenantWorkspacePath,
} from './openclaw-tenant.js';
import { writeAgentToolsMd } from './openclaw-agent-tools.js';
import { clearAgentTombstone } from './agent-delete.js';
import { getOpenClawDir } from '../config/openclaw-paths.js';

const OPENCLAW_DIR = getOpenClawDir();

/** Default content tools for CEO-created custom agents (not COO-only tools). */
const DEFAULT_TOOLS_ALLOW = [
  'learnings_summary',
  'summarize_url',
  'generate_image',
  'generate_video',
  'kanban_create_task',
  'kanban_move_status',
  'kanban_reassign_to_coo',
  'email_send',
  'notify_ceo',
  'ceo_profile',
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_insert_row',
  'master_data_update_row',
  'master_data_delete_row',
  'master_data_list_documents',
  'master_data_rag',
  'browser',
];

/**
 * Append a new agent row to a manager's AGENTS.md table (so COO/parent can delegate).
 */
async function appendAgentRowToAgentsMd(workspaceRoot, agent, relationText = 'reports to you') {
  let content = '';
  try {
    const result = await workspace.readWorkspaceFile('agents', { workspaceRoot });
    content = result?.text ?? '';
  } catch (_) {
    return;
  }
  const lines = content.split(/\r?\n/);
  const tableRowRe = /^\|\s*\*\*[^*]+\*\*\s*\|/;
  let lastTableRowIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (tableRowRe.test(lines[i])) lastTableRowIndex = i;
  }
  const roleCell = `${(agent.role || 'Agent').replace(/\|/g, ' ')}; ${relationText}`;
  const newRow = `| **${agent.id}** | ${(agent.name || agent.id).replace(/\|/g, ' ')} | ${roleCell} |`;
  if (lastTableRowIndex >= 0) {
    lines.splice(lastTableRowIndex + 1, 0, newRow);
  } else {
    lines.push('', '| Agent ID | Name | Role |', '|----------|------|------|', newRow, '');
  }
  await workspace.writeWorkspaceFile('agents', lines.join('\n'), { workspaceRoot, backup: true });
}

function deriveId(name, getExistingIds) {
  const base =
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 32) || 'agent';
  const existing = getExistingIds();
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function buildSoulMd(name, role, id, ownerUserId) {
  const sessionKey = ownerUserId ? tenantSessionKeyForAgent(ownerUserId, id) : `agent::${id}:main`;
  return `# SOUL — ${name}

You are **${name}**. ${role || 'Specialist agent.'}

## Role

- Fulfill requests in your domain. Report to COO when relevant.
- You operate in **one CEO tenant only**. Read **ORG.md** for peer agents and tenant session keys.

## Memory (avoid redoing recent work)

- **Before responding:** Get your session history for context. Use **sessions_history** with the session key that applies to this run:
  - If the user message says **"Your session key for this run is …"**, use that exact sessionKey (required when delegated or on a Kanban task).
  - Otherwise use \`sessionKey: "${sessionKey}"\` for Dashboard chat (tenant format required).
  Then proceed with the task.
- **Before starting a task:** Read MEMORY.md. If you see a recent completion for the same or very similar topic, state that and ask whether to redo or reuse.
- **After completing a task:** Append a brief line to MEMORY.md: topic/request summary and date. Keep only recent entries (e.g. last 20–30).

## Tools

- **Before non-trivial work:** call **learnings_summary** with a short \`topic\` (optional \`days\`). Apply the summary.
- **notify_ceo**: ONLY when the CEO explicitly asked you to reach/notify/ping them, or for a true blocker while they are not already in Dashboard chat. Never call it for ordinary chat replies — they already see your answer. Parameters: \`title\` (required), optional \`body\`, \`link_url\` (prefer \`/agents/<your-id>/chat\`). Recipient is always this org's CEO; never pass a user id.
- **Out of specialty:** If the CEO asks for work that clearly belongs to another agent in **ORG.md** (e.g. deep tech research → TechResearcher), tell them which agent to use or **sessions_send** to that peer. Do **not** call notify_ceo on yourself.
- **kanban_create_task**, **kanban_move_status** and other Agent OS tools are **API tools**. Invoke them by tool name with JSON parameters. Do **not** run them as shell commands.
- Use **kanban_create_task** only when the CEO asked to track work on Kanban. **kanban_move_status**: \`in_progress\` when you start; \`completed\` only after you finished the deliverable; \`failed\` if blocked.
- **Peer agents:** Use **sessions_send** with tenant session keys from **ORG.md** to reach COO or other agents in this org.
- **Tool choice:** Pick the tool that best matches the user's request (see TOOLS.md). If a tool's response is inadequate (error, empty, or doesn't answer the question), try the next best tool for that context instead of stopping.
- **Browser:** Default **browser** tool with **profile="openclaw"** (managed Playwright). If this agent was granted **browse_*** content tools (Agent Workspace → Tool access), use those for natural-language goals and recipe replay on the CEO's Browser Session (client Chrome relay when ready, otherwise managed). Only use profile="chrome" when the CEO has opted in and marked the client session ready.

## Boundaries

- Stay in role; escalate when needed. Do not change other agents' SOUL or AGENTS.
- Avoid harmful, biased, or sexual content; keep outputs professional.
`;
}

function buildCustomAgentsMd(name, role, department, ownerUserId, cooId) {
  const cooKey = tenantSessionKeyForAgent(ownerUserId, cooId || 'balserve');
  return `# AGENTS — Operating contract (${name})

## Role

${role || 'Specialist.'}

## Department

${department || 'Unassigned'}

## This org (tenancy)

- Read **ORG.md** for all agents in this CEO account, peer **tenant session keys**, and delegation rules.
- Your tenant session key is in ORG.md. COO session key: \`${cooKey}\`.
- Use **sessions_send** with tenant keys from ORG.md to reach COO or peers — never bare agent ids.

## Priorities

1. Fulfill requests in your domain.
2. If the request is outside your domain, point the CEO to the right peer in ORG.md (or sessions_send) — do not notify_ceo yourself.
3. Use **notify_ceo** only when the CEO asked to be reached/notified, or for a true blocker while they are not in your chat.
4. Report to COO via **sessions_send** when you need coordination.

## Boundaries

- Do not change other agents' SOUL or AGENTS. Escalate approvals to COO/CEO.
- Only interact with agents listed in ORG.md for this CEO.
`;
}

/**
 * @param {{ name: string, role?: string, parent_id?: string, reportingTo?: string, department?: string, id?: string, ownerUserId?: string, tools?: string[], monthly_token_budget?: number|string|null, error_budget_pct?: number|string|null }} input
 */
export async function createFullAgent(input) {
  const name = (input.name || 'Unnamed').trim();
  if (!name) throw new Error('name is required');

  const ownerUserId = input.ownerUserId ? String(input.ownerUserId).trim() : null;
  if (!ownerUserId) {
    throw new Error('ownerUserId is required — agents must be created for a CEO workspace');
  }

  const db = getDb();
  const existingIds = new Set(db.prepare('SELECT id FROM agents').all().map((r) => r.id));
  const getExistingIds = () => existingIds;

  let id = (input.id || '').trim().toLowerCase();
  if (!id) id = deriveId(name, getExistingIds);
  else if (existingIds.has(id)) throw new Error(`Agent id "${id}" already exists`);

  // Collision with this CEO's tenant runtime
  const runtimeId = tenantOpenClawAgentId(ownerUserId, id);
  const tenantWs = tenantWorkspacePath(ownerUserId, id);

  let parentId =
    (input.parent_id != null && String(input.parent_id).trim()) ||
    (input.reportingTo != null && String(input.reportingTo).trim()) ||
    (input.reporting_to != null && String(input.reporting_to).trim()) ||
    null;
  parentId = parentId || null;
  const coo = db.prepare('SELECT * FROM agents WHERE is_coo = 1 LIMIT 1').get();
  if (!parentId && coo) parentId = coo.id;

  const role = (input.role || 'Agent').trim();
  const department = String(input.department || '').trim();
  const soulMd = buildSoulMd(name, role, id, ownerUserId);
  const agentsMd = buildCustomAgentsMd(name, role, department, ownerUserId, coo?.id);
  const memoryMd = `# MEMORY — ${name}

## Facts

- Role: ${role || 'Specialist'}.
- Department: ${department || 'Unassigned'}.
- Reports to: ${parentId || 'COO'}.
- CEO workspace: ${ownerUserId}.
`;

  // Re-creating an id the user deleted earlier is deliberate, so drop its tombstone.
  clearAgentTombstone(db, id);

  // Custom agents belong to the creating CEO and are NOT auto-granted to all CEOs on signup.
  db.prepare(
    `INSERT INTO agents (id, name, role, parent_id, workspace_path, openclaw_agent_id, is_coo, agent_type, owner_user_id, department)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'custom', ?, ?)`
  ).run(id, name, role, parentId, tenantWs, id, 0, ownerUserId, department);

  let row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  const toolsToGrant = Array.isArray(input.tools) && input.tools.length ? input.tools : DEFAULT_TOOLS_ALLOW;
  try {
    setAgentToolGrants(row, toolsToGrant);
  } catch (e) {
    console.warn('setAgentToolGrants failed for', id, e?.message);
  }

  grantUserAgent(ownerUserId, id);
  row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);

  // Provision tenant OpenClaw runtime (openclaw.json + tenants/{ceo}/workspace-{id})
  const ensured = ensureTenantOpenClawAgent(row, ownerUserId);

  // Write CEO-specific SOUL/AGENTS/MEMORY into the tenant workspace (overrides template stubs)
  mkdirSync(join(ensured.workspacePath, 'memory'), { recursive: true });
  await workspace.writeWorkspaceFile('soul', soulMd, { workspaceRoot: ensured.workspacePath });
  await workspace.writeWorkspaceFile('agents', agentsMd, { workspaceRoot: ensured.workspacePath });
  await workspace.writeWorkspaceFile('memory', memoryMd, { workspaceRoot: ensured.workspacePath });
  try {
    await writeAgentToolsMd({ ...row, workspace_path: ensured.workspacePath }, toolsToGrant);
  } catch (e) {
    console.warn('[create-full-agent] TOOLS.md write failed', e?.message);
  }

  // Session dirs for the tenant runtime id
  const AGENTS_ROOT = join(OPENCLAW_DIR, 'agents');
  for (const dir of [
    join(AGENTS_ROOT, ensured.openclawAgentId, 'agent'),
    join(AGENTS_ROOT, ensured.openclawAgentId, 'sessions'),
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      if (dir.endsWith('sessions')) writeFileSync(join(dir, 'sessions.json'), '{}', 'utf8');
    }
  }

  // Register under this CEO's tenant COO AGENTS.md (not the shared global COO workspace)
  const agentInfo = { id, name, role: role || 'Agent' };
  if (coo) {
    try {
      const cooTenant = ensureTenantOpenClawAgent(coo, ownerUserId);
      await appendAgentRowToAgentsMd(cooTenant.workspacePath, agentInfo, 'reports to you');
    } catch (e) {
      console.warn('appendAgentRowToAgentsMd (tenant COO) failed', e?.message);
    }
  }
  if (parentId && parentId !== coo?.id) {
    const parent = db.prepare('SELECT * FROM agents WHERE id = ?').get(parentId);
    if (parent) {
      try {
        const parentTenant = ensureTenantOpenClawAgent(parent, ownerUserId);
        await appendAgentRowToAgentsMd(parentTenant.workspacePath, agentInfo, 'reports to you');
      } catch (e) {
        console.warn('appendAgentRowToAgentsMd (parent) failed', e?.message);
      }
    }
  }

  if (input.monthly_token_budget != null || input.error_budget_pct != null) {
    try {
      const { setAgentBudget } = await import('./agent-budgets.js');
      setAgentBudget(ownerUserId, id, {
        monthly_token_budget: input.monthly_token_budget,
        error_budget_pct: input.error_budget_pct,
      });
    } catch (e) {
      console.warn('[create-full-agent] budget setup failed', id, e?.message || e);
    }
  }

  syncAllowlistsFile();
  try {
    const { syncOrgContextForCeo } = await import('./org-context.js');
    await syncOrgContextForCeo(ownerUserId);
  } catch (e) {
    console.warn('[create-full-agent] org sync:', e?.message);
  }
  db.prepare('UPDATE agents SET workspace_path = ? WHERE id = ?').run(ensured.workspacePath, id);

  return {
    ...db.prepare('SELECT * FROM agents WHERE id = ?').get(id),
    openclaw_runtime_id: ensured.openclawAgentId || runtimeId,
    tenant_session_key: tenantSessionKeyForAgent(ownerUserId, id),
    tenant_workspace_path: ensured.workspacePath,
    granted_to_user_id: ownerUserId,
  };
}

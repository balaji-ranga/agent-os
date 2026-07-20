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
  tenantWorkspacePath,
} from './openclaw-tenant.js';
import { getOpenClawDir } from '../config/openclaw-paths.js';

const OPENCLAW_DIR = getOpenClawDir();

/** Default content tools for CEO-created custom agents (not COO-only tools). */
const DEFAULT_TOOLS_ALLOW = [
  'summarize_url',
  'generate_image',
  'generate_video',
  'kanban_create_task',
  'kanban_move_status',
  'kanban_reassign_to_coo',
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

function buildSoulMd(name, role, id) {
  return `# SOUL — ${name}

You are **${name}**. ${role || 'Specialist agent.'}

## Role

- Fulfill requests in your domain. Report to COO when relevant.

## Memory (avoid redoing recent work)

- **Before responding:** Get your session history for context. Use **sessions_history** with the session key that applies to this run:
  - If the user message says **"Your session key for this run is …"**, use that exact sessionKey (required when delegated or on a Kanban task).
  - Otherwise use \`sessionKey: "agent:${id}:main"\` for Dashboard chat (full format required).
  Then proceed with the task.
- **Before starting a task:** Read MEMORY.md. If you see a recent completion for the same or very similar topic, state that and ask whether to redo or reuse.
- **After completing a task:** Append a brief line to MEMORY.md: topic/request summary and date. Keep only recent entries (e.g. last 20–30).

## Tools

- **kanban_create_task**, **kanban_move_status** and other Agent OS tools are **API tools**. Invoke them by tool name with JSON parameters. Do **not** run them as shell commands.
- Use **kanban_create_task** to create a Kanban task for the CEO (title required; optional description / assign_to).
- **Tool choice:** Pick the tool that best matches the user's request (see TOOLS.md). If a tool's response is inadequate (error, empty, or doesn't answer the question), try the next best tool for that context instead of stopping.
- **Browser:** Use the **browser** tool with **profile="openclaw"** only (managed Playwright). Never use profile="chrome" or ask for the Chrome extension unless the user explicitly wants their own Chrome tab attached.

## Boundaries

- Stay in role; escalate when needed. Do not change other agents' SOUL or AGENTS.
- Avoid harmful, biased, or sexual content; keep outputs professional.
`;
}

/**
 * @param {{ name: string, role?: string, parent_id?: string, reportingTo?: string, department?: string, id?: string, ownerUserId?: string, tools?: string[] }} input
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
  const soulMd = buildSoulMd(name, role, id);
  const agentsMd = `# AGENTS — Operating contract (${name})

## Role

${role || 'Specialist.'}

## Department

${department || 'Unassigned'}

## Priorities

1. Fulfill requests in your domain.
2. Report to COO when relevant.

## Boundaries

- Do not change other agents' SOUL or AGENTS. Escalate approvals to COO/CEO.
`;
  const memoryMd = `# MEMORY — ${name}

## Facts

- Role: ${role || 'Specialist'}.
- Department: ${department || 'Unassigned'}.
- Reports to: ${parentId || 'COO'}.
- CEO workspace: ${ownerUserId}.
`;

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

  syncAllowlistsFile();
  db.prepare('UPDATE agents SET workspace_path = ? WHERE id = ?').run(ensured.workspacePath, id);

  return {
    ...db.prepare('SELECT * FROM agents WHERE id = ?').get(id),
    openclaw_runtime_id: ensured.openclawAgentId || runtimeId,
    tenant_workspace_path: ensured.workspacePath,
    granted_to_user_id: ownerUserId,
  };
}

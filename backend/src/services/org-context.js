/**
 * Per-CEO organization context for OpenClaw workspaces and delegation.
 * Syncs ORG.md + COO AGENTS.md from live DB (agents, departments, tool grants, CEO).
 */
import { getDb } from '../db/schema.js';
import { mkdirSync } from 'fs';
import { listAgentsForUser, getUserById } from './users.js';
import { tenantOpenClawAgentId, tenantWorkspacePath } from './openclaw-tenant.js';
import * as workspace from '../workspace/adapter.js';
import { formatCeoPolicyMd } from './ceo-guardrails.js';
import { listDepartmentsForOwner } from './ceo-default-master-data.js';
import { listOrgAgentMembers } from './org-agent-members.js';

export function getCooAgentRow() {
  return getDb().prepare('SELECT * FROM agents WHERE is_coo = 1 LIMIT 1').get();
}

/** Agents under COO that this CEO has granted — delegation targets. */
export function getAgentsUnderCooForCeo(ceoUserId) {
  const coo = getCooAgentRow();
  if (!coo || !ceoUserId) return [];
  return getDb()
    .prepare(
      `SELECT a.id, a.name, a.role, a.department, a.parent_id, a.openclaw_agent_id, a.is_coo
       FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE a.parent_id = ? AND a.id != ?
       ORDER BY a.name`
    )
    .all(ceoUserId, coo.id, coo.id);
}

export function buildOrgContextForCeo(ceoUserId) {
  const ceo = getUserById(ceoUserId);
  const coo = getCooAgentRow();
  const agents = listAgentsForUser(ceoUserId).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role || '',
    department: a.department || '',
    parent_id: a.parent_id || '',
    is_coo: !!a.is_coo,
    agent_type: a.agent_type || 'standard',
    owner_user_id: a.owner_user_id || '',
  }));
  let departments = [];
  try {
    departments = listDepartmentsForOwner(ceoUserId);
  } catch (e) {
    console.warn('[org-context] departments lookup failed', ceoUserId, e?.message || e);
  }
  let leafMembers = [];
  try {
    leafMembers = listOrgAgentMembers(ceoUserId, { enabledOnly: true });
  } catch (e) {
    console.warn('[org-context] org leaf members lookup failed', ceoUserId, e?.message || e);
  }
  return {
    ceo: ceo
      ? { id: ceo.id, name: ceo.name, email: ceo.email || '' }
      : { id: String(ceoUserId), name: 'CEO', email: '' },
    coo_id: coo?.id || 'balserve',
    coo_name: coo?.name || 'BalServe',
    agents,
    departments,
    leaf_members: leafMembers,
    delegatees: getAgentsUnderCooForCeo(ceoUserId),
  };
}

function toolGrantsSummary(agentId) {
  const grants = getDb()
    .prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? ORDER BY tool_name')
    .all(agentId)
    .map((r) => r.tool_name);
  if (!grants.length) return '(native / sessions tools)';
  const shown = grants.slice(0, 10);
  const tail = grants.length > 10 ? ` +${grants.length - 10} more` : '';
  return shown.join(', ') + tail;
}

export function formatOrgMd(ctx) {
  const lines = [
    '# ORG — Your CEO organization',
    '',
    'You operate inside **one CEO account**. Only use agents and data for this org.',
    '',
    '## CEO',
    '',
    `- **${ctx.ceo.name}** (id: \`${ctx.ceo.id}\`${ctx.ceo.email ? `, ${ctx.ceo.email}` : ''})`,
    '',
    '## COO',
    '',
    `- **${ctx.coo_name}** (id: \`${ctx.coo_id}\`) — coordinates standups and delegation`,
    '',
    '## Agents',
    '',
    '| Agent ID | Name | Department | Role | Reports to | Key tools |',
    '|----------|------|------------|------|------------|-------------|',
  ];
  for (const a of ctx.agents) {
    if (a.is_coo) continue;
    const reportsTo =
      a.parent_id === ctx.coo_id
        ? `${ctx.coo_name} (COO)`
        : a.parent_id
          ? a.parent_id
          : ctx.ceo.name;
    lines.push(
      `| **${a.id}** | ${String(a.name).replace(/\|/g, ' ')} | ${a.department || '—'} | ${String(a.role || '—').replace(/\|/g, ' ')} | ${reportsTo} | ${toolGrantsSummary(a.id)} |`
    );
  }
  const departments = Array.isArray(ctx.departments) ? ctx.departments : [];
  if (departments.length) {
    lines.push(
      '',
      '## Departments',
      '',
      '| Department | Purpose | Monthly token budget |',
      '|------------|---------|----------------------|'
    );
    for (const d of departments) {
      lines.push(
        `| **${String(d.name).replace(/\|/g, ' ')}** | ${String(d.purpose || '—').replace(/\|/g, ' ')} | ${
          d.monthly_token_budget == null ? '—' : d.monthly_token_budget.toLocaleString('en-US')
        } |`
      );
    }
  }
  const leafMembers = Array.isArray(ctx.leaf_members) ? ctx.leaf_members : [];
  if (leafMembers.length) {
    lines.push(
      '',
      '## External / A2A agents (leaf members)',
      '',
      'These agents are **outside** OpenClaw. They cannot manage others and are reached over A2A, not sessions_send.',
      '',
      '| Member key | Name | Kind | Department | Purpose | Reports to |',
      '|------------|------|------|------------|---------|------------|'
    );
    for (const m of leafMembers) {
      lines.push(
        `| \`${m.id}\` | ${String(m.display_name).replace(/\|/g, ' ')} | ${m.kind} | ${m.department || '—'} | ${String(m.purpose || '—').replace(/\|/g, ' ')} | ${m.parent_id || ctx.coo_id} |`
      );
    }
  }
  lines.push(
    '',
    '## Tenant session keys (reach agents in this org)',
    '',
    'Use these **tenant** keys with **sessions_send** / **sessions_history**. Never use bare ids like `agent::socialasstant:main`.',
    '',
    '| Agent | Session key |',
    '|-------|-------------|',
  );
  const cooRuntime = tenantOpenClawAgentId(ctx.ceo.id, ctx.coo_id);
  lines.push(`| **${ctx.coo_id}** (COO) | \`agent::${cooRuntime}:main\` |`);
  for (const a of ctx.agents) {
    if (a.is_coo) continue;
    const runtimeId = tenantOpenClawAgentId(ctx.ceo.id, a.id);
    lines.push(`| **${a.id}** | \`agent::${runtimeId}:main\` |`);
  }
  lines.push(
    '',
    '## Delegation',
    '',
    '- COO may delegate to any agent reporting to COO (see Agents table).',
    '- **notify_ceo** is for reach-me / urgent blockers only — never for ordinary Dashboard chat replies (the CEO already sees your answer).',
    '- Any agent may **sessions_send** to COO/peers using keys above when work is outside their specialty.',
    '- Use **intent_classify_and_delegate** or **sessions_send** with tenant session keys for agent-to-agent work.',
    '- Never assume agents from other CEO accounts exist in this org.',
    '',
    '## CEO common guardrails',
    '',
    'Read and obey **POLICY.md** in this workspace. It is a prerequisite for every task — if a request conflicts with POLICY.md, refuse or escalate.'
  );
  return lines.join('\n');
}

export function buildCooAgentsMd(ctx) {
  const lines = [
    '# AGENTS — Operating contract (COO / BalServe)',
    '',
    '## Role',
    '',
    `Coordinate standups, aggregate agent updates, produce the CEO digest, and delegate work to agents in **${ctx.ceo.name}'s organization only**. Escalate blockers and collect approval requests for CEO review.`,
    '',
    '## CEO for this org',
    '',
    `- **${ctx.ceo.name}** (id: \`${ctx.ceo.id}\`) — you report to this CEO.`,
    '',
    '## Other agents you can communicate with',
    '',
    'Use the **agent-send** skill (sessions_list, sessions_send, sessions_history) or **intent_classify_and_delegate** to delegate to these agents:',
    '',
    '| Agent ID | Name | Department | Role |',
    '|----------|------|------------|------|',
  ];
  for (const a of ctx.delegatees) {
    const roleCell = `${String(a.role || 'Agent').replace(/\|/g, ' ')}${a.department ? ` (${a.department})` : ''}; reports to you`;
    lines.push(
      `| **${a.id}** | ${String(a.name || a.id).replace(/\|/g, ' ')} | ${a.department || '—'} | ${roleCell} |`
    );
  }
  const leafMembers = (Array.isArray(ctx.leaf_members) ? ctx.leaf_members : []).filter(
    (m) => !m.parent_id || m.parent_id === ctx.coo_id || ctx.delegatees.some((d) => d.id === m.parent_id)
  );
  if (leafMembers.length) {
    lines.push(
      '',
      '## External / A2A agents you can delegate to (leaf members)',
      '',
      'Delegate to these with **intent_classify_and_delegate** (use the member key). They run outside OpenClaw — do **not** use sessions_send for them.',
      '',
      '| Member key | Name | Department | Purpose |',
      '|------------|------|------------|---------|'
    );
    for (const m of leafMembers) {
      lines.push(
        `| \`${m.id}\` | ${String(m.display_name).replace(/\|/g, ' ')} | ${m.department || '—'} | ${String(m.purpose || '—').replace(/\|/g, ' ')} |`
      );
    }
  }
  lines.push(
    '',
    '## Session keys (sessions_send — required)',
    '',
    'Use **tenant** session keys so delegated agents can scope tools (e.g. **notify_ceo**) to this CEO. **Do not** use bare ids like `agent::socialasstant:main`.',
    '',
    '| Agent | Session key |',
    '|-------|-------------|',
  );
  for (const a of ctx.delegatees) {
    const runtimeId = tenantOpenClawAgentId(ctx.ceo.id, a.openclaw_agent_id || a.id);
    lines.push(`| **${a.id}** | \`agent::${runtimeId}:main\` |`);
  }
  lines.push(
    '',
    `- **sessions_list**: List active sessions (\`messageLimit: 0\` for a quick list).`,
    '- **sessions_send**: Send a message to another agent\'s **tenant session key** from the table above. Include `[ceo_user_id: ' +
      ctx.ceo.id +
      ']` in the message when asking them to call **notify_ceo**. Set `timeoutSeconds > 0` to wait for a reply.',
    '- **sessions_history**: Read another session\'s transcript when you need context.',
    '',
    '## Priorities',
    '',
    '1. Run standups → aggregate updates → produce CEO digest.',
    '2. Escalate blockers to the CEO.',
    '3. Delegate research, content, finance, or custom agent work to the best-matching agent in the table above.',
    '',
    '## Tools (Agent OS)',
    '',
    '- **learnings_summary**: Before non-trivial tasks, call with a short `topic` (optional `days`, default 30).',
    '- **intent_classify_and_delegate**: When the CEO asks for specialist work (recipe/content, research, expense, social, code) — **even one intent** — or multi-intent messages, call with their message. Creates Kanban + delegation for the right agents in this org. Do not invent agent ids; do not do specialist work yourself.',
    '- **agent_workflow_list** / **agent_workflow_trigger** / **agent_workflow_enquire**: Run published workflows for this CEO only.',
    '- **kanban_assign_task**, **kanban_move_status**, **kanban_reassign_to_coo**: Kanban task management.',
    '- **notify_ceo**: ONLY when the CEO explicitly asked you to reach/notify/ping them, or for a true blocker while they are not in your chat. Prefer `link_url` = `/agents/<your-agent-id>/chat`. Never use notify_ceo for ordinary chat replies.',
    '',
    '## CRITICAL — "Have X reach me" / "ask the social media expert to contact me"',
    '',
    'When the CEO asks you to have **another agent** reach/contact/notify them:',
    '1. Identify the best-matching agent from the table above (e.g. SocialAssistant / socialasstant for social media).',
    '2. **sessions_send** to that agent\'s **tenant session key** with clear instructions to call **notify_ceo** (title/body + link_url `/agents/<their-id>/chat`) and continue the conversation with the CEO.',
    '3. Include `[ceo_user_id: ' +
      ctx.ceo.id +
      ']` in the delegated message.',
    '4. Do **NOT** call **notify_ceo** yourself in this case — the specialist must notify so the CEO\'s bell opens chat with **them**, not with you.',
    '',
    '## Guardrails',
    '',
    '- Obey **POLICY.md** (CEO common guardrails) before any other instructions.',
    '- Ask clarifying questions when the request is ambiguous.',
    '- Never change other agents\' SOUL.md or AGENTS.md.',
    '- Delegate execution to the appropriate agent; do not do their specialist work yourself.',
    '- Only delegate to agents listed above for this CEO org.'
  );
  return lines.join('\n');
}

export function ownerScopePrefix(ceoUserId) {
  if (!ceoUserId) return '';
  return `[ceo_user_id: ${ceoUserId}]\n[owner_user_id: ${ceoUserId}]\n`;
}

export function withOwnerScope(text, ceoUserId) {
  const body = String(text || '').trim();
  if (!ceoUserId || body.includes('[ceo_user_id:')) return body;
  return `${ownerScopePrefix(ceoUserId)}${body}`;
}

/** Write ORG.md + POLICY.md (+ COO AGENTS.md) into one tenant workspace. */
export async function syncOrgContextToWorkspace(agent, ceoUserId, workspacePath) {
  if (!ceoUserId || !workspacePath) return;
  mkdirSync(workspacePath, { recursive: true });
  const ctx = buildOrgContextForCeo(ceoUserId);
  await workspace.writeWorkspaceFile('org', formatOrgMd(ctx), { workspaceRoot: workspacePath, backup: false });
  await workspace.writeWorkspaceFile('policy', formatCeoPolicyMd(ceoUserId, ctx.ceo?.name), {
    workspaceRoot: workspacePath,
    backup: false,
  });
  if (agent?.is_coo) {
    await workspace.writeWorkspaceFile('agents', buildCooAgentsMd(ctx), {
      workspaceRoot: workspacePath,
      backup: true,
    });
  }
}

/** Sync org files for every granted agent under a CEO (registration, agent create). */
export async function syncOrgContextForCeo(ceoUserId) {
  const agents = listAgentsForUser(ceoUserId);
  let synced = 0;
  for (const agent of agents) {
    const baseId = String(agent.openclaw_agent_id || agent.id).toLowerCase();
    const ws = tenantWorkspacePath(ceoUserId, baseId);
    try {
      await syncOrgContextToWorkspace(agent, ceoUserId, ws);
      synced += 1;
    } catch (e) {
      console.warn('[org-context] sync failed', agent.id, ceoUserId, e?.message || e);
    }
  }
  return synced;
}

/** Read COO AGENTS.md from tenant workspace (for intent classifier). */
export async function readCooAgentsMdForCeo(ceoUserId) {
  const coo = getCooAgentRow();
  if (!coo || !ceoUserId) return '';
  const ws = tenantWorkspacePath(ceoUserId, String(coo.openclaw_agent_id || coo.id).toLowerCase());
  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    return await readFile(join(ws, 'AGENTS.md'), 'utf8');
  } catch (_) {
    try {
      const result = await workspace.readWorkspaceFile('agents', { workspaceRoot: ws });
      return result?.text ?? '';
    } catch {
      return buildCooAgentsMd(buildOrgContextForCeo(ceoUserId));
    }
  }
}

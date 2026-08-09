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

/**
 * Marks a COO AGENTS.md as org-synced. Template sync must never overwrite a file carrying this
 * marker, or the COO loses its delegation targets (leaf members especially).
 *
 * Org sync only refreshes the managed roster sections below; Role / Priorities / Tools /
 * Guardrails / any custom ## sections the CEO edited are preserved.
 */
export const GENERATED_COO_AGENTS_MARKER = '<!-- agent-os: generated from live org — do not overwrite from template -->';

/** Headings platform owns on every Dashboard / ensureTenant org sync. */
export const COO_AGENTS_MD_MANAGED_HEADINGS = [
  'CEO for this org',
  'Other agents you can communicate with',
  'External / A2A agents you can delegate to (leaf members)',
  'Session keys (sessions_send — required)',
];

export function isGeneratedCooAgentsMd(text) {
  return String(text || '').includes(GENERATED_COO_AGENTS_MARKER);
}

function normalizeHeading(h) {
  return String(h || '')
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isManagedCooAgentsHeading(heading) {
  const n = normalizeHeading(heading);
  if (COO_AGENTS_MD_MANAGED_HEADINGS.some((h) => normalizeHeading(h) === n)) return true;
  // Older ORG-style / short titles still treated as platform-owned so they get replaced.
  return /^external\s*\/\s*a2a agents\b/.test(n);
}

function parseMdSections(text) {
  const lines = String(text || '').split(/\r?\n/);
  const preamble = [];
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (current) sections.push(current);
      current = { heading: line.replace(/^##\s+/, '').trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);
  return { preamble, sections };
}

function trimSectionBody(lines) {
  const body = [...lines];
  while (body.length && body[0].trim() === '') body.shift();
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  return body;
}

function leafMembersForCoo(ctx) {
  return (Array.isArray(ctx.leaf_members) ? ctx.leaf_members : []).filter(
    (m) => !m.parent_id || m.parent_id === ctx.coo_id || ctx.delegatees.some((d) => d.id === m.parent_id)
  );
}

/** Platform-owned roster blocks rebuilt from the live org on every sync. */
export function buildManagedCooAgentsSections(ctx) {
  const agentsBody = [
    'Use the **agent-send** skill (sessions_list, sessions_send, sessions_history) or **intent_classify_and_delegate** to delegate to these agents:',
    '',
    '| Agent ID | Name | Department | Role |',
    '|----------|------|------------|------|',
  ];
  for (const a of ctx.delegatees) {
    const roleCell = `${String(a.role || 'Agent').replace(/\|/g, ' ')}${a.department ? ` (${a.department})` : ''}; reports to you`;
    agentsBody.push(
      `| **${a.id}** | ${String(a.name || a.id).replace(/\|/g, ' ')} | ${a.department || '—'} | ${roleCell} |`
    );
  }

  const sections = [
    {
      heading: 'CEO for this org',
      lines: [`- **${ctx.ceo.name}** (id: \`${ctx.ceo.id}\`) — you report to this CEO.`],
    },
    {
      heading: 'Other agents you can communicate with',
      lines: agentsBody,
    },
  ];

  const leafMembers = leafMembersForCoo(ctx);
  if (leafMembers.length) {
    const leafBody = [
      'Delegate to these with **intent_classify_and_delegate** (use the member key). They run outside OpenClaw — do **not** use sessions_send for them.',
      '',
      '| Member key | Name | Department | Purpose |',
      '|------------|------|------------|---------|',
    ];
    for (const m of leafMembers) {
      leafBody.push(
        `| \`${m.id}\` | ${String(m.display_name).replace(/\|/g, ' ')} | ${m.department || '—'} | ${String(m.purpose || '—').replace(/\|/g, ' ')} |`
      );
    }
    sections.push({
      heading: 'External / A2A agents you can delegate to (leaf members)',
      lines: leafBody,
    });
  }

  const sessionBody = [
    'Use **tenant** session keys so delegated agents can scope tools (e.g. **notify_ceo**) to this CEO. **Do not** use bare ids like `agent::socialasstant:main`.',
    '',
    '| Agent | Session key |',
    '|-------|-------------|',
  ];
  for (const a of ctx.delegatees) {
    const runtimeId = tenantOpenClawAgentId(ctx.ceo.id, a.openclaw_agent_id || a.id);
    sessionBody.push(`| **${a.id}** | \`agent::${runtimeId}:main\` |`);
  }
  sessionBody.push(
    '',
    `- **sessions_list**: List active sessions (\`messageLimit: 0\` for a quick list).`,
    '- **sessions_send**: Send a message to another agent\'s **tenant session key** from the table above. Include `[ceo_user_id: ' +
      ctx.ceo.id +
      ']` in the message when asking them to call **notify_ceo**. Set `timeoutSeconds > 0` to wait for a reply.',
    '- **sessions_history**: Read another session\'s transcript when you need context.'
  );
  sections.push({
    heading: 'Session keys (sessions_send — required)',
    lines: sessionBody,
  });

  return sections;
}

function defaultCooAgentsUserSections(ctx) {
  return [
    {
      heading: 'Role',
      lines: [
        `Coordinate standups, aggregate agent updates, produce the CEO digest, and delegate work to agents in **${ctx.ceo.name}'s organization only**. Escalate blockers and collect approval requests for CEO review.`,
      ],
    },
    {
      heading: 'Priorities',
      lines: [
        '1. Run standups → aggregate updates → produce CEO digest.',
        '2. Escalate blockers to the CEO.',
        '3. Delegate research, content, finance, or custom agent work to the best-matching agent in the table above.',
      ],
    },
    {
      heading: 'Tools (Agent OS)',
      lines: [
        '- **learnings_summary**: Before non-trivial tasks, call with a short `topic` (optional `days`, default 30).',
        '- **intent_classify_and_delegate**: When the CEO asks for specialist work (recipe/content, research, expense, social, code) — **even one intent** — or multi-intent messages, call with their message. Creates Kanban + delegation for the right agents in this org. Do not invent agent ids; do not do specialist work yourself. **Skip** when they say **don\'t/do not delegate** or only want to find/download/attach an existing file (use list_inbound / master_data tools).',
        '- **agent_workflow_list** / **agent_workflow_trigger** / **agent_workflow_enquire** / **agent_workflow_runs** / **agent_workflow_retry**: List/enquire/trigger published workflows, inspect runs, and retry (mode=from_start or from_failed_step). Never use ibkr_order_learnings for workflow run status.',
        '- **kanban_assign_task**, **kanban_move_status**, **kanban_reassign_to_coo**, **kanban_get_task**, **kanban_watch_tick**: Kanban assign/move/read. **kanban_get_task** returns full content (`deliverable`, `delegation_response`, messages, chat turns) — use it when the CEO asks what a completed task produced. For “notify me when task #N finishes” (WhatsApp), create a cron that calls **kanban_watch_tick** (timeout ≥180s; name includes `#N`); it returns `reply` (`NO_REPLY` or notify text) and auto-removes the cron when completed/failed.',
        '- **speech_tts** / **speech_stt** / **analyze_image** / **list_inbound_attachments** / **master_data_index_document** / **master_data_rag** / **master_data_list_documents**: Free Piper TTS and Whisper STT when the CEO asks to speak or transcribe (optional-voice). WhatsApp/web media lands under `inbound/attachments/`. Find/download/re-attach files with **list_inbound_attachments** and paste `paste_in_chat` markdown in your reply. If you see “[whatsapp attachment unavailable]” (or Telegram equivalent) or any channel file: (1) **list_inbound_attachments**, (2) newest matching `relative_path`, (3) if `rag_indexable` → **master_data_index_document** then **master_data_rag**; if image → **analyze_image**; if audio/video → **speech_stt** / summarize. Do not stop at “unavailable” — bytes usually land in inbound within a few seconds.',
        '- **notify_ceo**: ONLY when the CEO explicitly asked you to reach/notify/ping them, or for a true blocker while they are not in your chat. Prefer `link_url` = `/agents/<your-agent-id>/chat`. Never use notify_ceo for ordinary chat replies.',
        '- **ceo_profile**: Call before answering questions about the CEO\'s name, email, mobile, region, or business. Prefer live profile over chat memory; if a field is empty, ask the CEO or say you fell back to chat memory.',
        '- **status_checker**: Reconcile A2A/Kanban statuses and post a **task-status** digest to standup chat (returns HTML). Counts only (awaiting / failed / open / done). **Does not** compute Time Saved or dollar value. Email is sent only by the daily platform batch.',
        '- **this_week_digest**: Load the CEO This Week Digest (nav Digest): KPIs including Time Saved and Est. Value Delivered, with methodology. Value = sum((min_per_task/60)*each AI employee hourly_rate_usd) for completed Kanban; workflows/unassigned use platform default USD/hr (env, default 10). Hire default rate is 10. Formula hours: completed count x minutes_per_task / 60. Not CRM revenue. Answer yourself — do not send the CEO to Platform Help for these numbers.',
        '- **operational_effectiveness**: Load the CEO Home Operational Effectiveness Index (OEI): score 0–100 (Green≥75 / Amber 50–74 / Red 0–49), 14-day window, domain scores (vision, org, goals, workflows, autonomy, CRM platform-or-MCA, governance), and top improve actions. Use when the CEO asks how effective the company is or how to raise the ops score. Not Digest Time Saved dollars.',
      ],
    },
    {
      heading: 'CRITICAL — "Have X reach me" / "ask the social media expert to contact me"',
      lines: [
        'When the CEO asks you to have **another agent** reach/contact/notify them:',
        '1. Identify the best-matching agent from the table above (e.g. SocialAssistant / socialasstant for social media).',
        '2. **sessions_send** to that agent\'s **tenant session key** with clear instructions to call **notify_ceo** (title/body + link_url `/agents/<their-id>/chat`) and continue the conversation with the CEO.',
        '3. Include `[ceo_user_id: ' +
          ctx.ceo.id +
          ']` in the delegated message.',
        '4. Do **NOT** call **notify_ceo** yourself in this case — the specialist must notify so the CEO\'s bell opens chat with **them**, not with you.',
      ],
    },
    {
      heading: 'Guardrails',
      lines: [
        '- Obey **POLICY.md** (CEO common guardrails) before any other instructions.',
        '- Ask clarifying questions when the request is ambiguous.',
        '- Never change other agents\' SOUL.md or AGENTS.md.',
        '- Delegate execution to the appropriate agent; do not do their specialist work yourself.',
        '- Only delegate to agents listed above for this CEO org.',
      ],
    },
  ];
}

function assembleCooAgentsMd(preambleLines, sections) {
  const out = [];
  for (const line of preambleLines) out.push(line);
  if (out.length && out[out.length - 1].trim() !== '') out.push('');
  for (const s of sections) {
    out.push(`## ${s.heading}`, '');
    for (const line of trimSectionBody(s.lines)) out.push(line);
    out.push('');
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return `${out.join('\n')}\n`;
}

function rebuildCooAgentsPreamble(existingPreamble) {
  const cleaned = [];
  let sawTitle = false;
  for (const line of existingPreamble || []) {
    if (line.includes(GENERATED_COO_AGENTS_MARKER)) continue;
    if (/^#\s+AGENTS\b/i.test(line)) {
      sawTitle = true;
      cleaned.push(line);
      continue;
    }
    cleaned.push(line);
  }
  const preamble = [GENERATED_COO_AGENTS_MARKER, ''];
  if (!sawTitle) {
    preamble.push('# AGENTS — Operating contract (COO / BalServe)', '');
  }
  for (const line of cleaned) preamble.push(line);
  while (preamble.length && preamble[preamble.length - 1].trim() === '') preamble.pop();
  return preamble;
}

/**
 * Full default COO AGENTS.md (empty workspace / first provision).
 * Prefer {@link mergeCooAgentsMd} when an existing file may contain manual edits.
 */
export function buildCooAgentsMd(ctx) {
  const preamble = [
    GENERATED_COO_AGENTS_MARKER,
    '',
    '# AGENTS — Operating contract (COO / BalServe)',
  ];
  const userSecs = defaultCooAgentsUserSections(ctx);
  const managed = buildManagedCooAgentsSections(ctx);
  // Role first, then managed roster, then the rest of the defaults.
  const role = userSecs[0];
  const rest = userSecs.slice(1);
  return assembleCooAgentsMd(preamble, [role, ...managed, ...rest]);
}

/**
 * Refresh only the live-org roster sections in an existing COO AGENTS.md.
 * Preserves Role, Priorities, Tools, Guardrails, and any custom ## sections.
 *
 * @param {string} existingText
 * @param {ReturnType<typeof buildOrgContextForCeo>} ctx
 */
export function mergeCooAgentsMd(existingText, ctx) {
  const text = String(existingText || '').trim();
  if (!text) return buildCooAgentsMd(ctx);

  const { preamble, sections } = parseMdSections(text);
  const managed = buildManagedCooAgentsSections(ctx);
  const preserved = sections.filter((s) => !isManagedCooAgentsHeading(s.heading));
  const roleIdx = preserved.findIndex((s) => normalizeHeading(s.heading) === 'role');

  const ordered = [];
  if (roleIdx >= 0) {
    ordered.push(preserved[roleIdx]);
    ordered.push(...managed);
    for (let i = 0; i < preserved.length; i++) {
      if (i === roleIdx) continue;
      ordered.push(preserved[i]);
    }
  } else {
    ordered.push(...managed);
    ordered.push(...preserved);
  }

  return assembleCooAgentsMd(rebuildCooAgentsPreamble(preamble), ordered);
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
    // Merge: refresh roster / session-key / leaf sections only — keep Role, Priorities, Tools,
    // Guardrails, and any custom ## sections the CEO may have edited by hand.
    let existing = '';
    try {
      const { readFileSync } = await import('fs');
      const { join } = await import('path');
      existing = readFileSync(join(workspacePath, 'AGENTS.md'), 'utf8');
    } catch {
      existing = '';
    }
    const agentsMd = mergeCooAgentsMd(existing, ctx);
    await workspace.writeWorkspaceFile('agents', agentsMd, {
      workspaceRoot: workspacePath,
      backup: false,
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

/**
 * Read COO AGENTS.md from tenant workspace (for intent classifier).
 * A workspace file that is not org-synced is a stale template copy: it lists a fixed set of
 * internal agents and no external/A2A leaf members, which would silently shrink the classifier's
 * delegation targets. Merge the live roster into the existing file (preserving manual sections)
 * and heal the workspace in that case.
 */
export async function readCooAgentsMdForCeo(ceoUserId) {
  const coo = getCooAgentRow();
  if (!coo || !ceoUserId) return '';
  const ws = tenantWorkspacePath(ceoUserId, String(coo.openclaw_agent_id || coo.id).toLowerCase());
  let text = '';
  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    text = await readFile(join(ws, 'AGENTS.md'), 'utf8');
  } catch (_) {
    try {
      const result = await workspace.readWorkspaceFile('agents', { workspaceRoot: ws });
      text = result?.text ?? '';
    } catch {
      text = '';
    }
  }
  if (isGeneratedCooAgentsMd(text)) return text;

  const ctx = buildOrgContextForCeo(ceoUserId);
  const healed = mergeCooAgentsMd(text, ctx);
  console.warn('[org-context] COO AGENTS.md was not org-synced, merging live roster', ceoUserId, ws);
  try {
    mkdirSync(ws, { recursive: true });
    await workspace.writeWorkspaceFile('agents', healed, { workspaceRoot: ws, backup: false });
  } catch (e) {
    console.warn('[org-context] COO AGENTS.md heal write failed', ceoUserId, e?.message || e);
  }
  return healed;
}

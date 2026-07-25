/**
 * LIVE validation on a real CEO tenant — Balaji Ranganathan (`ceo-bala`).
 *
 * Deliberately does NOT clean up: the budgets, org leaf members, Kanban cards and delegation
 * runs it creates are left in place so the CEO can validate them in the UI.
 *
 * Covers:
 *  1. Token + error budgets on internal agents (COO `balserve`, `techresearcher`)
 *  2. A published A2A workflow agent placed in the Research department under TechResearcher
 *  3. An external A2A agent placed in the Operations department under the COO
 *  4. COO delegation to internal agent (OpenClaw cron path → agent_delegation_tasks + Kanban)
 *  5. COO delegation to A2A leaf and external leaf (direct A2A path → Kanban + invocations)
 *  6. Skill-based routing: the COO AGENTS.md classifier picking the leaf members
 *  7. Budget enforcement: over-budget leaf is refused before the outbound call (then restored)
 *
 * Usage (inside the backend container):
 *   node scripts/test-balaji-org-delegation-live.js
 */
import { getDb, initDb } from '../src/db/schema.js';
import { getAgentBudget, getMemberBudgetStatus, setAgentBudget } from '../src/services/agent-budgets.js';
import { getMonthlyTokens } from '../src/services/token-usage.js';
import { publishWorkflowAsA2A } from '../src/services/workflow-a2a-publish.js';
import { setA2AAccessPolicy } from '../src/services/workflow-a2a-access.js';
import {
  createExternalAgent,
  discoverExternalAgent,
  updateExternalAgent,
} from '../src/services/external-agents.js';
import { listOrgAgentMembers, upsertOrgAgentMember } from '../src/services/org-agent-members.js';
import { delegateToOrgMembers } from '../src/services/org-member-delegation.js';
import {
  classifyCooDelegationTargets,
  tryHandleCooSpecialtyDelegation,
} from '../src/services/coo-specialty-delegation.js';
import { scheduleCeoRequestViaOpenClawCron } from '../src/services/delegation-queue.js';
import { getOrCreateDelegationHubStandup } from '../src/services/standup-hub.js';
import { readCooAgentsMdForCeo, syncOrgContextForCeo } from '../src/services/org-context.js';
import { getAgentEfficiency } from '../src/services/agent-efficiency.js';

const OWNER = process.env.LIVE_OWNER || 'ceo-bala';
const COO_ID = process.env.LIVE_COO || 'balserve';
const INTERNAL_ID = process.env.LIVE_INTERNAL || 'techresearcher';
const API_BASE = process.env.LIVE_A2A_BASE || 'http://127.0.0.1:3001/api';

const A2A_WF_ID = 'live-org-a2a-priorart';
const EXT_WF_ID = 'live-org-a2a-ops-echo';
const EXT_AGENT_ID = 'a2a-live-ops-echo';

const BUDGETS = {
  [COO_ID]: { monthly_token_budget: 500000, error_budget_pct: 10 },
  [INTERNAL_ID]: { monthly_token_budget: 200000, error_budget_pct: 15 },
  a2aLeaf: { monthly_token_budget: 150000, error_budget_pct: 20 },
  extLeaf: { monthly_token_budget: 120000, error_budget_pct: 25 },
};

let failures = 0;
const summary = [];

function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/**
 * Publish a trigger-only workflow (valid editor graph). There is no "output" node in the palette —
 * earlier fixtures invented one and the runner skipped it, which made A2A fall back to
 * "Workflow completed successfully." Keep the graph real; the reply text for smoke is that fallback.
 */
function ensureWorkflow(db, id, name, description) {
  const now = new Date().toISOString();
  const graph = JSON.stringify({
    nodes: [{ id: 't1', type: 'trigger', data: { label: 'Trigger' } }],
    edges: [],
  });
  db.prepare(
    `INSERT INTO agent_workflow_definitions
       (id, owner_user_id, name, description, status, draft_graph_json, published_graph_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       status = 'published',
       draft_graph_json = excluded.draft_graph_json,
       published_graph_json = excluded.published_graph_json,
       updated_at = excluded.updated_at`
  ).run(id, OWNER, name, description, graph, graph, now, now);
  return id;
}

/** Reuse the existing publication for a workflow when the script is re-run. */
function ensurePublication(db, workflowId, body) {
  const existing = db
    .prepare(
      `SELECT * FROM workflow_a2a_publications
       WHERE workflow_definition_id = ? AND owner_user_id = ? AND status = 'published'
       ORDER BY rowid DESC LIMIT 1`
    )
    .get(workflowId, OWNER);
  if (existing) {
    console.log(`[live] reusing publication ${existing.id} for workflow ${workflowId}`);
    return publishWorkflowAsA2A(
      OWNER,
      workflowId,
      { ...body, publish_id: existing.id },
      { id: OWNER, name: 'live-test' }
    );
  }
  return publishWorkflowAsA2A(
    OWNER,
    workflowId,
    { ...body, as_new_agent: true },
    { id: OWNER, name: 'live-test' }
  );
}

async function main() {
  initDb();
  const db = getDb();

  section('Tenant + internal agents');
  const ceo = db.prepare(`SELECT id, name, role FROM platform_users WHERE id = ?`).get(OWNER);
  check('CEO tenant exists', !!ceo, `${ceo?.id} / ${ceo?.name}`);
  if (!ceo) throw new Error(`CEO ${OWNER} not found`);

  const coo = db
    .prepare(
      `SELECT a.* FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE a.id = ?`
    )
    .get(OWNER, COO_ID);
  check('COO agent granted to CEO', !!coo && coo.is_coo === 1, `${coo?.id} is_coo=${coo?.is_coo}`);

  const internal = db
    .prepare(
      `SELECT a.* FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE a.id = ?`
    )
    .get(OWNER, INTERNAL_ID);
  check(
    'internal specialist granted to CEO',
    !!internal,
    `${internal?.id} dept=${internal?.department} parent=${internal?.parent_id}`
  );

  // Refusals used to be logged as failed invocations, which wrongly spent the member's error
  // budget. Drop those artifacts so the live failure rates below reflect real calls only.
  const repaired = db
    .prepare(
      `DELETE FROM org_member_invocations
       WHERE owner_user_id = ? AND status = 'failed' AND latency_ms IS NULL
         AND (error_message LIKE 'Budget exceeded:%' OR error_message LIKE 'Private A2A agent%')`
    )
    .run(OWNER);
  if (repaired.changes) {
    console.log(`[live] removed ${repaired.changes} legacy budget/ACL refusal rows from the error budget`);
  }

  section('Budgets + error budgets on internal agents');
  for (const agentId of [COO_ID, INTERNAL_ID]) {
    const wanted = BUDGETS[agentId];
    setAgentBudget(OWNER, agentId, wanted);
    const stored = getAgentBudget(OWNER, agentId, { carryForward: false });
    check(
      `${agentId}: token budget stored`,
      stored?.monthly_token_budget === wanted.monthly_token_budget,
      `${stored?.monthly_token_budget}`
    );
    check(
      `${agentId}: error budget stored`,
      Number(stored?.error_budget_pct) === wanted.error_budget_pct,
      `${stored?.error_budget_pct}%`
    );
    const status = getMemberBudgetStatus(OWNER, agentId);
    check(
      `${agentId}: budget status computed`,
      ['ok', 'warn', 'blocked'].includes(status.state),
      `state=${status.state} tokens=${status.tokens_used}/${status.monthly_token_budget} ` +
        `terminal=${status.terminal_calls} failure_rate=${status.failure_rate ?? 'n/a'}%`
    );
    summary.push(
      `internal ${agentId}: tokens ${status.tokens_used}/${status.monthly_token_budget}, ` +
        `error budget ${status.error_budget_pct}%, state=${status.state}`
    );
  }

  section('A2A agent published + placed in Research department');
  ensureWorkflow(
    db,
    A2A_WF_ID,
    'Patent Prior-Art Checker',
    'Searches patent prior art for an invention description and returns matching references.'
  );
  const a2aPub = ensurePublication(db, A2A_WF_ID, {
    name: 'Patent Prior-Art Checker',
    description:
      'Searches patent prior art for an invention description and returns matching prior-art references and claim-overlap risk.',
    auth_mode: 'public',
    visibility: 'public',
  });
  check('A2A publication created/updated', !!a2aPub?.id, `${a2aPub?.id} skill=${a2aPub?.skill_id}`);

  const a2aMember = upsertOrgAgentMember(OWNER, {
    kind: 'a2a_publish',
    ref_id: a2aPub.id,
    display_name: 'Patent Prior-Art Checker',
    purpose:
      'Patent prior-art search: given an invention description, returns prior-art references and claim-overlap risk.',
    department: 'Research',
    parent_id: INTERNAL_ID,
    ...BUDGETS.a2aLeaf,
  });
  check('A2A leaf placed in org', a2aMember?.id === `a2a:${a2aPub.id}`, a2aMember?.id);
  check('A2A leaf department is Research', a2aMember?.department === 'Research');
  check('A2A leaf reports to TechResearcher', a2aMember?.parent_id === INTERNAL_ID);
  check(
    'A2A leaf budgets stored',
    a2aMember?.monthly_token_budget === BUDGETS.a2aLeaf.monthly_token_budget &&
      a2aMember?.error_budget_pct === BUDGETS.a2aLeaf.error_budget_pct,
    `tokens=${a2aMember?.monthly_token_budget} error=${a2aMember?.error_budget_pct}%`
  );
  setAgentBudget(OWNER, a2aMember.id, BUDGETS.a2aLeaf);

  section('External agent registered + placed in Operations department');
  ensureWorkflow(
    db,
    EXT_WF_ID,
    'Ops Echo Service',
    'Acknowledges an operations request and echoes a status line.'
  );
  const extPub = ensurePublication(db, EXT_WF_ID, {
    name: 'Ops Echo Service',
    description: 'Operations status desk — acknowledges an operations request and returns a status line.',
    auth_mode: 'public',
    visibility: 'public',
  });
  // The external-agent path calls the *public* A2A endpoint, so it must not be IP-denied.
  setA2AAccessPolicy(extPub.id, OWNER, 'allow_all');
  check('backing A2A publication for external agent', !!extPub?.id, extPub?.id);

  const endpointUrl = `${API_BASE}/a2a/${extPub.id}`;
  const authUser = { id: OWNER, role: 'ceo' };
  const existingExt = db.prepare(`SELECT id FROM external_agents WHERE id = ?`).get(EXT_AGENT_ID);
  if (existingExt) {
    updateExternalAgent(EXT_AGENT_ID, authUser, {
      name: 'Ops Echo Service',
      description: 'Operations status desk — acknowledges an operations request and returns a status line.',
      endpoint_url: endpointUrl,
      skill_id: extPub.skill_id || 'default',
    });
  } else {
    createExternalAgent(authUser, {
      id: EXT_AGENT_ID,
      name: 'Ops Echo Service',
      description: 'Operations status desk — acknowledges an operations request and returns a status line.',
      endpoint_url: endpointUrl,
      skill_id: extPub.skill_id || 'default',
    });
  }
  const discovered = await discoverExternalAgent(EXT_AGENT_ID, authUser);
  check('external agent healthy', discovered?.status === 'healthy', `status=${discovered?.status}`);

  const extMember = upsertOrgAgentMember(OWNER, {
    kind: 'external',
    ref_id: EXT_AGENT_ID,
    display_name: 'Ops Echo Service',
    purpose:
      'Ops echo / operations status desk: when asked to echo a greeting or acknowledge an operations/facilities request, returns a short status line.',
    department: 'Operations',
    parent_id: COO_ID,
    ...BUDGETS.extLeaf,
  });
  check('external leaf placed in org', extMember?.id === `ext:${EXT_AGENT_ID}`, extMember?.id);
  check('external leaf department is Operations', extMember?.department === 'Operations');
  check('external leaf reports to COO', extMember?.parent_id === COO_ID);
  setAgentBudget(OWNER, extMember.id, BUDGETS.extLeaf);

  section('Org context sync (COO AGENTS.md must list the leaf members)');
  const synced = await syncOrgContextForCeo(OWNER);
  check('org context synced to workspaces', (synced?.synced ?? synced) > 0, JSON.stringify(synced));
  const agentsMd = await readCooAgentsMdForCeo(OWNER);
  check('COO AGENTS.md lists the A2A leaf', agentsMd.includes(a2aMember.id), a2aMember.id);
  check('COO AGENTS.md lists the external leaf', agentsMd.includes(extMember.id), extMember.id);
  const leafTable = agentsMd
    .split(/\r?\n/)
    .filter((l) => l.includes('a2a:') || l.includes('ext:'))
    .join('\n');
  console.log('  COO AGENTS.md leaf rows:\n' + leafTable);

  section('Delegation path 1/3 — internal agent (OpenClaw cron)');
  const standupId = getOrCreateDelegationHubStandup(OWNER);
  const internalResult = await scheduleCeoRequestViaOpenClawCron(
    standupId,
    'Research the current state of on-device small language models and summarise the top three options.',
    OWNER,
    {
      restrictToAgentIds: [INTERNAL_ID],
      preAllocated: {
        [INTERNAL_ID]:
          'Research the current state of on-device small language models and summarise the top three options.',
      },
    }
  );
  check(
    'internal delegation queued',
    (internalResult?.count || 0) >= 1,
    `count=${internalResult?.count} agents=${(internalResult?.agentNames || []).join(', ')}`
  );
  check(
    'internal delegation created a Kanban card',
    (internalResult?.kanbanTaskIds || []).length >= 1,
    `kanban=${(internalResult?.kanbanTaskIds || []).join(', ')}`
  );
  const internalTask = db
    .prepare(
      `SELECT id, to_agent_id, status FROM agent_delegation_tasks
       WHERE standup_id = ? AND to_agent_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(standupId, INTERNAL_ID);
  check(
    'internal delegation task row exists',
    !!internalTask,
    `task=${internalTask?.id} status=${internalTask?.status}`
  );
  const internalKanban = (internalResult?.kanbanTaskIds || [])[0];
  const internalCard = internalKanban
    ? db.prepare(`SELECT * FROM kanban_tasks WHERE id = ?`).get(internalKanban)
    : null;
  check(
    'internal Kanban card uses assigned_agent_id (FK to agents)',
    internalCard?.assigned_agent_id === INTERNAL_ID,
    `assigned_agent_id=${internalCard?.assigned_agent_id} member_key=${internalCard?.assigned_member_key ?? 'null'}`
  );
  // Delivery is asynchronous (OpenClaw cron, or the delegation cron when cron_add is unavailable).
  let internalStatus = internalTask?.status;
  for (let i = 0; i < 10 && internalStatus === 'pending'; i += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    internalStatus = db
      .prepare(`SELECT status FROM agent_delegation_tasks WHERE id = ?`)
      .get(internalTask.id)?.status;
  }
  console.log(`  internal delegation task ${internalTask?.id} status after wait: ${internalStatus}`);
  summary.push(
    `internal delegation: standup=${standupId} task=${internalTask?.id} status=${internalStatus} kanban=${internalKanban} (TechResearcher replies asynchronously)`
  );

  section('Delegation path 2/3 — A2A leaf member (COO caller)');
  const a2aOutcome = await delegateToOrgMembers(
    OWNER,
    {
      [a2aMember.id]:
        'Run a prior-art check for a battery thermal-management invention using phase-change materials.',
    },
    { callerAgentId: COO_ID }
  );
  check(
    'A2A leaf delegation succeeded',
    a2aOutcome.delegated.length === 1 && a2aOutcome.failed.length === 0,
    `delegated=${a2aOutcome.delegated.length} failed=${a2aOutcome.failed.length} ` +
      `blocked=${a2aOutcome.blocked.length} err=${a2aOutcome.failed[0]?.error || '-'}`
  );
  const a2aTaskId = a2aOutcome.delegated[0]?.taskId;
  const a2aCard = a2aTaskId ? db.prepare(`SELECT * FROM kanban_tasks WHERE id = ?`).get(a2aTaskId) : null;
  check('A2A Kanban card completed', a2aCard?.status === 'completed', `status=${a2aCard?.status}`);
  check(
    'A2A Kanban card tracks member key (assigned_agent_id null)',
    a2aCard?.assigned_member_key === a2aMember.id && a2aCard?.assigned_agent_id == null,
    `member_key=${a2aCard?.assigned_member_key} agent_id=${a2aCard?.assigned_agent_id}`
  );
  const a2aInv = db
    .prepare(
      `SELECT status, latency_ms FROM org_member_invocations
       WHERE owner_user_id = ? AND member_key = ? ORDER BY id DESC LIMIT 1`
    )
    .get(OWNER, a2aMember.id);
  check('A2A invocation recorded ok', a2aInv?.status === 'ok', `latency=${a2aInv?.latency_ms}ms`);
  const a2aTokens = getMonthlyTokens(OWNER, a2aMember.id);
  check('A2A token usage recorded', a2aTokens.total_tokens > 0, `tokens=${a2aTokens.total_tokens}`);
  check(
    'A2A reply text captured',
    String(a2aOutcome.delegated[0]?.text || '').trim().length > 0,
    String(a2aOutcome.delegated[0]?.text || '').slice(0, 80)
  );
  summary.push(
    `A2A leaf ${a2aMember.id}: kanban=${a2aTaskId}, tokens=${a2aTokens.total_tokens}, reply="${String(a2aOutcome.delegated[0]?.text || '').slice(0, 60)}"`
  );

  section('Delegation path 3/3 — external agent leaf (COO caller)');
  const extOutcome = await delegateToOrgMembers(
    OWNER,
    { [extMember.id]: 'Log an operations request: meeting room A/V needs a firmware update this week.' },
    { callerAgentId: COO_ID }
  );
  check(
    'external leaf delegation succeeded',
    extOutcome.delegated.length === 1 && extOutcome.failed.length === 0,
    `delegated=${extOutcome.delegated.length} failed=${extOutcome.failed.length} blocked=${extOutcome.blocked.length} ` +
      `err=${extOutcome.failed[0]?.error || '-'}`
  );
  const extTaskId = extOutcome.delegated[0]?.taskId;
  const extCard = extTaskId ? db.prepare(`SELECT * FROM kanban_tasks WHERE id = ?`).get(extTaskId) : null;
  check('external Kanban card completed', extCard?.status === 'completed', `status=${extCard?.status}`);
  const extInv = db
    .prepare(
      `SELECT status, latency_ms FROM org_member_invocations
       WHERE owner_user_id = ? AND member_key = ? ORDER BY id DESC LIMIT 1`
    )
    .get(OWNER, extMember.id);
  check('external invocation recorded ok', extInv?.status === 'ok', `latency=${extInv?.latency_ms}ms`);
  const extTokens = getMonthlyTokens(OWNER, extMember.id);
  check('external token usage recorded', extTokens.total_tokens > 0, `tokens=${extTokens.total_tokens}`);
  summary.push(
    `external leaf ${extMember.id}: kanban=${extTaskId}, tokens=${extTokens.total_tokens}, reply="${String(extOutcome.delegated[0]?.text || '').slice(0, 60)}"`
  );

  section('Skill-based routing — COO classifier picks the leaf members');
  try {
    const a2aRoute = await classifyCooDelegationTargets(
      OWNER,
      'I need a patent prior-art search for a new battery cooling design — check claim overlap risk.'
    );
    console.log(`  classifier → ${JSON.stringify(a2aRoute)}`);
    check(
      'classifier routes prior-art ask to the A2A leaf',
      Object.keys(a2aRoute).includes(a2aMember.id),
      Object.keys(a2aRoute).join(', ') || 'no target'
    );
  } catch (e) {
    check('classifier (A2A) ran', false, e?.message || String(e));
  }

  try {
    const extRoute = await classifyCooDelegationTargets(
      OWNER,
      'Please log an operations desk request to service the meeting room projector.'
    );
    console.log(`  classifier → ${JSON.stringify(extRoute)}`);
    check(
      'classifier routes ops ask to the external leaf',
      Object.keys(extRoute).includes(extMember.id),
      Object.keys(extRoute).join(', ') || 'no target'
    );
  } catch (e) {
    check('classifier (external) ran', false, e?.message || String(e));
  }

  section('COO delegation handler end-to-end (LLM → delegate)');
  try {
    const handled = await tryHandleCooSpecialtyDelegation(
      OWNER,
      'Run a patent prior-art check on a phase-change-material battery cooling plate and report claim overlap.'
    );
    console.log(`  COO reply: ${String(handled?.cooReply || '(none)').slice(0, 400)}`);
    console.log(`  result: ${JSON.stringify(handled?.result || {})}`);
    const reached = [
      ...(handled?.result?.external_delegated || []),
      ...(handled?.result?.agentNames || []),
    ];
    check('COO handler delegated somewhere', !!handled?.ok, `targets=${reached.join(', ') || 'none'}`);
    summary.push(`COO handler: ${JSON.stringify(handled?.result || {})}`);
  } catch (e) {
    check('COO handler ran', false, e?.message || String(e));
  }

  section('Budget enforcement on a leaf (temporary, then restored)');
  const invCountBefore = db
    .prepare(`SELECT COUNT(*) AS c FROM org_member_invocations WHERE owner_user_id = ? AND member_key = ?`)
    .get(OWNER, a2aMember.id).c;
  setAgentBudget(OWNER, a2aMember.id, { monthly_token_budget: 1, error_budget_pct: 20 });
  const blockedOutcome = await delegateToOrgMembers(
    OWNER,
    { [a2aMember.id]: 'This request must be refused by the token budget.' },
    { callerAgentId: COO_ID }
  );
  check(
    'over-budget A2A leaf is blocked before the outbound call',
    blockedOutcome.blocked.length === 1 && blockedOutcome.delegated.length === 0,
    blockedOutcome.blocked[0]?.reasons?.join('; ')
  );
  const invCountAfter = db
    .prepare(`SELECT COUNT(*) AS c FROM org_member_invocations WHERE owner_user_id = ? AND member_key = ?`)
    .get(OWNER, a2aMember.id).c;
  check(
    'budget refusal does not spend the error budget',
    invCountAfter === invCountBefore,
    `invocations ${invCountBefore} → ${invCountAfter}`
  );
  setAgentBudget(OWNER, a2aMember.id, BUDGETS.a2aLeaf);
  const restored = getMemberBudgetStatus(OWNER, a2aMember.id);
  check(
    'A2A leaf budget restored to normal',
    restored.state !== 'blocked' && restored.monthly_token_budget === BUDGETS.a2aLeaf.monthly_token_budget,
    `state=${restored.state} tokens=${restored.tokens_used}/${restored.monthly_token_budget}`
  );

  section('Agent View / efficiency payloads');
  for (const key of [INTERNAL_ID, a2aMember.id, extMember.id]) {
    const eff = getAgentEfficiency(OWNER, key, { days: 30 });
    check(
      `Agent View resolves ${key}`,
      !!eff && !!eff.totals,
      `kind=${eff?.kind} completed=${eff?.totals?.tasks_completed} failed=${eff?.totals?.tasks_failed} tokens=${eff?.totals?.tokens}`
    );
  }

  section('Final budget / error-budget snapshot');
  for (const key of [COO_ID, INTERNAL_ID, a2aMember.id, extMember.id]) {
    const s = getMemberBudgetStatus(OWNER, key);
    console.log(
      `  ${key}: state=${s.state} tokens=${s.tokens_used}/${s.monthly_token_budget ?? '—'} (${s.token_pct ?? 0}%) ` +
        `error_budget=${s.error_budget_pct ?? '—'}% failure_rate=${s.failure_rate ?? 'n/a'}% ` +
        `terminal=${s.terminal_calls} (block needs ≥${s.min_terminal_calls_for_error_block})`
    );
  }

  section('Left in place for your validation (NO cleanup)');
  console.log(`  CEO: ${OWNER} (${ceo.name})`);
  console.log(`  Org leaf members: ${JSON.stringify(listOrgAgentMembers(OWNER), null, 2)}`);
  for (const line of summary) console.log(`  - ${line}`);

  console.log(failures ? `\n[live] ${failures} FAILURE(S)` : '\n[live] PASS');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('[live] error:', e);
  process.exit(1);
});

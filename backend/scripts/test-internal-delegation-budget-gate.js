/**
 * Verify COO specialty delegation refuses internal agents that are over budget
 * BEFORE enqueue / OpenClaw cron (parity with leaf member refuses).
 *
 * Usage: node backend/scripts/test-internal-delegation-budget-gate.js
 *
 * Safe on live ceo-bala: temporarily sets TechResearcher token budget to 1, attempts a
 * research-shaped specialty delegation via the schedule path, asserts no new Kanban /
 * cron work was created, then restores the prior budget.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { setAgentBudget, getAgentBudget, getMemberBudgetStatus, enforceBudget } from '../src/services/agent-budgets.js';
import { scheduleCeoRequestViaOpenClawCron } from '../src/services/delegation-queue.js';
import { getOrCreateDelegationHubStandup } from '../src/services/standup-hub.js';
import { recordTokenUsage } from '../src/services/token-usage.js';

const OWNER = process.env.TEST_OWNER || 'ceo-bala';
const AGENT = 'techresearcher';

initDb();
const db = getDb();

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

async function main() {
  console.log(`== Internal delegation budget gate (${OWNER} → ${AGENT}) ==`);

  const prior = getAgentBudget(OWNER, AGENT);
  const priorStatus = getMemberBudgetStatus(OWNER, AGENT);
  console.log(
    `  prior budget tokens=${prior?.monthly_token_budget ?? '—'} used=${priorStatus.tokens_used} state=${priorStatus.state}`
  );

  // Seed enough usage that a tiny budget will block (local DBs may have 0 usage).
  recordTokenUsage(OWNER, {
    memberKey: AGENT,
    agentId: AGENT,
    source: 'delegation',
    inputTokens: 50,
    outputTokens: 50,
    estimated: true,
  });

  setAgentBudget(OWNER, AGENT, {
    monthly_token_budget: 1,
    error_budget_pct: prior?.error_budget_pct ?? 15,
  });
  const blockedStatus = enforceBudget(OWNER, AGENT, {
    action: 'delegation',
    memberLabel: 'TechResearcher',
    throwOnBlock: false,
  });
  check(
    'enforceBudget reports blocked after tiny budget',
    blockedStatus.state === 'blocked',
    `state=${blockedStatus.state} used=${blockedStatus.tokens_used}`
  );

  const beforeTasks = db
    .prepare(
      `SELECT COUNT(*) AS c FROM agent_delegation_tasks
       WHERE owner_user_id = ? AND to_agent_id = ? AND status IN ('pending','processing')`
    )
    .get(OWNER, AGENT)?.c;

  const standupId = getOrCreateDelegationHubStandup(OWNER);
  const result = await scheduleCeoRequestViaOpenClawCron(
    standupId,
    'Research the latest advances in patent prior-art search tooling for the CEO.',
    OWNER,
    {
      restrictToAgentIds: [AGENT],
      preAllocated: {
        [AGENT]: 'Research the latest advances in patent prior-art search tooling for the CEO.',
      },
    }
  );

  check('schedule returns count 0 (no work started)', result.count === 0, `count=${result.count}`);
  check(
    'schedule lists agent in internalBlocked',
    (result.internalBlocked || []).some((b) => String(b.id).toLowerCase() === AGENT),
    JSON.stringify(result.internalBlocked || [])
  );
  check('schedule agentNames empty', (result.agentNames || []).length === 0, String(result.agentNames));

  const afterTasks = db
    .prepare(
      `SELECT COUNT(*) AS c FROM agent_delegation_tasks
       WHERE owner_user_id = ? AND to_agent_id = ? AND status IN ('pending','processing')`
    )
    .get(OWNER, AGENT)?.c;
  check(
    'no new pending/processing delegation tasks',
    Number(afterTasks) === Number(beforeTasks),
    `before=${beforeTasks} after=${afterTasks}`
  );

  // Clean up any accidental pending task from a failed run, then restore budget.
  db.prepare(
    `UPDATE agent_delegation_tasks SET status = 'failed', error_message = 'budget-gate test cleanup',
      completed_at = datetime('now')
     WHERE owner_user_id = ? AND to_agent_id = ? AND status IN ('pending','processing')`
  ).run(OWNER, AGENT);

  // Restore to a budget above current usage so we don't leave the agent stuck blocked
  // (VPS live agents may already have spent more than the prior configured budget).
  const usedNow = Number(getMemberBudgetStatus(OWNER, AGENT).tokens_used) || 0;
  const restoreTokens = Math.max(
    Number(prior?.monthly_token_budget) || 0,
    usedNow + 50000,
    500000
  );
  setAgentBudget(OWNER, AGENT, {
    monthly_token_budget: restoreTokens,
    error_budget_pct: prior?.error_budget_pct ?? 15,
  });
  const restored = getMemberBudgetStatus(OWNER, AGENT);
  check(
    'budget restored above usage (not token-blocked)',
    restored.state !== 'blocked' || !(restored.reasons || []).some((r) => /token budget/i.test(r)),
    `state=${restored.state} tokens=${restored.tokens_used}/${restored.monthly_token_budget}`
  );

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('test failed:', e);
  try {
    setAgentBudget(OWNER, AGENT, { monthly_token_budget: 200000, error_budget_pct: 15 });
  } catch (_) {}
  process.exit(1);
});

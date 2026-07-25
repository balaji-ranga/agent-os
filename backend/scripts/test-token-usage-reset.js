/**
 * Reset month-to-date token usage (selected member or all) for budget gauges.
 *
 * IMPORTANT: Uses a disposable owner id so deploy smoke never wipes real CEO metrics
 * (previously defaulted to ceo-bala and deleted production token_usage rows on every deploy).
 *
 * Usage: node backend/scripts/test-token-usage-reset.js [ownerUserId]
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  recordTokenUsage,
  getMonthlyTokens,
  resetTokenUsage,
  monthPeriod,
} from '../src/services/token-usage.js';
import { getMemberBudgetStatus, setAgentBudget } from '../src/services/agent-budgets.js';

/** Disposable probe owner — never a real CEO tenant. */
const DEFAULT_PROBE_OWNER = 'ceo-token-reset-probe';
const OWNER = process.argv[2] || process.env.TEST_OWNER || DEFAULT_PROBE_OWNER;
const AGENT = 'techresearcher';
const PERIOD = monthPeriod();

if (OWNER === 'ceo-bala' || OWNER === 'default') {
  console.error(
    `Refusing to run token-usage reset probe against production owner "${OWNER}". ` +
      `Use ${DEFAULT_PROBE_OWNER} (default) or another disposable id.`
  );
  process.exit(2);
}

initDb();

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

console.log(`== token usage reset (${OWNER} / ${AGENT} / ${PERIOD}) ==`);

// Ensure a clean slate for this probe owner only.
getDb().prepare('DELETE FROM token_usage WHERE owner_user_id = ?').run(OWNER);
getDb().prepare('DELETE FROM agent_ops_budgets WHERE owner_user_id = ?').run(OWNER);

setAgentBudget(OWNER, AGENT, { monthly_token_budget: 100000, error_budget_pct: 15 });
recordTokenUsage(OWNER, {
  memberKey: AGENT,
  agentId: AGENT,
  source: 'delegation',
  inputTokens: 40,
  outputTokens: 60,
  estimated: true,
});
const before = getMonthlyTokens(OWNER, AGENT, PERIOD);
check('seeded usage > 0', before.total_tokens > 0, `tokens=${before.total_tokens}`);

const one = resetTokenUsage(OWNER, { memberKey: AGENT, period: PERIOD });
check('single-member reset deletes rows', one.deleted_rows >= 1, `deleted=${one.deleted_rows}`);
const afterOne = getMonthlyTokens(OWNER, AGENT, PERIOD);
check('single-member usage is 0', afterOne.total_tokens === 0, `tokens=${afterOne.total_tokens}`);
const status = getMemberBudgetStatus(OWNER, AGENT);
check(
  'budget status shows 0 used after reset',
  status.tokens_used === 0,
  `used=${status.tokens_used} state=${status.state}`
);

recordTokenUsage(OWNER, {
  memberKey: AGENT,
  agentId: AGENT,
  source: 'openclaw_chat',
  inputTokens: 10,
  outputTokens: 10,
  estimated: true,
});
recordTokenUsage(OWNER, {
  memberKey: 'balserve',
  agentId: 'balserve',
  source: 'openclaw_chat',
  inputTokens: 5,
  outputTokens: 5,
  estimated: true,
});
const all = resetTokenUsage(OWNER, { period: PERIOD });
check('all-members reset deletes rows', all.deleted_rows >= 2, `deleted=${all.deleted_rows}`);
check('all-members member_key is null', all.member_key == null);
check(
  'techresearcher cleared after all-reset',
  getMonthlyTokens(OWNER, AGENT, PERIOD).total_tokens === 0
);
check(
  'balserve cleared after all-reset',
  getMonthlyTokens(OWNER, 'balserve', PERIOD).total_tokens === 0
);

// Cleanup probe rows so the disposable owner never accumulates junk.
getDb().prepare('DELETE FROM token_usage WHERE owner_user_id = ?').run(OWNER);
getDb().prepare('DELETE FROM agent_ops_budgets WHERE owner_user_id = ?').run(OWNER);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

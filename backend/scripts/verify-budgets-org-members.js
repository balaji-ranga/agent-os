/**
 * Smoke check for the budgets / org-leaf-member schema and services.
 * Verifies tables exist, the ledger records usage, and budget enforcement warns then blocks.
 *
 * Usage: node backend/scripts/verify-budgets-org-members.js
 */
import { getDb, initDb } from '../src/db/schema.js';
import { getMonthlyTokens, recordTokenUsage } from '../src/services/token-usage.js';
import { getMemberBudgetStatus, setAgentBudget } from '../src/services/agent-budgets.js';
import { splitAllocationByKind } from '../src/services/org-member-keys.js';

const REQUIRED_TABLES = [
  'agent_ops_budgets',
  'token_usage',
  'org_agent_members',
  'org_member_invocations',
];

function main() {
  initDb();
  const db = getDb();
  const found = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(() => '?').join(',')})`
    )
    .all(...REQUIRED_TABLES)
    .map((r) => r.name);
  const missing = REQUIRED_TABLES.filter((t) => !found.includes(t));
  if (missing.length) {
    console.error('[verify] missing tables:', missing.join(', '));
    process.exit(1);
  }
  console.log('[verify] tables ok:', found.join(', '));

  const kanbanCols = db.prepare('PRAGMA table_info(kanban_tasks)').all().map((c) => c.name);
  if (!kanbanCols.includes('assigned_member_key')) {
    console.error('[verify] kanban_tasks.assigned_member_key column missing');
    process.exit(1);
  }
  console.log('[verify] kanban_tasks.assigned_member_key ok');

  const deptTables = db
    .prepare("SELECT owner_user_id, columns_json FROM master_data_tables WHERE name = 'departments'")
    .all();
  const missingCols = deptTables.filter((t) => {
    const cols = JSON.parse(t.columns_json || '[]').map((c) => (typeof c === 'string' ? c : c.name));
    return !cols.includes('purpose') || !cols.includes('monthly_token_budget');
  });
  if (missingCols.length) {
    console.error(
      `[verify] ${missingCols.length}/${deptTables.length} departments tables missing purpose/monthly_token_budget`
    );
    process.exit(1);
  }
  console.log(`[verify] departments purpose + budget columns ok (${deptTables.length} owners)`);

  const owner = '__verify_owner__';
  const member = '__verify_member__';
  db.prepare('DELETE FROM token_usage WHERE owner_user_id = ?').run(owner);
  db.prepare('DELETE FROM agent_ops_budgets WHERE owner_user_id = ?').run(owner);

  setAgentBudget(owner, member, { monthly_token_budget: 1000, error_budget_pct: 5 });
  recordTokenUsage(owner, { memberKey: member, source: 'verify', inputTokens: 500, outputTokens: 350 });
  const used = getMonthlyTokens(owner, member);
  if (used.total_tokens !== 850) {
    console.error('[verify] expected 850 tokens, got', used.total_tokens);
    process.exit(1);
  }
  const warn = getMemberBudgetStatus(owner, member);
  if (warn.state !== 'warn') {
    console.error('[verify] expected warn state at 85%, got', warn.state, warn.reasons);
    process.exit(1);
  }
  recordTokenUsage(owner, { memberKey: member, source: 'verify', inputTokens: 200, outputTokens: 0 });
  const blocked = getMemberBudgetStatus(owner, member);
  if (blocked.state !== 'blocked') {
    console.error('[verify] expected blocked state at 105%, got', blocked.state, blocked.reasons);
    process.exit(1);
  }
  console.log('[verify] warn-then-block ok:', blocked.reasons.join(' | '));

  const split = splitAllocationByKind({ techresearcher: 'a', 'ext:foo': 'b', 'a2a:bar': 'c' });
  if (Object.keys(split.internal).length !== 1 || Object.keys(split.leaf).length !== 2) {
    console.error('[verify] allocation split wrong', split);
    process.exit(1);
  }
  console.log('[verify] allocation split ok');

  db.prepare('DELETE FROM token_usage WHERE owner_user_id = ?').run(owner);
  db.prepare('DELETE FROM agent_ops_budgets WHERE owner_user_id = ?').run(owner);
  console.log('[verify] PASS');
}

main();

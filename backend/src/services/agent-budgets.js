/**
 * Monthly operating budgets for org members (internal agents + external/A2A leaf members).
 *
 * Two budgets per member per month:
 *  - `monthly_token_budget` — LLM tokens the member may spend (from the `token_usage` ledger).
 *  - `error_budget_pct`     — maximum share of terminal calls that may fail.
 *
 * Enforcement is warn-then-block: past the warn threshold the CEO gets one bell notification per
 * day; at 100% of the token budget (or above the error budget) new delegated/interactive work is
 * refused until the next month or until the CEO raises the budget.
 */
import { getDb } from '../db/schema.js';
import { getKanbanScopeIds } from './kanban-user-scope.js';
import { getMonthlyTokens, monthPeriod } from './token-usage.js';
import { sendPlatformNotifications } from './platform-notifications.js';

export const DEFAULT_WARN_TOKEN_PCT = 80;
export const DEFAULT_WARN_ERROR_PCT = 80;

/**
 * Error budgets are noisy on tiny samples, so a member is only blocked on failure rate once it
 * has this many terminal calls in the month.
 */
export const MIN_TERMINAL_CALLS_FOR_ERROR_BLOCK = 10;

export class BudgetBlockedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BudgetBlockedError';
    this.code = 'budget_exceeded';
    this.status = 429;
    this.details = details;
  }
}

function toIntOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function toPctOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

function mapBudget(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    member_key: row.member_key,
    period: row.period,
    monthly_token_budget: row.monthly_token_budget == null ? null : Number(row.monthly_token_budget),
    error_budget_pct: row.error_budget_pct == null ? null : Number(row.error_budget_pct),
    warn_token_pct: row.warn_token_pct == null ? DEFAULT_WARN_TOKEN_PCT : Number(row.warn_token_pct),
    warn_error_pct: row.warn_error_pct == null ? DEFAULT_WARN_ERROR_PCT : Number(row.warn_error_pct),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Set (or clear) the budget for a member in a period. */
export function setAgentBudget(
  ownerUserId,
  memberKey,
  {
    period = monthPeriod(),
    monthly_token_budget = null,
    error_budget_pct = null,
    warn_token_pct = DEFAULT_WARN_TOKEN_PCT,
    warn_error_pct = DEFAULT_WARN_ERROR_PCT,
  } = {}
) {
  const owner = String(ownerUserId || '').trim();
  const key = String(memberKey || '').trim();
  if (!owner || !key) throw new Error('owner and member_key are required');
  const tokens = toIntOrNull(monthly_token_budget);
  const errPct = toPctOrNull(error_budget_pct);
  getDb()
    .prepare(
      `INSERT INTO agent_ops_budgets
         (owner_user_id, member_key, period, monthly_token_budget, error_budget_pct, warn_token_pct, warn_error_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_user_id, member_key, period) DO UPDATE SET
         monthly_token_budget = excluded.monthly_token_budget,
         error_budget_pct = excluded.error_budget_pct,
         warn_token_pct = excluded.warn_token_pct,
         warn_error_pct = excluded.warn_error_pct,
         updated_at = datetime('now')`
    )
    .run(
      owner,
      key,
      String(period),
      tokens,
      errPct,
      toPctOrNull(warn_token_pct) ?? DEFAULT_WARN_TOKEN_PCT,
      toPctOrNull(warn_error_pct) ?? DEFAULT_WARN_ERROR_PCT
    );
  console.log(
    `[budgets] set member=${key} owner=${owner} period=${period} tokens=${tokens ?? 'none'} error_pct=${errPct ?? 'none'}`
  );
  return getAgentBudget(owner, key, { period, carryForward: false });
}

/**
 * Budget for a member/period. When `carryForward` is set and the period has no row, the most
 * recent earlier budget is copied forward on first use so budgets do not silently disappear.
 */
export function getAgentBudget(ownerUserId, memberKey, { period = monthPeriod(), carryForward = true } = {}) {
  const owner = String(ownerUserId || '').trim();
  const key = String(memberKey || '').trim();
  if (!owner || !key) return null;
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT * FROM agent_ops_budgets WHERE owner_user_id = ? AND member_key = ? AND period = ?`
    )
    .get(owner, key, String(period));
  if (existing) return mapBudget(existing);
  if (!carryForward) return null;
  const prior = db
    .prepare(
      `SELECT * FROM agent_ops_budgets
       WHERE owner_user_id = ? AND member_key = ? AND period < ?
       ORDER BY period DESC LIMIT 1`
    )
    .get(owner, key, String(period));
  if (!prior) return null;
  try {
    db.prepare(
      `INSERT OR IGNORE INTO agent_ops_budgets
         (owner_user_id, member_key, period, monthly_token_budget, error_budget_pct, warn_token_pct, warn_error_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      owner,
      key,
      String(period),
      prior.monthly_token_budget,
      prior.error_budget_pct,
      prior.warn_token_pct,
      prior.warn_error_pct
    );
    console.log(`[budgets] carried forward member=${key} owner=${owner} into period=${period}`);
  } catch (e) {
    console.warn('[budgets] carry-forward failed', key, e?.message || e);
  }
  return getAgentBudget(owner, key, { period, carryForward: false });
}

export function listAgentBudgets(ownerUserId, period = monthPeriod()) {
  if (!ownerUserId) return [];
  return getDb()
    .prepare(`SELECT * FROM agent_ops_budgets WHERE owner_user_id = ? AND period = ?`)
    .all(String(ownerUserId), String(period))
    .map(mapBudget);
}

/**
 * Terminal (completed/failed) call counts for a member in a month.
 * Internal agents: Kanban tasks assigned to them (delegations land here too).
 * Leaf members: recorded outbound invocations.
 */
export function getMemberOutcomes(ownerUserId, memberKey, period = monthPeriod()) {
  const owner = String(ownerUserId || '').trim();
  const key = String(memberKey || '').trim();
  if (!owner || !key) return { completed: 0, failed: 0, terminal: 0, failure_rate: null };
  const db = getDb();
  let completed = 0;
  let failed = 0;

  if (!key.startsWith('ext:') && !key.startsWith('a2a:')) {
    const scope = getKanbanScopeIds(owner);
    const ph = scope.map(() => '?').join(',');
    const row = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM kanban_tasks
         WHERE owner_user_id IN (${ph})
           AND assigned_agent_id = ?
           AND status IN ('completed', 'failed')
           AND strftime('%Y-%m', updated_at, 'localtime') = ?`
      )
      .get(...scope, key, String(period));
    completed += Number(row?.completed) || 0;
    failed += Number(row?.failed) || 0;
  }

  const invRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM org_member_invocations
       WHERE owner_user_id = ? AND member_key = ?
         AND strftime('%Y-%m', created_at, 'localtime') = ?`
    )
    .get(owner, key, String(period));
  completed += Number(invRow?.completed) || 0;
  failed += Number(invRow?.failed) || 0;

  const terminal = completed + failed;
  return {
    completed,
    failed,
    terminal,
    failure_rate: terminal > 0 ? (failed / terminal) * 100 : null,
  };
}

/**
 * Month-to-date budget status for a member.
 * @returns {{ state: 'ok'|'warn'|'blocked', ... }}
 */
export function getMemberBudgetStatus(ownerUserId, memberKey, { period = monthPeriod() } = {}) {
  const owner = String(ownerUserId || '').trim();
  const key = String(memberKey || '').trim();
  const budget = getAgentBudget(owner, key, { period });
  const usage = getMonthlyTokens(owner, key, period);
  const outcomes = getMemberOutcomes(owner, key, period);

  const tokenBudget = budget?.monthly_token_budget ?? null;
  const tokenPct =
    tokenBudget && tokenBudget > 0 ? (usage.total_tokens / tokenBudget) * 100 : null;
  const errorBudget = budget?.error_budget_pct ?? null;
  const warnTokenPct = budget?.warn_token_pct ?? DEFAULT_WARN_TOKEN_PCT;
  const warnErrorPct = budget?.warn_error_pct ?? DEFAULT_WARN_ERROR_PCT;

  const reasons = [];
  let state = 'ok';

  if (tokenPct != null && tokenPct >= 100) {
    state = 'blocked';
    reasons.push(
      `Monthly token budget exhausted (${usage.total_tokens.toLocaleString('en-US')} / ${tokenBudget.toLocaleString('en-US')} tokens)`
    );
  } else if (tokenPct != null && tokenPct >= warnTokenPct) {
    state = 'warn';
    reasons.push(`Token budget at ${Math.round(tokenPct)}% of ${tokenBudget.toLocaleString('en-US')}`);
  }

  if (errorBudget != null && outcomes.failure_rate != null) {
    const errorUsePct = errorBudget > 0 ? (outcomes.failure_rate / errorBudget) * 100 : 100;
    if (
      outcomes.failure_rate >= errorBudget &&
      outcomes.terminal >= MIN_TERMINAL_CALLS_FOR_ERROR_BLOCK
    ) {
      state = 'blocked';
      reasons.push(
        `Failure rate ${outcomes.failure_rate.toFixed(1)}% is at/over the ${errorBudget}% error budget (${outcomes.failed}/${outcomes.terminal} calls)`
      );
    } else if (errorUsePct >= warnErrorPct && state !== 'blocked') {
      state = 'warn';
      reasons.push(
        `Failure rate ${outcomes.failure_rate.toFixed(1)}% against a ${errorBudget}% error budget`
      );
    }
  }

  return {
    owner_user_id: owner,
    member_key: key,
    period,
    state,
    reasons,
    tokens_used: usage.total_tokens,
    tokens_estimated: usage.estimated_tokens,
    token_calls: usage.calls,
    monthly_token_budget: tokenBudget,
    token_pct: tokenPct == null ? null : Math.round(tokenPct * 10) / 10,
    warn_token_pct: warnTokenPct,
    error_budget_pct: errorBudget,
    warn_error_pct: warnErrorPct,
    completed: outcomes.completed,
    failed: outcomes.failed,
    terminal_calls: outcomes.terminal,
    failure_rate: outcomes.failure_rate == null ? null : Math.round(outcomes.failure_rate * 10) / 10,
    min_terminal_calls_for_error_block: MIN_TERMINAL_CALLS_FOR_ERROR_BLOCK,
  };
}

function warnNotificationKey(memberKey, period) {
  const day = new Date().toISOString().slice(0, 10);
  return `budget-warn:${memberKey}:${period}:${day}`;
}

function notifyBudgetWarning(ownerUserId, memberKey, memberLabel, status) {
  try {
    sendPlatformNotifications({
      userIds: [ownerUserId],
      title: `Budget warning — ${memberLabel || memberKey}`,
      body: status.reasons.join(' · '),
      linkUrl: '/efficiency?tab=agent',
      createdBy: 'system:budgets',
      source: 'agent-budget',
      sourceKey: warnNotificationKey(memberKey, status.period),
    });
  } catch (e) {
    console.warn('[budgets] warn notification failed', memberKey, e?.message || e);
  }
}

/**
 * Gate new delegated / interactive work for a member.
 * Warns (once per day) at the warn threshold and throws {@link BudgetBlockedError} at 100%.
 *
 * @param {string} ownerUserId
 * @param {string} memberKey internal agent id or org_agent_members.id
 * @param {{ action?: string, memberLabel?: string, throwOnBlock?: boolean }} [opts]
 */
export function enforceBudget(ownerUserId, memberKey, opts = {}) {
  const { action = 'work', memberLabel = '', throwOnBlock = true } = opts;
  const owner = String(ownerUserId || '').trim();
  const key = String(memberKey || '').trim();
  if (!owner || !key) return { state: 'ok', reasons: [] };
  let status;
  try {
    status = getMemberBudgetStatus(owner, key);
  } catch (e) {
    console.warn('[budgets] status check failed, allowing', key, e?.message || e);
    return { state: 'ok', reasons: [], error: e?.message || String(e) };
  }
  if (status.state === 'warn') {
    console.warn(
      `[budgets] warn member=${key} owner=${owner} action=${action} reasons="${status.reasons.join('; ')}"`
    );
    notifyBudgetWarning(owner, key, memberLabel, status);
  }
  if (status.state === 'blocked') {
    console.warn(
      `[budgets] BLOCKED member=${key} owner=${owner} action=${action} reasons="${status.reasons.join('; ')}"`
    );
    if (throwOnBlock) {
      throw new BudgetBlockedError(
        `${memberLabel || key} is over its monthly budget: ${status.reasons.join('; ')}. Raise the budget in Efficiency → Agent View or wait for next month.`,
        status
      );
    }
  }
  return status;
}

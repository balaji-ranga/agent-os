/**
 * Efficiency → LLMOps dashboard aggregate. Owner-scoped. No secrets.
 */
import { getDb } from '../db/schema.js';
import { parseEfficiencyRange } from './efficiency.js';
import {
  getOwnerTokenTotals,
  getOwnerTokensBySource,
  getOwnerTokensByModel,
  listRecentTraces,
  monthPeriod,
} from './token-usage.js';
import {
  valueTokenUsage,
  getPriceBook,
  listManualCostLines,
  ensureDefaultPriceBook,
} from './llmops-cost.js';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rangeBounds(days) {
  const range = parseEfficiencyRange(days);
  if (!range.days) return { since: null, until: todayKey(), range };
  const until = todayKey();
  const d = new Date();
  d.setDate(d.getDate() - (range.days - 1));
  const since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { since, until, range };
}

function qualitySignals(ownerUserId, since, until) {
  const db = getDb();
  const owner = String(ownerUserId);
  const dateSql = since && until ? ` AND date(created_at, 'localtime') BETWEEN ? AND ?` : '';
  const dateParams = since && until ? [since, until] : [];

  let feedback = { up: 0, down: 0, positive_pct: null };
  try {
    const rows = db
      .prepare(
        `SELECT rating, COUNT(*) AS c FROM agent_response_feedback
         WHERE owner_user_id = ?${dateSql.replace('created_at', 'created_at')}
         GROUP BY rating`
      )
      .all(owner, ...dateParams);
    const up = Number(rows.find((r) => r.rating === 'up')?.c) || 0;
    const down = Number(rows.find((r) => r.rating === 'down')?.c) || 0;
    const tot = up + down;
    feedback = {
      up,
      down,
      positive_pct: tot > 0 ? Math.round((up / tot) * 100) : null,
    };
  } catch (e) {
    console.warn('[llmops] feedback query failed:', e?.message || e);
  }

  let goals = { completed: 0, failed: 0, running: 0 };
  try {
    const gDate = since && until ? ` AND date(created_at, 'localtime') BETWEEN ? AND ?` : '';
    const rows = db
      .prepare(
        `SELECT status, COUNT(*) AS c FROM agent_goal_runs
         WHERE owner_user_id = ?${gDate}
         GROUP BY status`
      )
      .all(owner, ...dateParams);
    for (const r of rows) {
      const s = String(r.status || '').toLowerCase();
      if (s === 'completed' || s === 'ok' || s === 'success') goals.completed += Number(r.c) || 0;
      else if (s === 'failed' || s === 'error') goals.failed += Number(r.c) || 0;
      else goals.running += Number(r.c) || 0;
    }
  } catch (e) {
    console.warn('[llmops] goal query failed:', e?.message || e);
  }

  let policy_decisions = 0;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM goal_mission_events
         WHERE owner_user_id = ? AND event_type = 'policy_decision'${dateSql}`
      )
      .get(owner, ...dateParams);
    policy_decisions = Number(row?.n) || 0;
  } catch (e) {
    console.warn('[llmops] policy events query failed:', e?.message || e);
  }

  return { feedback, goals, policy_decisions };
}

/**
 * CEO LLMOps snapshot: meters, estimated $, traces, quality (thumbs / goals / policy).
 */
export function getLlmopsSummary(ownerUserId, { days = 30 } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('owner_user_id required');
    err.status = 400;
    throw err;
  }
  ensureDefaultPriceBook();
  const { since, until, range } = rangeBounds(days);
  const window = { since, until };
  const tokens = getOwnerTokenTotals(owner, window);
  const by_source = getOwnerTokensBySource(owner, window);
  const by_model = getOwnerTokensByModel(owner, window);
  const valued = valueTokenUsage(owner, window);
  const period = monthPeriod();
  const manuals = listManualCostLines(owner, { period });
  const manual_usd = Math.round(manuals.reduce((a, r) => a + Number(r.amount_usd || 0), 0) * 100) / 100;
  const book = getPriceBook(owner);
  const traces = listRecentTraces(owner, { limit: 40, ...window });
  const quality = qualitySignals(owner, since, until);

  return {
    owner_user_id: owner,
    range: range.key,
    days: range.days,
    since,
    until,
    period,
    tokens,
    by_source,
    by_model,
    cost: {
      llm_estimated_usd: valued.amount_usd,
      manual_usd,
      total_estimated_usd: Math.round((valued.amount_usd + manual_usd) * 10000) / 10000,
      payer: valued.payer,
      currency: 'USD',
      lines: valued.lines,
      manuals,
      disclaimer:
        'LLM $ uses your price book (or platform estimate catalog). Not a provider invoice. Digest Est. Value is imputed hours, not this number. OEI is ops, not money.',
    },
    traces,
    quality,
    price_book: book,
    split: {
      product:
        'Efficiency → LLMOps / Agent View / Goal execution trace / workflow run audit. Quality: thumbs, Maker/Checker, Policies.',
      operator:
        'Admin → AgentSystem recovery, Admin → Crons, PLATFORM_LOG_LEVEL. Not shown here.',
    },
  };
}

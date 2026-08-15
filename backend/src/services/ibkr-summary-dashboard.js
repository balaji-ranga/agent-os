/**
 * IBKR Summary dashboard: portfolio snapshot + day-wise planned vs executed.
 * Owner-scoped only (no body spoof).
 */
import { getDb } from '../db/schema.js';
import { ensureIbkrMonthlyTables } from './ibkr-monthly-guardrail.js';
import { getMonthlyGuardrail } from './ibkr-monthly-guardrail.js';
import { listPlansHistory, getPlan, OPEN_PLAN_STATUSES, PLAN_STATUSES } from './trading-day-plans.js';
import { mapDayPlanToBridgeOrders } from './trading-plan-bridge-map.js';
import { getDayStatus } from './ibkr-trading-ledger.js';
import { getIbkrTradingConfig } from './ibkr-trading-rules.js';

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function actionType(a = {}) {
  return String(a.type || a.action || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
}

function notionalOfAction(a) {
  const qty = Number(a.qty ?? a.quantity);
  const px = Number(a.entry_price ?? a.entryPrice ?? a.trigger_price ?? a.price);
  const notional = Number(a.notional_usd ?? a.notionalUsd);
  if (Number.isFinite(notional) && notional > 0) return notional;
  if (Number.isFinite(qty) && qty > 0 && Number.isFinite(px) && px > 0) return qty * px;
  return null;
}

/**
 * Summarize Maker plan actions for dashboard rows.
 */
export function summarizePlanActions(planRow) {
  let plan = planRow?.plan;
  if (typeof plan === 'string') {
    try {
      plan = JSON.parse(plan);
      while (typeof plan === 'string') plan = JSON.parse(plan);
    } catch {
      plan = {};
    }
  }
  plan = plan && typeof plan === 'object' ? plan : {};
  const actions = asArray(plan.actions);
  const byType = {};
  let plannedNotionalUsd = 0;
  let notionalKnown = true;
  for (const a of actions) {
    const t = actionType(a) || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
    if (t === 'new_entry' || t === 'buy' || t === 'entry') {
      const n = notionalOfAction(a);
      if (n != null) plannedNotionalUsd += n;
      else notionalKnown = false;
    }
  }
  const mapping = mapDayPlanToBridgeOrders(planRow || {});
  return {
    action_count: actions.length,
    by_type: byType,
    planned_notional_usd: Number(plannedNotionalUsd.toFixed(2)),
    planned_notional_complete: notionalKnown,
    mappable: {
      trades: mapping.summary?.trade_count || 0,
      stops: mapping.summary?.stop_count || 0,
      sells: mapping.summary?.sell_count || 0,
      skipped: mapping.summary?.skipped_count || 0,
      actionable: mapping.summary?.actionable || 0,
    },
    actions: actions.map((a) => ({
      type: actionType(a),
      key: a.key || a.symbol || null,
      qty: a.qty ?? a.quantity ?? null,
      entry_price: a.entry_price ?? a.entryPrice ?? null,
      stop_price: a.stop_price ?? a.stopPrice ?? null,
      tp_price: a.tp_price ?? a.tpPrice ?? null,
      requires_ceo_approval: !!(a.requires_ceo_approval || a.requiresCeoApproval),
      notional_usd: notionalOfAction(a),
      thesis: a.thesis || a.rationale || null,
    })),
  };
}

/** Parse nested JSON strings (W2 desktop often stores execute bodyText as a string). */
function deepParseJson(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return value;
  try {
    return deepParseJson(JSON.parse(t), depth + 1);
  } catch {
    return value;
  }
}

/**
 * Collect IB order ids from flat report fields, place_bracket.results, or a stringified execute body.
 */
function collectOrderIdsFromReport(root) {
  const orderIds = [];
  const seen = new Set();
  const pushId = (id) => {
    if (id == null || id === '') return;
    const n = typeof id === 'number' ? id : Number(String(id).trim());
    const key = Number.isFinite(n) ? n : String(id);
    if (seen.has(key)) return;
    seen.add(key);
    orderIds.push(Number.isFinite(n) ? n : id);
  };

  const walk = (node, depth = 0) => {
    if (node == null || depth > 10) return;
    node = deepParseJson(node);
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    for (const k of ['order_ids', 'orderIds']) {
      for (const id of asArray(node[k])) pushId(id);
    }
    // Single order id on a place result row (not parent_id / account numbers).
    if (node.order_id != null && (node.orderIds == null || asArray(node.orderIds).length === 0)) {
      if (node.ok === true || node.side || node.contract || node.key) pushId(node.order_id);
    }
    if (node.place_bracket != null) walk(node.place_bracket, depth + 1);
    if (node.results != null) walk(node.results, depth + 1);
    if (node.execute != null) walk(node.execute, depth + 1);
    if (node.mapping != null && depth < 4) walk(node.mapping, depth + 1);
  };

  walk(root);
  return orderIds;
}

function extractExecution(planRow) {
  let plan = planRow?.plan;
  if (typeof plan === 'string') plan = deepParseJson(plan);
  plan = plan && typeof plan === 'object' ? plan : {};
  let approvals = planRow?.approvals;
  if (typeof approvals === 'string') approvals = deepParseJson(approvals);
  approvals = approvals && typeof approvals === 'object' ? approvals : {};

  let exec = plan.execution || approvals.execution || null;
  exec = deepParseJson(exec);
  if (!exec || typeof exec !== 'object') {
    return {
      has_report: false,
      status: planRow?.status || null,
      source: null,
      phase: null,
      updated_at: null,
      order_ids: [],
      dry_run: null,
      raw: null,
    };
  }

  let execute = deepParseJson(exec.execute ?? null);
  if (execute && typeof execute !== 'object') execute = null;

  const placeRaw = execute?.place_bracket ?? exec.place_bracket ?? null;
  let placeObj = deepParseJson(placeRaw);
  if (placeObj && typeof placeObj !== 'object') placeObj = { text: String(placeRaw) };

  // Flat report fields + nested place_bracket / stringified W2 execute body (bodyText).
  const orderIds = collectOrderIdsFromReport({
    order_ids: exec.order_ids || exec.orderIds,
    orderIds: exec.orderIds || exec.order_ids,
    execute,
    place_bracket: placeObj,
  });

  const dryRaw = exec.dry_run ?? execute?.dry_run ?? placeObj?.dry_run;
  return {
    has_report: true,
    status: exec.status || planRow?.status || null,
    source: exec.source || null,
    phase: exec.phase || null,
    updated_at: exec.updated_at || null,
    order_ids: orderIds,
    dry_run: dryRaw === true ? true : dryRaw === false ? false : null,
    suggested_status: execute?.suggested_status || null,
    mapping_summary: execute?.mapping?.summary || placeObj?.mapping?.summary || null,
    mapping_skipped_reasons: asArray(execute?.mapping?.skipped || placeObj?.mapping?.skipped)
      .map((s) => s?.reason)
      .filter(Boolean),
    place_ok: placeObj?.ok,
    place_skipped: placeObj?.skipped === true,
    raw: exec,
  };
}

function dayRow(planRow) {
  const planned = summarizePlanActions(planRow);
  const executed = extractExecution(planRow);
  return {
    id: planRow.id,
    plan_date: planRow.plan_date,
    status: planRow.status,
    updated_at: planRow.updated_at,
    created_at: planRow.created_at,
    planned,
    executed,
    planned_vs_executed: {
      planned_actionable: planned.mappable.actionable,
      reported: executed.has_report,
      order_count: executed.order_ids.length,
      terminal:
        ['executed', 'superseded', 'failed'].includes(String(planRow.status || '').toLowerCase()) ||
        false,
      gap_notes: buildGapNotes(planned, executed, planRow.status),
    },
  };
}

function buildGapNotes(planned, executed, status) {
  const notes = [];
  if (planned.action_count === 0) notes.push('No maker actions stored on this day plan.');
  if (planned.mappable.actionable > 0 && !executed.has_report && status === 'approved') {
    notes.push('Plan approved but not yet executed on laptop (W2).');
  }
  if (executed.place_skipped) {
    const reasons = (executed.mapping_skipped_reasons || []).join(', ');
    notes.push(
      reasons
        ? `Bridge skipped placing: ${reasons}`
        : 'Bridge reported place skip (no trades[] / empty mapping).'
    );
  }
  if (executed.dry_run) notes.push('Execution was dry-run (IBKR_TRADING_ENABLED off).');
  if (planned.mappable.actionable > 0 && executed.has_report && executed.order_ids.length === 0 && !executed.dry_run) {
    notes.push('Actions mapped as actionable but no order ids recorded in execution report.');
  }
  if (status === 'partial') notes.push('Partial — residual legs may remain for next session.');
  return notes;
}

/**
 * Portfolio + day timeline for IBKR Summary page.
 */
export async function getSummaryDashboard(ownerUserId, { days = 30, includeLive = false } = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');

  const d = Math.min(Math.max(Number(days) || 30, 1), 180);
  const plans = listPlansHistory(owner, { days: d, limit: 120 });
  const daysOut = plans.map(dayRow);

  let analytics = null;
  try {
    const { getPortfolioAnalytics, ensureIbkrAnalyticsTables } = await import('./ibkr-analytics.js');
    ensureIbkrAnalyticsTables();
    analytics = await getPortfolioAnalytics(owner, { days: d, includeLive: !!includeLive });
  } catch (e) {
    analytics = { ok: false, error: e.message || String(e) };
  }

  let guardrail = null;
  try {
    guardrail = getMonthlyGuardrail(owner, {});
  } catch (e) {
    guardrail = { ok: false, error: e.message || String(e) };
  }

  let dayStatus = null;
  try {
    dayStatus = getDayStatus(owner, {});
  } catch (e) {
    dayStatus = { error: e.message || String(e) };
  }

  const openCount = daysOut.filter((r) => OPEN_PLAN_STATUSES.includes(r.status)).length;
  const executedDays = daysOut.filter((r) => r.status === 'executed').length;

  return {
    ok: true,
    owner_user_id: owner,
    days: d,
    gateway: getIbkrTradingConfig(),
    budget: dayStatus,
    guardrail,
    portfolio: analytics,
    totals: {
      plan_days: daysOut.length,
      open_plans: openCount,
      executed_days: executedDays,
      planned_actionable_sum: daysOut.reduce((s, r) => s + (r.planned?.mappable?.actionable || 0), 0),
      order_ids_recorded: daysOut.reduce((s, r) => s + (r.executed?.order_ids?.length || 0), 0),
    },
    day_rows: daysOut,
    plan_statuses: PLAN_STATUSES,
    open_plan_statuses: OPEN_PLAN_STATUSES,
  };
}

/**
 * Single day drilldown: full plan JSON + mapping + order events for that day.
 */
export function getDayDrilldown(ownerUserId, planDate) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  const date = String(planDate || '').slice(0, 10);
  if (!owner) throw new Error('owner_user_id is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('plan_date YYYY-MM-DD required');

  const plan = getPlan(owner, { plan_date: date });
  if (!plan) {
    return { ok: false, error: 'plan_not_found', plan_date: date };
  }
  const summary = dayRow(plan);
  const mapping = mapDayPlanToBridgeOrders(plan);

  let orderEvents = [];
  try {
    orderEvents = getDb()
      .prepare(
        `SELECT id, status, symbol_key, symbol, side, ib_order_id, reason_code, reason_text,
                source, qty, detail_json, created_at
         FROM ibkr_order_events
         WHERE owner_user_id = ?
           AND date(created_at) = date(?)
         ORDER BY id DESC
         LIMIT 100`
      )
      .all(owner, date)
      .map((r) => {
        let detail = null;
        try {
          detail = r.detail_json ? JSON.parse(r.detail_json) : null;
        } catch {
          detail = r.detail_json;
        }
        return {
          id: r.id,
          event_type: r.status,
          status: r.status,
          symbol_key: r.symbol_key,
          symbol: r.symbol,
          side: r.side,
          order_id: r.ib_order_id,
          reason: r.reason_text || r.reason_code || null,
          source: r.source,
          qty: r.qty,
          created_at: r.created_at,
          detail,
        };
      });
  } catch {
    orderEvents = [];
  }

  let fills = [];
  try {
    fills = getDb()
      .prepare(
        `SELECT * FROM ibkr_fills
         WHERE owner_user_id = ?
           AND date(filled_at) = date(?)
         ORDER BY id DESC
         LIMIT 50`
      )
      .all(owner, date);
  } catch {
    fills = [];
  }

  return {
    ok: true,
    plan_date: date,
    day: summary,
    plan,
    mapping,
    order_events: orderEvents,
    fills,
  };
}
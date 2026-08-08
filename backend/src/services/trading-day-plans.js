/**
 * Trading day plans CRUD (Maker/Checker output stored for laptop execution fetch).
 * Statuses support plan lifecycle + laptop<->VPS execution recovery.
 */
import { getDb } from '../db/schema.js';
import { ensureIbkrMonthlyTables } from './ibkr-monthly-guardrail.js';

/** @type {readonly string[]} */
export const PLAN_STATUSES = Object.freeze([
  'pending',
  'approved',
  'executing',
  'partial',
  'executed',
  'failed',
  'superseded',
]);

/** Plans still open for recovery / W2 execution. */
export const OPEN_PLAN_STATUSES = Object.freeze(['approved', 'executing', 'partial', 'failed']);

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseJson(text, fallback = null) {
  if (text == null || text === '') return fallback;
  if (typeof text === 'object') return text;
  try {
    let v = JSON.parse(text);
    // Workflow templates often pass {{hard-gates.plan_json}} already as a JSON string.
    while (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        break;
      }
    }
    return v;
  } catch {
    return fallback;
  }
}

/** Normalize plan/verdict/approvals for DB column: single JSON.stringify of an object. */
function toJsonColumn(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const parsed = parseJson(value, null);
    return parsed != null ? JSON.stringify(parsed) : value;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return null;
}

function normalizeStatus(status, { allowNull = false } = {}) {
  const st = String(status || '').trim().toLowerCase();
  if (!st) {
    if (allowNull) return null;
    throw new Error('status is required');
  }
  if (!PLAN_STATUSES.includes(st)) {
    throw new Error(`invalid status "${st}"; expected one of: ${PLAN_STATUSES.join('|')}`);
  }
  return st;
}

function rowToPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    plan_date: row.plan_date,
    status: row.status,
    plan: parseJson(row.plan_json, null),
    checker_verdict: parseJson(row.checker_verdict_json, null),
    approvals: parseJson(row.approvals_json, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Upsert plan for owner+date.
 * @param {string} ownerUserId
 * @param {{ plan_date?: string, status?: string, plan?: object, checker_verdict?: object, approvals?: object }} body
 */
export function savePlan(ownerUserId, body = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');

  const planDate = String(body.plan_date || body.date || todayUtcDate()).slice(0, 10);
  const status = normalizeStatus(body.status || 'pending');
  const planJson = toJsonColumn(body.plan != null ? body.plan : body.plan_json);
  const verdictJson = toJsonColumn(
    body.checker_verdict != null ? body.checker_verdict : body.checker_verdict_json
  );
  const approvalsJson = toJsonColumn(body.approvals != null ? body.approvals : body.approvals_json);

  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM trading_day_plans WHERE owner_user_id = ? AND plan_date = ?')
    .get(owner, planDate);

  if (existing) {
    db.prepare(
      `UPDATE trading_day_plans SET
         status = ?,
         plan_json = COALESCE(?, plan_json),
         checker_verdict_json = COALESCE(?, checker_verdict_json),
         approvals_json = COALESCE(?, approvals_json),
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(status, planJson, verdictJson, approvalsJson, existing.id);
    console.log(
      '[trading-day-plans] updated id=%s owner=%s date=%s status=%s',
      existing.id,
      owner,
      planDate,
      status
    );
  } else {
    const info = db
      .prepare(
        `INSERT INTO trading_day_plans
           (owner_user_id, plan_date, status, plan_json, checker_verdict_json, approvals_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(owner, planDate, status, planJson, verdictJson, approvalsJson);
    console.log(
      '[trading-day-plans] created id=%s owner=%s date=%s status=%s',
      info.lastInsertRowid,
      owner,
      planDate,
      status
    );
  }

  return getPlan(owner, { plan_date: planDate });
}

export function getPlan(ownerUserId, { plan_date = null, date = null } = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  const planDate = String(plan_date || date || todayUtcDate()).slice(0, 10);
  const row = getDb()
    .prepare('SELECT * FROM trading_day_plans WHERE owner_user_id = ? AND plan_date = ?')
    .get(owner, planDate);
  return rowToPlan(row);
}

/**
 * List plans still open for recovery / execution.
 * Status in approved|executing|partial|failed.
 * @param {string} ownerUserId
 * @param {{ limit?: number }} [opts]
 */
export function listOpenPlans(ownerUserId, { limit = 14 } = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  const lim = Math.min(Math.max(Number(limit) || 14, 1), 90);
  const placeholders = OPEN_PLAN_STATUSES.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT * FROM trading_day_plans
       WHERE owner_user_id = ? AND status IN (${placeholders})
       ORDER BY plan_date DESC
       LIMIT ?`
    )
    .all(owner, ...OPEN_PLAN_STATUSES, lim);
  console.log('[trading-day-plans] listOpenPlans owner=%s count=%s limit=%s', owner, rows.length, lim);
  return rows.map(rowToPlan);
}

export function updateStatus(ownerUserId, { plan_date, status, approvals = undefined } = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  const planDate = String(plan_date || todayUtcDate()).slice(0, 10);
  const st = normalizeStatus(status);

  const db = getDb();
  const row = db
    .prepare('SELECT id FROM trading_day_plans WHERE owner_user_id = ? AND plan_date = ?')
    .get(owner, planDate);
  if (!row) throw new Error(`no plan for ${planDate}`);

  if (approvals !== undefined) {
    db.prepare(
      `UPDATE trading_day_plans SET status = ?, approvals_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(st, JSON.stringify(approvals), row.id);
  } else {
    db.prepare(
      `UPDATE trading_day_plans SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(st, row.id);
  }
  console.log('[trading-day-plans] status id=%s status=%s', row.id, st);
  return getPlan(owner, { plan_date: planDate });
}

/**
 * Normalize W2 / bridge execution_report: parse stringified execute body and denormalize order_ids.
 * Desktop package often sends execute as bodyText (JSON string), not nested objects.
 */
function normalizeExecutionReport(report) {
  if (report == null) return null;
  let r = report;
  if (typeof r === 'string') {
    r = parseJson(r, null);
    if (!r || typeof r !== 'object') return { notes: String(report).slice(0, 500) };
  }
  if (typeof r !== 'object' || Array.isArray(r)) return r;

  const out = { ...r };
  if (typeof out.execute === 'string') {
    const parsed = parseJson(out.execute, null);
    if (parsed != null) out.execute = parsed;
  }

  const ids = [];
  const push = (id) => {
    if (id == null || id === '') return;
    const n = typeof id === 'number' ? id : Number(String(id).trim());
    if (!Number.isFinite(n) && typeof id !== 'string') return;
    const v = Number.isFinite(n) ? n : id;
    if (!ids.includes(v)) ids.push(v);
  };
  for (const id of Array.isArray(out.order_ids) ? out.order_ids : []) push(id);
  for (const id of Array.isArray(out.orderIds) ? out.orderIds : []) push(id);

  const place =
    (out.execute && typeof out.execute === 'object' && out.execute.place_bracket) ||
    out.place_bracket ||
    null;
  let placeObj = place;
  if (typeof placeObj === 'string') placeObj = parseJson(placeObj, null);
  if (placeObj && typeof placeObj === 'object') {
    for (const row of Array.isArray(placeObj.results) ? placeObj.results : []) {
      for (const id of row?.orderIds || row?.order_ids || []) push(id);
    }
  }
  // Full bridge body sometimes sits on execute (ok, dry_run, place_bracket, …)
  if (out.execute && typeof out.execute === 'object') {
    for (const id of out.execute.order_ids || out.execute.orderIds || []) push(id);
    const nested = out.execute.place_bracket;
    let nestedPlace = nested;
    if (typeof nestedPlace === 'string') nestedPlace = parseJson(nestedPlace, null);
    if (nestedPlace && typeof nestedPlace === 'object') {
      for (const row of Array.isArray(nestedPlace.results) ? nestedPlace.results : []) {
        for (const id of row?.orderIds || row?.order_ids || []) push(id);
      }
    }
    if (out.dry_run == null && out.execute.dry_run != null) out.dry_run = out.execute.dry_run;
  }

  if (ids.length) out.order_ids = ids;
  return out;
}

/**
 * Merge an execution report into plan_json.execution (and approvals_json.execution)
 * and set status (typically executing|partial|executed|failed).
 * @param {string} ownerUserId
 * @param {{ plan_date?: string, status: string, execution_report?: object }} body
 */
export function markPlanExecution(ownerUserId, body = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  const planDate = String(body.plan_date || body.date || todayUtcDate()).slice(0, 10);
  const st = normalizeStatus(body.status);
  const reportRaw = body.execution_report != null ? body.execution_report : body.execution || null;
  const report = reportRaw != null ? normalizeExecutionReport(reportRaw) : null;

  const db = getDb();
  const row = db
    .prepare('SELECT * FROM trading_day_plans WHERE owner_user_id = ? AND plan_date = ?')
    .get(owner, planDate);
  if (!row) throw new Error(`no plan for ${planDate}`);

  const plan = parseJson(row.plan_json, {}) || {};
  const approvals = parseJson(row.approvals_json, {}) || {};
  const stamp = new Date().toISOString();

  if (report != null) {
    const prevExec =
      plan.execution && typeof plan.execution === 'object' && !Array.isArray(plan.execution)
        ? plan.execution
        : {};
    plan.execution = {
      ...prevExec,
      ...report,
      updated_at: stamp,
      status: st,
    };
    const prevApprExec =
      approvals.execution && typeof approvals.execution === 'object' && !Array.isArray(approvals.execution)
        ? approvals.execution
        : {};
    approvals.execution = {
      ...prevApprExec,
      ...report,
      updated_at: stamp,
      status: st,
    };
  }

  db.prepare(
    `UPDATE trading_day_plans SET
       status = ?,
       plan_json = ?,
       approvals_json = ?,
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(st, JSON.stringify(plan), JSON.stringify(approvals), row.id);

  console.log(
    '[trading-day-plans] markPlanExecution id=%s date=%s status=%s has_report=%s',
    row.id,
    planDate,
    st,
    report != null
  );
  return getPlan(owner, { plan_date: planDate });
}
/**
 * List plans for owner within date window (inclusive), newest first.
 * @param {string} ownerUserId
 * @param {{ days?: number, limit?: number, status?: string|null }} [opts]
 */
export function listPlansHistory(ownerUserId, { days = 30, limit = 90, status = null } = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  const lim = Math.min(Math.max(Number(limit) || 90, 1), 200);
  const d = Math.min(Math.max(Number(days) || 30, 1), 365);
  const db = getDb();
  let rows;
  if (status) {
    const st = normalizeStatus(status);
    rows = db
      .prepare(
        `SELECT * FROM trading_day_plans
         WHERE owner_user_id = ?
           AND status = ?
           AND plan_date >= date('now', ?)
         ORDER BY plan_date DESC
         LIMIT ?`
      )
      .all(owner, st, `-${d} days`, lim);
  } else {
    rows = db
      .prepare(
        `SELECT * FROM trading_day_plans
         WHERE owner_user_id = ?
           AND plan_date >= date('now', ?)
         ORDER BY plan_date DESC
         LIMIT ?`
      )
      .all(owner, `-${d} days`, lim);
  }
  return rows.map(rowToPlan);
}
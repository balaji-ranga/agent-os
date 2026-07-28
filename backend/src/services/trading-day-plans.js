/**
 * Trading day plans CRUD (Maker/Checker output stored for laptop execution fetch).
 */
import { getDb } from '../db/schema.js';
import { ensureIbkrMonthlyTables } from './ibkr-monthly-guardrail.js';

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseJson(text, fallback = null) {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
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
  const status = String(body.status || 'pending').trim() || 'pending';
  const planJson = body.plan != null ? JSON.stringify(body.plan) : body.plan_json ?? null;
  const verdictJson =
    body.checker_verdict != null
      ? JSON.stringify(body.checker_verdict)
      : body.checker_verdict_json ?? null;
  const approvalsJson =
    body.approvals != null ? JSON.stringify(body.approvals) : body.approvals_json ?? null;

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
    console.log('[trading-day-plans] updated id=%s owner=%s date=%s status=%s', existing.id, owner, planDate, status);
  } else {
    const info = db
      .prepare(
        `INSERT INTO trading_day_plans
           (owner_user_id, plan_date, status, plan_json, checker_verdict_json, approvals_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(owner, planDate, status, planJson, verdictJson, approvalsJson);
    console.log('[trading-day-plans] created id=%s owner=%s date=%s status=%s', info.lastInsertRowid, owner, planDate, status);
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

export function updateStatus(ownerUserId, { plan_date, status, approvals = undefined } = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  const planDate = String(plan_date || todayUtcDate()).slice(0, 10);
  const st = String(status || '').trim();
  if (!st) throw new Error('status is required');

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

/**
 * Outcome object, observer, plan versions, and mission telemetry for goal runs.
 * Generic: any CEO goal, not a vertical-specific KPI schema.
 * Owner-scoped reads/writes.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

let _ready = false;

export function ensureGoalOutcomeTables() {
  if (_ready) return;
  const db = getDb();
  try {
    const cols = db.prepare('PRAGMA table_info(agent_goal_runs)').all().map((c) => c.name);
    if (cols.length && !cols.includes('outcome_json')) {
      db.exec('ALTER TABLE agent_goal_runs ADD COLUMN outcome_json TEXT');
    }
    if (cols.length && !cols.includes('plan_history_json')) {
      db.exec('ALTER TABLE agent_goal_runs ADD COLUMN plan_history_json TEXT');
    }
  } catch (_) {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS goal_mission_events (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      goal_run_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_goal_mission_events_owner
      ON goal_mission_events(owner_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_goal_mission_events_run
      ON goal_mission_events(goal_run_id, created_at ASC);
  `);
  _ready = true;
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Extract measurable outcome fields from free-text CEO intent.
 * Numbers, spend caps, deadlines, and never/exclude constraints — no vertical hardcoding.
 */
export function parseOutcomeFromPrompt(prompt) {
  const text = String(prompt || '');
  const lower = text.toLowerCase();

  let target = null;
  const createN = text.match(/\b(?:create|find|source|add|close|collect|complete)\s+(\d{1,5})\b/i);
  const nNoun = text.match(/\b(\d{1,5})\s+(?:genuinely\s+)?(?:qualified\s+)?(?:prospects?|leads?|invoices?|orders?|items?|records?)\b/i);
  const atLeast = text.match(/\bat least\s+(\d{1,5})\b/i);
  if (createN) target = Number(createN[1]);
  else if (nNoun) target = Number(nNoun[1]);
  else if (atLeast) target = Number(atLeast[1]);

  let budget_usd = null;
  const spend = text.match(/(?:under|below|cap(?:ped)?(?: at)?|keep(?: total)?(?: .{0,24})?under|spend)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  const dollar = text.match(/\$(\d+(?:\.\d+)?)/);
  if (spend) budget_usd = Number(spend[1]);
  else if (dollar && /spend|budget|cost|under/.test(lower)) budget_usd = Number(dollar[1]);

  let deadline = null;
  const days = text.match(/(\d{1,3})\s+business days/i) || text.match(/next\s+(\d{1,3})\s+days/i);
  if (days) {
    const n = Number(days[1]);
    const d = new Date();
    d.setDate(d.getDate() + n);
    deadline = d.toISOString().slice(0, 10);
  }

  const constraints = [];
  for (const re of [
    /never [^.!\n]{4,160}/gi,
    /do not [^.!\n]{4,160}/gi,
    /don't [^.!\n]{4,160}/gi,
    /exclude [^.!\n]{4,160}/gi,
  ]) {
    const matches = text.match(re) || [];
    for (const m of matches) {
      const c = m.trim().replace(/\s+/g, ' ');
      if (c.length >= 8 && !constraints.includes(c)) constraints.push(c.slice(0, 240));
    }
  }

  const approval_policy = {
    external_send: /without approval|do not send|never send|approval required/.test(lower)
      ? 'approval_required'
      : 'inherit',
    notify: /notify me only for exceptions|exceptions or final/.test(lower) ? 'exceptions_only' : 'inherit',
  };

  let kpi = 'completed_count';
  if (/verified|qualified|genuine/.test(lower)) kpi = 'verified_count';
  else if (/invoice|collect/.test(lower)) kpi = 'resolved_count';

  return {
    intent: text.trim().slice(0, 2000),
    kpi,
    baseline: 0,
    target: Number.isFinite(target) ? target : null,
    current_value: 0,
    rejected_count: 0,
    unknown_count: 0,
    deadline,
    constraints,
    budget_usd: Number.isFinite(budget_usd) ? budget_usd : null,
    spend_usd: 0,
    approval_policy,
    plan_version: 1,
  };
}

export function observeStepResult(result = {}) {
  const r = result && typeof result === 'object' ? result : {};
  const status = String(r.verification_status || r.acceptance || r.quality || '').toLowerCase();
  const invented = r.invented === true || r.fabricated === true;
  const acceptedFlag = r.accepted === true || r.counts_toward_kpi === true;
  const rejectedFlag = r.accepted === false || r.rejected === true;
  const deltaRaw = r.kpi_delta != null ? Number(r.kpi_delta) : r.count != null ? Number(r.count) : 1;
  const delta = Number.isFinite(deltaRaw) ? deltaRaw : 0;

  if (invented || /invented|fabricated/.test(status)) {
    return { accepted: false, kpi_delta: 0, class: 'rejected', reason: 'invented_or_unsupported' };
  }
  if (rejectedFlag || status === 'rejected' || status === 'disqualified') {
    return { accepted: false, kpi_delta: 0, class: 'rejected', reason: r.reason || 'rejected' };
  }
  if (status === 'unknown' || status === 'unverifiable' || status === 'missing') {
    return { accepted: false, kpi_delta: 0, class: 'unknown', reason: r.reason || 'unverifiable' };
  }
  if (acceptedFlag || status === 'verified' || status === 'qualified' || status === 'accepted') {
    return { accepted: true, kpi_delta: Math.max(0, delta), class: 'accepted', reason: r.reason || 'verified' };
  }
  // Activity-only results do not increment the outcome KPI.
  return { accepted: null, kpi_delta: 0, class: 'activity', reason: 'activity_not_kpi' };
}

export function applyObservation(outcome, observation) {
  const o = { ...(outcome || {}) };
  o.current_value = Number(o.current_value || 0);
  o.rejected_count = Number(o.rejected_count || 0);
  o.unknown_count = Number(o.unknown_count || 0);
  if (observation.class === 'accepted') o.current_value += Number(observation.kpi_delta || 0);
  else if (observation.class === 'rejected') o.rejected_count += 1;
  else if (observation.class === 'unknown') o.unknown_count += 1;
  o.last_observation = observation;
  return o;
}

export function recordMissionEvent({ ownerUserId, goalRunId = null, event_type, payload = {} }) {
  ensureGoalOutcomeTables();
  const owner = String(ownerUserId || '').trim();
  const type = String(event_type || '').trim();
  if (!owner || !type) return null;
  const id = `gme-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  getDb()
    .prepare(
      `INSERT INTO goal_mission_events (id, owner_user_id, goal_run_id, event_type, payload_json)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, owner, goalRunId || null, type, JSON.stringify(payload || {}));
  return id;
}

export function listMissionEvents(ownerUserId, { goalRunId = null, limit = 100 } = {}) {
  ensureGoalOutcomeTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = goalRunId
    ? getDb()
        .prepare(
          `SELECT * FROM goal_mission_events WHERE owner_user_id = ? AND goal_run_id = ?
           ORDER BY datetime(created_at) ASC LIMIT ?`
        )
        .all(owner, goalRunId, lim)
    : getDb()
        .prepare(
          `SELECT * FROM goal_mission_events WHERE owner_user_id = ?
           ORDER BY datetime(created_at) DESC LIMIT ?`
        )
        .all(owner, lim);
  return rows.map((r) => ({
    id: r.id,
    owner_user_id: r.owner_user_id,
    goal_run_id: r.goal_run_id,
    event_type: r.event_type,
    payload: parseJson(r.payload_json, {}),
    created_at: r.created_at,
  }));
}

export function loadOutcome(goalRow) {
  const stored = parseJson(goalRow?.outcome_json, null);
  if (stored && typeof stored === 'object') return stored;
  return parseOutcomeFromPrompt(goalRow?.prompt || '');
}

export function loadPlanHistory(goalRow) {
  const h = parseJson(goalRow?.plan_history_json, []);
  return Array.isArray(h) ? h : [];
}

export function persistOutcome(goalRunId, ownerUserId, outcome) {
  ensureGoalOutcomeTables();
  getDb()
    .prepare(
      `UPDATE agent_goal_runs SET outcome_json = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(JSON.stringify(outcome || {}), goalRunId, ownerUserId);
}

/** Generic mission spend meter (USD). Owner-scoped. */
export function addGoalSpend(goalRunId, ownerUserId, usd) {
  ensureGoalOutcomeTables();
  const owner = String(ownerUserId || '').trim();
  const id = String(goalRunId || '').trim();
  const add = Number(usd);
  if (!owner || !id || !Number.isFinite(add) || add === 0) return null;
  const row = getDb()
    .prepare('SELECT * FROM agent_goal_runs WHERE id = ? AND owner_user_id = ?')
    .get(id, owner);
  if (!row) return null;
  const outcome = loadOutcome(row);
  outcome.spend_usd = Math.round((Number(outcome.spend_usd || 0) + add) * 100) / 100;
  persistOutcome(id, owner, outcome);
  return outcome.spend_usd;
}

export function persistPlanHistory(goalRunId, ownerUserId, history) {
  ensureGoalOutcomeTables();
  getDb()
    .prepare(
      `UPDATE agent_goal_runs SET plan_history_json = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(JSON.stringify(history || []), goalRunId, ownerUserId);
}

export function snapshotPlanVersion({ goalRow, steps = [], rationale = '' }) {
  const outcome = loadOutcome(goalRow);
  const history = loadPlanHistory(goalRow);
  const version = Number(outcome.plan_version || 1);
  history.push({
    version,
    at: new Date().toISOString(),
    rationale: String(rationale || '').slice(0, 500),
    outcome: { ...outcome },
    step_labels: (steps || []).map((s) => s.label || s.step_type || s.type),
  });
  outcome.plan_version = version + 1;
  return { outcome, history, from: version, to: outcome.plan_version };
}

export function mergeConstraintText(outcome, extraConstraint) {
  const o = { ...(outcome || {}), constraints: [...(outcome?.constraints || [])] };
  const c = String(extraConstraint || '').trim();
  if (c && !o.constraints.includes(c)) o.constraints.push(c.slice(0, 240));
  return o;
}

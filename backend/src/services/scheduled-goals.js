import {trackingReferenceResult} from './floassist/source-references.js';
import {claimScheduledRun} from './scheduled-run-claim.js';
import {runEvidenceSummary} from './floassist/source-receipts.js';
import {responsibilitySources,sourceReadInstructions,reconciliationCandidates} from './floassist/responsibilities.js';
/**
 * CEO scheduled goals — durable schedules for agent prompts.
 * Pause/delete are status/row only; platform tick ignores non-active; survives restarts.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { getPlatformTimezone, formatServerDateTime } from '../utils/format-datetime.js';
import { isUserEnabled } from './user-enabled.js';
import * as openclaw from '../gateway/openclaw.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import { getPromptForFreshGoalRun } from './delegation-queue.js';
import { insertChatTurn } from './chat-history.js';
import {
  createAndStartGoalRun,
  planGoalStepsFromText,
  planGoalStepsAsync,
  planUsesGoalRunMode,
  getGoalRun,
  normalizeStepSpec,
  createGoalPlanningRun,
  updateGoalPlanningRun,
  failGoalPlanningRun,
  discardGoalPlanningRun,
} from './agent-goal-run.js';
import { normalizeDeliverTo, deliverScheduledGoalOutcome } from './agent-channel-announce.js';
import { consumeWorkSteering, steeringPrompt, closeWorkSteering, handoffWorkSteering } from './work-steering.js';
import { registerOpenClawSessionOwner } from './tool-owner-scope.js';
import { floAssistScheduleGate } from './floassist/runtime.js';
import {TRACKING_RUN_INSTRUCTIONS,trackingHistorySummary,listTracking} from './floassist/tracking.js';
import {selectSessionContentTools,installSessionToolScope,removeSessionToolScope} from './openclaw-session-tool-scope.js';

const CADENCES = new Set(['hourly', 'daily', 'weekdays', 'weekly']);
const STATUSES = new Set(['active', 'paused', 'completed', 'draft']);

function db() { return getDb(); }
function newId() { return `sg-${randomUUID().replace(/-/g, '').slice(0, 16)}`; }

/** Accept aliases like "every hour", "mon-fri", "everyday". */
export function normalizeCadence(raw) {
  let cadence = String(raw || 'daily').toLowerCase().trim();
  if (cadence === 'every day' || cadence === 'everyday' || cadence === 'day') cadence = 'daily';
  if (cadence === 'weekday' || cadence === 'mon-fri' || cadence === 'mon–fri') cadence = 'weekdays';
  if (
    cadence === 'every hour' ||
    cadence === 'every_hour' ||
    cadence === 'hour' ||
    cadence === 'hours' ||
    cadence === '1h'
  ) {
    cadence = 'hourly';
  }
  if (cadence === 'week' || cadence === 'once_a_week') cadence = 'weekly';
  if (!CADENCES.has(cadence)) {
    throw Object.assign(
      new Error('cadence must be hourly, daily, weekdays, or weekly'),
      { status: 400 }
    );
  }
  return cadence;
}

function normalizeTimeLocal(raw) {
  const s = String(raw || '09:00').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw Object.assign(new Error('time_local must be HH:MM (24h)'), { status: 400 });
  const h = Number(m[1]), min = Number(m[2]);
  if (!Number.isFinite(h) || h < 0 || h > 23 || !Number.isFinite(min) || min < 0 || min > 59) {
    throw Object.assign(new Error('time_local out of range'), { status: 400 });
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Stable key so we fire at most once per schedule slot (per hour for hourly, per day otherwise). */
export function runKeyForParts(row, parts, { force = false } = {}) {
  if (force) return `${parts.dateKey}-manual-${Date.now()}`;
  if (row.cadence === 'hourly') {
    return `${parts.dateKey}-${String(parts.hour).padStart(2, '0')}`;
  }
  return parts.dateKey;
}

function resolveTimezone(tz) {
  const t = String(tz || '').trim();
  if (!t) return getPlatformTimezone();
  try { new Intl.DateTimeFormat('en-US', { timeZone: t }); return t; }
  catch { throw Object.assign(new Error(`Invalid timezone: ${t}`), { status: 400 }); }
}

export function zonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const map = {};
  for (const p of dtf.formatToParts(date)) { if (p.type !== 'literal') map[p.type] = p.value; }
  const hour = Number(map.hour === '24' ? 0 : map.hour);
  const minute = Number(map.minute);
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[map.weekday] ?? date.getDay();
  return { hour, minute, weekday, dateKey: `${map.year}-${map.month}-${map.day}` };
}

function parseEndsAt(endsAt) {
  if (endsAt == null || endsAt === '' || String(endsAt).toLowerCase() === 'perpetual') return null;
  const s = String(endsAt).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T23:59:59.000Z`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw Object.assign(new Error('ends_at invalid'), { status: 400 });
  return d.toISOString();
}

function isExpired(endsAt, now = new Date()) {
  if (!endsAt) return false;
  const d = new Date(endsAt);
  return !Number.isNaN(d.getTime()) && d.getTime() < now.getTime();
}

function resolveAgentForOwner(ownerUserId, agentId) {
  const raw = String(agentId || '').trim();
  const id = raw.toLowerCase();
  let agent = null;
  if (!id || id === 'coo') {
    agent = db().prepare('SELECT * FROM agents WHERE is_coo = 1 LIMIT 1').get();
  } else {
    agent = db().prepare('SELECT * FROM agents WHERE lower(id) = ?').get(id);
    if (!agent && id.includes('--')) {
      agent = db().prepare('SELECT * FROM agents WHERE lower(id) = ?').get(id.split('--').pop());
    }
  }
  if (!agent) throw Object.assign(new Error(raw ? `Unknown agent: ${agentId}` : 'agent_id required'), { status: 400 });
  const entitled = db().prepare(
    `SELECT 1 AS ok FROM user_agents WHERE user_id = ? AND agent_id = ? AND enabled = 1`
  ).get(ownerUserId, agent.id);
  if (!entitled && !agent.is_coo) {
    throw Object.assign(new Error(`Agent "${agent.id}" is not available for this company`), { status: 403 });
  }
  return agent;
}

/** CEO UI execution plans (Generate draft / specialty ladder) are COO-only. */
export function agentAllowsScheduledGoalPlan(agent) {
  return !!agent?.is_coo;
}

function normalizeExecutionMode(value) {
  if (!['goal_plan', 'direct_agent'].includes(value)) throw Object.assign(new Error('execution_mode must be goal_plan or direct_agent'), {status:400});
  return value;
}
function executionMode(row) { return row.execution_mode || (String(row.source || '').startsWith('floassist:') ? 'direct_agent' : 'goal_plan'); }

function ensureScheduledGoalPlanCols() {
  try {
    const cols = db().prepare('PRAGMA table_info(scheduled_goals)').all().map((c) => c.name);
    if (!cols.includes('execution_mode')) {
      db().exec("ALTER TABLE scheduled_goals ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'goal_plan'");
      db().exec("UPDATE scheduled_goals SET execution_mode='direct_agent' WHERE source LIKE 'floassist:%' OR agent_id IN (SELECT id FROM agents WHERE COALESCE(is_coo,0)=0)");
    }
    if (!cols.includes('plan_json')) db().exec('ALTER TABLE scheduled_goals ADD COLUMN plan_json TEXT');
    if (!cols.includes('plan_status')) db().exec("ALTER TABLE scheduled_goals ADD COLUMN plan_status TEXT DEFAULT 'none'");
    if (!cols.includes('plan_feedback_json')) db().exec('ALTER TABLE scheduled_goals ADD COLUMN plan_feedback_json TEXT');
    if (!cols.includes('plan_version')) db().exec('ALTER TABLE scheduled_goals ADD COLUMN plan_version INTEGER DEFAULT 0');
    if (!cols.includes('deliver_to')) db().exec(`ALTER TABLE scheduled_goals ADD COLUMN deliver_to TEXT DEFAULT '["web"]'`);
  } catch (_) {}
}

function parsePlanJson(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function serializePlanSteps(steps) {
  return (Array.isArray(steps) ? steps : []).map((s, i) => {
    const n = normalizeStepSpec(s);
    return {
      step_index: i,
      type: n.type,
      label: n.label,
      spec: n.spec || {},
    };
  });
}

/**
 * Build a draft execution plan for a goal prompt (CEO review before schedule activate).
 */
export async function previewGoalPlan(ownerUserId, { prompt, feedback = null, previous_plan = null, explicit_steps = null, agent_id = null } = {}) {
  const p = String(prompt || '').trim();
  if (!p) throw Object.assign(new Error('prompt is required'), { status: 400 });
  if (agent_id) {
    const agent = resolveAgentForOwner(ownerUserId, agent_id);
    if (!agentAllowsScheduledGoalPlan(agent)) {
      throw Object.assign(
        new Error('Execution plans apply only to the COO. Other AI employees run the scheduled prompt directly.'),
        { status: 400 }
      );
    }
  }
  let steps;
  if (Array.isArray(explicit_steps) && explicit_steps.length) {
    steps = planGoalStepsFromText(p, { explicitSteps: explicit_steps });
  } else {
    steps = await planGoalStepsAsync(p, {
      ownerUserId,
      feedback: feedback || null,
      maxSpecialty: 8,
    });
  }
  // Optional: if feedback says merge with previous, prefer explicit_steps path
  if (feedback && previous_plan?.steps && String(feedback).toLowerCase().includes('keep previous')) {
    steps = planGoalStepsFromText(p, { explicitSteps: previous_plan.steps });
  }
  const plan = {
    version: 1,
    prompt: p,
    steps: serializePlanSteps(steps),
    uses_goal_run_mode: planUsesGoalRunMode(steps),
    generated_at: new Date().toISOString(),
    feedback_applied: feedback ? String(feedback).slice(0, 500) : null,
  };
  return plan;
}

function planStatusOf(row) {
  return String(row.plan_status || 'none').toLowerCase() || 'none';
}

function scheduleLabel(row) {
  const t = row.time_local || '09:00';
  const tz = row.timezone || getPlatformTimezone();
  if (row.cadence === 'hourly') {
    const mm = String(t).split(':')[1] || '00';
    return `Hourly at :${mm} (${tz})`;
  }
  if (row.cadence === 'weekdays') return `Weekdays at ${t} (${tz})`;
  if (row.cadence === 'weekly') {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `Weekly on ${names[Number(row.weekday) || 0] || 'Mon'} at ${t} (${tz})`;
  }
  return `Daily at ${t} (${tz})`;
}

function endsLabel(row) {
  if (!row.ends_at) return 'Perpetual';
  try { return formatServerDateTime(row.ends_at); } catch { return row.ends_at; }
}

export function serializeGoal(row) {
  if (!row) return null;
  const agent = db().prepare('SELECT id, name, role, is_coo FROM agents WHERE id = ?').get(row.agent_id);
  const plan = parsePlanJson(row.plan_json);
  let feedback = [];
  try {
    const f = row.plan_feedback_json ? JSON.parse(row.plan_feedback_json) : [];
    feedback = Array.isArray(f) ? f : [];
  } catch {
    feedback = [];
  }
  return {
    id: row.id, owner_user_id: row.owner_user_id, title: row.title, prompt: row.prompt,
    agent_id: row.agent_id, agent_name: agent?.name || row.agent_id, agent_role: agent?.role || null,
    is_coo: !!agent?.is_coo, cadence: row.cadence, weekday: row.weekday, time_local: row.time_local,
    timezone: row.timezone || getPlatformTimezone(), ends_at: row.ends_at, ends_label: endsLabel(row),
    is_perpetual: !row.ends_at, status: row.status, schedule_label: scheduleLabel(row),
    last_run_at: row.last_run_at, last_run_status: row.last_run_status, last_run_error: row.last_run_error,
    last_run_key: row.last_run_key, run_count: row.run_count || 0, source: row.source,
    execution_mode: executionMode(row),
    plan, plan_status: planStatusOf(row), plan_version: Number(row.plan_version) || 0,
    plan_feedback: feedback.slice(-10),
    deliver_to: normalizeDeliverTo(row.deliver_to),
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function getGoalRow(id, ownerUserId) {
  ensureScheduledGoalPlanCols();
  return db().prepare('SELECT * FROM scheduled_goals WHERE id = ? AND owner_user_id = ?').get(id, ownerUserId);
}

export function listScheduledGoals(ownerUserId, { status } = {}) {
  ensureScheduledGoalPlanCols();
  let sql = 'SELECT * FROM scheduled_goals WHERE owner_user_id = ?';
  const params = [ownerUserId];
  if (status && STATUSES.has(status)) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY datetime(created_at) DESC';
  return db().prepare(sql).all(...params).map(serializeGoal);
}

export function getScheduledGoal(ownerUserId, id) {
  const row = getGoalRow(id, ownerUserId);
  return row ? serializeGoal(row) : null;
}

export async function createScheduledGoal(ownerUserId, input = {}) {
  ensureScheduledGoalPlanCols();
  const prompt = String(input.prompt || input.goal || input.message || '').trim();
  if (!prompt) throw Object.assign(new Error('prompt is required'), { status: 400 });
  const agent = resolveAgentForOwner(ownerUserId, input.agent_id || input.agentId || input.agent);
  const cadence = normalizeCadence(input.cadence || 'daily');
  let weekday = input.weekday != null ? Number(input.weekday) : null;
  if (cadence === 'weekly') {
    if (weekday == null || weekday < 0 || weekday > 6) weekday = 1;
  } else {
    weekday = null;
  }
  const defaultTime = cadence === 'hourly' ? '00:00' : '09:00';
  const time_local = normalizeTimeLocal(input.time_local || input.time || input.at || defaultTime);
  const timezone = input.timezone ? resolveTimezone(input.timezone) : '';
  const ends_at = parseEndsAt(input.ends_at ?? input.endsAt ?? input.until ?? null);
  const title = String(input.title || '').trim() || prompt.replace(/\s+/g, ' ').slice(0, 72) || 'Scheduled goal';
  const source = String(input.source || 'ceo').slice(0, 32);
  const deliver_to = JSON.stringify(normalizeDeliverTo(input.deliver_to || input.deliverTo, input));

  // CEO UI: require draft plan, only activate when approve_plan / plan_status approved
  const approve =
    input.approve_plan === true ||
    input.approvePlan === true ||
    String(input.plan_status || '').toLowerCase() === 'approved' ||
    source === 'coo_tool' ||
    source === 'blueprint' ||
    input.skip_plan_review === true;

  let plan = null;
  // Prefer an explicit CEO plan (including manually amended baseline). Do not re-LLM when
  // the client sent plan.steps — empty only when amended_manually (still building).
  const clientPlan = input.plan && typeof input.plan === 'object' ? input.plan : null;
  const clientSteps = clientPlan && Array.isArray(clientPlan.steps) ? clientPlan.steps : null;
  const execution_mode = normalizeExecutionMode(input.execution_mode ?? (agentAllowsScheduledGoalPlan(agent) ? 'goal_plan' : 'direct_agent'));
  if (execution_mode === 'goal_plan' && !agentAllowsScheduledGoalPlan(agent)) throw Object.assign(new Error('Goal plans require a COO agent'), {status:400});
  const allowsPlan = execution_mode === 'goal_plan';
  const useClientPlan =
    allowsPlan &&
    clientSteps &&
    (clientSteps.length > 0 ||
      clientPlan.amended_manually === true ||
      clientPlan.manual === true);
  if (!allowsPlan) {
    plan = null;
    console.info('[scheduled-goals] skip execution plan — non-COO agent', { agent: agent.id, owner: ownerUserId });
  } else if (useClientPlan) {
    plan = {
      ...clientPlan,
      steps: serializePlanSteps(clientSteps),
      uses_goal_run_mode: planUsesGoalRunMode(clientSteps),
      amended_manually: !!(clientPlan.amended_manually || clientPlan.manual),
    };
  }

  const plan_status = allowsPlan && plan?.steps?.length ? (approve ? 'approved' : 'draft') : 'none';
  const status = plan_status === 'draft' ? 'draft' : approve ? 'active' : 'paused';
  const id = newId();
  db().prepare(`INSERT INTO scheduled_goals (
    id, owner_user_id, title, prompt, agent_id, cadence, weekday,
    time_local, timezone, ends_at, status, source, plan_json, plan_status, plan_version, deliver_to, execution_mode
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
    id, ownerUserId, title, prompt, agent.id, cadence, weekday, time_local, timezone, ends_at,
    status, source, plan ? JSON.stringify(plan) : null, plan_status, deliver_to, execution_mode
  );
  console.log(`[scheduled-goals] created id=${id} owner=${ownerUserId} agent=${agent.id} status=${status} plan=${plan_status} deliver_to=${deliver_to}`);
  return serializeGoal(getGoalRow(id, ownerUserId));
}


export async function setScheduledGoalPlan(ownerUserId, id, { plan = null, feedback = null, approve = false, prompt = null } = {}) {
  ensureScheduledGoalPlanCols();
  const row = getGoalRow(id, ownerUserId);
  if (!row) throw Object.assign(new Error('Scheduled goal not found'), { status: 404 });
  const ownerAgent = resolveAgentForOwner(ownerUserId, row.agent_id);
  if (!agentAllowsScheduledGoalPlan(ownerAgent)) {
    throw Object.assign(
      new Error('Execution plans apply only to the COO. Other AI employees run the scheduled prompt directly.'),
      { status: 400 }
    );
  }
  let nextPrompt = prompt != null ? String(prompt).trim() || row.prompt : row.prompt;
  let feedbackLog = [];
  try {
    feedbackLog = row.plan_feedback_json ? JSON.parse(row.plan_feedback_json) : [];
    if (!Array.isArray(feedbackLog)) feedbackLog = [];
  } catch {
    feedbackLog = [];
  }
  let nextPlan = plan;
  if (!nextPlan || !Array.isArray(nextPlan.steps)) {
    nextPlan = await previewGoalPlan(ownerUserId, {
      prompt: nextPrompt,
      feedback,
      previous_plan: parsePlanJson(row.plan_json),
      agent_id: ownerAgent.id,
    });
  } else {
    nextPlan = {
      ...nextPlan,
      steps: serializePlanSteps(nextPlan.steps),
      uses_goal_run_mode: planUsesGoalRunMode(nextPlan.steps),
      generated_at: new Date().toISOString(),
      feedback_applied: feedback ? String(feedback).slice(0, 500) : null,
      amended_manually: !!(nextPlan.amended_manually || nextPlan.manual),
    };
  }
  if (feedback && String(feedback).trim()) {
    feedbackLog.push({
      at: new Date().toISOString(),
      feedback: String(feedback).trim().slice(0, 2000),
      plan_version: (Number(row.plan_version) || 0) + 1,
    });
  }
  const plan_status = approve ? 'approved' : 'draft';
  let status = row.status;
  if (approve) status = 'active';
  else if (row.status === 'active' || row.status === 'draft') status = 'draft';
  const ver = (Number(row.plan_version) || 0) + 1;
  db().prepare(`UPDATE scheduled_goals SET prompt=?, plan_json=?, plan_status=?, plan_feedback_json=?, plan_version=?,
    status=?, updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(
    nextPrompt,
    JSON.stringify(nextPlan),
    plan_status,
    JSON.stringify(feedbackLog.slice(-30)),
    ver,
    status,
    id,
    ownerUserId
  );
  console.log(`[scheduled-goals] plan set id=${id} plan_status=${plan_status} status=${status} v=${ver}`);
  return serializeGoal(getGoalRow(id, ownerUserId));
}

export async function approveScheduledGoalPlan(ownerUserId, id) {
  return setScheduledGoalPlan(ownerUserId, id, { approve: true, plan: parsePlanJson(getGoalRow(id, ownerUserId)?.plan_json) });
}

export function updateScheduledGoal(ownerUserId, id, patch = {}) {
  const row = getGoalRow(id, ownerUserId);
  if (!row) throw Object.assign(new Error('Scheduled goal not found'), { status: 404 });
  let title = row.title, prompt = row.prompt, agent_id = row.agent_id, cadence = row.cadence;
  let weekday = row.weekday, time_local = row.time_local, timezone = row.timezone, ends_at = row.ends_at, status = row.status;
  let deliver_to = row.deliver_to;
  if (patch.title != null) title = String(patch.title).trim() || title;
  if (patch.prompt != null || patch.goal != null || patch.message != null) {
    const p = String(patch.prompt ?? patch.goal ?? patch.message).trim();
    if (p) prompt = p;
  }
  const execution_mode = normalizeExecutionMode(patch.execution_mode ?? executionMode(row));
  let clearPlan = false;
  if (patch.agent_id || patch.agentId || patch.agent) {
    const nextAgent = resolveAgentForOwner(ownerUserId, patch.agent_id || patch.agentId || patch.agent);
    agent_id = nextAgent.id;
    if (!nextAgent.is_coo && row.agent_id !== agent_id) clearPlan = true;
  }
  if (patch.cadence != null) {
    cadence = normalizeCadence(patch.cadence);
  }
  if (patch.weekday != null) weekday = Number(patch.weekday);
  if (cadence === 'weekly') {
    if (weekday == null || !Number.isFinite(weekday)) weekday = 1;
  } else {
    weekday = null;
  }
  if (patch.time_local != null || patch.time != null || patch.at != null) {
    time_local = normalizeTimeLocal(patch.time_local || patch.time || patch.at);
  }
  if (patch.timezone != null) timezone = patch.timezone === '' ? '' : resolveTimezone(patch.timezone);
  if (patch.ends_at !== undefined || patch.endsAt !== undefined || patch.until !== undefined) {
    ends_at = parseEndsAt(patch.ends_at ?? patch.endsAt ?? patch.until);
  }
  if (patch.status != null) {
    status = String(patch.status).toLowerCase();
    if (!STATUSES.has(status)) throw Object.assign(new Error('status must be active, paused, or completed'), { status: 400 });
  }
  if (
    patch.deliver_to != null ||
    patch.deliverTo != null ||
    patch.also_whatsapp != null ||
    patch.deliver_whatsapp != null ||
    patch.whatsapp != null ||
    patch.also_slack != null ||
    patch.deliver_slack != null
  ) {
    deliver_to = JSON.stringify(normalizeDeliverTo(patch.deliver_to ?? patch.deliverTo ?? row.deliver_to, patch));
  }
  if (execution_mode === 'goal_plan' && !resolveAgentForOwner(ownerUserId,agent_id).is_coo) throw Object.assign(new Error('Goal plans require a COO agent'), {status:400});
  if (execution_mode === 'direct_agent' && status === 'draft') status = 'paused';
  if (clearPlan) {
    if (status === 'draft') status = 'paused';
    db().prepare(`UPDATE scheduled_goals SET title=?, prompt=?, agent_id=?, cadence=?, weekday=?,
      time_local=?, timezone=?, ends_at=?, status=?, plan_json=NULL, plan_status='none', deliver_to=?, execution_mode=?, updated_at=datetime('now')
      WHERE id=? AND owner_user_id=?`).run(title, prompt, agent_id, cadence, weekday, time_local, timezone, ends_at, status, deliver_to, execution_mode, id, ownerUserId);
    console.log(`[scheduled-goals] updated id=${id} status=${status} cleared plan (non-COO agent)`);
  } else {
    db().prepare(`UPDATE scheduled_goals SET title=?, prompt=?, agent_id=?, cadence=?, weekday=?,
      time_local=?, timezone=?, ends_at=?, status=?, deliver_to=?, execution_mode=?, updated_at=datetime('now')
      WHERE id=? AND owner_user_id=?`).run(title, prompt, agent_id, cadence, weekday, time_local, timezone, ends_at, status, deliver_to, execution_mode, id, ownerUserId);
    console.log(`[scheduled-goals] updated id=${id} status=${status}`);
  }
  return serializeGoal(getGoalRow(id, ownerUserId));
}

export function pauseScheduledGoal(ownerUserId, id) {
  return updateScheduledGoal(ownerUserId, id, { status: 'paused' });
}

export function resumeScheduledGoal(ownerUserId, id) {
  const row = getGoalRow(id, ownerUserId);
  if (!row) throw Object.assign(new Error('Scheduled goal not found'), { status: 404 });
  if (isExpired(row.ends_at)) return updateScheduledGoal(ownerUserId, id, { status: 'completed' });
  const agent = db().prepare('SELECT is_coo FROM agents WHERE id = ?').get(row.agent_id);
  if (executionMode(row) === 'goal_plan' && planStatusOf(row) === 'draft' && agent?.is_coo) {
    throw Object.assign(new Error('Approve the execution plan before resuming this schedule'), { status: 400 });
  }
  if (!agent?.is_coo && (planStatusOf(row) === 'draft' || row.status === 'draft')) {
    db().prepare(
      `UPDATE scheduled_goals SET status='active', plan_json=NULL, plan_status='none', updated_at=datetime('now')
       WHERE id=? AND owner_user_id=?`
    ).run(id, ownerUserId);
    console.info('[scheduled-goals] activate non-COO schedule without execution plan', { id, agent: row.agent_id });
    return serializeGoal(getGoalRow(id, ownerUserId));
  }
  return updateScheduledGoal(ownerUserId, id, { status: 'active' });
}

export function deleteScheduledGoal(ownerUserId, id) {
  const row = getGoalRow(id, ownerUserId);
  if (!row) throw Object.assign(new Error('Scheduled goal not found'), { status: 404 });
  db().prepare('DELETE FROM scheduled_goal_runs WHERE goal_id = ? AND owner_user_id = ?').run(id, ownerUserId);
  db().prepare('DELETE FROM scheduled_goals WHERE id = ? AND owner_user_id = ?').run(id, ownerUserId);
  console.log(`[scheduled-goals] deleted id=${id} owner=${ownerUserId}`);
  return { ok: true, id, removed: true };
}

export function isGoalDueNow(row, now = new Date()) {
  if (!row || row.status !== 'active') return false;
  if (isExpired(row.ends_at, now)) return false;
  const tz = resolveTimezone(row.timezone || '');
  const parts = zonedParts(now, tz);
  const [hh, mm] = String(row.time_local || (row.cadence === 'hourly' ? '00:00' : '09:00'))
    .split(':')
    .map((x) => Number(x));
  if (row.cadence === 'hourly') {
    // Every hour at :MM from time_local (HH is ignored; default :00).
    if (parts.minute !== mm) return false;
  } else if (parts.hour !== hh || parts.minute !== mm) {
    return false;
  }
  if (row.cadence === 'weekdays' && (parts.weekday === 0 || parts.weekday === 6)) return false;
  if (row.cadence === 'weekly') {
    const want = Number(row.weekday);
    if (Number.isFinite(want) && parts.weekday !== want) return false;
  }
  const slotKey = runKeyForParts(row, parts, { force: false });
  if (row.last_run_key === slotKey) return false;
  return true;
}

function buildRunMessage(row, ownerUserId, { runKey, force }) {
  const ends = row.ends_at ? `Ends: ${row.ends_at}` : 'Ends: perpetual (runs until paused or deleted)';
  return (
    `[Scheduled goal — automatic run]\n[ceo_user_id: ${ownerUserId}]\n[owner_user_id: ${ownerUserId}]\n` +
    `[scheduled_goal_id: ${row.id}]\n[run_key: ${runKey}]\n[trigger: ${force ? 'run_now' : 'schedule'}]\n\n` +
    `Title: ${row.title}\nSchedule: ${scheduleLabel(row)}\n${ends}\n\n` +
    `You are receiving a CEO scheduled prompt. Execute the following instructions now using your tools. ` +
    `Work autonomously; do not ask the CEO to re-confirm unless policy requires approval for publish/external actions. ` +
    (['floassist:priority','floassist:deadlines','floassist:followups'].includes(row.source)
      ? `This check must persist verified obligations using the FloAssist Kanban tracking tools. Do not call notify_ceo or messaging tools: tracking queues eligible task alerts. Do not create a new goal plan or generic scan-progress task. Return FLOASSIST_NO_UPDATE after processing.\n\n`
      : String(row.source||'').startsWith('floassist:')
      ? `This is a single proactive assistant check. Perform the selected-source checks directly in this session. Do not create a goal plan, Kanban task, subagent timer, or notification step. Do not call notify_ceo or messaging tools to report this check: the platform handles delivery of your final response. Return only a concise user-facing actionable finding, without task IDs, tool receipts, execution steps or progress reports. Format for WhatsApp: a single-asterisk bold responsibility heading, short separated bullet points, bold labels for When and Next action, and at most one relevant icon per section. Do not use Markdown tables, columns, double-asterisk bold or code fences. If nothing actionable was verified, return exactly FLOASSIST_NO_UPDATE. A duplicate-action block is not a fresh finding.\n\n`
      : `When done, reply with a short summary of what you produced or delegated.\n\n`) +
    `--- CEO prompt ---\n${row.prompt}\n--- end ---`
  );
}

export async function runScheduledGoal(ownerUserId, id, opts = {}) {
  // Operator-only diagnostic session; public Run Now routes do not forward this option.
  if(opts.diagnosticSessionTag&&!/^[a-z0-9-]{1,80}$/.test(opts.diagnosticSessionTag))throw new Error('Invalid diagnostic session tag');
  const force = !!opts.force;
  const row = getGoalRow(id, ownerUserId);
  if (!row) throw Object.assign(new Error('Scheduled goal not found'), { status: 404 });
  if (!isUserEnabled(ownerUserId)) return { ok: false, skipped: true, reason: 'owner_disabled' };
  const floAssistGate = floAssistScheduleGate(row);
  if (!floAssistGate.ok) return { ok: false, skipped: true, reason: floAssistGate.reason };
  if (row.status === 'paused' && !force) return { ok: false, skipped: true, reason: 'paused' };
  if (row.status === 'completed' && !force) return { ok: false, skipped: true, reason: 'completed' };
  if (isExpired(row.ends_at) && !force) {
    updateScheduledGoal(ownerUserId, id, { status: 'completed' });
    return { ok: false, skipped: true, reason: 'ended' };
  }
  const earlyPlanStatus = planStatusOf(row);
  if (row.status === 'draft' || (executionMode(row) === 'goal_plan' && earlyPlanStatus === 'draft')) {
    throw Object.assign(new Error('Goal plan is draft — approve the execution plan before run'), { status: 400 });
  }
  const tz = resolveTimezone(row.timezone || '');
  const parts = zonedParts(new Date(), tz);
  const runKey = runKeyForParts(row, parts, { force });
  if (!force && row.last_run_key === runKey) {
    return {
      ok: false,
      skipped: true,
      reason: row.cadence === 'hourly' ? 'already_ran_this_hour' : 'already_ran_today',
      run_key: runKey,
    };
  }
  const claim = claimScheduledRun(db(),row,runKey,{force,requestKey:opts.requestKey});
  if(claim.skipped)return {ok:false,...claim};
  const runId=claim.run_id;

  const agent = resolveAgentForOwner(ownerUserId, row.agent_id);
  // A schedule steer is one-fire guidance, not a permanent prompt/cadence change.
  const scheduleGuidanceNotes = consumeWorkSteering(ownerUserId, 'schedule', id, `schedule_dispatch:${runId}`);
  const floAssistPrefs=String(row.source||'').startsWith('floassist:')?JSON.parse(db().prepare('SELECT preferences_json FROM floassist_profiles WHERE owner_id=?').get(ownerUserId)?.preferences_json||'{}'):null;
  const currentTracking=floAssistPrefs?listTracking(db(),ownerUserId,{limit:100}):null;
  const trackingIdentity=currentTracking?JSON.stringify(trackingReferenceResult(db(),ownerUserId,{tasks:reconciliationCandidates(currentTracking.tasks,row.source.split(':')[1]).map(({task_id,app_id,account_id,source_id,obligation_key,state,task_status,due_at})=>({task_id,app_id,account_id,source_id,obligation_key,state,task_status,due_at})),next_after_id:currentTracking.next_after_id},{owner:ownerUserId,run:runId,origin:row.source})):'';
  const guidance = (floAssistPrefs?sourceReadInstructions(floAssistPrefs,row.source.split(':')[1])+'\nAuthoritative active reconciliation candidates for this responsibility (an empty list means no existing tasks to reconcile; do not inspect or modify stopped, closed, or other-module tasks. Backend observation globally matches existing/closed identities to prevent duplicates. Do not guess task IDs; paginate tracking_list if next_after_id is present): '+trackingIdentity+'\n':'')+steeringPrompt(scheduleGuidanceNotes)+(floAssistPrefs?`\nCurrent responsibility source boundary (supersedes an older saved source list): ${responsibilitySources(floAssistPrefs,row.source.split(':')[1]).join(', ')}. Other apps are checked by their own responsibility. Scheduled scans must never call tracking_update with track, stop, snooze or acknowledge. Those require a user instruction. `:'')+(row.source==='floassist:conflicts'?'\nCalendar Conflicts requires individual events with start/end times and IDs. Use the selected calendar provider event-list action (for Google Calendar: googlecalendar.list_events_all_calendars or googlecalendar.list_events). Free/busy returns merged availability and cannot prove whether events overlap. Read the event-list guide, then fetch individual events. Do not create tracking tasks for a conflict scan. Use local-day boundaries in the owner timezone, with explicit UTC offsets rather than midnight UTC. If no overlaps exist, return exactly FLOASSIST_NO_UPDATE.':'')+(String(row.source||'').startsWith('floassist:')
    ? '\nConnector verification protocol: Before each distinct connector action, call connector_get_action_guide and use its exact input_schema (including required fields); do not guess camelCase or snake_case names. If an input is rejected, correct it using the returned schema and retry. For Gmail, use the provider threadId from a fresh discovery result, not a message ID or a remembered task identifier. Read the full current thread before floassist_tracking_observe. A suppressed candidate is a completed relevance check, not a reason to force an alert. An unavailable source must be reported as incomplete, never silently replaced with memory.' : '');
  handoffWorkSteering(ownerUserId, 'schedule', id, 'schedule_run', runId, scheduleGuidanceNotes.map(n => n.id));
  const steeredPrompt = `[scheduled_goal_id: ${row.id}]\n[run_key: ${runKey}]\n` + row.prompt + guidance + (['floassist:priority','floassist:deadlines','floassist:followups'].includes(row.source)?`\n\n${TRACKING_RUN_INSTRUCTIONS}`:'');
  let openclawId = agent.openclaw_agent_id || agent.id;
  try { openclawId = ensureTenantOpenClawAgent(agent, ownerUserId).openclawAgentId; }
  catch (e) { console.warn(`[scheduled-goals] tenant ensure failed agent=${agent.id}:`, e.message); }

  // Per-fire AgentSystem session — never share across scheduled goals (even same agent/CEO).
  const sessionUser = openclaw.sessionUserFor(
    openclawId,
    ownerUserId,
    opts.diagnosticSessionTag || `sched-${String(id).replace(/^sg-/, '')}-${String(runId).replace(/^sgr-/, '').slice(0, 12)}`
  );

  try {
    insertChatTurn({ agentId: agent.id, ownerUserId, role: 'user', content: `[Scheduled goal] ${row.title}\n\n${row.prompt}` });
  } catch (e) { console.warn('[scheduled-goals] chat user turn:', e.message); }

  if (row.source === 'floassist:priority') {
    (await import('./floassist/tracking.js')).queueWhatsAppTasks(db(),ownerUserId,runId);
    try { await (await import('./floassist/connector-health.js')).checkFloAssistConnectorHealth(ownerUserId); }
    catch (e) { console.warn('[floassist-health] check unavailable'); }
    try { await (await import('./floassist/storage.js')).checkFloAssistStorage(ownerUserId); }
    catch (e) { console.warn('[floassist-storage] check unavailable'); }
  }

  // Prefer durable goal plan when approved stored plan or structured multi-step.
  const pStatus = planStatusOf(row);
  let planned = null;
  let planningGoal = null;
  const stored = parsePlanJson(row.plan_json);
  const floAssistRun=String(row.source||'').startsWith('floassist:');
  const directRun = executionMode(row) === 'direct_agent';
  if (!directRun && stored?.steps?.length && pStatus === 'approved') {
    planned = stored.steps.map((s) => normalizeStepSpec(s));
  } else if (!directRun) {
    planningGoal = createGoalPlanningRun({
      ownerUserId,
      agentId: agent.id,
      title: row.title,
      prompt: steeredPrompt,
      source: 'scheduled_goal',
      scheduledGoalId: id,
      scheduledGoalRunId: runId,
      context: { run_key: runKey, force },
    });
    try {
      planned = await planGoalStepsAsync(steeredPrompt, {
        ownerUserId,
        orchestratorAgentId: agent.id,
        onProgress: (progress) => updateGoalPlanningRun(planningGoal.id, ownerUserId, progress),
      });
    } catch (error) {
      failGoalPlanningRun(planningGoal.id, ownerUserId, error);
      throw error;
    }
  }
  const hasGoalPlan = planUsesGoalRunMode(planned);
  if (hasGoalPlan) {
    try {
      console.log(`[scheduled-goals] goal-run plan id=${id} agent=${agent.id} steps=${planned.length}`);
      const started = await createAndStartGoalRun({
        ownerUserId,
        agentId: agent.id,
        title: row.title,
        prompt: steeredPrompt + steeringPrompt(consumeWorkSteering(ownerUserId, 'schedule_run', runId, 'scheduled_goal_handoff')),
        steps: planned,
        source: 'scheduled_goal',
        scheduledGoalId: id,
        scheduledGoalRunId: runId,
        context: { run_key: runKey, force },
        goalRunId: planningGoal?.id || null,
      });
      const g = started?.goal || getGoalRun(started?.goal?.id || started?.id, ownerUserId);
      if (g?.id) handoffWorkSteering(ownerUserId, 'schedule_run', runId, 'goal', g.id);
      closeWorkSteering(ownerUserId, 'schedule_run', runId);
      const exec = started?.execution || started;
      const firstWf = exec?.workflow_run_id || exec?.run_id || null;
      const stepsPreview = (g?.steps || planned)
        .map((s, i) => `${i + 1}. ${s.label || s.title || s.type || s.step_type || 'step'}`)
        .join('; ');
      const reply =
        `Scheduled goal plan started (agent_goal_run ${g?.id || 'n/a'}).\n` +
        `Steps: ${stepsPreview}\n` +
        (firstWf ? `First workflow run_id: ${firstWf} (async). Platform advances the plan on each workflow terminal.\n` : '') +
        `You do not need to re-trigger phase 1 unless the plan is agent_continue.`;
      try { insertChatTurn({ agentId: agent.id, ownerUserId, role: 'assistant', content: reply }); } catch (_) {}
      db().prepare(
        `UPDATE scheduled_goals SET last_run_status='ok', last_run_error=NULL, run_count=COALESCE(run_count,0)+1, updated_at=datetime('now')
         WHERE id=? AND owner_user_id=?`
      ).run(id, ownerUserId);
      db().prepare(`UPDATE scheduled_goal_runs SET status='ok', reply_preview=? WHERE id=?`).run(reply.slice(0, 2000), runId);
      if (isExpired(row.ends_at)) updateScheduledGoal(ownerUserId, id, { status: 'completed' });
      // Plan-mode: WhatsApp waits for the once-only completion nudge (completed/failed), not "plan started".
      return {
        ok: true,
        goal_id: id,
        run_id: runId,
        run_key: runKey,
        agent_id: agent.id,
        agent_goal_run_id: g?.id || null,
        first_workflow_run_id: firstWf,
        reply_preview: reply.slice(0, 500),
        mode: 'goal_run_plan', plan_steps: planned.length,
      };
    } catch (planErr) {
      console.warn('[scheduled-goals] goal-run plan failed, falling back to chat:', planErr?.message || planErr);
    }
  }
  if (planningGoal) discardGoalPlanningRun(planningGoal.id, ownerUserId);

  let prompt = buildRunMessage(row, ownerUserId, { runKey, force });
  prompt += guidance + steeringPrompt(consumeWorkSteering(ownerUserId, 'schedule_run', runId, 'scheduled_agent_dispatch'));
  if(['floassist:priority','floassist:deadlines','floassist:followups'].includes(row.source))prompt+=`\n\n${TRACKING_RUN_INSTRUCTIONS}`;
  try {
    prompt = getPromptForFreshGoalRun(prompt);
  } catch (_) {}
  prompt = `[ceo_user_id: ${ownerUserId}]\n[owner_user_id: ${ownerUserId}]\n${prompt}`;

  const scheduledSessionKey = openclaw.sessionKeyFor(openclawId, sessionUser);
  try {
    const required = String(row.source||'').startsWith('floassist:')
      ? ['floassist_status','floassist_tracking_list','floassist_tracking_observe','floassist_tracking_update',
        'connector_list_apps','connector_search_actions','connector_get_action_guide','connector_execute_action',
        'kanban_get_task','kanban_user_action','agent_work_history'] : [];
    const selection=selectSessionContentTools({agentId:agent.id,ownerUserId,message:prompt,
      route:{executor_evidence:{capability_names:required}}});
    if(floAssistRun){
      selection.floassist_module=row.source.split(':')[1];
      // The initial snapshot is owner scoped. Restrict reconciliation to its
      // eligible IDs only when the snapshot is complete; do not truncate paging.
      if(currentTracking&&!currentTracking.next_after_id)selection.floassist_reconciliation_task_ids=reconciliationCandidates(currentTracking.tasks,selection.floassist_module).map(t=>t.task_id);
      // These checks do not need CRM, productivity/ICS, delegation or user-action
      // tools. Retain permanent COO grants for its other work.
      const trackingRun=['floassist:priority','floassist:deadlines','floassist:followups'].includes(row.source);
      const allowed=required.filter(name=>name!=='kanban_user_action'&&name!=='agent_work_history'&&(trackingRun||!['floassist_tracking_observe','floassist_tracking_update'].includes(name)));
      selection.tools=selection.tools.filter(name=>allowed.includes(name));
      if(selection.floassist_reconciliation_task_ids?.length===0)selection.tools=selection.tools.filter(name=>name!=='floassist_tracking_update');
      selection.scoped=true;selection.selected_count=selection.tools.length;
    }
    installSessionToolScope(scheduledSessionKey,selection);
    console.log(`[scheduled-goals] firing id=${id} agent=${openclawId} run_key=${runKey}`);
    registerOpenClawSessionOwner(openclaw.sessionKeyFor(openclawId, sessionUser), ownerUserId, null, 'schedule', { scheduled_goal_run_id: runId, original_request: row.prompt, resolved_request: row.prompt });
    const checkContract=floAssistRun?{
      role:'system',content:`FloAssist scheduled source check (${row.source.split(':')[1]}). This is a bounded check, not a task-completion workflow. Use tools only when needed, not merely because they are available. Finishing this check does not complete, stop, resume or acknowledge any user task. Skip closed/stopped records. Never call close_orphan just to mark the scan complete: it requires exact stored app_id, account_id, source_id, obligation_key and fresh provider evidence of deletion or actual fulfillment, with source_checked, source_outcome and source_evidence. An upcoming submission remains open until fulfilled; reading its email is not fulfillment. If no reconciliation is needed, do not call tracking_update. Briefing and conflict checks report verified facts only and do not create tracking tasks. ${guidance}${['floassist:priority','floassist:deadlines','floassist:followups'].includes(row.source)?`\n${TRACKING_RUN_INSTRUCTIONS}`:''}`
    }:null;
    const { content } = await openclaw.chatCompletions(
      openclawId, [...(checkContract?[checkContract]:[]),{ role: 'user', content: prompt }], sessionUser, false,
      {
        injectLearningsInstruction: false,
        injectKanbanInstruction: !directRun,
        injectSessionHistoryInstruction: false,
        timeoutMs: Number(process.env.SCHEDULED_GOAL_CHAT_TIMEOUT_MS || process.env.OPENCLAW_FETCH_TIMEOUT_MS || 240000),
      }
    );
    const reply = String(content || '').trim() || '(no response)';
    const evidence=floAssistRun?runEvidenceSummary(db(),ownerUserId,runId):null;
    const incomplete=evidence&&(evidence.errors>0||evidence.reads===0);
    const evidenceError=incomplete?`Incomplete source verification: ${evidence.sources} source IDs read; ${evidence.errors} unresolved tool failures. Agent summary is not proof of complete coverage. Review tool history and delivery status before retrying.`:null;
    closeWorkSteering(ownerUserId, 'schedule_run', runId);
    const preview = (reply==='FLOASSIST_NO_UPDATE'&&['floassist:priority','floassist:deadlines','floassist:followups'].includes(row.source)
      ? trackingHistorySummary(db(),ownerUserId) : reply).slice(0, 2000);
    try { insertChatTurn({ agentId: agent.id, ownerUserId, role: 'assistant', content: reply }); } catch (_) {}
    if(!incomplete)void deliverScheduledGoalOutcome({
      ownerUserId,
      agentId: agent.id,
      deliverTo: row.deliver_to,
      scheduledGoalId: id,
      text: reply,
      sourceKey: `sg:${id}:${runId}`,
    }).catch((e) => console.warn('[scheduled-goals] channel fan-out', e?.message || e));
    db().prepare(
      `UPDATE scheduled_goals SET last_run_status='ok', last_run_error=NULL, run_count=COALESCE(run_count,0)+1, updated_at=datetime('now')
       WHERE id=? AND owner_user_id=?`
    ).run(id, ownerUserId);
    db().prepare(`UPDATE scheduled_goal_runs SET status='ok', reply_preview=? WHERE id=?`).run(preview, runId);
    if(incomplete){
      db().prepare("UPDATE scheduled_goal_runs SET status='error',error=? WHERE id=?").run(evidenceError,runId);
      db().prepare("UPDATE scheduled_goals SET last_run_status='error',last_run_error=? WHERE id=? AND owner_user_id=?").run(evidenceError,id,ownerUserId);
    }
    if (isExpired(row.ends_at)) updateScheduledGoal(ownerUserId, id, { status: 'completed' });
    return { ok: !incomplete, ...(evidenceError?{error:evidenceError}:{}), goal_id: id, run_id: runId, run_key: runKey, agent_id: agent.id, reply_preview: preview.slice(0, 500), mode: 'chat' };
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`[scheduled-goals] fail id=${id}:`, msg);
    closeWorkSteering(ownerUserId, 'schedule_run', runId);
    db().prepare(
      `UPDATE scheduled_goals SET last_run_status='error', last_run_error=?, updated_at=datetime('now') WHERE id=? AND owner_user_id=?`
    ).run(msg.slice(0, 500), id, ownerUserId);
    db().prepare(`UPDATE scheduled_goal_runs SET status='error', error=? WHERE id=?`).run(msg.slice(0, 1000), runId);
    return { ok: false, goal_id: id, run_id: runId, error: msg };
  } finally {
    try { removeSessionToolScope(scheduledSessionKey); }
    catch (e) { console.warn('[scheduled-goals] tool-scope cleanup:',e?.message||e); }
  }
}

export async function tickScheduledGoals(now = new Date()) {
  try {
    const { isPlatformLocalOllama } = await import('./platform-llm-settings.js');
    const { hasAnyActiveDashboardChat } = await import('./tool-owner-scope.js');
    if (isPlatformLocalOllama() && hasAnyActiveDashboardChat()) {
      console.info('[scheduled-goals] skip tick: dashboard chat owns local Ollama');
      return { count: 0, results: [], launched: [], skipped: 'local_ollama_dashboard_chat' };
    }
  } catch (e) {
    console.warn('[scheduled-goals] local-ollama chat gate:', e?.message || e);
  }
  try {
    reconcileStuckScheduledGoalRuns(now);
  } catch (e) {
    console.warn('[scheduled-goals] reconcile stuck:', e?.message || e);
  }
  const actives = db().prepare(`SELECT id, owner_user_id, ends_at FROM scheduled_goals WHERE status='active'`).all();
  for (const r of actives) {
    if (isExpired(r.ends_at, now)) {
      try { updateScheduledGoal(r.owner_user_id, r.id, { status: 'completed' }); console.log(`[scheduled-goals] auto-completed expired id=${r.id}`); }
      catch (_) {}
    }
  }
  const rows = db().prepare(
    `SELECT g.* FROM scheduled_goals g INNER JOIN platform_users u ON u.id=g.owner_user_id AND u.enabled=1 WHERE g.status='active'`
  ).all();
  const due = rows.filter((row) => isGoalDueNow(row, now));
  if (!due.length) return { count: 0, results: [], launched: [] };

  // Independent executions: start every due goal in parallel and do not await completion.
  // A hung OpenClaw chat / long agent_tool chain on one schedule must not block siblings
  // or hold the platform cron (which skips overlapping ticks while running).
  const launched = [];
  for (const row of due) {
    launched.push({ goal_id: row.id, title: row.title, agent_id: row.agent_id, owner_user_id: row.owner_user_id });
    void runScheduledGoal(row.owner_user_id, row.id, { force: false })
      .then((r) => {
        if (r?.skipped) {
          console.info(
            `[scheduled-goals] skipped id=${row.id} reason=${r.reason || 'skipped'}`
          );
          return;
        }
        console.info(
          `[scheduled-goals] finished id=${row.id} ok=${!!r?.ok} mode=${r?.mode || (r?.error ? 'error' : 'done')}`
        );
      })
      .catch((e) => {
        console.error(`[scheduled-goals] async fail id=${row.id}:`, e?.message || e);
      });
  }
  console.log(
    `[scheduled-goals] tick launched ${launched.length} goal(s) in parallel (non-blocking): ${launched
      .map((g) => g.goal_id)
      .join(',')}`
  );
  return { count: launched.length, launched, async: true, results: [] };
}

/**
 * Heal scheduled_goal_runs left at status=running when the parent await died
 * (backend restart) or when linked agent_goal_run already finished.
 */
export function reconcileStuckScheduledGoalRuns(now = new Date()) {
  const stuckMins = Math.max(5, Number(process.env.SCHEDULED_GOAL_STUCK_MINUTES || 30) || 30);
  const cutoff = new Date(now.getTime() - stuckMins * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const rows = db()
    .prepare(
      `SELECT sgr.*, agr.id AS agr_id, agr.status AS agr_status
       FROM scheduled_goal_runs sgr
       LEFT JOIN agent_goal_runs agr ON agr.scheduled_goal_run_id = sgr.id
       WHERE sgr.status = 'running'`
    )
    .all();
  let healed = 0;
  for (const row of rows) {
    let nextStatus = null;
    let preview = null;
    let err = null;
    if (row.agr_id && (row.agr_status === 'completed' || row.agr_status === 'partial_success' || row.agr_status === 'failed' || row.agr_status === 'cancelled')) {
      nextStatus = row.agr_status === 'completed' ? 'ok' : row.agr_status === 'partial_success' ? 'partial' : 'error';
      preview = `Reconciled from agent_goal_run ${row.agr_id} (${row.agr_status})`;
      if (!['completed', 'partial_success'].includes(row.agr_status)) err = preview;
    } else if (!row.agr_id && String(row.created_at || '') <= cutoff) {
      nextStatus = 'error';
      err = `Timed out while running (no agent_goal_run after ${stuckMins}m; likely AgentSystem hang or backend restart)`;
      preview = err;
    } else if (row.agr_id && String(row.created_at || '') <= cutoff) {
      // agr still non-terminal but sgr claimed long ago — leave agr alone; only age-out orphan sgr without agr above.
      continue;
    } else {
      continue;
    }
    db()
      .prepare(
        `UPDATE scheduled_goal_runs SET status = ?, reply_preview = COALESCE(?, reply_preview), error = COALESCE(?, error) WHERE id = ? AND status = 'running'`
      )
      .run(nextStatus, preview, err, row.id);
    const goalStatus = nextStatus === 'ok' ? 'ok' : 'error';
    db()
      .prepare(
        `UPDATE scheduled_goals SET last_run_status = ?, last_run_error = ?, updated_at = datetime('now')
         WHERE id = ? AND owner_user_id = ? AND last_run_status = 'running'`
      )
      .run(goalStatus, err, row.goal_id, row.owner_user_id);
    healed += 1;
    console.warn(
      `[scheduled-goals] healed stuck run sgr=${row.id} goal=${row.goal_id} -> ${nextStatus}`
    );
  }
  return { healed, scanned: rows.length };
}

export function findGoalForOwner(ownerUserId, query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const byId = getGoalRow(q, ownerUserId);
  if (byId) return serializeGoal(byId);
  const rows = db().prepare(
    `SELECT * FROM scheduled_goals WHERE owner_user_id=? AND (lower(title) LIKE ? OR lower(prompt) LIKE ?)
     ORDER BY datetime(updated_at) DESC LIMIT 5`
  ).all(ownerUserId, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
  if (rows.length === 1) return serializeGoal(rows[0]);
  if (rows.length > 1) return { matches: rows.map(serializeGoal) };
  return null;
}

export function listRecentRuns(ownerUserId, goalId, limit = 20) {
  const runs=db().prepare(
    `SELECT * FROM scheduled_goal_runs WHERE owner_user_id=? AND (? IS NULL OR goal_id=?)
     ORDER BY datetime(created_at) DESC LIMIT ?`
  ).all(ownerUserId, goalId || null, goalId || null, Math.min(Math.max(limit, 1), 100));
  const hasNotifications=db().prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_notifications'").get();
  return runs.map(run=>({...run,notification_items:hasNotifications?db().prepare("SELECT status,count(*) count FROM floassist_notifications WHERE owner_id=? AND (source_key LIKE ? OR source_key LIKE ?) GROUP BY status").all(ownerUserId,`%:finding:${run.id}`,`%:sg:${run.goal_id}:${run.id}`):[]}));
}

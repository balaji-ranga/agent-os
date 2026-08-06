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
import { getPromptWithMemoryInjected } from './delegation-queue.js';
import { insertChatTurn } from './chat-history.js';

const CADENCES = new Set(['hourly', 'daily', 'weekdays', 'weekly']);
const STATUSES = new Set(['active', 'paused', 'completed']);

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
  const id = String(agentId || '').trim().toLowerCase();
  if (!id) throw Object.assign(new Error('agent_id required'), { status: 400 });
  let agent = db().prepare('SELECT * FROM agents WHERE lower(id) = ?').get(id);
  if (!agent && id.includes('--')) {
    agent = db().prepare('SELECT * FROM agents WHERE lower(id) = ?').get(id.split('--').pop());
  }
  if (!agent && (id === 'coo' || id === 'balserve')) {
    agent = db().prepare('SELECT * FROM agents WHERE is_coo = 1 LIMIT 1').get();
  }
  if (!agent) throw Object.assign(new Error(`Unknown agent: ${agentId}`), { status: 400 });
  const entitled = db().prepare(
    `SELECT 1 AS ok FROM user_agents WHERE user_id = ? AND agent_id = ? AND enabled = 1`
  ).get(ownerUserId, agent.id);
  if (!entitled && !agent.is_coo) {
    throw Object.assign(new Error(`Agent "${agent.id}" is not available for this company`), { status: 403 });
  }
  return agent;
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
  return {
    id: row.id, owner_user_id: row.owner_user_id, title: row.title, prompt: row.prompt,
    agent_id: row.agent_id, agent_name: agent?.name || row.agent_id, agent_role: agent?.role || null,
    is_coo: !!agent?.is_coo, cadence: row.cadence, weekday: row.weekday, time_local: row.time_local,
    timezone: row.timezone || getPlatformTimezone(), ends_at: row.ends_at, ends_label: endsLabel(row),
    is_perpetual: !row.ends_at, status: row.status, schedule_label: scheduleLabel(row),
    last_run_at: row.last_run_at, last_run_status: row.last_run_status, last_run_error: row.last_run_error,
    last_run_key: row.last_run_key, run_count: row.run_count || 0, source: row.source,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function getGoalRow(id, ownerUserId) {
  return db().prepare('SELECT * FROM scheduled_goals WHERE id = ? AND owner_user_id = ?').get(id, ownerUserId);
}

export function listScheduledGoals(ownerUserId, { status } = {}) {
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

export function createScheduledGoal(ownerUserId, input = {}) {
  const prompt = String(input.prompt || input.goal || input.message || '').trim();
  if (!prompt) throw Object.assign(new Error('prompt is required'), { status: 400 });
  const agent = resolveAgentForOwner(ownerUserId, input.agent_id || input.agentId || input.agent || 'coo');
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
  const id = newId();
  db().prepare(`INSERT INTO scheduled_goals (
    id, owner_user_id, title, prompt, agent_id, cadence, weekday,
    time_local, timezone, ends_at, status, source
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(
    id, ownerUserId, title, prompt, agent.id, cadence, weekday, time_local, timezone, ends_at, source
  );
  console.log(`[scheduled-goals] created id=${id} owner=${ownerUserId} agent=${agent.id} cadence=${cadence} time=${time_local}`);
  return serializeGoal(getGoalRow(id, ownerUserId));
}

export function updateScheduledGoal(ownerUserId, id, patch = {}) {
  const row = getGoalRow(id, ownerUserId);
  if (!row) throw Object.assign(new Error('Scheduled goal not found'), { status: 404 });
  let title = row.title, prompt = row.prompt, agent_id = row.agent_id, cadence = row.cadence;
  let weekday = row.weekday, time_local = row.time_local, timezone = row.timezone, ends_at = row.ends_at, status = row.status;
  if (patch.title != null) title = String(patch.title).trim() || title;
  if (patch.prompt != null || patch.goal != null || patch.message != null) {
    const p = String(patch.prompt ?? patch.goal ?? patch.message).trim();
    if (p) prompt = p;
  }
  if (patch.agent_id || patch.agentId || patch.agent) {
    agent_id = resolveAgentForOwner(ownerUserId, patch.agent_id || patch.agentId || patch.agent).id;
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
  db().prepare(`UPDATE scheduled_goals SET title=?, prompt=?, agent_id=?, cadence=?, weekday=?,
    time_local=?, timezone=?, ends_at=?, status=?, updated_at=datetime('now')
    WHERE id=? AND owner_user_id=?`).run(title, prompt, agent_id, cadence, weekday, time_local, timezone, ends_at, status, id, ownerUserId);
  console.log(`[scheduled-goals] updated id=${id} status=${status}`);
  return serializeGoal(getGoalRow(id, ownerUserId));
}

export function pauseScheduledGoal(ownerUserId, id) {
  return updateScheduledGoal(ownerUserId, id, { status: 'paused' });
}

export function resumeScheduledGoal(ownerUserId, id) {
  const row = getGoalRow(id, ownerUserId);
  if (!row) throw Object.assign(new Error('Scheduled goal not found'), { status: 404 });
  if (isExpired(row.ends_at)) return updateScheduledGoal(ownerUserId, id, { status: 'completed' });
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
    `When done, reply with a short summary of what you produced or delegated.\n\n` +
    `--- CEO prompt ---\n${row.prompt}\n--- end ---`
  );
}

export async function runScheduledGoal(ownerUserId, id, opts = {}) {
  const force = !!opts.force;
  const row = getGoalRow(id, ownerUserId);
  if (!row) throw Object.assign(new Error('Scheduled goal not found'), { status: 404 });
  if (!isUserEnabled(ownerUserId)) return { ok: false, skipped: true, reason: 'owner_disabled' };
  if (row.status === 'paused' && !force) return { ok: false, skipped: true, reason: 'paused' };
  if (row.status === 'completed' && !force) return { ok: false, skipped: true, reason: 'completed' };
  if (isExpired(row.ends_at) && !force) {
    updateScheduledGoal(ownerUserId, id, { status: 'completed' });
    return { ok: false, skipped: true, reason: 'ended' };
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
  if (!force) {
    const claim = db().prepare(
      `UPDATE scheduled_goals SET last_run_key=?, last_run_at=datetime('now'), last_run_status='running', updated_at=datetime('now')
       WHERE id=? AND owner_user_id=? AND (last_run_key IS NULL OR last_run_key != ?)`
    ).run(runKey, id, ownerUserId, runKey);
    if (!claim.changes) return { ok: false, skipped: true, reason: 'claim_failed', run_key: runKey };
  } else {
    db().prepare(
      `UPDATE scheduled_goals SET last_run_key=?, last_run_at=datetime('now'), last_run_status='running', updated_at=datetime('now')
       WHERE id=? AND owner_user_id=?`
    ).run(runKey, id, ownerUserId);
  }
  const runId = `sgr-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  db().prepare(
    `INSERT OR IGNORE INTO scheduled_goal_runs (id, goal_id, owner_user_id, run_key, status, agent_id, triggered_by)
     VALUES (?, ?, ?, ?, 'running', ?, ?)`
  ).run(runId, id, ownerUserId, runKey, row.agent_id, force ? 'run_now' : 'schedule');

  const agent = resolveAgentForOwner(ownerUserId, row.agent_id);
  let openclawId = agent.openclaw_agent_id || agent.id;
  try { openclawId = ensureTenantOpenClawAgent(agent, ownerUserId).openclawAgentId; }
  catch (e) { console.warn(`[scheduled-goals] tenant ensure failed agent=${agent.id}:`, e.message); }

  const sessionUser = openclaw.sessionUserFor(openclawId, ownerUserId, `sched-${id.slice(0, 12)}`);
  let prompt = buildRunMessage(row, ownerUserId, { runKey, force });
  try { prompt = await getPromptWithMemoryInjected(agent.id, prompt); } catch (_) {}
  prompt = `[ceo_user_id: ${ownerUserId}]\n[owner_user_id: ${ownerUserId}]\n${prompt}`;

  try {
    insertChatTurn({ agentId: agent.id, ownerUserId, role: 'user', content: `[Scheduled goal] ${row.title}\n\n${row.prompt}` });
  } catch (e) { console.warn('[scheduled-goals] chat user turn:', e.message); }

  try {
    console.log(`[scheduled-goals] firing id=${id} agent=${openclawId} run_key=${runKey}`);
    const { content } = await openclaw.chatCompletions(
      openclawId, [{ role: 'user', content: prompt }], sessionUser, false,
      { injectLearningsInstruction: true, injectKanbanInstruction: true }
    );
    const reply = String(content || '').trim() || '(no response)';
    const preview = reply.slice(0, 2000);
    try { insertChatTurn({ agentId: agent.id, ownerUserId, role: 'assistant', content: reply }); } catch (_) {}
    db().prepare(
      `UPDATE scheduled_goals SET last_run_status='ok', last_run_error=NULL, run_count=COALESCE(run_count,0)+1, updated_at=datetime('now')
       WHERE id=? AND owner_user_id=?`
    ).run(id, ownerUserId);
    db().prepare(`UPDATE scheduled_goal_runs SET status='ok', reply_preview=? WHERE id=?`).run(preview, runId);
    if (isExpired(row.ends_at)) updateScheduledGoal(ownerUserId, id, { status: 'completed' });
    return { ok: true, goal_id: id, run_id: runId, run_key: runKey, agent_id: agent.id, reply_preview: preview.slice(0, 500) };
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`[scheduled-goals] fail id=${id}:`, msg);
    db().prepare(
      `UPDATE scheduled_goals SET last_run_status='error', last_run_error=?, updated_at=datetime('now') WHERE id=? AND owner_user_id=?`
    ).run(msg.slice(0, 500), id, ownerUserId);
    db().prepare(`UPDATE scheduled_goal_runs SET status='error', error=? WHERE id=?`).run(msg.slice(0, 1000), runId);
    return { ok: false, goal_id: id, run_id: runId, error: msg };
  }
}

export async function tickScheduledGoals(now = new Date()) {
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
  const results = [];
  for (const row of rows) {
    if (!isGoalDueNow(row, now)) continue;
    try { results.push(await runScheduledGoal(row.owner_user_id, row.id, { force: false })); }
    catch (e) { results.push({ ok: false, goal_id: row.id, error: e.message }); }
  }
  if (results.length) console.log(`[scheduled-goals] tick fired ${results.length} goal(s)`);
  return { count: results.length, results };
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
  return db().prepare(
    `SELECT * FROM scheduled_goal_runs WHERE owner_user_id=? AND (? IS NULL OR goal_id=?)
     ORDER BY datetime(created_at) DESC LIMIT ?`
  ).all(ownerUserId, goalId || null, goalId || null, Math.min(Math.max(limit, 1), 100));
}
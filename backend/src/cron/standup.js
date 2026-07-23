/**
 * Standup cron: legacy auto-collect + per-standup daily schedule runner.
 */
import { getDb } from '../db/schema.js';
import * as openclaw from '../gateway/openclaw.js';
import { runCooSummarization } from '../services/coo.js';
import { getPromptWithMemoryInjected, scheduleCeoRequestViaOpenClawCron } from '../services/delegation-queue.js';
import { getAgentsUnderCooForCeo } from '../services/org-context.js';
import { ensureTenantOpenClawAgent } from '../services/openclaw-tenant.js';
import { isVisibleStandupSource } from '../services/standup-hub.js';
import { isUserEnabled } from '../services/user-enabled.js';

const STANDUP_PROMPT_BASE =
  "The COO is collecting today's standup. What is your status and a brief summary? Reply in 2–4 sentences: what you did, any blockers, and next steps.";

function db() {
  return getDb();
}

async function runStandupForCeo(ceoUserId) {
  const coo = db().prepare('SELECT * FROM agents WHERE is_coo = 1 LIMIT 1').get();
  if (!coo) return { standup: null, error: 'No COO agent configured' };

  const delegated = getAgentsUnderCooForCeo(ceoUserId);
  const now = new Date().toISOString();
  db()
    .prepare('INSERT INTO standups (scheduled_at, status, source, owner_user_id) VALUES (?, ?, ?, ?)')
    .run(now, 'scheduled', 'cron', ceoUserId);
  const standup = db().prepare('SELECT * FROM standups WHERE id = last_insert_rowid()').get();
  if (!standup) return { standup: null, error: 'Failed to create standup' };

  for (const agent of delegated) {
    let openclawId = agent.openclaw_agent_id || agent.id;
    try {
      openclawId = ensureTenantOpenClawAgent(agent, ceoUserId).openclawAgentId;
    } catch (_) {}
    const sessionUser = `standup-${standup.id}-${agent.id}`;
    const sessionKeyLine = `\n\nYour session key for this run is ${openclaw.sessionKeyFor(openclawId, sessionUser)}. Use this exact sessionKey when calling sessions_history. If sessions_history returns empty, the conversation is in the messages above—proceed with those.`;
    let prompt = await getPromptWithMemoryInjected(agent.id, STANDUP_PROMPT_BASE);
    prompt = `[ceo_user_id: ${ceoUserId}]\n[owner_user_id: ${ceoUserId}]\n${prompt}${sessionKeyLine}`;
    try {
      const { content } = await openclaw.chatCompletions(
        openclawId,
        [{ role: 'user', content: prompt }],
        sessionUser,
        false
      );
      db()
        .prepare('INSERT INTO standup_responses (standup_id, agent_id, content) VALUES (?, ?, ?)')
        .run(standup.id, agent.id, content || '(no response)');
    } catch (err) {
      db()
        .prepare('INSERT INTO standup_responses (standup_id, agent_id, content) VALUES (?, ?, ?)')
        .run(standup.id, agent.id, `[Error collecting: ${err.message}]`);
    }
  }

  const responses = db()
    .prepare('SELECT agent_id, content FROM standup_responses WHERE standup_id = ? ORDER BY submitted_at')
    .all(standup.id);

  try {
    const { coo_summary, ceo_summary } = await runCooSummarization(responses, [], [], ceoUserId);
    db()
      .prepare('UPDATE standups SET coo_summary = ?, ceo_summary = ?, status = ? WHERE id = ?')
      .run(coo_summary, ceo_summary, 'completed', standup.id);
  } catch (err) {
    db().prepare('UPDATE standups SET status = ? WHERE id = ?').run('coo_failed', standup.id);
    return { standup: db().prepare('SELECT * FROM standups WHERE id = ?').get(standup.id), error: err.message };
  }

  return { standup: db().prepare('SELECT * FROM standups WHERE id = ?').get(standup.id) };
}

/**
 * Run scheduled standup for every enabled CEO (tenant-isolated).
 */
export async function runScheduledStandup() {
  const ceos = db()
    .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all();
  if (!ceos.length) return { standup: null, error: 'No CEO users' };

  const results = [];
  for (const { id } of ceos) {
    results.push(await runStandupForCeo(id));
  }
  const last = results[results.length - 1];
  return { standup: last?.standup || null, results, error: last?.error };
}

function utcDateKey(d) {
  return d.toISOString().slice(0, 10);
}

/** True when standup's scheduled_at hour:minute (UTC) matches now. */
export function isStandupDueNow(scheduledAtIso, now = new Date()) {
  if (!scheduledAtIso) return false;
  const scheduled = new Date(scheduledAtIso);
  if (Number.isNaN(scheduled.getTime())) return false;
  return (
    scheduled.getUTCHours() === now.getUTCHours() && scheduled.getUTCMinutes() === now.getUTCMinutes()
  );
}

/** Skip if this standup already fired today (UTC day). */
export function alreadyRanStandupToday(lastScheduledRunAt, now = new Date()) {
  if (!lastScheduledRunAt) return false;
  const last = new Date(lastScheduledRunAt);
  if (Number.isNaN(last.getTime())) return false;
  return utcDateKey(last) === utcDateKey(now);
}

function resolveStandupRunMessage(standup) {
  const outcomes = String(standup.outcomes || '').trim();
  if (outcomes) return outcomes;
  const firstUser = db()
    .prepare(
      `SELECT content FROM standup_messages WHERE standup_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1`
    )
    .get(standup.id);
  if (firstUser?.content) return String(firstUser.content).trim();
  return 'Provide your status and deliverables for the CEO standup.';
}

/**
 * Run one user-created standup schedule: delegate outcomes to team via COO.
 */
export async function runStandupScheduleForStandup(standup) {
  const ownerUserId = standup.owner_user_id;
  if (!ownerUserId) return { standupId: standup.id, error: 'missing owner_user_id' };
  if (!isUserEnabled(ownerUserId)) {
    return { standupId: standup.id, skipped: true, reason: 'owner_disabled' };
  }

  const message = resolveStandupRunMessage(standup);
  db()
    .prepare('INSERT INTO standup_messages (standup_id, role, content) VALUES (?, ?, ?)')
    .run(standup.id, 'user', `[Scheduled run] ${message}`);

  const result = await scheduleCeoRequestViaOpenClawCron(standup.id, message, ownerUserId);
  const cooReply =
    result.count === 0
      ? 'Scheduled standup: no agents were allocated for this request.'
      : `Scheduled standup: I've asked ${result.agentNames.join(' and ')} to look into this. You'll see their responses here when ready.`;
  db()
    .prepare('INSERT INTO standup_messages (standup_id, role, content) VALUES (?, ?, ?)')
    .run(standup.id, 'coo', cooReply);

  const now = new Date().toISOString();
  db()
    .prepare('UPDATE standups SET last_scheduled_run_at = ?, status = ? WHERE id = ?')
    .run(now, 'active', standup.id);

  return {
    standupId: standup.id,
    requestId: result.requestId,
    tasksQueued: result.count,
    cooReply,
  };
}

/**
 * Fire user-created standups whose daily schedule matches the current minute.
 * Skips standups owned by disabled platform users.
 */
export async function runDueStandupSchedules(now = new Date()) {
  const rows = db()
    .prepare(
      `SELECT s.* FROM standups s
       INNER JOIN platform_users u ON u.id = s.owner_user_id AND u.enabled = 1
       WHERE s.source = 'manual'
         AND s.status IN ('scheduled', 'active')
         AND s.owner_user_id IS NOT NULL
         AND s.scheduled_at IS NOT NULL`
    )
    .all();

  const due = rows.filter(
    (s) =>
      isVisibleStandupSource(s.source) &&
      isStandupDueNow(s.scheduled_at, now) &&
      !alreadyRanStandupToday(s.last_scheduled_run_at, now)
  );

  const results = [];
  for (const standup of due) {
    try {
      results.push(await runStandupScheduleForStandup(standup));
    } catch (err) {
      results.push({ standupId: standup.id, error: err.message });
    }
  }
  return { count: results.length, results };
}

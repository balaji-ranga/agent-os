/**
 * Standup cron: create per-CEO standups, collect status from that CEO's agents via tenant OpenClaw.
 */
import { getDb } from '../db/schema.js';
import * as openclaw from '../gateway/openclaw.js';
import { runCooSummarization } from '../services/coo.js';
import { getPromptWithMemoryInjected } from '../services/delegation-queue.js';
import { getAgentsUnderCooForCeo } from '../services/org-context.js';
import { ensureTenantOpenClawAgent } from '../services/openclaw-tenant.js';

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
    const { coo_summary, ceo_summary } = await runCooSummarization(responses, []);
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

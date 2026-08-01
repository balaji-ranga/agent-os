/**
 * Per-CEO data retention: permanently delete aged chat, standup chat, workflow runs,
 * and CEO Content Explorer media (inbound uploads + generated files on disk).
 */
import { getDb } from '../db/schema.js';
import { purgeAgedContentExplorerMedia } from './content-explorer.js';

export const RETENTION_DAY_OPTIONS = [30, 60, 90, 120, 365];
export const DEFAULT_RETENTION_DAYS = 90;

export function normalizeRetentionDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  if (RETENTION_DAY_OPTIONS.includes(n)) return n;
  let best = DEFAULT_RETENTION_DAYS;
  let bestDist = Infinity;
  for (const opt of RETENTION_DAY_OPTIONS) {
    const d = Math.abs(opt - n);
    if (d < bestDist) {
      best = opt;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Permanently delete aged history for one CEO.
 * @returns {{ owner_user_id, retention_days, deleted: object }}
 */
export function purgeOwnerRetention(ownerUserId, { days = null } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const db = getDb();
  const row = db.prepare(`SELECT data_retention_days FROM platform_users WHERE id = ?`).get(owner);
  const retentionDays = normalizeRetentionDays(days ?? row?.data_retention_days ?? DEFAULT_RETENTION_DAYS);
  const cutoff = `-${retentionDays} days`;

  const deleted = {
    chat_turns: 0,
    agent_workflow_chat_turns: 0,
    standup_messages: 0,
    workflow_run_steps: 0,
    workflow_runs: 0,
    inbound_attachments: 0,
    generated_media: 0,
  };

  deleted.chat_turns =
    db
      .prepare(
        `DELETE FROM chat_turns
         WHERE owner_user_id = ? AND datetime(created_at) < datetime('now', ?)`
      )
      .run(owner, cutoff).changes || 0;

  try {
    deleted.agent_workflow_chat_turns =
      db
        .prepare(
          `DELETE FROM agent_workflow_chat_turns
           WHERE owner_user_id = ? AND datetime(created_at) < datetime('now', ?)`
        )
        .run(owner, cutoff).changes || 0;
  } catch (_) {
    /* table may not exist on older DBs */
  }

  deleted.standup_messages =
    db
      .prepare(
        `DELETE FROM standup_messages
         WHERE standup_id IN (SELECT id FROM standups WHERE owner_user_id = ?)
           AND datetime(created_at) < datetime('now', ?)`
      )
      .run(owner, cutoff).changes || 0;

  const oldRuns = db
    .prepare(
      `SELECT id FROM agent_workflow_runs
       WHERE owner_user_id = ?
         AND datetime(COALESCE(started_at, updated_at, '1970-01-01')) < datetime('now', ?)`
    )
    .all(owner, cutoff)
    .map((r) => r.id);

  if (oldRuns.length) {
    const ph = oldRuns.map(() => '?').join(',');
    deleted.workflow_run_steps =
      db.prepare(`DELETE FROM agent_workflow_run_steps WHERE run_id IN (${ph})`).run(...oldRuns)
        .changes || 0;
    deleted.workflow_runs =
      db.prepare(`DELETE FROM agent_workflow_runs WHERE id IN (${ph})`).run(...oldRuns).changes || 0;
  }

  try {
    const media = purgeAgedContentExplorerMedia(owner, retentionDays);
    deleted.inbound_attachments = media.inbound_attachments || 0;
    deleted.generated_media = media.generated_media || 0;
  } catch (e) {
    console.warn('[retention] media purge failed', owner, e?.message || e);
  }

  console.log(
    `[retention] owner=${owner} days=${retentionDays} deleted=${JSON.stringify(deleted)}`
  );
  return { owner_user_id: owner, retention_days: retentionDays, deleted };
}

export function purgeRetentionForAllCeos() {
  const ceos = getDb()
    .prepare(`SELECT id, data_retention_days FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all();
  const results = [];
  for (const ceo of ceos) {
    try {
      results.push({ ok: true, ...purgeOwnerRetention(ceo.id) });
    } catch (e) {
      console.warn('[retention] failed', ceo.id, e?.message || e);
      results.push({ ok: false, owner_user_id: ceo.id, error: e.message || String(e) });
    }
  }
  return { count: results.length, results };
}

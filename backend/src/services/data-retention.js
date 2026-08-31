/**
 * Per-CEO data retention: permanently delete aged chat, standup chat, workflow runs,
 * and CEO Content Explorer media (inbound uploads + generated files on disk).
 */
import { getDb } from '../db/schema.js';
import { purgeAgedContentExplorerMedia } from './content-explorer.js';
import { listDocuments, deleteDocument, isOpenSearchConfigured } from './master-data.js';

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
export async function purgeOwnerRetention(ownerUserId, { days = null } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const db = getDb();
  const row = db.prepare(`SELECT data_retention_days,role FROM platform_users WHERE id = ?`).get(owner);
  if (!row || row.role !== 'ceo') throw Object.assign(new Error('CEO owner profile required for company retention'), { status: 403 });
  const retentionDays = normalizeRetentionDays(days ?? row?.data_retention_days ?? DEFAULT_RETENTION_DAYS);
  const cutoff = `-${retentionDays} days`;

  const deleted = {
    chat_turns: 0,
    agent_workflow_chat_turns: 0,
    standup_messages: 0,
    workflow_run_steps: 0,
    workflow_runs: 0,
    tool_execution_actions: 0,
    inbound_attachments: 0,
    generated_media: 0,
    human_messages: 0,
    human_conversations: 0,
    human_calls: 0,
    human_call_invites: 0,
    agent_voice_sessions: 0,
    platform_notifications: 0,
    kanban_sla_events: 0,
    kanban_user_action_audit: 0,
    opensearch_documents: 0,
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

  // Human/voice communications belong to the CEO company, including employee activity.
  try {
    deleted.human_messages = db.prepare(
      `DELETE FROM human_messages WHERE owner_user_id=? AND datetime(created_at)<datetime('now',?)`
    ).run(owner, cutoff).changes || 0;
    db.prepare(`UPDATE human_conversations SET summary_text='',summary_updated_at=NULL
      WHERE owner_user_id=? AND summary_updated_at IS NOT NULL AND datetime(summary_updated_at)<datetime('now',?)`).run(owner, cutoff);
    const stale = db.prepare(`SELECT id FROM human_conversations c WHERE owner_user_id=?
      AND datetime(updated_at)<datetime('now',?) AND NOT EXISTS(SELECT 1 FROM human_messages m WHERE m.conversation_id=c.id)`).all(owner, cutoff).map((r) => r.id);
    if (stale.length) {
      const ph = stale.map(() => '?').join(',');
      db.prepare(`DELETE FROM human_conversation_participants WHERE conversation_id IN (${ph})`).run(...stale);
      deleted.human_conversations = db.prepare(`DELETE FROM human_conversations WHERE id IN (${ph})`).run(...stale).changes || 0;
    }
    deleted.human_calls = db.prepare(`DELETE FROM human_calls WHERE owner_user_id=?
      AND datetime(COALESCE(ended_at,expires_at,created_at))<datetime('now',?)`).run(owner, cutoff).changes || 0;
    deleted.human_call_invites = db.prepare(`DELETE FROM human_call_invites WHERE owner_user_id=?
      AND datetime(COALESCE(consumed_at,expires_at,created_at))<datetime('now',?)`).run(owner, cutoff).changes || 0;
    deleted.agent_voice_sessions = db.prepare(`DELETE FROM ceo_voice_sessions WHERE owner_user_id=?
      AND status<>'open' AND datetime(COALESCE(ended_at,expires_at,created_at))<datetime('now',?)`).run(owner, cutoff).changes || 0;
    deleted.platform_notifications = db.prepare(`DELETE FROM platform_user_notifications WHERE user_id IN
      (SELECT id FROM platform_users WHERE id=? OR owner_user_id=?) AND datetime(created_at)<datetime('now',?)`).run(owner, owner, cutoff).changes || 0;
    deleted.kanban_sla_events = db.prepare(`DELETE FROM kanban_sla_events
      WHERE owner_user_id=? AND datetime(occurred_at)<datetime('now',?)`).run(owner, cutoff).changes || 0;
    try {
      deleted.kanban_user_action_audit = db.prepare(`DELETE FROM kanban_user_action_audit
        WHERE owner_user_id=? AND datetime(created_at)<datetime('now',?)`).run(owner, cutoff).changes || 0;
    } catch (_) { /* table is created on first channel task action */ }
  } catch (e) {
    console.warn('[retention] company communication purge failed', owner, e?.message || e);
  }

  deleted.standup_messages =
    db
      .prepare(
        `DELETE FROM standup_messages
         WHERE standup_id IN (SELECT id FROM standups WHERE owner_user_id = ?)
           AND datetime(created_at) < datetime('now', ?)`
      )
      .run(owner, cutoff).changes || 0;

  try {
    deleted.tool_execution_actions =
      db.prepare(
        `DELETE FROM tool_execution_actions
          WHERE owner_user_id = ? AND datetime(created_at) < datetime('now', ?)`
      ).run(owner, cutoff).changes || 0;
  } catch (_) {
    /* table may not exist on older DBs */
  }


  // Delete only this CEO's aged uploaded/generated RAG documents; platform help is in a separate owner index.
  if (isOpenSearchConfigured()) {
    try {
      const docs = [];
      let offset = 0;
      for (;;) {
        const page = await listDocuments(owner, { limit: 200, offset });
        docs.push(...(page.documents || []));
        if (!page.has_more) break;
        offset += page.documents.length;
        if (!page.documents.length) break;
      }
      const cutoffMs = Date.now() - retentionDays * 86400000;
      for (const doc of docs) {
        const at = Date.parse(doc.created_at || doc.updated_at || '');
        if (Number.isFinite(at) && at < cutoffMs && !doc.is_protected) {
          await deleteDocument(owner, doc.id);
          deleted.opensearch_documents += 1;
        }
      }
    } catch (e) {
      console.warn('[retention] OpenSearch document purge failed', owner, e?.message || e);
    }
  }

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

export async function purgeRetentionForAllCeos() {
  const ceos = getDb()
    .prepare(`SELECT id, data_retention_days FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all();
  const results = [];
  for (const ceo of ceos) {
    try {
      results.push({ ok: true, ...(await purgeOwnerRetention(ceo.id)) });
    } catch (e) {
      console.warn('[retention] failed', ceo.id, e?.message || e);
      results.push({ ok: false, owner_user_id: ceo.id, error: e.message || String(e) });
    }
  }
  return { count: results.length, results };
}

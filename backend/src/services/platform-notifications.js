import { getDb } from '../db/schema.js';

const NOTIFY_WINDOW_DAYS = 3;

function db() {
  return getDb();
}

export function sendPlatformNotifications({
  userIds = [],
  allUsers = false,
  title,
  body = '',
  linkUrl = '',
  createdBy,
  source = null,
  sourceKey = null,
}) {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) throw new Error('title is required');
  if (!createdBy) throw new Error('createdBy is required');

  let targets = [];
  if (allUsers) {
    targets = db()
      .prepare(`SELECT id FROM platform_users WHERE enabled = 1 ORDER BY name ASC`)
      .all()
      .map((r) => r.id);
  } else {
    const unique = [...new Set((userIds || []).map((id) => String(id).trim()).filter(Boolean))];
    if (!unique.length) throw new Error('Select at least one user or choose all users');
    const placeholders = unique.map(() => '?').join(',');
    targets = db()
      .prepare(
        `SELECT id FROM platform_users WHERE enabled = 1 AND id IN (${placeholders}) ORDER BY name ASC`
      )
      .all(...unique)
      .map((r) => r.id);
    if (!targets.length) throw new Error('No enabled users matched the selection');
  }

  const src = source != null ? String(source).trim() || null : null;
  const key = sourceKey != null ? String(sourceKey).trim() || null : null;

  const insert = db().prepare(
    `INSERT OR IGNORE INTO platform_user_notifications
       (user_id, title, body, link_url, created_by, source, source_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  // Fallback when unique index missing / NULL source (always insert)
  const insertPlain = db().prepare(
    `INSERT INTO platform_user_notifications (user_id, title, body, link_url, created_by, source, source_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let sent = 0;
  const tx = db().transaction((ids) => {
    for (const userId of ids) {
      if (src && key) {
        const r = insert.run(
          userId,
          trimmedTitle,
          String(body || '').trim(),
          String(linkUrl || '').trim() || null,
          createdBy,
          src,
          key
        );
        if (r.changes) sent += 1;
      } else {
        insertPlain.run(
          userId,
          trimmedTitle,
          String(body || '').trim(),
          String(linkUrl || '').trim() || null,
          createdBy,
          src,
          key
        );
        sent += 1;
      }
    }
  });
  tx(targets);

  return { sent, user_ids: targets };
}

/** Unread notifications from the last NOTIFY_WINDOW_DAYS days. */
export function listNotificationsForUser(userId, { limit = 30 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 30, 1), 100);
  return db()
    .prepare(
      `SELECT n.id, n.user_id, n.title, n.body, n.link_url, n.created_by, n.created_at,
              n.read_at, n.source, n.source_key,
              u.name AS created_by_name
       FROM platform_user_notifications n
       LEFT JOIN platform_users u ON u.id = n.created_by
       WHERE n.user_id = ?
         AND n.read_at IS NULL
         AND datetime(n.created_at) >= datetime('now', ?)
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ?`
    )
    .all(userId, `-${NOTIFY_WINDOW_DAYS} days`, cap)
    .map((row) => ({
      id: row.id,
      kind: 'platform',
      title: row.title,
      body: row.body || '',
      link_url: row.link_url || null,
      created_at: row.created_at,
      created_by: row.created_by,
      created_by_name:
        row.created_by === 'system'
          ? 'System'
          : row.created_by_name || (row.created_by === 'system' ? 'System' : 'Admin'),
      source: row.source || null,
      source_key: row.source_key || null,
      read: false,
    }));
}

export function markNotificationsRead(userId, ids = []) {
  const list = [...new Set((ids || []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!list.length) return { marked: 0 };
  const placeholders = list.map(() => '?').join(',');
  const r = db()
    .prepare(
      `UPDATE platform_user_notifications
       SET read_at = datetime('now')
       WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`
    )
    .run(userId, ...list);
  return { marked: r.changes || 0 };
}

export function markAllNotificationsRead(userId) {
  const r = db()
    .prepare(
      `UPDATE platform_user_notifications
       SET read_at = datetime('now')
       WHERE user_id = ? AND read_at IS NULL
         AND datetime(created_at) >= datetime('now', ?)`
    )
    .run(userId, `-${NOTIFY_WINDOW_DAYS} days`);
  return { marked: r.changes || 0 };
}

export function deleteNotificationsBySource(source, sourceKey, userId = null) {
  const src = String(source || '').trim();
  const key = String(sourceKey || '').trim();
  if (!src || !key) return { deleted: 0 };
  if (userId) {
    const r = db()
      .prepare(
        `DELETE FROM platform_user_notifications WHERE source = ? AND source_key = ? AND user_id = ?`
      )
      .run(src, key, userId);
    return { deleted: r.changes || 0 };
  }
  const r = db()
    .prepare(`DELETE FROM platform_user_notifications WHERE source = ? AND source_key = ?`)
    .run(src, key);
  return { deleted: r.changes || 0 };
}

export function nodeWantsNotification(node) {
  const v = node?.data?.send_notification ?? node?.data?.sendNotification;
  return v === true || v === 1 || v === 'yes' || v === 'true';
}

export function notifyWorkflowNodeEvent({
  ownerUserId,
  runId,
  runNumber = null,
  definitionName = '',
  definitionId = '',
  node,
  phase, // started | completed | failed
}) {
  if (!nodeWantsNotification(node)) return null;
  if (!ownerUserId || !runId || !node?.id) return null;
  const label = node.data?.label || node.id;
  const phaseLabel = phase === 'started' ? 'started' : phase === 'failed' ? 'failed' : 'completed';
  const wfName = definitionName || definitionId || 'Workflow';
  const runLabel = runNumber != null ? `#${runNumber}` : `#${runId}`;
  try {
    return sendPlatformNotifications({
      userIds: [ownerUserId],
      title: `Workflow step ${phaseLabel}: ${label}`,
      body: `${wfName} · run ${runLabel}`,
      linkUrl: `/workflows?run_id=${runId}`,
      createdBy: 'system',
      source: 'workflow_node',
      sourceKey: `run:${runId}:node:${node.id}:${phaseLabel}`,
    });
  } catch (e) {
    console.warn('[notifications] workflow node notify failed:', e.message);
    return null;
  }
}

export function notifyKanbanTaskCreated({ userId, task }) {
  if (!userId || !task?.id) return null;
  try {
    return sendPlatformNotifications({
      userIds: [userId],
      title: `Kanban: ${task.title || `Task #${task.id}`}`,
      body: task.assigned_agent_id
        ? `Assigned to ${task.assigned_agent_id}`
        : 'New task on your board',
      linkUrl: `/kanban`,
      createdBy: 'system',
      source: 'kanban_task',
      sourceKey: String(task.id),
    });
  } catch (e) {
    console.warn('[notifications] kanban create notify failed:', e.message);
    return null;
  }
}

export function clearKanbanTaskNotification(taskId, userId = null) {
  if (!taskId) return { deleted: 0 };
  return deleteNotificationsBySource('kanban_task', String(taskId), userId);
}

export { NOTIFY_WINDOW_DAYS };

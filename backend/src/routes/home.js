/**
 * Home dashboard snapshot + global search.
 * GET /api/home/snapshot — org-wide KPIs for the authenticated CEO (platform TZ today)
 * GET /api/home/search?q= — chats, kanban, agents, workflows, master tables, RAG docs
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getDb } from '../db/schema.js';
import { getDbForCeo } from '../db/request-db.js';
import { listAgentsForUser } from '../services/users.js';
import { kanbanOwnerSqlFilter } from '../services/kanban-user-scope.js';
import { getPlatformTimezone } from '../utils/format-datetime.js';
import { listTables, ensureMasterDataSchema } from '../services/master-data.js';
import {
  isOpenSearchConfigured,
  searchDocuments,
  listDocuments as osListDocuments,
} from '../services/opensearch/index.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

function zonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const o = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') o[part.type] = part.value;
  }
  return {
    year: Number(o.year),
    month: Number(o.month),
    day: Number(o.day),
    hour: Number(o.hour),
    minute: Number(o.minute),
    second: Number(o.second),
  };
}

/** Offset ms: (wall clock interpreted as UTC) - actual UTC for that instant. */
function tzOffsetMs(timeZone, date) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/**
 * Calendar-day start / multi-day window start in platform timezone, as SQLite UTC strings
 * matching how kanban stores datetime('now') values (UTC, space separator).
 * daysBack=0 => today 00:00 local; daysBack=6 => start of day 6 days ago (7-day inclusive window).
 */
function platformDayWindow({ daysBack = 0 } = {}) {
  const timeZone = getPlatformTimezone();
  const now = new Date();
  const p = zonedParts(now, timeZone);
  const localTodayUtcGuess = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  const localMidday = new Date(localTodayUtcGuess + 12 * 3600_000);
  let off = tzOffsetMs(timeZone, localMidday);
  let startMs = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) - off;
  const off2 = tzOffsetMs(timeZone, new Date(startMs));
  if (off2 !== off) {
    off = off2;
    startMs = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) - off;
  }
  if (daysBack > 0) {
    startMs -= daysBack * 24 * 3600_000;
  }
  const d = new Date(startMs);
  const iso = d.toISOString().slice(0, 19).replace('T', ' ');
  return {
    timeZone,
    startIso: iso,
    dayLabel: new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now),
  };
}

function sqlCount(db, ownerFilter, status, sinceIso) {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM kanban_tasks k
         WHERE ${ownerFilter.clause}
           AND k.status = ?
           AND COALESCE(k.updated_at, k.created_at) >= ?`
      )
      .get(...ownerFilter.params, status, sinceIso)?.n || 0
  );
}

router.get('/snapshot', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    const agents = listAgentsForUser(owner) || [];
    const ownerFilter = kanbanOwnerSqlFilter(req.authUser);
    const db = getDb();
    const todayWin = platformDayWindow({ daysBack: 0 });
    const weekWin = platformDayWindow({ daysBack: 6 });

    const statusRows = db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM kanban_tasks k
         WHERE ${ownerFilter.clause}
         GROUP BY status`
      )
      .all(...ownerFilter.params);
    const byStatus = {
      open: 0,
      awaiting_confirmation: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
    };
    let totalTasks = 0;
    for (const r of statusRows) {
      if (byStatus[r.status] != null) byStatus[r.status] = Number(r.n) || 0;
      totalTasks += Number(r.n) || 0;
    }
    const inProgress = byStatus.in_progress;
    const awaiting = byStatus.awaiting_confirmation;

    let completedToday = 0;
    let failedToday = 0;
    let completed7d = 0;
    let failed7d = 0;
    try {
      completedToday = sqlCount(db, ownerFilter, 'completed', todayWin.startIso);
      failedToday = sqlCount(db, ownerFilter, 'failed', todayWin.startIso);
      completed7d = sqlCount(db, ownerFilter, 'completed', weekWin.startIso);
      failed7d = sqlCount(db, ownerFilter, 'failed', weekWin.startIso);
    } catch (e) {
      console.warn('[home] task window counts:', e?.message || e);
    }

    // Success rate (7d): completed / (completed + failed) over last 7 platform-TZ days.
    // Open / in-progress / awaiting cards are excluded.
    const decided7d = completed7d + failed7d;
    const successRate = decided7d > 0 ? Math.round((completed7d / decided7d) * 100) : 100;

    let workflowsRunning = 0;
    let recentWorkflows = [];
    try {
      workflowsRunning =
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM agent_workflow_runs
             WHERE owner_user_id = ? AND lower(status) IN ('running','pending','paused')`
          )
          .get(owner)?.n || 0;
      recentWorkflows = db
        .prepare(
          `SELECT r.id, r.status, r.started_at, r.completed_at, r.definition_id,
                  COALESCE(d.name, 'Workflow') AS name
           FROM agent_workflow_runs r
           LEFT JOIN agent_workflow_definitions d ON d.id = r.definition_id
           WHERE r.owner_user_id = ?
           ORDER BY COALESCE(r.completed_at, r.started_at, r.id) DESC
           LIMIT 5`
        )
        .all(owner)
        .map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          started_at: r.started_at,
          completed_at: r.completed_at,
          definition_id: r.definition_id,
        }));
    } catch (e) {
      console.warn('[home] workflow snapshot:', e?.message || e);
    }

    const recentActivity = db
      .prepare(
        `SELECT k.id, k.title, k.status, k.assigned_agent_id, k.updated_at, k.created_at,
                a.name AS agent_name, a.avatar_image AS agent_avatar
         FROM kanban_tasks k
         LEFT JOIN agents a ON a.id = k.assigned_agent_id
         WHERE ${ownerFilter.clause}
           AND k.status IN ('in_progress','open','awaiting_confirmation')
         ORDER BY COALESCE(k.updated_at, k.created_at) DESC
         LIMIT 8`
      )
      .all(...ownerFilter.params)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        agent_id: t.assigned_agent_id,
        agent_name: t.agent_name || 'Unassigned',
        agent_avatar: t.agent_avatar || '',
        updated_at: t.updated_at || t.created_at,
      }));

    const agentActivity = agents.slice(0, 8).map((a) => {
      const active =
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM kanban_tasks k
             WHERE ${ownerFilter.clause}
               AND k.assigned_agent_id = ?
               AND k.status IN ('open','in_progress','awaiting_confirmation')`
          )
          .get(...ownerFilter.params, a.id)?.n || 0;
      let lastTitle = null;
      try {
        lastTitle =
          db
            .prepare(
              `SELECT title FROM kanban_tasks k
               WHERE ${ownerFilter.clause} AND k.assigned_agent_id = ?
               ORDER BY COALESCE(k.updated_at, k.created_at) DESC LIMIT 1`
            )
            .get(...ownerFilter.params, a.id)?.title || null;
      } catch {
        /* ignore */
      }
      return {
        id: a.id,
        name: a.name,
        role: a.role || '',
        department: a.department || '',
        avatar_image: a.avatar_image || '',
        is_coo: !!a.is_coo,
        active_tasks: active,
        status: active > 0 ? 'active' : 'idle',
        activity: lastTitle || (a.role ? String(a.role).slice(0, 80) : 'Ready'),
      };
    });

    res.json({
      timezone: todayWin.timeZone,
      day_label: todayWin.dayLabel,
      kpis: {
        active_agents: agents.length,
        tasks_in_progress: inProgress,
        awaiting_approval: awaiting,
        success_rate_7d: successRate,
        success_rate_label: 'Success rate (7d)',
        success_rate_detail: {
          completed_7d: completed7d,
          failed_7d: failed7d,
          formula: 'completed / (completed + failed) over last 7 platform-TZ days',
        },
      },
      snapshot: {
        workflows_running: workflowsRunning,
        tasks_completed_today: completedToday,
        approvals_pending: awaiting,
        errors_failed_today: failedToday,
        total_tasks: totalTasks,
        by_status: byStatus,
        day_start_utc: todayWin.startIso,
        timezone: todayWin.timeZone,
      },
      agent_activity: agentActivity,
      recent_workflows: recentWorkflows,
      recent_tasks: recentActivity,
    });
  } catch (e) {
    console.warn('[home] snapshot failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    const q = String(req.query.q || req.query.query || '').trim().slice(0, 120);
    if (q.length < 2) return res.json({ q, results: [] });
    const safe = q.replace(/[%_]/g, '');
    const like = `%${safe}%`;
    const db = getDb();
    const ownerFilter = kanbanOwnerSqlFilter(req.authUser);
    const results = [];
    const seen = new Set();
    const push = (item) => {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(item);
    };

    try {
      const chats = db
        .prepare(
          `SELECT id, agent_id, title, status, archived_at, started_at
           FROM chat_sessions
           WHERE owner_user_id = ? AND title LIKE ? COLLATE NOCASE
           ORDER BY COALESCE(archived_at, started_at) DESC
           LIMIT 12`
        )
        .all(owner, like);
      for (const c of chats) {
        push({
          type: 'chat',
          id: c.id,
          title: c.title || 'Chat session',
          subtitle: c.status === 'archived' ? 'Archived chat' : 'Chat',
          href: c.agent_id ? `/agents/${encodeURIComponent(c.agent_id)}/chat` : '/',
          updated_at: c.archived_at || c.started_at,
        });
      }
    } catch (e) {
      console.warn('[home] search chats:', e?.message || e);
    }

    try {
      const tasks = db
        .prepare(
          `SELECT k.id, k.title, k.status, k.updated_at
           FROM kanban_tasks k
           WHERE ${ownerFilter.clause}
             AND (k.title LIKE ? COLLATE NOCASE OR IFNULL(k.description,'') LIKE ? COLLATE NOCASE)
           ORDER BY COALESCE(k.updated_at, k.created_at) DESC
           LIMIT 12`
        )
        .all(...ownerFilter.params, like, like);
      for (const t of tasks) {
        push({
          type: 'task',
          id: t.id,
          title: t.title || `Task #${t.id}`,
          subtitle: `Kanban · ${t.status}`,
          href: `/kanban?task=${t.id}`,
          updated_at: t.updated_at,
        });
      }
    } catch (e) {
      console.warn('[home] search tasks:', e?.message || e);
    }

    try {
      const agents = listAgentsForUser(owner) || [];
      const ql = q.toLowerCase();
      for (const a of agents) {
        const hay = `${a.name || ''} ${a.role || ''} ${a.department || ''}`.toLowerCase();
        if (!hay.includes(ql)) continue;
        push({
          type: 'agent',
          id: a.id,
          title: a.name || a.id,
          subtitle: a.role || 'Agent',
          href: a.is_coo ? '/' : `/agents/${encodeURIComponent(a.id)}/chat`,
          updated_at: null,
        });
      }
    } catch (e) {
      console.warn('[home] search agents:', e?.message || e);
    }

    try {
      const wfs = db
        .prepare(
          `SELECT id, name, status, updated_at
           FROM agent_workflow_definitions
           WHERE owner_user_id = ? AND name LIKE ? COLLATE NOCASE
           ORDER BY updated_at DESC
           LIMIT 10`
        )
        .all(owner, like);
      for (const w of wfs) {
        push({
          type: 'workflow',
          id: w.id,
          title: w.name || w.id,
          subtitle: `Workflow · ${w.status || ''}`,
          href: `/workflows/${encodeURIComponent(w.id)}/edit`,
          updated_at: w.updated_at,
        });
      }
    } catch (e) {
      console.warn('[home] search workflows:', e?.message || e);
    }

    // Master Data tables + row samples (CEO tenant/shared DB)
    try {
      const tables = listTables(owner) || [];
      const ql = q.toLowerCase();
      for (const t of tables) {
        const cols = Array.isArray(t.columns) ? t.columns.join(' ') : '';
        const hay = `${t.name || ''} ${t.description || ''} ${cols}`.toLowerCase();
        if (!hay.includes(ql)) continue;
        push({
          type: 'table',
          id: t.id,
          title: t.name || t.id,
          subtitle: t.description
            ? `Master table · ${String(t.description).slice(0, 60)}`
            : `Master table · ${t.row_count ?? 0} rows`,
          href: `/master-data?table=${encodeURIComponent(t.id)}`,
          updated_at: t.updated_at || null,
        });
      }
      try {
        const ceoDb = getDbForCeo(owner);
        ensureMasterDataSchema(ceoDb);
        const rowHits = ceoDb
          .prepare(
            `SELECT r.id, r.table_id, r.row_json, t.name AS table_name
             FROM master_data_rows r
             JOIN master_data_tables t ON t.id = r.table_id
             WHERE r.owner_user_id = ? AND r.row_json LIKE ? COLLATE NOCASE
             ORDER BY r.id DESC
             LIMIT 8`
          )
          .all(owner, like);
        for (const r of rowHits) {
          push({
            type: 'table_row',
            id: `${r.table_id}:${r.id}`,
            title: `Row in ${r.table_name || r.table_id}`,
            subtitle: String(r.row_json || '').slice(0, 100),
            href: `/master-data?table=${encodeURIComponent(r.table_id)}`,
            updated_at: null,
          });
        }
      } catch (e) {
        console.warn('[home] search master rows:', e?.message || e);
      }
    } catch (e) {
      console.warn('[home] search master tables:', e?.message || e);
    }

    // RAG documents (OpenSearch) — meta list + hybrid body search
    if (isOpenSearchConfigured()) {
      try {
        const docs = await osListDocuments(owner, { excludeProtected: true });
        const ql = q.toLowerCase();
        for (const d of docs || []) {
          const tags = Array.isArray(d.tags) ? d.tags.join(' ') : '';
          const hay = `${d.title || ''} ${d.filename || ''} ${tags}`.toLowerCase();
          if (!hay.includes(ql)) continue;
          push({
            type: 'document',
            id: d.id,
            title: d.title || d.filename || d.id,
            subtitle: 'Document',
            href: '/master-data?tab=documents',
            updated_at: d.updated_at || d.created_at || null,
          });
        }
      } catch (e) {
        console.warn('[home] search document list:', e?.message || e);
      }

      try {
        const rag = await searchDocuments(owner, { query: q, topK: 8 });
        for (const chunk of rag?.chunks || []) {
          const docId = chunk.document_id || chunk.id;
          if (!docId) continue;
          const excerpt = chunk.content
            ? `RAG · ${String(chunk.content).replace(/\s+/g, ' ').slice(0, 90)}…`
            : 'RAG document match';
          push({
            type: 'document',
            id: docId,
            title: chunk.title || chunk.filename || docId,
            subtitle: excerpt,
            href: '/master-data?tab=documents',
            updated_at: null,
          });
        }
      } catch (e) {
        console.warn('[home] search RAG:', e?.message || e);
      }
    } else {
      try {
        const ceoDb = getDbForCeo(owner);
        ensureMasterDataSchema(ceoDb);
        const docs = ceoDb
          .prepare(
            `SELECT id, title, filename, updated_at, text_excerpt
             FROM master_data_documents
             WHERE owner_user_id = ?
               AND (
                 IFNULL(title,'') LIKE ? COLLATE NOCASE
                 OR IFNULL(filename,'') LIKE ? COLLATE NOCASE
                 OR IFNULL(text_excerpt,'') LIKE ? COLLATE NOCASE
               )
             ORDER BY updated_at DESC
             LIMIT 12`
          )
          .all(owner, like, like, like);
        for (const d of docs) {
          push({
            type: 'document',
            id: d.id,
            title: d.title || d.filename || d.id,
            subtitle: 'Document',
            href: '/master-data?tab=documents',
            updated_at: d.updated_at,
          });
        }
      } catch (e) {
        console.warn('[home] search sqlite docs:', e?.message || e);
      }
    }

    res.json({ q, results: results.slice(0, 40) });
  } catch (e) {
    console.warn('[home] search failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;

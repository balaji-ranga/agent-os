/**
 * Kanban board API: tasks (CRUD, filters), task messages, reopen.
 * Status flow: open | awaiting_confirmation | in_progress | completed | failed.
 * When user adds a message to a task with an assigned agent, the session continues: we call the agent and append its reply.
 */
import { Router } from 'express';
import { getDb } from '../db/schema.js';
import * as openclaw from '../gateway/openclaw.js';
import { resolveKanbanTaskArtifacts } from '../services/kanban-artifacts.js';
import { parseAgentWorkflowMeta } from '../services/agent-workflow-kanban.js';
import { formatServerDateTime, formatServerDate, getServerTimezone } from '../utils/format-datetime.js';
import { resolveKanbanChatContext } from '../services/kanban-chat-context.js';
import { attachAuthUser, requireAuth, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  filterKanbanTasksForUser,
  kanbanTaskBelongsToUser,
  assertKanbanTaskAccess,
  assertKanbanTaskMutate,
  canMutateKanbanTask,
  kanbanOwnerSqlFilter,
} from '../services/kanban-user-scope.js';
import {
  notifyKanbanTaskCreated,
  clearKanbanTaskNotification,
} from '../services/platform-notifications.js';
import { buildKanbanChatStatusGuidance } from '../services/kanban-chat-status.js';
import {
  enrichReplyWithRecentImages,
  looksStatusOnlyReply,
  taskExpectsRichDeliverable,
  RICH_DELIVERABLE_NUDGE,
} from '../services/kanban-reply-enrich.js';
import { ensureTenantOpenClawAgent } from '../services/openclaw-tenant.js';
import { registerOpenClawSessionOwner } from '../services/tool-owner-scope.js';
import { insertChatTurn } from '../services/chat-history.js';
import {
  cancelDelegationsForDeletedKanban,
  reinitiateKanbanDelegation,
} from '../services/kanban-orphan-watcher.js';
import { respondToGoalActionApproval } from '../services/goal-action-approval.js';
import { respondToHumanGoalTask } from '../services/agent-goal-run.js';
import { normalizeEtaHours, computeDueAt, withSlaState } from '../services/kanban-sla.js';

const router = Router();
router.use(attachAuthUser);
router.use(requireAuth);
const VALID_STATUSES = ['open', 'awaiting_confirmation', 'in_progress', 'completed', 'failed'];

router.post('/tasks/:id/human-response', async (req, res) => {
  try {
    const task = db().prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    assertKanbanTaskMutate(task, req.authUser);
    const ownerUserId = resolveAuthenticatedCeoUserId(req);
    const result = await respondToHumanGoalTask({
      ownerUserId,
      actorUserId: req.authUser.id,
      taskId: Number(req.params.id),
      action: req.body?.action,
      outcome: req.body?.outcome,
    });
    res.json(result);
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

function db() {
  return getDb();
}

router.post('/tasks/:id/action-approval', async (req, res) => {
  try {
    const task = db().prepare('SELECT * FROM kanban_tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    assertKanbanTaskMutate(task, req.authUser);
    const ownerUserId = resolveAuthenticatedCeoUserId(req);
    const decision = String(req.body?.decision || '').toLowerCase();
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'decision must be approve or reject' });
    const out = await respondToGoalActionApproval({
      ownerUserId,
      kanbanTaskId: Number(req.params.id),
      decision,
      comment: String(req.body?.comment || '').slice(0, 1000),
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || String(e) });
  }
});

/** Mirror Kanban task chat into Dashboard chat_turns so Agent Chat shows the same exchange. */
function mirrorKanbanTurnToAgentChat({ agentId, ownerUserId, role, content, taskId, taskTitle }) {
  if (!agentId || !ownerUserId || !content) return;
  const prefix =
    role === 'user'
      ? `[Kanban #${taskId}${taskTitle ? ` · ${String(taskTitle).slice(0, 80)}` : ''}]\n`
      : `[Kanban #${taskId}]\n`;
  try {
    insertChatTurn({
      agentId,
      ownerUserId,
      role,
      content: `${prefix}${content}`,
    });
  } catch (e) {
    console.warn('[kanban] mirror to chat_turns failed:', e.message);
  }
}

/** Add platform-timezone display strings so the UI never renders raw UTC. */
function withDisplayTimes(row) {
  return {
    ...withSlaState(row),
    created_at_display: formatServerDateTime(row.created_at),
    updated_at_display: row.updated_at ? formatServerDateTime(row.updated_at) : null,
    due_date_display: row.due_date ? formatServerDate(row.due_date) : null,
  };
}

function messagesWithDisplayTimes(rows) {
  return (rows || []).map((m) => ({ ...m, created_at_display: formatServerDateTime(m.created_at) }));
}

const KANBAN_SELECT = `
  SELECT k.id, k.title, k.description, k.status, k.assigned_agent_id, k.assigned_member_key,
         k.assigned_user_id, k.created_by, k.standup_id,
         k.agent_delegation_task_id, k.owner_user_id, k.created_at, k.updated_at, k.due_date,
         k.eta_hours, k.due_at, k.sla_nudged_at, k.sla_escalated_at,
         COALESCE(a.name, om.display_name, pu.name) AS assigned_agent_name,
         om.kind AS assigned_member_kind,
         pu.name AS assigned_user_name
  FROM kanban_tasks k
  LEFT JOIN agents a ON a.id = k.assigned_agent_id
  LEFT JOIN org_agent_members om
    ON om.id = k.assigned_member_key AND om.owner_user_id = k.owner_user_id
  LEFT JOIN platform_users pu ON pu.id = k.assigned_user_id
`;

function resolveWorkflowStepIo(description) {
  const meta = parseAgentWorkflowMeta(description);
  if (!meta.run_id || !meta.node_id) return { input: null, output: null };
  const step = db()
    .prepare('SELECT input_json, output_json FROM agent_workflow_run_steps WHERE run_id = ? AND node_id = ?')
    .get(meta.run_id, meta.node_id);
  if (!step) return { input: null, output: null };
  let input = null;
  let output = null;
  try {
    if (step.input_json) input = JSON.parse(step.input_json);
  } catch {
    input = { _raw: step.input_json };
  }
  try {
    if (step.output_json) output = JSON.parse(step.output_json);
  } catch {
    output = { _raw: step.output_json };
  }
  return { input, output };
}

function parseViewRange(view, from, to) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);
  if (view === 'all' || view === 'everything') {
    return null; // no created_at filter — full board
  } else if (view === 'daily') {
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  } else if (view === 'weekly') {
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  } else if (view === 'monthly') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (view === 'range' && from && to) {
    start = new Date(from);
    end = new Date(to);
  } else {
    return null;
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

// GET /api/kanban/tasks — list with filters: view=all|daily|weekly|monthly|range, from, to, limit, offset
router.get('/tasks', (req, res) => {
  try {
    const view = (req.query.view || 'weekly').toLowerCase();
    const from = req.query.from;
    const to = req.query.to;
    const range = parseViewRange(view, from, to);
    const ownerFilter = kanbanOwnerSqlFilter(req.authUser);

    let where = `WHERE ${ownerFilter.clause}`;
    const params = [...ownerFilter.params];
    if (range) {
      const startSql = range.start.replace('T', ' ').replace(/\.\d{3}Z$/, '').slice(0, 19);
      const endSql = range.end.replace('T', ' ').replace(/\.\d{3}Z$/, '').slice(0, 19);
      where += ` AND k.created_at >= ? AND k.created_at <= ?`;
      params.push(startSql, endSql);
    }
    // "All" needs a higher page size so board delete-all / status views stay usable.
    const defaultLimit = view === 'all' || view === 'everything' || !range ? 200 : 100;
    const maxLimit = view === 'all' || view === 'everything' || !range ? 500 : 200;
    const limit = Math.min(Math.max(Number(req.query.limit) || defaultLimit, 1), maxLimit);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const total =
      db().prepare(`SELECT COUNT(*) AS n FROM kanban_tasks k ${where}`).get(...params)?.n ?? 0;

    const sql = `${KANBAN_SELECT} ${where} ORDER BY k.created_at DESC LIMIT ? OFFSET ?`;
    const rows = db().prepare(sql).all(...params, limit, offset);
    const scoped = filterKanbanTasksForUser(rows, req.authUser);
    const server_timezone = getServerTimezone();
    const tasks = scoped.map((row) => ({
      ...withDisplayTimes(row),
      can_mutate: canMutateKanbanTask(row, req.authUser),
    }));
    res.json({
      tasks,
      total,
      limit,
      offset,
      has_more: offset + tasks.length < total,
      server_timezone,
      view,
      filtered: !!range,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Unfiltered status counts for the entitled CEO — matches status_checker scope (all ages).
 * Use this so the Kanban UI can warn when the weekly/monthly filter hides open work.
 */
router.get('/counts', (req, res) => {
  try {
    const ownerFilter = kanbanOwnerSqlFilter(req.authUser);
    const rows = db()
      .prepare(
        `SELECT status, COUNT(*) AS n FROM kanban_tasks k
         WHERE ${ownerFilter.clause}
         GROUP BY status`
      )
      .all(...ownerFilter.params);
    const by_status = {
      open: 0,
      awaiting_confirmation: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
    };
    let total = 0;
    for (const r of rows) {
      if (by_status[r.status] != null) by_status[r.status] = Number(r.n) || 0;
      total += Number(r.n) || 0;
    }
    const active =
      by_status.open +
      by_status.awaiting_confirmation +
      by_status.in_progress +
      by_status.failed;
    res.json({
      by_status,
      total,
      active,
      needs_attention: by_status.awaiting_confirmation + by_status.failed,
      server_timezone: getServerTimezone(),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/kanban/summary — for standup: last 1 day task progress (counts by agent/status)
router.get('/summary', (req, res) => {
  try {
    const days = Math.min(Number(req.query.days) || 1, 31);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const ownerFilter = kanbanOwnerSqlFilter(req.authUser);
    const rows = db()
      .prepare(
        `${KANBAN_SELECT}
         WHERE ${ownerFilter.clause}
           AND k.created_at >= ?
           AND (k.assigned_agent_id IS NOT NULL OR k.assigned_member_key IS NOT NULL)
         ORDER BY k.created_at DESC
         LIMIT ?`
      )
      .all(...ownerFilter.params, since, 2000);
    const scoped = filterKanbanTasksForUser(rows, req.authUser);
    const counts = {};
    for (const r of scoped) {
      const key = r.assigned_agent_id || r.assigned_member_key;
      if (!counts[key]) {
        counts[key] = { open: 0, awaiting_confirmation: 0, in_progress: 0, completed: 0, failed: 0 };
      }
      if (VALID_STATUSES.includes(r.status)) counts[key][r.status] += 1;
    }
    const byAgent = counts;
    const agentNames = db().prepare('SELECT id, name FROM agents').all();
    const names = Object.fromEntries(agentNames.map((a) => [a.id, a.name]));
    for (const r of scoped) {
      if (r.assigned_member_key && r.assigned_agent_name) names[r.assigned_member_key] = r.assigned_agent_name;
    }
    res.json({ since, by_agent: byAgent, agent_names: names });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/kanban/tasks/:id — one task with messages and delegation context (prompt/response given to agent)
router.get('/tasks/:id', (req, res) => {
  try {
    const task = db()
      .prepare(
        `SELECT k.*, COALESCE(a.name, om.display_name, pu.name) AS assigned_agent_name,
                om.kind AS assigned_member_kind,
                d.prompt AS delegation_prompt_preview,
                d.owner_user_id AS delegation_owner_user_id
         FROM kanban_tasks k
         LEFT JOIN agents a ON a.id = k.assigned_agent_id
         LEFT JOIN org_agent_members om
           ON om.id = k.assigned_member_key AND om.owner_user_id = k.owner_user_id
         LEFT JOIN platform_users pu ON pu.id = k.assigned_user_id
         LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
         WHERE k.id = ?`
      )
      .get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    assertKanbanTaskAccess(task, req.authUser);
    const msgLimit = Math.min(Math.max(Number(req.query.messages_limit) || 100, 1), 500);
    const msgOffset = Math.max(Number(req.query.messages_offset) || 0, 0);
    const messagesTotal =
      db().prepare('SELECT COUNT(*) AS n FROM task_messages WHERE task_id = ?').get(task.id)?.n ?? 0;
    const messages = db()
      .prepare(
        'SELECT id, role, content, created_at FROM task_messages WHERE task_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      )
      .all(task.id, msgLimit, msgOffset);
    let delegation_prompt = null;
    let delegation_response = null;
    if (task.agent_delegation_task_id) {
      const d = db().prepare('SELECT prompt, response_content FROM agent_delegation_tasks WHERE id = ?').get(task.agent_delegation_task_id);
      if (d) {
        delegation_prompt = d.prompt || null;
        delegation_response = d.response_content || null;
      }
    }
    const { artifacts, groups, count: artifact_count } = resolveKanbanTaskArtifacts(
      task,
      task.agent_delegation_task_id
        ? { prompt: delegation_prompt, response_content: delegation_response }
        : null,
      messages
    );
    const { input: workflow_step_input, output: workflow_step_output } = resolveWorkflowStepIo(task.description);
    const chat_context = resolveKanbanChatContext(db(), task);
    res.json({
      ...withDisplayTimes(task),
      server_timezone: getServerTimezone(),
      messages: messagesWithDisplayTimes(messages),
      messages_total: messagesTotal,
      messages_limit: msgLimit,
      messages_offset: msgOffset,
      messages_has_more: msgOffset + messages.length < messagesTotal,
      chat_context,
      delegation_prompt,
      delegation_response,
      workflow_step_input,
      workflow_step_output,
      artifacts,
      artifact_groups: groups,
      artifact_count,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/kanban/tasks — create. Body: title, description?, assign_to: 'coo' | agent_id
router.post('/tasks', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body);
    if (!ownerUserId) return res.status(403).json({ error: 'CEO session required to create Kanban tasks' });
    const { title, description, assign_to, due_date, eta_hours } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title required' });
    const assigned_agent_id = assign_to && assign_to !== 'coo' ? String(assign_to).trim() || null : null;
    const desc = typeof description === 'string' ? description.trim() : '';
    const due = due_date ? new Date(due_date).toISOString().slice(0, 10) : null;
    const eta = normalizeEtaHours(eta_hours, `${title}\n${desc}`);
    const dueAt = computeDueAt(eta);
    db()
      .prepare(
        `INSERT INTO kanban_tasks (title, description, status, assigned_agent_id, created_by, due_date, eta_hours, due_at, owner_user_id)
         VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?)`
      )
      .run(title.trim(), desc, 'open', assigned_agent_id, due, eta, dueAt, ownerUserId);
    const row = db().prepare('SELECT * FROM kanban_tasks ORDER BY id DESC LIMIT 1').get();
    notifyKanbanTaskCreated({ userId: ownerUserId, task: row });
    res.status(201).json(row);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PATCH /api/kanban/tasks/:id — update status, assigned_agent_id, etc.
router.patch('/tasks/:id', (req, res) => {
  try {
    const task = db().prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    assertKanbanTaskMutate(task, req.authUser);
    const { status, assigned_agent_id, assigned_user_id, title, description, due_date, eta_hours } = req.body;
    const updates = [];
    const values = [];
    if (status !== undefined && VALID_STATUSES.includes(status)) {
      if ((status === 'completed' || status === 'failed') && task.goal_run_id && task.goal_step_id && task.assigned_user_id) {
        return res.status(409).json({ error: 'Use Complete task or Unable to complete and provide the human outcome so the goal can continue.' });
      }
      updates.push('status = ?');
      values.push(status);
    }
    if (assigned_agent_id !== undefined) {
      updates.push('assigned_agent_id = ?');
      values.push(assigned_agent_id || null);
      if (assigned_agent_id) {
        updates.push('assigned_user_id = ?');
        values.push(null);
      }
    }
    if (assigned_user_id !== undefined) {
      updates.push('assigned_user_id = ?');
      values.push(assigned_user_id || null);
      if (assigned_user_id) {
        updates.push('assigned_agent_id = ?');
        values.push(null);
      }
    }
    if (title !== undefined && typeof title === 'string') {
      updates.push('title = ?');
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(typeof description === 'string' ? description : '');
    }
    if (due_date !== undefined) {
      updates.push('due_date = ?');
      values.push(due_date ? new Date(due_date).toISOString().slice(0, 10) : null);
    }
    if (eta_hours !== undefined) {
      const eta = normalizeEtaHours(eta_hours, `${title ?? task.title}\n${description ?? task.description}`);
      updates.push('eta_hours = ?', 'due_at = ?', 'sla_nudged_at = NULL', 'sla_escalated_at = NULL');
      values.push(eta, computeDueAt(eta));
    }
    if (updates.length === 0) return res.json(task);
    updates.push("updated_at = datetime('now')");
    values.push(req.params.id);
    db().prepare(`UPDATE kanban_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    let updated = db().prepare('SELECT k.*, a.name AS assigned_agent_name FROM kanban_tasks k LEFT JOIN agents a ON a.id = k.assigned_agent_id WHERE k.id = ?').get(req.params.id);
    if (status === 'completed' || status === 'failed') {
      clearKanbanTaskNotification(updated.id, req.authUser?.id);
    }
    // Drag/move back to open: start a fresh specialty run (watcher used to ignore open+completed).
    const movedToOpen =
      status === 'open' &&
      task.status !== 'open' &&
      updated.assigned_agent_id &&
      !updated.assigned_member_key;
    let reinit = null;
    if (movedToOpen) {
      reinit = reinitiateKanbanDelegation(updated.id, {
        reason: 'ceo_move_open',
        resetRetries: true,
      });
      if (reinit?.ok) {
        updated = db()
          .prepare(
            'SELECT k.*, a.name AS assigned_agent_name FROM kanban_tasks k LEFT JOIN agents a ON a.id = k.assigned_agent_id WHERE k.id = ?'
          )
          .get(req.params.id);
        console.info(
          '[kanban] move→open reinitiated task=%s delegation=%s agent=%s',
          updated.id,
          reinit.new_delegation_id,
          reinit.agent_id
        );
      } else {
        console.warn(
          '[kanban] move→open reinit skipped task=%s reason=%s',
          updated.id,
          reinit?.reason || 'unknown'
        );
      }
    }
    res.json(reinit ? { ...updated, reinit } : updated);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// POST /api/kanban/tasks/:id/reopen — set status to open and re-queue assigned specialty work
router.post('/tasks/:id/reopen', (req, res) => {
  try {
    const task = db().prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    assertKanbanTaskMutate(task, req.authUser);
    db().prepare("UPDATE kanban_tasks SET status = 'open', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    let reinit = null;
    if (task.assigned_agent_id && !task.assigned_member_key) {
      reinit = reinitiateKanbanDelegation(Number(req.params.id), {
        reason: 'ceo_reopen',
        resetRetries: true,
      });
      if (reinit?.ok) {
        console.info(
          '[kanban] reopen reinitiated task=%s delegation=%s agent=%s',
          req.params.id,
          reinit.new_delegation_id,
          reinit.agent_id
        );
      } else {
        console.warn(
          '[kanban] reopen reinit skipped task=%s reason=%s',
          req.params.id,
          reinit?.reason || 'unknown'
        );
      }
    }
    const updated = db()
      .prepare(
        'SELECT k.*, a.name AS assigned_agent_name FROM kanban_tasks k LEFT JOIN agents a ON a.id = k.assigned_agent_id WHERE k.id = ?'
      )
      .get(req.params.id);
    res.json(reinit ? { ...updated, reinit } : updated);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// DELETE /api/kanban/tasks/:id — delete one task (cancel linked work, messages, then task)
router.delete('/tasks/:id', (req, res) => {
  try {
    const task = db().prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    assertKanbanTaskMutate(task, req.authUser);
    const id = Number(req.params.id);
    clearKanbanTaskNotification(id, req.authUser?.id);
    cancelDelegationsForDeletedKanban([id]);
    db().prepare('UPDATE kanban_tasks SET standup_id = NULL, agent_delegation_task_id = NULL WHERE id = ?').run(id);
    db().prepare('DELETE FROM task_messages WHERE task_id = ?').run(id);
    db().prepare('DELETE FROM kanban_tasks WHERE id = ?').run(id);
    res.status(204).send();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// DELETE /api/kanban/tasks — bulk delete. Body: { task_ids: [1, 2, 3] }
router.delete('/tasks', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.task_ids) ? req.body.task_ids.map((n) => Number(n)).filter((n) => n > 0) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'task_ids array required with at least one id' });
    const allowed = [];
    for (const id of ids) {
      const task = db().prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(id);
      if (task && canMutateKanbanTask(task, req.authUser)) allowed.push(id);
    }
    if (!allowed.length) return res.status(404).json({ error: 'No accessible tasks found' });
    const placeholders = allowed.map(() => '?').join(',');
    for (const id of allowed) clearKanbanTaskNotification(id, req.authUser?.id);
    cancelDelegationsForDeletedKanban(allowed);
    db().prepare(`UPDATE kanban_tasks SET standup_id = NULL, agent_delegation_task_id = NULL WHERE id IN (${placeholders})`).run(...allowed);
    db().prepare(`DELETE FROM task_messages WHERE task_id IN (${placeholders})`).run(...allowed);
    db().prepare(`DELETE FROM kanban_tasks WHERE id IN (${placeholders})`).run(...allowed);
    res.status(204).send();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/kanban/tasks/:id/messages?limit=&offset=
router.get('/tasks/:id/messages', (req, res) => {
  try {
    const task = db().prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    assertKanbanTaskAccess(task, req.authUser);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const total =
      db().prepare('SELECT COUNT(*) AS n FROM task_messages WHERE task_id = ?').get(req.params.id)?.n ?? 0;
    const rows = db()
      .prepare(
        'SELECT id, role, content, created_at FROM task_messages WHERE task_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      )
      .all(req.params.id, limit, offset);
    res.json({
      messages: messagesWithDisplayTimes(rows),
      total,
      limit,
      offset,
      has_more: offset + rows.length < total,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/kanban/tasks/:id/messages — add message (role, content). If task has assigned agent, continue session: call agent and append its reply.
router.post('/tasks/:id/messages', async (req, res) => {
  try {
    const task = db()
      .prepare(
        'SELECT id, title, description, status, assigned_agent_id, assigned_user_id, agent_delegation_task_id, owner_user_id FROM kanban_tasks WHERE id = ?'
      )
      .get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    assertKanbanTaskMutate(task, req.authUser);
    const { role, content } = req.body;
    const r = (role || 'user').toString().toLowerCase();
    const c = content != null ? (typeof content === 'string' ? content : JSON.stringify(content)) : '';
    db().prepare('INSERT INTO task_messages (task_id, role, content) VALUES (?, ?, ?)').run(req.params.id, r, c);
    const userRow = db().prepare('SELECT id, role, content, created_at FROM task_messages WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(req.params.id);

    let ownerUserId = task.owner_user_id || null;
    if (!ownerUserId && req.authUser?.role === 'ceo') ownerUserId = req.authUser.id;
    if (!ownerUserId) {
      try {
        ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
      } catch {
        ownerUserId = null;
      }
    }

    if (task.assigned_agent_id && r === 'user' && ownerUserId) {
      mirrorKanbanTurnToAgentChat({
        agentId: task.assigned_agent_id,
        ownerUserId,
        role: 'user',
        content: c,
        taskId: task.id,
        taskTitle: task.title,
      });
    }

    if (task.assigned_agent_id && r === 'user') {
      const agent = db().prepare('SELECT id, openclaw_agent_id FROM agents WHERE id = ?').get(task.assigned_agent_id);
      if (agent) {
        let delegationPrompt = null;
        let delegationResponse = null;
        if (task.agent_delegation_task_id) {
          const d = db().prepare('SELECT prompt, response_content FROM agent_delegation_tasks WHERE id = ?').get(task.agent_delegation_task_id);
          if (d) {
            delegationPrompt = d.prompt || null;
            delegationResponse = d.response_content || null;
          }
        }
        const taskMessages = db().prepare('SELECT role, content FROM task_messages WHERE task_id = ? ORDER BY created_at').all(req.params.id);
        const taskId = Number(req.params.id);
        const ceoOwner = ownerUserId || task.owner_user_id || null;
        // Per-CEO tenant OpenClaw agent (same as Dashboard) so tools/BYOK/workspace match.
        const ensured = ceoOwner ? ensureTenantOpenClawAgent(agent, ceoOwner) : null;
        const openclawAgentId = ensured?.openclawAgentId || agent.openclaw_agent_id || agent.id;
        const sessionUser = ceoOwner
          ? openclaw.sessionUserFor(agent.id, ceoOwner, `kanban-${taskId}`)
          : `kanban-${taskId}`;
        const sessionKey = openclaw.sessionKeyFor(openclawAgentId, sessionUser);
        if (ceoOwner) registerOpenClawSessionOwner(sessionKey, ceoOwner);

        const sessionKeyLine = `Your session key for this run is ${sessionKey}. Use this exact sessionKey when calling sessions_history. The messages in this request already contain the full task conversation; if sessions_history returns empty, use these messages as your context and proceed.\n\n`;
        const guidance = buildKanbanChatStatusGuidance(taskId, task.status, {
          userText: c,
          title: task.title || '',
          description: task.description || '',
        });
        const messages = [];
        const taskContext = delegationPrompt || [task.title, task.description].filter(Boolean).join('\n') || task.title;
        messages.push({
          role: 'user',
          content: sessionKeyLine + guidance.instructions + `Task: ${taskContext}` + guidance.finishBlock,
        });
        if (delegationResponse) messages.push({ role: 'assistant', content: delegationResponse });
        for (const m of taskMessages) messages.push({ role: m.role, content: m.content });
        try {
          const turnStartedAt = new Date().toISOString();
          let { content: replyContent } = await openclaw.chatCompletions(openclawAgentId, messages, sessionUser, false);
          let reply = (replyContent && String(replyContent).trim()) || '(No reply.)';
          const statusOnlyBeforeEnrich = looksStatusOnlyReply(reply);
          reply = enrichReplyWithRecentImages(reply, {
            ownerUserId: ceoOwner,
            agentId: agent.id,
            sinceIso: turnStartedAt,
          });
          // One nudge if model only said "done" but the task expects recipe/research/image body
          // (check status-only on the raw reply — image enrich must not suppress the nudge)
          if (
            !String(reply).startsWith('[Error from agent:') &&
            taskExpectsRichDeliverable(task.title, task.description, c) &&
            statusOnlyBeforeEnrich
          ) {
            try {
              const nudged = await openclaw.chatCompletions(
                openclawAgentId,
                [
                  ...messages,
                  { role: 'assistant', content: reply },
                  { role: 'user', content: RICH_DELIVERABLE_NUDGE },
                ],
                sessionUser,
                false
              );
              let nudgedReply = (nudged.content && String(nudged.content).trim()) || '';
              if (nudgedReply && !nudgedReply.startsWith('[Error from agent:')) {
                nudgedReply = enrichReplyWithRecentImages(nudgedReply, {
                  ownerUserId: ceoOwner,
                  agentId: agent.id,
                  sinceIso: turnStartedAt,
                });
                if (nudgedReply.length > reply.length || !looksStatusOnlyReply(nudgedReply)) {
                  reply = nudgedReply;
                }
              }
            } catch (nudgeErr) {
              console.warn('[kanban] deliverable nudge failed:', nudgeErr?.message || nudgeErr);
            }
          }
          db().prepare('INSERT INTO task_messages (task_id, role, content) VALUES (?, ?, ?)').run(req.params.id, 'assistant', reply);
          if (ceoOwner) {
            mirrorKanbanTurnToAgentChat({
              agentId: agent.id,
              ownerUserId: ceoOwner,
              role: 'assistant',
              content: reply,
              taskId,
              taskTitle: task.title,
            });
          }
          const stillStatusOnly = looksStatusOnlyReply(reply);
          const expectsDeliverable =
            guidance.expectsDeliverable ||
            taskExpectsRichDeliverable(task.title, task.description, c);
          if (guidance.promoteOnReply) {
            db()
              .prepare(
                `UPDATE kanban_tasks SET status = 'in_progress', updated_at = datetime('now')
                 WHERE id = ? AND status IN ('open', 'awaiting_confirmation')`
              )
              .run(taskId);
          }
          // Status-only chatter must never complete a deliverable card — even if the agent
          // called kanban_move_status → completed during this turn (CEO reopen/nudge path).
          if (stillStatusOnly && expectsDeliverable && !String(reply).startsWith('[Error from agent:')) {
            db()
              .prepare(
                `UPDATE kanban_tasks SET status = 'in_progress', updated_at = datetime('now')
                 WHERE id = ? AND status IN ('open', 'in_progress', 'completed')`
              )
              .run(taskId);
            console.warn(
              `[kanban] chat reply status-only — keep in_progress task=${taskId} (will not auto-complete)`
            );
          } else if (
            guidance.completeOnReply &&
            !stillStatusOnly &&
            !String(reply).startsWith('[Error from agent:')
          ) {
            db()
              .prepare(
                `UPDATE kanban_tasks SET status = 'completed', updated_at = datetime('now')
                 WHERE id = ? AND status IN ('open', 'in_progress')`
              )
              .run(taskId);
            clearKanbanTaskNotification(taskId, req.authUser?.id);
          }
          try {
            const { recoverStaleAgentContinueGoalSteps } = await import('../services/agent-goal-run.js');
            await recoverStaleAgentContinueGoalSteps({ ownerUserId: ceoOwner, limit: 10 });
          } catch (recoverErr) {
            console.warn('[kanban] stale goal continuation recovery:', recoverErr?.message || recoverErr);
          }
        } catch (err) {
          const errMsg = err?.message || String(err);
          db().prepare('INSERT INTO task_messages (task_id, role, content) VALUES (?, ?, ?)').run(req.params.id, 'assistant', `[Error from agent: ${errMsg}]`);
        }
      }
    }

    res.status(201).json(userRow);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

export default router;

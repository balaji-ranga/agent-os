/**
 * COO Status Checker — Kanban inventory + A2A run reconcile + CEO digest.
 *
 * Source of truth is Kanban (and workflow_a2a_tasks for async A2A). Standup chat / email
 * are presentation surfaces for the CEO.
 */
import { getDb } from '../db/schema.js';
import { getUserById } from './users.js';
import { requeueStuckStatusOnlyKanbanCards, rependInfraFailedStatusOnlyRetries } from './delegation-status-only-retry.js';
import { getOrCreateDelegationHubStandup } from './standup-hub.js';
import { executeEmailSend } from './email-send.js';

const A2A_WORKING = new Set(['working', 'submitted', 'input-required', 'input_required', 'queued']);
const A2A_FAILED = new Set(['failed', 'rejected', 'canceled', 'cancelled', 'unknown']);
const A2A_DONE = new Set(['completed', 'complete', 'success']);

function isA2AMemberKey(key) {
  return String(key || '').startsWith('a2a:');
}

function publishIdFromMemberKey(key) {
  const k = String(key || '');
  return k.startsWith('a2a:') ? k.slice(4) : null;
}

function parseMetaFromDescription(description) {
  const d = String(description || '');
  const task =
    d.match(/\[a2a_task_id:\s*([0-9a-f-]{8,})\]/i)?.[1] ||
    d.match(/a2a[_ ]?task[_ ]?id\s*[:=]\s*([0-9a-f-]{8,})/i)?.[1] ||
    null;
  const runRaw =
    d.match(/\[workflow_run_id:\s*(\d+)\]/i)?.[1] ||
    d.match(/agent_wf_run_id[:=]\s*(\d+)/i)?.[1] ||
    d.match(/run[_ ]?id\s*[:=]\s*(\d+)/i)?.[1] ||
    null;
  return {
    a2aTaskId: task,
    runId: runRaw != null ? Number(runRaw) : null,
  };
}

function isCeoApprovalTask(task) {
  const d = String(task.description || '').toLowerCase();
  return (
    task.status === 'awaiting_confirmation' ||
    d.includes('node_type: ceo_approval') ||
    d.includes('node_type:ceo_approval') ||
    d.includes('ceo approval') ||
    d.includes('awaiting ceo')
  );
}

function assigneeLabel(task) {
  if (task.assigned_member_key) return task.assigned_member_key;
  if (task.assigned_agent_id) return task.assigned_agent_id;
  return 'unassigned';
}

/**
 * Reconcile Kanban leaf cards that belong to A2A publications against workflow_a2a_tasks /
 * agent_workflow_runs. Fixes premature "completed" on async accept.
 */
export function reconcileA2AKanbanForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const db = getDb();
  const tasks = db
    .prepare(
      `SELECT * FROM kanban_tasks
       WHERE owner_user_id = ?
         AND assigned_member_key IS NOT NULL
         AND assigned_member_key LIKE 'a2a:%'
         AND status IN ('completed', 'in_progress', 'failed', 'open', 'awaiting_confirmation')
       ORDER BY updated_at DESC
       LIMIT 200`
    )
    .all(owner);

  const changes = [];
  for (const task of tasks) {
    const meta = parseMetaFromDescription(task.description);
    const a2aTaskId = task.a2a_task_id || meta.a2aTaskId;
    const runId = task.workflow_run_id || meta.runId;
    let a2aRow = null;
    if (a2aTaskId) {
      a2aRow = db.prepare(`SELECT * FROM workflow_a2a_tasks WHERE task_id = ?`).get(a2aTaskId);
    }
    if (!a2aRow && runId) {
      a2aRow = db
        .prepare(
          `SELECT * FROM workflow_a2a_tasks WHERE run_id = ? AND owner_user_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(runId, owner);
    }
    if (!a2aRow) {
      const publishId = publishIdFromMemberKey(task.assigned_member_key);
      if (publishId) {
        a2aRow = db
          .prepare(
            `SELECT * FROM workflow_a2a_tasks
             WHERE owner_user_id = ? AND publish_id = ?
               AND datetime(created_at) >= datetime(?, '-2 hours')
               AND datetime(created_at) <= datetime(?, '+2 hours')
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(owner, publishId, task.created_at, task.created_at);
      }
    }
    if (!a2aRow) continue;

    const state = String(a2aRow.state || '').toLowerCase();
    let runStatus = null;
    if (a2aRow.run_id) {
      runStatus = db
        .prepare(`SELECT id, status, error_message FROM agent_workflow_runs WHERE id = ?`)
        .get(a2aRow.run_id);
    }
    const runState = String(runStatus?.status || '').toLowerCase();

    let nextStatus = null;
    let reason = null;
    if (A2A_FAILED.has(state) || runState === 'failed') {
      nextStatus = 'failed';
      reason =
        String(a2aRow.output_text || '').trim() ||
        String(runStatus?.error_message || '').trim() ||
        `A2A/workflow ended in state "${state || runState}"`;
    } else if (A2A_WORKING.has(state) || runState === 'running' || runState === 'waiting') {
      nextStatus = 'in_progress';
    } else if (A2A_DONE.has(state) || runState === 'completed') {
      nextStatus = 'completed';
    }

    const patch = {};
    if (!task.a2a_task_id && a2aRow.task_id) patch.a2a_task_id = a2aRow.task_id;
    if (!task.workflow_run_id && a2aRow.run_id) patch.workflow_run_id = a2aRow.run_id;

    if (nextStatus && nextStatus !== task.status) {
      let descSuffix = '';
      if (nextStatus === 'failed' && reason) {
        descSuffix = `\n\n---\nStatus checker: marked failed.\nReason: ${reason.slice(0, 1500)}`;
      } else if (nextStatus === 'in_progress' && task.status === 'completed') {
        descSuffix = `\n\n---\nStatus checker: A2A/workflow still ${state || runState} — moved back to in_progress.`;
      }
      db.prepare(
        `UPDATE kanban_tasks
         SET status = ?,
             a2a_task_id = COALESCE(?, a2a_task_id),
             workflow_run_id = COALESCE(?, workflow_run_id),
             description = description || ?,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        nextStatus,
        patch.a2a_task_id || null,
        patch.workflow_run_id ?? null,
        descSuffix,
        task.id
      );
      changes.push({
        kanban_id: task.id,
        from: task.status,
        to: nextStatus,
        a2a_task_id: a2aRow.task_id,
        run_id: a2aRow.run_id,
        reason: reason || null,
      });
      console.log(
        `[status-checker] kanban=${task.id} ${task.status}→${nextStatus} a2a=${a2aRow.task_id} run=${a2aRow.run_id}`
      );
    } else if (Object.keys(patch).length) {
      db.prepare(
        `UPDATE kanban_tasks
         SET a2a_task_id = COALESCE(?, a2a_task_id),
             workflow_run_id = COALESCE(?, workflow_run_id)
         WHERE id = ?`
      ).run(patch.a2a_task_id || null, patch.workflow_run_id ?? null, task.id);
    }
  }
  return changes;
}

function listOpenTasks(ownerUserId) {
  return getDb()
    .prepare(
      `SELECT * FROM kanban_tasks
       WHERE owner_user_id = ? AND status IN ('open', 'awaiting_confirmation', 'in_progress')
       ORDER BY
         CASE status WHEN 'awaiting_confirmation' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
         updated_at DESC`
    )
    .all(String(ownerUserId));
}

/** All currently-failed cards (still need CEO attention, any age). */
function listFailedTasks(ownerUserId, limit = 150) {
  return getDb()
    .prepare(
      `SELECT * FROM kanban_tasks
       WHERE owner_user_id = ? AND status = 'failed'
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(String(ownerUserId), Math.min(500, Math.max(1, Number(limit) || 150)));
}

/** Recently completed cards (default last 7 days). */
function listRecentlyCompleted(ownerUserId, days = 7) {
  return getDb()
    .prepare(
      `SELECT * FROM kanban_tasks
       WHERE owner_user_id = ?
         AND status = 'completed'
         AND datetime(updated_at) >= datetime('now', ?)
       ORDER BY updated_at DESC
       LIMIT 100`
    )
    .all(String(ownerUserId), `-${Number(days) || 7} days`);
}

function failureReasonFromTask(task) {
  const d = String(task.description || '');
  const m =
    d.match(/Reason:\s*([^\n]+(?:\n(?!---)[^\n]+)*)/i) ||
    d.match(/---\nResult:\n([\s\S]*)$/i);
  return m ? String(m[1]).trim().slice(0, 800) : '';
}

/**
 * Build structured digest for one CEO.
 */
function mapTaskBrief(t, extra = {}) {
  return {
    id: t.id,
    title: t.title || '(untitled)',
    assignee: assigneeLabel(t),
    status: t.status,
    updated_at: t.updated_at,
    a2a: isA2AMemberKey(t.assigned_member_key),
    ...extra,
  };
}

export function buildStatusDigest(ownerUserId, { reconcile = true } = {}) {
  const owner = String(ownerUserId || '').trim();
  const sync = reconcile ? reconcileA2AKanbanForOwner(owner) : [];
  const open = listOpenTasks(owner);
  const failed = listFailedTasks(owner);
  const completed = listRecentlyCompleted(owner, 7);

  const awaitingCeo = open.filter((t) => isCeoApprovalTask(t) || t.status === 'awaiting_confirmation');
  const inProgress = open.filter((t) => t.status === 'in_progress' && !awaitingCeo.some((a) => a.id === t.id));
  const otherOpen = open.filter(
    (t) => t.status === 'open' && !awaitingCeo.some((a) => a.id === t.id)
  );

  const sections = {
    awaiting_ceo: awaitingCeo.map((t) =>
      mapTaskBrief(t, { note: 'Needs your input / approval to continue.' })
    ),
    in_progress: inProgress.map((t) => mapTaskBrief(t)),
    open: otherOpen.map((t) => mapTaskBrief(t)),
    failed: failed.map((t) => mapTaskBrief(t, { reason: failureReasonFromTask(t) })),
    // Keep legacy key for older clients / emails
    failed_1d: failed.map((t) => mapTaskBrief(t, { reason: failureReasonFromTask(t) })),
    completed_1d: completed.map((t) => mapTaskBrief(t)),
  };

  return {
    owner_user_id: owner,
    generated_at: new Date().toISOString(),
    // Counts are from ALL Kanban rows for this CEO (any age) — not the weekly UI filter.
    board_scope: 'all_ages',
    sync_changes: sync,
    counts: {
      awaiting_ceo: sections.awaiting_ceo.length,
      in_progress: sections.in_progress.length,
      open: sections.open.length,
      failed: sections.failed.length,
      failed_1d: sections.failed.length,
      completed_1d: sections.completed_1d.length,
      needs_attention: sections.awaiting_ceo.length + sections.failed.length,
    },
    sections,
  };
}

function formatTaskLine(t, { withReason = false } = {}) {
  const bits = [`#${t.id}`, t.title || '(untitled)', `(${t.assignee || '—'})`, t.status];
  if (withReason && t.reason) bits.push(`— ${t.reason.slice(0, 200)}`);
  return `- ${bits.join(' · ')}`;
}

export function formatDigestMarkdown(digest) {
  const c = digest.counts;
  const failed = digest.sections.failed || digest.sections.failed_1d || [];
  const lines = [
    `## COO Status Report`,
    `_Generated ${digest.generated_at}_`,
    '',
    `**Summary:** ${c.needs_attention || c.awaiting_ceo + (c.failed ?? c.failed_1d)} need attention · ${c.awaiting_ceo} awaiting you · ${c.failed ?? c.failed_1d} failed · ${c.in_progress} in progress · ${c.open} open · ${c.completed_1d} completed (7d)`,
    `_Scope: all open / failed / awaiting cards of any age (same as Kanban **All** view — not the Weekly filter)._`,
    '',
  ];
  if (digest.sync_changes?.length) {
    lines.push(
      `**A2A sync:** ${digest.sync_changes.length} Kanban card(s) updated from workflow/A2A run state.`,
      ''
    );
  }

  lines.push('### Needs your input / approval');
  if (!digest.sections.awaiting_ceo.length) lines.push('_None_');
  else digest.sections.awaiting_ceo.forEach((t) => lines.push(formatTaskLine(t) + ' — please act on Kanban to continue.'));
  lines.push('');

  lines.push('### Failed — needs attention');
  if (!failed.length) lines.push('_None_');
  else failed.forEach((t) => lines.push(formatTaskLine(t, { withReason: true })));
  lines.push('');

  lines.push('### In progress');
  if (!digest.sections.in_progress.length) lines.push('_None_');
  else digest.sections.in_progress.forEach((t) => lines.push(formatTaskLine(t)));
  lines.push('');

  lines.push('### Open');
  if (!digest.sections.open.length) lines.push('_None_');
  else digest.sections.open.forEach((t) => lines.push(formatTaskLine(t)));
  lines.push('');

  lines.push('### Completed (past 7 days)');
  if (!digest.sections.completed_1d.length) lines.push('_None_');
  else digest.sections.completed_1d.forEach((t) => lines.push(formatTaskLine(t)));
  lines.push('');

  lines.push(
    '### Your feedback',
    '- Reply in this standup (or on Kanban) with task `#id` if you need **rework / reopen** on any completed item.',
    '- For items awaiting confirmation, open **Kanban** and approve, reject, or comment so work can continue.',
    ''
  );
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDigestHtml(digest) {
  const c = digest.counts;
  const failed = digest.sections.failed || digest.sections.failed_1d || [];
  const failedCount = c.failed ?? c.failed_1d ?? failed.length;
  const needsAttention = c.needs_attention ?? c.awaiting_ceo + failedCount;

  const chip = (label, value, bg, fg) =>
    `<div style="display:inline-block;margin:0 8px 8px 0;padding:10px 14px;border-radius:10px;background:${bg};color:${fg};min-width:88px;">` +
    `<div style="font-size:1.35rem;font-weight:700;line-height:1.1;">${value}</div>` +
    `<div style="font-size:12px;opacity:0.9;margin-top:2px;">${escapeHtml(label)}</div></div>`;

  const row = (t, extra = '', accent = '') =>
    `<tr>` +
    `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">` +
    `<a href="/kanban" style="color:#0f766e;text-decoration:none;font-weight:600;">#${t.id}</a></td>` +
    `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(t.title)}</td>` +
    `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(t.assignee)}</td>` +
    `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">` +
    `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;background:${accent || '#f1f5f9'};">${escapeHtml(t.status)}</span></td>` +
    `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#475569;font-size:13px;">${escapeHtml(extra)}</td></tr>`;

  const table = (title, items, { extraFn, accent, emptyHint } = {}) => {
    const head =
      `<h3 style="margin:1.5rem 0 0.5rem;font-size:1.05rem;color:#0f172a;">${escapeHtml(title)}` +
      ` <span style="color:#94a3b8;font-weight:500;font-size:0.9rem;">(${items.length})</span></h3>`;
    if (!items.length) {
      return `${head}<p style="color:#94a3b8;margin:0.25rem 0 0;">${escapeHtml(emptyHint || 'None')}</p>`;
    }
    return (
      head +
      `<table style="border-collapse:collapse;width:100%;font-size:14px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">` +
      `<thead><tr style="background:#f8fafc;text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.03em;">` +
      `<th style="padding:8px 10px;">ID</th><th style="padding:8px 10px;">Title</th>` +
      `<th style="padding:8px 10px;">Assignee</th><th style="padding:8px 10px;">Status</th>` +
      `<th style="padding:8px 10px;">Notes</th></tr></thead><tbody>` +
      items.map((t) => row(t, extraFn ? extraFn(t) : '', accent)).join('') +
      `</tbody></table>`
    );
  };

  const when = escapeHtml(
    digest.generated_at
      ? new Date(digest.generated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : ''
  );

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>COO Status Report</title></head>
<body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.45;background:#f1f5f9;margin:0;padding:0;">
  <div style="max-width:800px;margin:0 auto;padding:28px 20px 40px;">
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px 22px;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
  <h1 style="font-size:1.45rem;margin:0 0 0.25rem;">COO Status Report</h1>
  <p style="color:#64748b;margin:0 0 1.1rem;">Generated ${when}</p>
  <p style="color:#64748b;font-size:12px;margin:0 0 1rem;">Counts include every open / failed / awaiting card of any age (Kanban <strong>All</strong> view — not the Weekly filter).</p>
  <div style="margin-bottom:0.5rem;">
    ${chip('Need attention', needsAttention, '#fef2f2', '#991b1b')}
    ${chip('Awaiting you', c.awaiting_ceo, '#fff7ed', '#9a3412')}
    ${chip('Failed', failedCount, '#fef2f2', '#b91c1c')}
    ${chip('In progress', c.in_progress, '#eff6ff', '#1e40af')}
    ${chip('Open', c.open, '#f8fafc', '#334155')}
    ${chip('Done (7d)', c.completed_1d, '#f0fdf4', '#166534')}
  </div>
  ${digest.sync_changes?.length ? `<p style="color:#475569;font-size:13px;"><strong>A2A sync:</strong> ${digest.sync_changes.length} card(s) updated from workflow run state.</p>` : ''}
  ${table('Needs your input / approval', digest.sections.awaiting_ceo, {
    extraFn: () => 'Open Kanban to approve, reject, or comment',
    accent: '#ffedd5',
    emptyHint: 'Nothing waiting on you',
  })}
  ${table('Failed — needs attention', failed, {
    extraFn: (t) => t.reason || 'See Kanban card for details',
    accent: '#fecaca',
    emptyHint: 'No failed tasks',
  })}
  ${table('In progress', digest.sections.in_progress, {
    extraFn: (t) => (t.a2a ? 'A2A / external agent' : ''),
    accent: '#dbeafe',
    emptyHint: 'Nothing in progress',
  })}
  ${table('Open', digest.sections.open, { emptyHint: 'No open backlog cards' })}
  ${table('Completed (past 7 days)', digest.sections.completed_1d, {
    extraFn: () => 'Reply in standup with #id to reopen / rework',
    accent: '#dcfce7',
    emptyHint: 'No completions in the last 7 days',
  })}
  <h3 style="margin:1.5rem 0 0.5rem;font-size:1.05rem;">Next steps</h3>
  <ul style="margin:0;padding-left:1.2rem;color:#334155;">
    <li>Open <strong>Kanban</strong> for cards that need approval or failed — act or reopen.</li>
    <li>Reply in standup chat with task <code>#id</code> to request rework.</li>
  </ul>
  <p style="color:#94a3b8;font-size:12px;margin-top:2rem;">Flolah · COO Status Report</p>
  </div></div>
  </body></html>`;
}

function postStandupDigest(ownerUserId, markdown) {
  const standupId = getOrCreateDelegationHubStandup(ownerUserId);
  // Prefer the CEO's most recent visible manual standup if one exists today; else hub is fine for delivery.
  const db = getDb();
  const recent = db
    .prepare(
      `SELECT id FROM standups
       WHERE owner_user_id = ?
         AND COALESCE(source, 'manual') = 'manual'
         AND date(created_at, 'localtime') = date('now', 'localtime')
       ORDER BY id DESC LIMIT 1`
    )
    .get(String(ownerUserId));
  const targetId = recent?.id || standupId;
  db.prepare(`INSERT INTO standup_messages (standup_id, role, content) VALUES (?, 'coo', ?)`).run(
    targetId,
    markdown
  );
  return targetId;
}

/**
 * Run status checker for one CEO: reconcile, digest, post to standup, optionally email.
 *
 * Email is intentionally OFF by default. Only the daily platform batch
 * (`runCooStatusCheckerForAllCeos`) enables email. UI button / status_checker tool
 * return HTML/markdown for the CEO without sending mail.
 */
export async function runCooStatusChecker(ownerUserId, { email = false, postStandup = true } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const ceo = getUserById(owner);
  if (!ceo || ceo.role !== 'ceo') {
    const err = new Error('Status checker requires a CEO owner');
    err.status = 400;
    throw err;
  }

  // Auto-retry specialty cards stuck after status-only chatter / orphaned runs.
  let statusOnlyRetry = null;
  try {
    const { runKanbanOrphanWatcher } = await import('./kanban-orphan-watcher.js');
    statusOnlyRetry = runKanbanOrphanWatcher({ ownerUserId: owner, limit: 15 });
  } catch (e) {
    console.warn('[status-checker] orphan watcher:', e?.message || e);
    try {
      statusOnlyRetry = requeueStuckStatusOnlyKanbanCards({ ownerUserId: owner, limit: 15 });
      const recovered = rependInfraFailedStatusOnlyRetries({ ownerUserId: owner, limit: 15 });
      if (recovered?.repended) {
        statusOnlyRetry = {
          ...(statusOnlyRetry || {}),
          repended: recovered.repended,
        };
      }
    } catch (e2) {
      console.warn('[status-checker] status-only requeue:', e2?.message || e2);
    }
  }

  const digest = buildStatusDigest(owner, { reconcile: true });
  const markdown = formatDigestMarkdown(digest);
  const html = formatDigestHtml(digest);

  let standupId = null;
  if (postStandup) {
    standupId = postStandupDigest(owner, markdown);
  }

  let emailResult = null;
  if (email && ceo.email) {
    try {
      const failedN = digest.counts.failed ?? digest.counts.failed_1d ?? 0;
      const attention = digest.counts.needs_attention ?? digest.counts.awaiting_ceo + failedN;
      emailResult = await executeEmailSend({
        to: ceo.email,
        subject: `COO Status Report — ${attention} need attention · ${failedN} failed · ${digest.counts.awaiting_ceo} awaiting you`,
        body: markdown.replace(/[#*_`]/g, ''),
        html,
      });
    } catch (e) {
      console.warn('[status-checker] email failed', owner, e?.message || e);
      emailResult = { ok: false, error: e?.message || String(e) };
    }
  }

  console.log(
    `[status-checker] owner=${owner} standup=${standupId} awaiting=${digest.counts.awaiting_ceo} email=${
      email ? (emailResult?.sent ? 'sent' : emailResult?.error || 'skipped/failed') : 'disabled'
    } status_only_requeued=${statusOnlyRetry?.requeued || 0}`
  );
  return { digest, markdown, html, standup_id: standupId, email: emailResult, status_only_retry: statusOnlyRetry };
}

/** Daily cron batch: every enabled CEO — the only path that emails the HTML digest. */
export async function runCooStatusCheckerForAllCeos() {
  const ceos = getDb()
    .prepare(`SELECT id, email FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all();
  const results = [];
  for (const ceo of ceos) {
    try {
      const out = await runCooStatusChecker(ceo.id, { email: true, postStandup: true });
      results.push({
        owner_user_id: ceo.id,
        ok: true,
        counts: out.digest.counts,
        standup_id: out.standup_id,
        email_sent: !!out.email?.sent,
      });
    } catch (e) {
      console.warn('[status-checker] ceo failed', ceo.id, e?.message || e);
      results.push({ owner_user_id: ceo.id, ok: false, error: e?.message || String(e) });
    }
  }
  return { count: results.length, results };
}

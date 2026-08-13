/**
 * Interactive watcher for video S1–S3 (character cast → storyboard) tests.
 *
 * Usage (backend container / local with DB):
 *   WATCH_OWNER=ceo-bala WATCH_INTERVAL_MS=4000 WATCH_SEC=2400 \
 *     node backend/scripts/watch-video-s1s3.mjs
 *
 * Prints only when the snapshot signature changes (runs, steps, kanban, chars, boards, chat, bells).
 */
import { initDb, getDb } from '../src/db/schema.js';

initDb();
const db = getDb();
const owner = String(process.env.WATCH_OWNER || process.env.REGRESSION_CEO_ID || 'ceo-bala').trim();
const interval = Math.max(2000, Number(process.env.WATCH_INTERVAL_MS || 4000));
const maxSec = Math.max(60, Number(process.env.WATCH_SEC || 2400));
const t0 = Date.now();
let lastSig = '';
let tick = 0;

function clip(s, n = 100) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n) + '…';
}

function mdTableId(name) {
  return (
    db
      .prepare(
        `SELECT id FROM master_data_tables WHERE owner_user_id = ? AND lower(name) = lower(?) LIMIT 1`
      )
      .get(owner, name)?.id || null
  );
}

function mdRows(tableName, limit = 8) {
  const tid = mdTableId(tableName);
  if (!tid) return { table: null, rows: [] };
  const rows = db
    .prepare(
      `SELECT id, row_json, created_at FROM master_data_rows
       WHERE table_id = ? AND owner_user_id = ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(tid, owner, limit)
    .map((r) => {
      let data = {};
      try {
        data = JSON.parse(r.row_json || '{}');
      } catch {
        data = {};
      }
      return { id: r.id, created_at: r.created_at, data };
    });
  return { table: tid, rows };
}

function snapshot() {
  const runs = db
    .prepare(
      `SELECT id, run_number, definition_id, status, progress_pct, error_message,
              started_at, completed_at, updated_at, context_json
       FROM agent_workflow_runs
       WHERE owner_user_id = ?
         AND (definition_id LIKE 'video-reasoning%'
           OR definition_id LIKE 'video-%'
           OR lower(definition_id) LIKE '%storyboard%')
       ORDER BY id DESC LIMIT 6`
    )
    .all(owner);

  const stepsByRun = {};
  for (const r of runs) {
    stepsByRun[r.id] = db
      .prepare(
        `SELECT node_id, node_label, node_type, status, kanban_task_id,
                substr(COALESCE(error_message,''),1,120) AS err
         FROM agent_workflow_run_steps WHERE run_id = ? ORDER BY id ASC`
      )
      .all(r.id);
  }

  const kanban = db
    .prepare(
      `SELECT id, title, status, created_by, updated_at
       FROM kanban_tasks
       WHERE owner_user_id = ?
         AND (
           lower(title) LIKE '%video cast%'
           OR lower(title) LIKE '%video storyboard%'
           OR lower(title) LIKE '%ceo review: video%'
           OR created_by = 'agent_workflow_ceo'
         )
       ORDER BY id DESC LIMIT 10`
    )
    .all(owner);

  const chars = mdRows('video_characters', 10);
  const boards = mdRows('video_storyboards', 6);

  const chats = db
    .prepare(
      `SELECT id, agent_id, role, substr(content,1,160) AS c, created_at
       FROM chat_turns
       WHERE owner_user_id = ?
         AND (agent_id LIKE '%video-orch%' OR agent_id LIKE '%balserve%')
       ORDER BY id DESC LIMIT 8`
    )
    .all(owner);

  const notes = db
    .prepare(
      `SELECT id, title, substr(COALESCE(body,''),1,100) AS body, created_at, source
       FROM platform_user_notifications
       WHERE user_id = ?
         AND (
           lower(title) LIKE '%video%'
           OR lower(title) LIKE '%workflow%'
           OR lower(title) LIKE '%storyboard%'
           OR lower(title) LIKE '%cast%'
         )
       ORDER BY id DESC LIMIT 8`
    )
    .all(owner);

  return { runs, stepsByRun, kanban, chars, boards, chats, notes, at: new Date().toISOString() };
}

function phaseHint(steps) {
  if (!steps?.length) return 'no-steps';
  const by = Object.fromEntries(steps.map((s) => [s.node_id, s.status]));
  const order = ['story-1', 'ceo-cast', 'scene-1', 'prompt-1', 'ceo-gate'];
  const bits = order.map((id) => {
    const st = by[id] || '—';
    return id.replace(/-1$/, '') + '=' + st;
  });
  return bits.join(' · ');
}

console.log('[watch-video-s1s3] owner=%s interval_ms=%s max_sec=%s', owner, interval, maxSec);
console.log(
  '[watch-video-s1s3] Interactive: open Content Orchestrator chat → paste S1–S3 brief → Approve cast then storyboard Kanban.'
);
console.log('[watch-video-s1s3] Watching video-reasoning runs, ceo-cast/ceo-gate, video_characters, storyboards, CO chat, bells.\n');

while ((Date.now() - t0) / 1000 < maxSec) {
  tick += 1;
  const s = snapshot();
  const sig = JSON.stringify({
    r: s.runs.map((x) => [x.id, x.status, x.progress_pct, x.updated_at]),
    st: Object.fromEntries(
      Object.entries(s.stepsByRun).map(([k, v]) => [k, v.map((x) => x.node_id + ':' + x.status)])
    ),
    k: s.kanban.map((x) => [x.id, x.status, x.title]),
    c: s.chars.rows.map((x) => [
      x.data.character_id || x.id,
      x.data.name,
      x.data.image_id || x.data.ref_media ? 'img' : 'noimg',
    ]),
    b: s.boards.rows.map((x) => [x.data.storyboard_id || x.id, x.data.status, x.data.title]),
    ch: s.chats.map((x) => x.id),
    n: s.notes.map((x) => x.id),
  });

  if (sig !== lastSig) {
    lastSig = sig;
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log('\n========', s.at, 't+' + elapsed + 's tick=' + tick, '========');

    if (!s.runs.length) {
      console.log('RUNS (none yet — trigger run video storyboard from Content Orchestrator)');
    }
    for (const r of s.runs) {
      const actor = (() => {
        try {
          return JSON.parse(r.context_json || '{}')?.coo_run_watch?.actor_agent_id || null;
        } catch {
          return null;
        }
      })();
      console.log(
        'RUN',
        '#' + (r.run_number ?? r.id),
        'id=' + r.id,
        r.status,
        (r.progress_pct != null ? r.progress_pct + '%' : ''),
        '|',
        clip(r.definition_id, 48),
        actor ? 'actor=' + actor : 'actor=—'
      );
      if (r.error_message) console.log('  ERR', clip(r.error_message, 160));
      const steps = s.stepsByRun[r.id] || [];
      console.log('  PHASE', phaseHint(steps));
      for (const st of steps) {
        if (st.status === 'skipped') continue;
        console.log(
          '  step',
          st.node_id.padEnd(12),
          st.status.padEnd(14),
          st.kanban_task_id ? 'kanban#' + st.kanban_task_id : '',
          st.err ? 'err=' + clip(st.err, 80) : '',
          '|',
          clip(st.node_label || st.node_type, 40)
        );
      }
    }

    console.log('KANBAN (cast / storyboard / ceo_approval)');
    if (!s.kanban.length) console.log('  (none)');
    for (const k of s.kanban) {
      const need =
        /awaiting|open|in_progress|awaiting_confirmation/i.test(k.status) &&
        /cast|storyboard|video/i.test(k.title)
          ? ' ← APPROVE/REJECT'
          : '';
      console.log(' ', k.id, k.status.padEnd(22), clip(k.title, 70) + need);
    }

    console.log('CHARS video_characters (' + s.chars.rows.length + ')');
    if (!s.chars.table) console.log('  (table missing)');
    for (const row of s.chars.rows) {
      const d = row.data || {};
      const img = d.image_id || d.ref_media ? 'portrait=yes' : 'portrait=NO';
      console.log(
        ' ',
        clip(d.character_id || '#' + row.id, 24),
        clip(d.name, 28),
        img,
        clip(d.role || '', 20)
      );
    }

    console.log('BOARDS video_storyboards (' + s.boards.rows.length + ')');
    if (!s.boards.table) console.log('  (table missing)');
    for (const row of s.boards.rows) {
      const d = row.data || {};
      console.log(
        ' ',
        clip(d.storyboard_id || '#' + row.id, 20),
        String(d.status || '—').padEnd(22),
        clip(d.title, 50),
        d.workflow_run_id ? 'wf=' + d.workflow_run_id : ''
      );
    }

    console.log('CHAT (CO / COO recent)');
    for (const c of [...s.chats].reverse()) {
      console.log(' ', c.created_at, c.agent_id, c.role, JSON.stringify(clip(c.c, 120)));
    }

    console.log('BELLS');
    if (!s.notes.length) console.log('  (none matching)');
    for (const n of s.notes) {
      console.log(' ', n.created_at, clip(n.title, 60), '|', clip(n.body, 80));
    }
  } else if (tick % 15 === 0) {
    console.log(
      '[watch-video-s1s3] heartbeat t+' +
        Math.round((Date.now() - t0) / 1000) +
        's — no change (still watching)'
    );
  }

  await new Promise((r) => setTimeout(r, interval));
}

console.log('\n[watch-video-s1s3] done (max_sec reached). Restart to continue.');

/**
 * Poll BrightBox goal plans + workflow runs for interactive multiphase tests.
 * Usage: node scripts/watch-brightbox-goal-wf.mjs
 * Env: WATCH_INTERVAL_MS=3000 WATCH_SEC=900
 */
import { initDb, getDb } from '../src/db/schema.js';

initDb();
const db = getDb();
const owner = process.env.REGRESSION_CEO_ID || 'ceo-demo-brightbox-744921';
const interval = Math.max(1500, Number(process.env.WATCH_INTERVAL_MS || 3000));
const maxSec = Math.max(30, Number(process.env.WATCH_SEC || 900));
const t0 = Date.now();
let lastSig = '';

function snapshot() {
  const goals = db
    .prepare(
      `SELECT id, title, status, source, current_step_index, created_at, updated_at
       FROM agent_goal_runs WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 12`
    )
    .all(owner);
  const steps = {};
  for (const g of goals) {
    steps[g.id] = db
      .prepare(
        `SELECT step_index, step_type, status, label, child_workflow_run_id, child_delegation_task_id
         FROM agent_goal_steps WHERE goal_run_id=? ORDER BY step_index`
      )
      .all(g.id);
  }
  const wfs = db
    .prepare(
      `SELECT id, run_number, definition_id, status, started_at, completed_at,
              substr(COALESCE(context_json,''), 1, 180) AS ctx
       FROM agent_workflow_runs WHERE owner_user_id=? ORDER BY id DESC LIMIT 12`
    )
    .all(owner);
  const notes = db
    .prepare(
      `SELECT id, title, substr(COALESCE(body,''),1,120) AS body
       FROM platform_user_notifications WHERE user_id=?
       ORDER BY id DESC LIMIT 6`
    )
    .all(owner);
  return { goals, steps, wfs, notes, at: new Date().toISOString() };
}

console.log('[watch-bb] owner', owner, 'interval_ms', interval, 'max_sec', maxSec);
console.log('[watch-bb] interactive: BrightBox → COO chat → multiphase goal (agent_goal_create). Expect ONE new agr-… then step advance.');

while ((Date.now() - t0) / 1000 < maxSec) {
  const s = snapshot();
  const sig = JSON.stringify({
    g: s.goals.map((x) => [x.id, x.status, x.current_step_index]),
    st: Object.fromEntries(Object.entries(s.steps).map(([k, v]) => [k, v.map((x) => x.status + ':' + x.step_type)])),
    w: s.wfs.map((x) => [x.id, x.status, x.run_number]),
    n: s.notes.map((x) => x.title),
  });
  if (sig !== lastSig) {
    lastSig = sig;
    console.log('\n========', s.at, '========');
    console.log('GOAL_COUNT', s.goals.length, 'WF_COUNT', s.wfs.length);
    for (const g of s.goals) {
      console.log('GOAL', g.id, g.status, 'src=' + g.source, '|', (g.title || '').slice(0, 80));
      for (const st of s.steps[g.id] || []) {
        console.log(
          '  step',
          st.step_index,
          st.step_type,
          st.status,
          st.child_workflow_run_id ? 'wf#' + st.child_workflow_run_id : '',
          st.child_delegation_task_id ? 'del#' + st.child_delegation_task_id : '',
          '|',
          (st.label || '').slice(0, 60)
        );
      }
    }
    for (const w of s.wfs) {
      const bound = /goal_run_id|agr-/.test(w.ctx || '');
      console.log(
        'WF',
        w.id,
        'run#',
        w.run_number,
        w.status,
        w.definition_id,
        bound ? 'BOUND?' : 'ctx~',
        (w.ctx || '').replace(/\s+/g, ' ').slice(0, 100)
      );
    }
    for (const n of s.notes) {
      console.log('NOTE', n.id, n.title, '|', (n.body || '').replace(/\n/g, ' ').slice(0, 100));
    }
    // heuristic: multiple simultaneous running agr = suspicious create storm
    const running = s.goals.filter((g) => g.status === 'running' || g.status === 'pending');
    if (running.length > 1) {
      console.warn('[watch-bb] WARN multiple open plans:', running.map((g) => g.id).join(', '));
    }
  }
  await new Promise((r) => setTimeout(r, interval));
}
console.log('[watch-bb] done');
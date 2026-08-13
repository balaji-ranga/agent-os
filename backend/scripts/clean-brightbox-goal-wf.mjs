/**
 * BrightBox demo clean: goal plans + workflow runs + related kanban/dels.
 * Usage: node scripts/clean-brightbox-goal-wf.mjs
 */
import { initDb, getDb } from '../src/db/schema.js';
import { seedMakerCheckerWorkflowsForBusinessProfile } from '../src/services/business-core-maker-checker-workflows.js';
import { getBusinessProfile } from '../src/services/company-business-profile.js';

initDb();
const db = getDb();
const owner = process.env.REGRESSION_CEO_ID || 'ceo-demo-brightbox-744921';

const before = {
  goals: db.prepare('SELECT COUNT(*) c FROM agent_goal_runs WHERE owner_user_id=?').get(owner)?.c,
  goal_steps: db
    .prepare(
      `SELECT COUNT(*) c FROM agent_goal_steps WHERE goal_run_id IN (SELECT id FROM agent_goal_runs WHERE owner_user_id=?)`
    )
    .get(owner)?.c,
  wf: db.prepare('SELECT COUNT(*) c FROM agent_workflow_runs WHERE owner_user_id=?').get(owner)?.c,
  kanban: db.prepare('SELECT COUNT(*) c FROM kanban_tasks WHERE owner_user_id=?').get(owner)?.c,
};
console.log('[clean-bb] before', before);

// Delete goal steps then runs
const goalIds = db.prepare('SELECT id FROM agent_goal_runs WHERE owner_user_id=?').all(owner).map((r) => r.id);
const delStep = db.prepare('DELETE FROM agent_goal_steps WHERE goal_run_id=?');
for (const id of goalIds) delStep.run(id);
const gDel = db.prepare('DELETE FROM agent_goal_runs WHERE owner_user_id=?').run(owner);
console.log('[clean-bb] goal plans deleted', gDel.changes, 'ids', goalIds.length);

// Workflow run steps + runs
const runIds = db.prepare('SELECT id FROM agent_workflow_runs WHERE owner_user_id=?').all(owner).map((r) => r.id);
for (const id of runIds) {
  db.prepare('DELETE FROM agent_workflow_run_steps WHERE run_id=?').run(id);
  db.prepare('DELETE FROM agent_workflow_runs WHERE id=?').run(id);
}
console.log('[clean-bb] workflow runs deleted', runIds.length);

// WF-related kanban (messages first for FK)
const kIds = db
  .prepare(
    `SELECT id FROM kanban_tasks WHERE owner_user_id = ?
       AND (created_by IN ('agent_workflow','agent_workflow_ceo','goal_run')
            OR description LIKE '%agent_workflow:%'
            OR description LIKE '%goal_run%'
            OR title LIKE '%maker checker%'
            OR title LIKE '%CEO gate%'
            OR title LIKE '%ERP:%'
            OR title LIKE '%CRM:%'
            OR title LIKE '%goal plan%')`
  )
  .all(owner)
  .map((r) => r.id);
const delMsg = db.prepare('DELETE FROM task_messages WHERE task_id=?');
for (const id of kIds) {
  try {
    delMsg.run(id);
  } catch (_) {}
}
let kDelChanges = 0;
if (kIds.length) {
  const ph = kIds.map(() => '?').join(',');
  kDelChanges = db.prepare(`DELETE FROM kanban_tasks WHERE id IN (${ph})`).run(...kIds).changes;
}
console.log('[clean-bb] kanban deleted', kDelChanges, 'of', kIds.length);

// Fail open delegation
const dFail = db
  .prepare(
    `UPDATE agent_delegation_tasks
     SET status = 'failed', error_message = 'brightbox goal/wf clean', completed_at = datetime('now')
     WHERE status IN ('pending','processing')
       AND (owner_user_id = ? OR to_agent_id LIKE 'erp-%ceodemobrigh' OR to_agent_id LIKE 'crm-%ceodemobrigh'
            OR prompt LIKE '%goal_run_id%')`
  )
  .run(owner);
console.log('[clean-bb] dels failed', dFail.changes);

// Optional: drop plan-related notifies noise (not required)
try {
  const n = db
    .prepare(
      `DELETE FROM platform_user_notifications WHERE user_id = ? AND (
        title LIKE '%Goal plan%' OR title LIKE '%Workflow%' OR source = 'workflow_run_watch'
      )`
    )
    .run(owner);
  console.log('[clean-bb] notifications deleted', n.changes);
} catch (e) {
  console.warn('[clean-bb] notify clean skip', e.message);
}

// Reseed maker-checker published graphs
try {
  const seed = seedMakerCheckerWorkflowsForBusinessProfile(owner, getBusinessProfile(owner));
  console.log('[clean-bb] seed graphs', JSON.stringify(seed.results || seed).slice(0, 400));
} catch (e) {
  console.warn('[clean-bb] seed skip', e.message);
}

const after = {
  goals: db.prepare('SELECT COUNT(*) c FROM agent_goal_runs WHERE owner_user_id=?').get(owner)?.c,
  wf: db.prepare('SELECT COUNT(*) c FROM agent_workflow_runs WHERE owner_user_id=?').get(owner)?.c,
};
console.log('[clean-bb] after', after);
console.log('BRIGHTBOX_GOAL_WF_CLEAN_OK', owner);
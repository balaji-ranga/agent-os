/**
 * Assert findPriorDigestForEmail + email_send wiring prefers status_checker HTML.
 * Usage: node scripts/test-goal-email-digest-from-status-checker.mjs
 */
import assert from 'assert';
import { initDb, getDb } from '../src/db/schema.js';
import {
  ensureAgentGoalRunTables,
  findPriorDigestForEmail,
  priorStepSummaries,
} from '../src/services/agent-goal-run.js';

initDb();
ensureAgentGoalRunTables();
const db = getDb();

const goalId = `agr-testemail${Date.now().toString(16).slice(-8)}`;
const step0 = `ags-test0${Date.now().toString(16).slice(-8)}`;
const step1 = `ags-test1${Date.now().toString(16).slice(-8)}`;

db.prepare(
  `INSERT INTO agent_goal_runs (id, owner_user_id, agent_id, title, prompt, source, status, context_json)
   VALUES (?, 'ceo-bala', 'balserve', 'Daily Status Checker Digest Email', 'Do not call notify_ceo. email_send HTML.', 'test', 'running', '{}')`
).run(goalId);

const fakeHtml = '<html><body><h1>COO Status Report</h1><p>Needs attention: 2</p></body></html>';
const fakeMd = '# COO Status Report\n\nNeeds attention: 2';
const statusResult = {
  ok: true,
  tool_name: 'status_checker',
  result: {
    ok: true,
    counts: { awaiting_ceo: 0, failed: 2, open: 0, completed_1d: 3, needs_attention: 2 },
    digest: { counts: { awaiting_ceo: 0, failed: 2, open: 0, completed_1d: 3, needs_attention: 2 } },
    html: fakeHtml,
    markdown: fakeMd,
  },
};

db.prepare(
  `INSERT INTO agent_goal_steps (id, goal_run_id, step_index, step_type, label, spec_json, status, result_json, completed_at)
   VALUES (?, ?, 0, 'agent_tool', 'COO Status Checker', ?, 'completed', ?, datetime('now'))`
).run(step0, goalId, JSON.stringify({ tool_name: 'status_checker', args: {} }), JSON.stringify(statusResult));

db.prepare(
  `INSERT INTO agent_goal_steps (id, goal_run_id, step_index, step_type, label, spec_json, status)
   VALUES (?, ?, 1, 'agent_tool', 'Send Email', ?, 'pending')`
).run(step1, goalId, JSON.stringify({ tool_name: 'email_send', args: {} }));

const dig = findPriorDigestForEmail(goalId, 1);
assert.ok(dig, 'digest found');
assert.strictEqual(dig.tool, 'status_checker');
assert.ok(dig.html.includes('COO Status Report'), 'html present');
assert.ok(dig.markdown.includes('Needs attention'), 'markdown present');

const summary = priorStepSummaries(goalId, 1);
assert.ok(!/\{"ok":true/.test(summary), 'summary must not dump raw JSON');
assert.ok(/HTML digest ready/i.test(summary), 'summary mentions HTML ready');

db.prepare('DELETE FROM agent_goal_steps WHERE goal_run_id = ?').run(goalId);
db.prepare('DELETE FROM agent_goal_runs WHERE id = ?').run(goalId);

console.log(JSON.stringify({ ok: true, goalId, html_len: dig.html.length, summary }, null, 2));

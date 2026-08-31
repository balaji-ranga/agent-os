import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-kanban-sla-policy-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
process.env.OPENSEARCH_ENABLED = '0';

let database;
try {
  const { initDb } = await import('../src/db/schema.js');
  database = initDb();
  const owner = 'ceo-sla-policy-test';
  database.prepare(
    `INSERT INTO platform_users(id,email,password_hash,name,role,enabled)
     VALUES(?,?,?,?,?,1)`
  ).run(owner, 'sla-policy@example.test', 'x', 'SLA Policy CEO', 'ceo');

  const policyService = await import('../src/services/work-assignment-policy.js');
  policyService.saveWorkAssignmentPolicy(owner, {
    mode: 'prefer_agent', urgent_eta_hours: 2, standard_eta_hours: 8, complex_eta_hours: 24,
    sla_notify_in_app: false, sla_notify_email: false, sla_notify_whatsapp: false,
    sla_include_status_checker: true,
  });
  const saved = policyService.getWorkAssignmentPolicy(owner);
  assert.equal(saved.sla_notify_in_app, false);
  assert.equal(saved.sla_notify_email, false);
  assert.equal(saved.sla_notify_whatsapp, false);
  assert.equal(saved.sla_include_status_checker, true);
  policyService.saveWorkAssignmentPolicy(owner, { mode: 'prefer_agent', standard_eta_hours: 12 });
  assert.equal(policyService.getWorkAssignmentPolicy(owner).sla_notify_email, false, 'partial saves retain SLA channel choices');

  const inserted = database.prepare(
    `INSERT INTO kanban_tasks
      (title,description,status,created_by,owner_user_id,assigned_user_id,eta_hours,due_at,created_at)
     VALUES(?,?,?,?,?,?,2,datetime('now','-1 hour'),datetime('now','-3 hours'))`
  ).run('Retained breach test', 'A deliberately overdue test card', 'in_progress', 'test', owner, owner);
  const taskId = Number(inserted.lastInsertRowid);

  const sla = await import('../src/services/kanban-sla.js');
  const monitored = await sla.runKanbanSlaMonitor();
  assert.equal(monitored.escalated, 1);
  const event = database.prepare(
    `SELECT * FROM kanban_sla_events WHERE owner_user_id=? AND task_id=? AND event_type='breach'`
  ).get(owner, taskId);
  assert.ok(event, 'breach event must be retained independently from the Kanban card');
  const delivery = JSON.parse(event.delivery_json);
  assert.equal(delivery.in_app, 'disabled');
  assert.equal(delivery.email, 'disabled');
  assert.equal(delivery.whatsapp, 'disabled');

  const task = database.prepare('SELECT * FROM kanban_tasks WHERE id=?').get(taskId);
  sla.preserveSlaHistoryForDeletedTask(task);
  database.prepare('DELETE FROM kanban_tasks WHERE id=?').run(taskId);
  const retained = sla.listRecentSlaBreaches(owner, 30);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].deleted, true);

  const status = await import('../src/services/coo-status-checker.js');
  const digest = status.buildStatusDigest(owner, { reconcile: false });
  assert.equal(digest.counts.sla_breaches_30d, 1);
  assert.equal(digest.sections.sla_breaches_30d[0].status, 'deleted');
  assert.match(status.formatDigestMarkdown(digest), /task deleted \(audit retained\)/i);

  policyService.saveWorkAssignmentPolicy(owner, { ...saved, sla_include_status_checker: false });
  const hidden = status.buildStatusDigest(owner, { reconcile: false });
  assert.equal(hidden.counts.sla_breaches_30d, 0);
  assert.equal(hidden.sections.escalations.length, 0);

  console.log('kanban-sla-policy: OK');
} finally {
  try { if (database?.open) database.close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}

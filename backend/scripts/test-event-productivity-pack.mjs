import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-event-productivity-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.USERPROFILE = join(root, 'home');
process.env.HOME = join(root, 'home');
process.env.OPENCLAW_CONFIG_PATH = join(root, 'home', '.openclaw', 'openclaw.json');
process.env.OPENSEARCH_ENABLED = '0';

let handle;
try {
  const { initDb } = await import('../src/db/schema.js');
  const svc = await import('../src/services/event-productivity.js');
  const { purgeOwnerRetention } = await import('../src/services/data-retention.js');
  const { seedEventProductivityToolsIfMissing } = await import('../src/db/seed-event-productivity-tools.js');
  const { previewActionPolicy, upsertActionFamilyPolicies, upsertActionPolicyOverride } = await import('../src/services/action-policy.js');
  handle = initDb();
  svc.ensureEventProductivitySchema();
  const ownerA = 'test-company-a';
  const ownerB = 'test-company-b';
  handle.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled,data_retention_days) VALUES (?,?,?,?,'ceo',1,30)`).run(ownerA, 'a@example.invalid', 'test-only', 'A');
  handle.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled,data_retention_days) VALUES (?,?,?,?,'ceo',1,30)`).run(ownerB, 'b@example.invalid', 'test-only', 'B');
  seedEventProductivityToolsIfMissing();

  const created = svc.createEventSubscription(ownerA, {
    name: 'Calendar changes', provider: 'google_workspace', event_type: 'calendar.event.changed',
    filters: { 'payload.calendar_id': 'primary' }, target_type: 'inbox',
  });
  assert.ok(created.webhook_secret.startsWith('eps_'));
  assert.equal(svc.listEventSubscriptions(ownerA).length, 1);
  assert.equal(svc.listEventSubscriptions(ownerB).length, 0, 'cross-owner subscription hidden');
  await assert.rejects(() => svc.ingestProductivityEvent(created.subscription.id, 'wrong', {}), /Invalid webhook secret/);

  const ignored = await svc.ingestProductivityEvent(created.subscription.id, created.webhook_secret, {
    provider_event_id: 'evt-ignore', event_type: 'calendar.event.changed', payload: { calendar_id: 'shared' },
  });
  assert.equal(ignored.ignored, true, 'structured filter mismatch ignored');
  const accepted = await svc.ingestProductivityEvent(created.subscription.id, created.webhook_secret, {
    provider_event_id: 'evt-1', event_type: 'calendar.event.changed', payload: { calendar_id: 'primary', title: 'Meeting', access_token: 'must-not-persist' },
  });
  assert.equal(accepted.event.status, 'completed');
  assert.equal(accepted.event.payload.access_token, '[redacted]');
  const duplicate = await svc.ingestProductivityEvent(created.subscription.id, created.webhook_secret, {
    provider_event_id: 'evt-1', event_type: 'calendar.event.changed', payload: { calendar_id: 'primary' },
  });
  assert.equal(duplicate.duplicate, true, 'provider event deduplicated');
  assert.throws(() => svc.getProductivityEvent(ownerB, accepted.event.id), /Event not found/, 'cross-owner event hidden');

  handle.prepare(`INSERT INTO agent_workflow_definitions(id,owner_user_id,name,status,paused,trigger_modes) VALUES (?,?,?,'published',0,'manual,event')`).run('wf-owned-by-a', ownerA, 'A workflow');
  const ownedWfSub = svc.createEventSubscription(ownerA, { name: 'Owned workflow', provider: 'google_workspace', event_type: 'file.created', target_type: 'workflow', target_id: 'wf-owned-by-a' });
  let workflowDispatch;
  const workflowEvent = await svc.ingestProductivityEvent(ownedWfSub.subscription.id, ownedWfSub.webhook_secret, { provider_event_id: 'evt-owned-wf', event_type: 'file.created', payload: { file_id: 'f1' } }, { triggerWorkflow: async (id, payload) => { workflowDispatch = { id, payload }; return { id: 101 }; } });
  assert.equal(workflowDispatch.id, 'wf-owned-by-a');
  assert.equal(workflowEvent.event.trigger_run_type, 'workflow');
  assert.equal(Number(workflowEvent.event.trigger_run_id), 101);

  const goalSub = svc.createEventSubscription(ownerA, { name: 'Goal event', provider: 'slack', event_type: 'message.flagged', target_type: 'goal', target_id: 'balserve', goal_prompt_template: 'Handle {{event_type}} at {{event_id}}' });
  let goalDispatch;
  const goalEvent = await svc.ingestProductivityEvent(goalSub.subscription.id, goalSub.webhook_secret, { provider_event_id: 'evt-goal', event_type: 'message.flagged', payload: { channel_id: 'c1' } }, { createGoal: async (opts) => { goalDispatch = opts; return { goal_run_id: 'agr-test' }; } });
  assert.match(goalDispatch.prompt, /message\.flagged/);
  assert.equal(goalDispatch.context.productivity_event.payload.channel_id, 'c1');
  assert.equal(goalEvent.event.trigger_run_type, 'goal');
  assert.equal(goalEvent.event.trigger_run_id, 'agr-test');

  handle.prepare(`INSERT INTO agent_workflow_definitions(id,owner_user_id,name,status,paused,trigger_modes) VALUES (?,?,?,'published',0,'manual,event')`).run('wf-owned-by-b', ownerB, 'B workflow');
  const wfSub = svc.createEventSubscription(ownerA, { name: 'Wrong owner workflow', provider: 'google_workspace', event_type: 'file.changed', target_type: 'workflow', target_id: 'wf-owned-by-b' });
  await assert.rejects(() => svc.ingestProductivityEvent(wfSub.subscription.id, wfSub.webhook_secret, { provider_event_id: 'evt-cross', event_type: 'file.changed', payload: {} }), /not owned/);
  const failed = svc.listProductivityEvents(ownerA, { status: 'failed' }).find((row) => row.provider_event_id === 'evt-cross');
  assert.ok(failed?.next_retry_at, 'retry scheduled');
  for (let i = 0; i < 4; i += 1) await svc.processProductivityEvent(ownerA, failed.id, { suppressThrow: true });
  assert.equal(svc.getProductivityEvent(ownerA, failed.id).status, 'dead_letter', 'bounded retries terminate');

  const bind = svc.upsertProductivityBinding(ownerA, { operation: 'calendar_list_events', provider: 'google_workspace', app_id: 'google_calendar', action_id: 'google_calendar.list_events' });
  assert.equal(svc.listProductivityBindings(ownerB).length, 0, 'cross-owner binding hidden');
  let calls = 0;
  const executeAction = async () => { calls += 1; return { ok: true, data: { id: 'external-1' }, transport: 'fixture' }; };
  const first = await svc.executeProductivityOperation(ownerA, 'calendar_list_events', { provider: 'google_workspace', input: { days: 7 }, idempotency_key: 'same-call' }, { executeAction });
  assert.equal(first.receipt.status, 'completed');
  const second = await svc.executeProductivityOperation(ownerA, 'calendar_list_events', { provider: 'google_workspace', input: { days: 7 }, idempotency_key: 'same-call' }, { executeAction });
  assert.equal(second.duplicate, true);
  assert.equal(calls, 1, 'idempotent action executes once');
  await assert.rejects(() => svc.executeProductivityOperation(ownerB, 'calendar_list_events', { provider: 'google_workspace' }, { executeAction }), /No enabled binding/);
  assert.equal(svc.PRODUCTIVITY_OPERATIONS.calendar_create_event.tier, 'R2');
  assert.equal(svc.PRODUCTIVITY_OPERATIONS.document_read.tier, 'R0');
  upsertActionFamilyPolicies(ownerA, [{ family: 'communicate_external', mode: 'approval_required' }]);
  const guarded = previewActionPolicy({ ownerUserId: ownerA, toolName: 'calendar_create_event' });
  assert.equal(guarded.mode, 'approval_required');
  assert.equal(guarded.classification_source, 'tool_metadata');
  upsertActionPolicyOverride(ownerA, { scope_type: 'tool', scope_id: 'calendar_create_event', action_family: 'communicate_external', mode: 'autonomous', max_uses: 1 });
  const overridden = previewActionPolicy({ ownerUserId: ownerA, toolName: 'calendar_create_event' });
  assert.equal(overridden.mode, 'autonomous');
  assert.equal(overridden.policy_scope, 'tool');

  handle.prepare(`UPDATE productivity_events SET received_at='2020-01-01',status='completed' WHERE owner_user_id=?`).run(ownerA);
  handle.prepare(`UPDATE productivity_action_receipts SET created_at='2020-01-01',status='completed' WHERE owner_user_id=?`).run(ownerA);
  const purged = await purgeOwnerRetention(ownerA, { days: 30 });
  assert.ok(purged.deleted.productivity_events >= 1);
  assert.ok(purged.deleted.productivity_action_receipts >= 1);

  console.log(JSON.stringify({ ok: true, checks: ['owner-isolation', 'secret-auth', 'payload-redaction', 'structured-filter', 'event-idempotency', 'workflow-dispatch', 'goal-dispatch', 'retry-dead-letter', 'binding-isolation', 'action-idempotency', 'risk-contract', 'action-policy-approval', 'action-policy-override', 'retention'], binding_id: bind.id }, null, 2));
} finally {
  try { handle?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}

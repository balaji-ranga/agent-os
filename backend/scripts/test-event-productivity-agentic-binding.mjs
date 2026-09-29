import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-productivity-binding-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.USERPROFILE = join(root, 'home');
process.env.HOME = join(root, 'home');
process.env.OPENCLAW_CONFIG_PATH = join(root, 'home', '.openclaw', 'openclaw.json');
process.env.OPENSEARCH_ENABLED = '0';

let handle;
try {
  const { initDb } = await import('../src/db/schema.js');
  const { ensureEventProductivitySchema, executeProductivityOperation, upsertProductivityBinding } = await import('../src/services/event-productivity.js');
  handle = initDb();
  ensureEventProductivitySchema();
  const owner = 'agentic-binding-company';
  handle.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES (?,?,?,?,'ceo',1)`).run(owner, 'binding@example.invalid', 'test-only', 'Binding Test');

  const binding = upsertProductivityBinding(owner, {
    operation: 'calendar_list_events',
    provider: 'google_workspace',
    app_id: 'google_calendar',
    action_id: 'google_calendar.list_events',
  });
  assert.equal(binding.action_id, 'google_calendar.list_events');

  const connectorCalls = [];
  const executeAction = async (executingOwner, actionId, input) => {
    connectorCalls.push({ executingOwner, actionId, input });
    return { ok: true, transport: 'functional-fixture', data: { id: 'calendar-query-1', events: [] } };
  };
  const agentRequest = {
    provider: 'google_workspace',
    input: { calendar_id: 'primary', days: 3 },
    event_id: 'epe-agentic-test',
    goal_run_id: 'agr-agentic-test',
    workflow_run_id: '401',
    idempotency_key: 'agentic-calendar-read-1',
  };
  const first = await executeProductivityOperation(owner, 'calendar_list_events', agentRequest, { executeAction });
  const replay = await executeProductivityOperation(owner, 'calendar_list_events', agentRequest, { executeAction });

  assert.equal(connectorCalls.length, 1, 'agent retry must not execute the provider action twice');
  assert.deepEqual(connectorCalls[0], {
    executingOwner: owner,
    actionId: 'google_calendar.list_events',
    input: { calendar_id: 'primary', days: 3 },
  });
  assert.equal(first.receipt.status, 'completed');
  assert.equal(first.receipt.action_id, 'google_calendar.list_events');
  assert.equal(first.receipt.event_id, 'epe-agentic-test');
  assert.equal(first.receipt.goal_run_id, 'agr-agentic-test');
  assert.equal(first.receipt.workflow_run_id, '401');
  assert.equal(first.receipt.verification_status, 'not_configured');
  assert.equal(replay.duplicate, true);
  assert.equal(replay.receipt.id, first.receipt.id);

  console.log(JSON.stringify({
    ok: true,
    flow: 'agent semantic request -> owner binding -> exact connector action -> durable receipt',
    operation: 'calendar_list_events',
    bound_action_id: connectorCalls[0].actionId,
    connector_execution_count: connectorCalls.length,
    duplicate_retry_suppressed: replay.duplicate,
    receipt_id: first.receipt.id,
    receipt_status: first.receipt.status,
  }, null, 2));
} finally {
  try { handle?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}

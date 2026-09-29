import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-company-email-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.USERPROFILE = join(root, 'home');
process.env.HOME = join(root, 'home');
process.env.OPENCLAW_CONFIG_PATH = join(root, 'home', '.openclaw', 'openclaw.json');
process.env.OPENSEARCH_ENABLED = '0';

let handle;
try {
  const { initDb } = await import('../src/db/schema.js');
  const email = await import('../src/services/company-email-channels.js');
  const events = await import('../src/services/event-productivity.js');
  const { purgeOwnerRetention } = await import('../src/services/data-retention.js');
  handle = initDb();
  email.ensureCompanyEmailChannelsSchema();
  events.ensureEventProductivitySchema();

  const ownerA = 'company-email-a';
  const ownerB = 'company-email-b';
  for (const [id, address] of [[ownerA, 'a@example.invalid'], [ownerB, 'b@example.invalid']]) {
    handle.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled,data_retention_days) VALUES (?,?,?,?,'ceo',1,30)`).run(id, address, 'test-only', id);
  }
  handle.prepare(`INSERT INTO agents(id,name,role) VALUES ('coo-a','COO','operations'),('marketing-a','Marketing Specialist','marketing'),('coo-b','Other COO','operations')`).run();
  handle.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES (?, 'coo-a',1),(?,'marketing-a',1),(?,'coo-b',1)`).run(ownerA, ownerA, ownerB);
  handle.prepare(`INSERT INTO agent_workflow_definitions(id,owner_user_id,name,status,paused,trigger_modes) VALUES ('mail-workflow-a',?,'Mail workflow','published',0,'manual,event'),('mail-workflow-b',?,'Other mail workflow','published',0,'manual,event')`).run(ownerA, ownerB);

  assert.throws(() => email.createCompanyEmailChannel(ownerA, {
    provider: 'outlook', mailbox_address: 'ops@example.com', routing_mode: 'workflow', routing_target_id: 'mail-workflow-b', default_agent_id: 'coo-a',
  }), /not owned/, 'cross-company workflow rejected');
  assert.throws(() => email.createCompanyEmailChannel(ownerA, {
    provider: 'outlook', mailbox_address: 'ops@example.com', routing_mode: 'goal', default_agent_id: 'coo-b',
  }), /not an enabled agent/, 'cross-company agent rejected');

  const created = email.createCompanyEmailChannel(ownerA, {
    provider: 'outlook', mailbox_address: 'ops@example.com', display_name: 'Company mailbox', direction: 'both',
    routing_mode: 'inbox', default_agent_id: 'coo-a', marketing_agent_id: 'marketing-a',
    config: { initial_lookback_hours: 24 },
  });
  assert.equal(created.status, 'draft');
  assert.equal(email.createCompanyEmailChannel instanceof Function, true);
  assert.equal((await email.listCompanyEmailChannels(ownerB, {}, { getConnections: async () => [] })).channels.length, 0, 'cross-owner channel hidden');
  await assert.rejects(() => email.getCompanyEmailChannel(ownerB, created.id, { getConnections: async () => [] }), /not found/i);

  const getConnections = async () => ({ connections: [{ app_id: 'outlook', app_name: 'Microsoft Outlook', connected: true }] });
  let profileCalls = 0;
  const executeAction = async (_owner, actionId) => {
    assert.equal(actionId, 'outlook.get_profile'); profileCalls += 1; return { ok: true, data: { mail: 'ops@example.com' } };
  };
  const tested = await email.testCompanyEmailChannel(ownerA, created.id, { getConnections, executeAction });
  assert.equal(tested.ok, true);
  const enabled = await email.enableCompanyEmailChannel(ownerA, created.id, { getConnections, executeAction });
  assert.equal(enabled.status, 'enabled');
  assert.equal(enabled.healthy, true);
  assert.equal(profileCalls, 2);

  const bodies = ['Interested in AI operations', 'Internal planning note'];
  let correlated = 0;
  const syncDeps = {
    fetchMessages: async () => [
      { provider_message_id: 'provider-1', internet_message_id: '<reply-1>', thread_id: 'thread-1', sender: 'lead@example.net', sender_name: 'Lead', subject: 'Re: campaign', body_text: bodies[0], received_at: new Date().toISOString() },
      { provider_message_id: 'provider-2', internet_message_id: '<normal-1>', thread_id: 'thread-2', sender: 'partner@example.net', sender_name: 'Partner', subject: 'Planning', body_text: bodies[1], received_at: new Date().toISOString() },
    ],
    correlateMarketing: (_owner, input) => {
      correlated += 1;
      assert.equal(input.owner_agent, 'marketing-a');
      return input.sender_id === 'lead@example.net'
        ? { matched: true, normal_chat: false, campaign: { campaign_id: 'campaign-1' }, lead: { lead_id: 'lead-1' }, classification: { intent: 'positive_interest' } }
        : { matched: false };
    },
  };
  const firstSync = await email.syncCompanyEmailChannel(ownerA, created.id, {}, syncDeps);
  assert.equal(firstSync.processed, 2);
  assert.equal(firstSync.marketing, 1);
  assert.equal(firstSync.inbox, 1);
  assert.equal(correlated, 2);
  const inboxEvents = events.listProductivityEvents(ownerA, { limit: 10 });
  assert.equal(inboxEvents.length, 1, 'normal email entered the durable event inbox');
  assert.equal(inboxEvents[0].event_type, 'email.message.received');
  assert.equal(inboxEvents[0].payload.body_text, bodies[1]);
  const replay = await email.syncCompanyEmailChannel(ownerA, created.id, {}, syncDeps);
  assert.equal(replay.duplicates, 2, 'provider messages are idempotent');
  assert.equal(events.listProductivityEvents(ownerA, { limit: 10 }).length, 1, 'duplicate did not dispatch again');

  const rawReceipts = handle.prepare(`SELECT * FROM company_email_channel_receipts WHERE owner_user_id=? ORDER BY provider_message_id`).all(ownerA);
  assert.equal(rawReceipts.length, 2);
  const serialized = JSON.stringify(rawReceipts);
  assert.equal(serialized.includes(bodies[0]), false, 'campaign message body is not stored in routing receipt');
  assert.equal(serialized.includes(bodies[1]), false, 'normal message body is not stored in routing receipt');
  assert.deepEqual(rawReceipts.map((row) => row.route_type).sort(), ['inbox', 'marketing']);

  handle.prepare(`UPDATE company_email_channel_receipts SET received_at='2020-01-01',created_at='2020-01-01' WHERE owner_user_id=?`).run(ownerA);
  const purged = await purgeOwnerRetention(ownerA, { days: 30 });
  assert.equal(purged.deleted.company_email_channel_receipts, 2, 'retention purges Email routing receipts');

  console.log(JSON.stringify({ ok: true, checks: [
    'owner-isolation', 'agent-ownership', 'workflow-ownership', 'oauth-required-health', 'test-before-enable',
    'campaign-routing', 'event-inbox-routing', 'provider-idempotency', 'receipt-body-minimization', 'retention',
  ] }, null, 2));
} finally {
  try { handle?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}

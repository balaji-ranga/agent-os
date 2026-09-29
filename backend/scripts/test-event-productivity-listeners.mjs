import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-event-listeners-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.USERPROFILE = join(root, 'home');
process.env.HOME = join(root, 'home');
process.env.OPENCLAW_CONFIG_PATH = join(root, 'home', '.openclaw', 'openclaw.json');
process.env.OPENSEARCH_ENABLED = '0';

let handle;
try {
  const { initDb } = await import('../src/db/schema.js');
  const events = await import('../src/services/event-productivity.js');
  const listeners = await import('../src/services/event-productivity-listeners.js');
  const { purgeOwnerRetention } = await import('../src/services/data-retention.js');
  handle = initDb();
  events.ensureEventProductivitySchema();
  const owner = 'listener-owner';
  handle.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled,data_retention_days) VALUES (?,?,?,?,'ceo',1,90)`)
    .run(owner, 'admin@example.invalid', 'test-only', 'Listener Owner');

  const gmail = events.createEventSubscription(owner, {
    name: 'Inbox changes', provider: 'google_workspace', event_type: 'email.message.received', target_type: 'inbox',
    listener_enabled: true, listener_poll_seconds: 60, source_disposition: 'trash',
  }).subscription;
  const calls = [];
  const gmailDeps = {
    executeAction: async (_owner, action, input) => {
      calls.push({ action, input });
      if (action === 'gmail.fetch_emails') return { data: { messages: [{
        id: 'gmail-message-1', threadId: 'thread-1', subject: 'New inquiry', from: 'sender@example.net',
        text: 'Please contact me', internalDate: Date.now(),
      }] } };
      if (action === 'gmail.move_to_trash') return { ok: true };
      throw new Error(`Unexpected action ${action}`);
    },
  };
  const first = await listeners.pollProductivitySubscription(owner, gmail.id, {}, gmailDeps);
  assert.equal(first.emitted, 1);
  assert.equal(first.source_trashed, 1);
  assert.equal(events.listProductivityEvents(owner, { subscription_id: gmail.id }).length, 1);
  const second = await listeners.pollProductivitySubscription(owner, gmail.id, {}, gmailDeps);
  assert.equal(second.emitted, 0);
  assert.equal(second.duplicates, 1);
  assert.equal(events.listProductivityEvents(owner, { subscription_id: gmail.id }).length, 1);
  assert.equal(calls.filter((call) => call.action === 'gmail.move_to_trash').length, 1, 'duplicate source is not trashed again');

  const outlook = events.createEventSubscription(owner, {
    name: 'Microsoft inbox changes', provider: 'microsoft_365', event_type: 'email.message.received', target_type: 'inbox',
    listener_enabled: true, listener_poll_seconds: 60,
  }).subscription;
  const outlookResult = await listeners.pollProductivitySubscription(owner, outlook.id, {}, {
    executeAction: async (_owner, action, input) => {
      assert.equal(action, 'outlook.list_messages');
      assert.match(input.filter, /receivedDateTime ge/);
      return { data: { value: [{
        id: 'outlook-message-1', conversationId: 'outlook-thread-1', internetMessageId: '<outlook-1>',
        subject: 'Microsoft 365 inbox change', from: { emailAddress: { address: 'sender@example.net' } },
        receivedDateTime: new Date().toISOString(), body: { contentType: 'text', content: 'Inbox event' },
      }] } };
    },
  });
  assert.equal(outlookResult.emitted, 1);
  assert.equal(events.listProductivityEvents(owner, { subscription_id: outlook.id }).length, 1);

  const calendar = events.createEventSubscription(owner, {
    name: 'Calendar changes', provider: 'google_workspace', event_type: 'calendar.event.changed', target_type: 'inbox',
    listener_enabled: true, listener_poll_seconds: 60,
  }).subscription;
  const beforeEnable = new Date(Date.now() - 60_000).toISOString();
  let calendarRows = [{ id: 'calendar-1', summary: 'Planning', created: beforeEnable, updated: beforeEnable, status: 'confirmed' }];
  const calendarDeps = { executeAction: async (_owner, action) => {
    assert.equal(action, 'google_calendar.list_events');
    return { data: { events: calendarRows } };
  } };
  const baseline = await listeners.pollProductivitySubscription(owner, calendar.id, {}, calendarDeps);
  assert.equal(baseline.emitted, 0, 'existing calendar row is a baseline, not a false change');
  calendarRows = [{ ...calendarRows[0], summary: 'Planning updated', updated: new Date().toISOString() }];
  const changed = await listeners.pollProductivitySubscription(owner, calendar.id, {}, calendarDeps);
  assert.equal(changed.emitted, 1);
  assert.equal(events.listProductivityEvents(owner, { subscription_id: calendar.id })[0].event_type, 'calendar.event.changed');

  const active = events.listEventSubscriptions(owner).find((row) => row.id === calendar.id);
  assert.equal(active.listener_status, 'active');
  assert.equal(active.listener_active, true);
  events.updateEventSubscription(owner, calendar.id, { listener_enabled: false });
  await assert.rejects(() => listeners.pollProductivitySubscription(owner, calendar.id, {}, calendarDeps), /Enable both/);

  handle.prepare(`UPDATE productivity_events SET received_at='2020-01-01',processed_at='2020-01-01' WHERE owner_user_id=?`).run(owner);
  const purged = await purgeOwnerRetention(owner);
  assert.equal(purged.retention_days, 90);
  assert.equal(purged.deleted.productivity_events, 3);
  assert.equal(events.listProductivityEvents(owner).length, 0);

  console.log(JSON.stringify({ ok: true, checks: [
    'shared-listener-email', 'gmail-and-microsoft-inbox-adapters', 'provider-id-deduplication', 'gmail-recoverable-trash', 'calendar-change-detection',
    'listener-active-status', 'listener-disable', 'subscription-history-filter', 'ceo-profile-retention',
  ] }, null, 2));
} finally {
  try { handle?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}

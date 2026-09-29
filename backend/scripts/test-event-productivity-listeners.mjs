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
process.env.USER_API_KEYS_KEK = 'test-only-calendar-url-encryption-key';

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

  assert.throws(() => events.createEventSubscription(owner, {
    name: 'Google view URL', provider: 'calendar_url', event_type: 'calendar.event.changed', target_type: 'inbox',
    source_url: 'https://calendar.google.com/calendar/u/0?cid=example',
  }), /viewing link/);
  assert.throws(() => events.createEventSubscription(owner, {
    name: 'Private URL', provider: 'calendar_url', event_type: 'calendar.event.changed', target_type: 'inbox',
    source_url: 'https://127.0.0.1/calendar.ics',
  }), /host is not allowed/);

  const publishedCalendar = events.createEventSubscription(owner, {
    name: 'Published ICS changes', provider: 'calendar_url', event_type: 'calendar.event.changed', target_type: 'inbox',
    source_url: 'webcal://calendar.example.invalid/private-token/basic.ics', listener_enabled: true, listener_poll_seconds: 60,
  }).subscription;
  assert.equal(publishedCalendar.source_url_configured, true);
  assert.equal(publishedCalendar.source_url_host, 'calendar.example.invalid');
  assert.equal(Object.hasOwn(publishedCalendar, 'source_url_encrypted'), false, 'private feed URL is never returned by the API model');
  let feedVersion = 1;
  let conditionalEtag = '';
  const ics = () => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:published-1\r\nSUMMARY:Planning${feedVersion === 2 ? ' updated' : ''}\r\nDTSTART:20260930T010000Z\r\nDTEND:20260930T020000Z\r\nCREATED:20260901T000000Z\r\nLAST-MODIFIED:2026092${feedVersion}T000000Z\r\nSTATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const publishedDeps = { requestCalendarUrl: async (url, options) => {
    assert.equal(url, 'https://calendar.example.invalid/private-token/basic.ics');
    conditionalEtag = options.headers['If-None-Match'] || '';
    return { status: 200, ok: true, headers: { etag: `"v${feedVersion}"`, 'content-type': 'text/calendar' }, text: async () => ics() };
  } };
  assert.equal((await listeners.pollProductivitySubscription(owner, publishedCalendar.id, {}, publishedDeps)).emitted, 0, 'published feed starts with a baseline');
  feedVersion = 2;
  const publishedChanged = await listeners.pollProductivitySubscription(owner, publishedCalendar.id, {}, publishedDeps);
  assert.equal(conditionalEtag, '"v1"');
  assert.equal(publishedChanged.emitted, 1);
  assert.equal(events.listProductivityEvents(owner, { subscription_id: publishedCalendar.id })[0].event_type, 'calendar.event.changed');
  const unchanged = await listeners.pollProductivitySubscription(owner, publishedCalendar.id, {}, { requestCalendarUrl: async (_url, options) => {
    assert.equal(options.headers['If-None-Match'], '"v2"');
    return { status: 304, ok: false, headers: { etag: '"v2"' }, text: async () => '' };
  } });
  assert.equal(unchanged.not_modified, true);
  assert.equal(unchanged.emitted, 0);

  const fileCreated = events.createEventSubscription(owner, {
    name: 'Drive file created', provider: 'google_workspace', event_type: 'file.created', target_type: 'inbox',
    listener_enabled: true, listener_poll_seconds: 60,
  }).subscription;
  const oldFileTime = new Date(Date.now() - 60_000).toISOString();
  let googleFiles = [{ id: 'drive-existing', name: 'Existing.txt', createdTime: oldFileTime, modifiedTime: oldFileTime, mimeType: 'text/plain' }];
  const googleFileDeps = { executeProductivityOperation: async (_owner, operation, input) => {
    assert.equal(operation, 'file_search');
    assert.equal(input.provider, 'google_workspace');
    return { result: { data: { files: googleFiles } } };
  } };
  const fileBaseline = await listeners.pollProductivitySubscription(owner, fileCreated.id, {}, googleFileDeps);
  assert.equal(fileBaseline.emitted, 0, 'existing Drive file is a baseline, not a false create');
  const newFileTime = new Date().toISOString();
  googleFiles = [...googleFiles, { id: 'drive-new', name: 'New.txt', createdTime: newFileTime, modifiedTime: newFileTime, mimeType: 'text/plain' }];
  const fileCreateResult = await listeners.pollProductivitySubscription(owner, fileCreated.id, {}, googleFileDeps);
  assert.equal(fileCreateResult.emitted, 1);
  assert.equal(events.listProductivityEvents(owner, { subscription_id: fileCreated.id })[0].event_type, 'file.created');

  const fileChanged = events.createEventSubscription(owner, {
    name: 'OneDrive file changed', provider: 'microsoft_365', event_type: 'file.changed', target_type: 'inbox',
    listener_enabled: true, listener_poll_seconds: 60,
  }).subscription;
  let microsoftFiles = [{ id: 'onedrive-1', name: 'Proposal.docx', createdDateTime: oldFileTime, lastModifiedDateTime: oldFileTime, eTag: 'v1' }];
  let microsoftHasMore = false;
  const microsoftFileDeps = { executeProductivityOperation: async (_owner, operation, input) => {
    assert.equal(operation, 'file_search');
    assert.equal(input.provider, 'microsoft_365');
    return { result: { data: { value: microsoftFiles, ...(microsoftHasMore ? { '@odata.nextLink': 'https://provider.invalid/next' } : {}) } } };
  } };
  assert.equal((await listeners.pollProductivitySubscription(owner, fileChanged.id, {}, microsoftFileDeps)).emitted, 0);
  microsoftFiles = [{ ...microsoftFiles[0], lastModifiedDateTime: new Date().toISOString(), eTag: 'v2' }];
  const fileChangeResult = await listeners.pollProductivitySubscription(owner, fileChanged.id, {}, microsoftFileDeps);
  assert.equal(fileChangeResult.emitted, 1);
  assert.equal(events.listProductivityEvents(owner, { subscription_id: fileChanged.id })[0].event_type, 'file.changed');

  const fileDeleted = events.createEventSubscription(owner, {
    name: 'OneDrive file deleted', provider: 'microsoft_365', event_type: 'file.deleted', target_type: 'inbox',
    listener_enabled: true, listener_poll_seconds: 60,
  }).subscription;
  microsoftFiles = [{ id: 'onedrive-delete', name: 'Old.docx', createdDateTime: oldFileTime, lastModifiedDateTime: oldFileTime, eTag: 'v1' }];
  assert.equal((await listeners.pollProductivitySubscription(owner, fileDeleted.id, {}, microsoftFileDeps)).emitted, 0);
  microsoftFiles = [];
  microsoftHasMore = true;
  const incompleteMissing = await listeners.pollProductivitySubscription(owner, fileDeleted.id, {}, microsoftFileDeps);
  assert.equal(incompleteMissing.emitted, 0, 'an incomplete provider page never infers deletion');
  assert.equal(incompleteMissing.pending_deletions, 0);
  microsoftHasMore = false;
  const firstMissing = await listeners.pollProductivitySubscription(owner, fileDeleted.id, {}, microsoftFileDeps);
  assert.equal(firstMissing.emitted, 0, 'one missing snapshot does not emit a false delete');
  assert.equal(firstMissing.pending_deletions, 1);
  const confirmedMissing = await listeners.pollProductivitySubscription(owner, fileDeleted.id, {}, microsoftFileDeps);
  assert.equal(confirmedMissing.emitted, 1, 'two complete missing snapshots confirm deletion');
  assert.equal(events.listProductivityEvents(owner, { subscription_id: fileDeleted.id })[0].event_type, 'file.deleted');
  assert.equal((await listeners.pollProductivitySubscription(owner, fileDeleted.id, {}, microsoftFileDeps)).emitted, 0, 'confirmed deletion is not emitted again');

  const providerTombstone = events.createEventSubscription(owner, {
    name: 'Drive provider tombstone', provider: 'google_workspace', event_type: 'file.deleted', target_type: 'inbox',
    listener_enabled: true, listener_poll_seconds: 60,
  }).subscription;
  const tombstoneTime = new Date().toISOString();
  const tombstoneResult = await listeners.pollProductivitySubscription(owner, providerTombstone.id, {}, {
    executeProductivityOperation: async () => ({ result: { data: { files: [{ id: 'drive-deleted', name: 'Removed.txt', trashed: true, modifiedTime: tombstoneTime }] } } }),
  });
  assert.equal(tombstoneResult.emitted, 1, 'provider tombstones emit deletion immediately');

  const missingBinding = events.createEventSubscription(owner, {
    name: 'Drive binding required', provider: 'google_workspace', event_type: 'file.created', target_type: 'inbox',
    listener_enabled: true, listener_poll_seconds: 60,
  }).subscription;
  await assert.rejects(
    () => listeners.pollProductivitySubscription(owner, missingBinding.id, {}, {
      executeProductivityOperation: async () => { throw Object.assign(new Error('No enabled binding for file_search on google_workspace'), { code: 'PRODUCTIVITY_BINDING_REQUIRED' }); },
    }),
    (error) => error.code === 'LISTENER_BINDING_REQUIRED' && /file_search capability binding/.test(error.message)
  );

  events.upsertProductivityBinding(owner, {
    operation: 'file_search', provider: 'google_workspace', app_id: 'google_drive', action_id: 'google_drive.list_files', enabled: true,
  });
  let boundFiles = [{ id: 'bound-existing', name: 'Baseline.pdf', createdTime: oldFileTime, modifiedTime: oldFileTime, mimeType: 'application/pdf' }];
  const boundActions = [];
  const boundDeps = { productivityDeps: { executeAction: async (_owner, action, input) => {
    boundActions.push({ action, input });
    return { data: { files: boundFiles } };
  } } };
  const boundBaseline = await listeners.pollProductivitySubscription(owner, missingBinding.id, {}, boundDeps);
  assert.equal(boundBaseline.emitted, 0);
  const boundNewTime = new Date().toISOString();
  boundFiles = [...boundFiles, { id: 'bound-new', name: 'Uploaded.pdf', createdTime: boundNewTime, modifiedTime: boundNewTime, mimeType: 'application/pdf' }];
  const boundCreate = await listeners.pollProductivitySubscription(owner, missingBinding.id, {}, boundDeps);
  assert.equal(boundCreate.emitted, 1);
  assert.deepEqual(boundActions.map((row) => row.action), ['google_drive.list_files', 'google_drive.list_files']);
  assert.equal(events.listProductivityEvents(owner, { subscription_id: missingBinding.id })[0].event_type, 'file.created');
  assert.equal(events.listProductivityReceipts(owner).filter((row) => row.operation === 'file_search' && row.status === 'completed').length, 2);

  const active = events.listEventSubscriptions(owner).find((row) => row.id === calendar.id);
  assert.equal(active.listener_status, 'active');
  assert.equal(active.listener_active, true);
  events.updateEventSubscription(owner, calendar.id, { listener_enabled: false });
  await assert.rejects(() => listeners.pollProductivitySubscription(owner, calendar.id, {}, calendarDeps), /Enable both/);

  handle.prepare(`UPDATE productivity_events SET received_at='2020-01-01',processed_at='2020-01-01' WHERE owner_user_id=?`).run(owner);
  const purged = await purgeOwnerRetention(owner);
  assert.equal(purged.retention_days, 90);
  assert.equal(purged.deleted.productivity_events, 9);
  assert.equal(events.listProductivityEvents(owner).length, 0);

  console.log(JSON.stringify({ ok: true, checks: [
    'shared-listener-email', 'gmail-and-microsoft-inbox-adapters', 'provider-id-deduplication', 'gmail-recoverable-trash', 'calendar-change-detection', 'published-ics-calendar-listener', 'calendar-url-encryption-and-redaction', 'calendar-http-cache',
    'google-drive-file-created', 'microsoft-file-changed', 'incomplete-snapshot-safety', 'two-snapshot-file-deletion', 'provider-file-tombstone', 'file-binding-required', 'file-listener-owner-binding-execution',
    'listener-active-status', 'listener-disable', 'subscription-history-filter', 'ceo-profile-retention',
  ] }, null, 2));
} finally {
  try { handle?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}

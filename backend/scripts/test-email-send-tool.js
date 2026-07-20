/**
 * Smoke test: email_send content tool (validation + optional live SMTP).
 * Usage: node scripts/test-email-send-tool.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { seedEmailSendToolIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantEmailSendToAllAgents } from '../src/services/agent-feedback.js';
import { executeEmailSend, buildCalendarInvite } from '../src/services/email-send.js';

initDb();
seedEmailSendToolIfMissing();
grantEmailSendToAllAgents();

const meta = getDb().prepare(`SELECT name, endpoint, enabled FROM content_tools_meta WHERE name = 'email_send'`).get();
if (!meta) throw new Error('email_send not in content_tools_meta');
console.log('OK: content_tools_meta', meta);

const grants = getDb().prepare(`SELECT COUNT(*) AS n FROM agent_tool_grants WHERE tool_name = 'email_send'`).get().n;
console.log('OK: agent_tool_grants count', grants);

const ics = buildCalendarInvite({
  title: 'Test Meeting',
  start: '2026-07-21T10:00:00Z',
  end: '2026-07-21T11:00:00Z',
  organizer: 'test@example.com',
  attendees: ['guest@example.com'],
});
if (!ics.ics.includes('BEGIN:VCALENDAR')) throw new Error('ICS build failed');
if (!ics.ics.includes('ORGANIZER;CN=')) throw new Error('ICS missing ORGANIZER CN');
console.log('OK: calendar ICS built, method', ics.method);

const selfInvite = buildCalendarInvite({
  title: 'Self test',
  start: '2026-07-21T10:00:00Z',
  end: '2026-07-21T11:00:00Z',
  organizer: 'host@example.com',
  attendees: ['host@example.com'],
});
if (selfInvite.method !== 'PUBLISH') throw new Error('expected PUBLISH for self-invite');
console.log('OK: self-invite uses METHOD:PUBLISH');

const { normalizeAttachments } = await import('../src/services/email-send.js');
const attNorm = normalizeAttachments({
  attachments: [{ filename: 'meeting.ics', content: ics.ics, contentType: 'text/calendar; method=REQUEST' }],
});
if (attNorm.length !== 1 || attNorm[0].filename !== 'meeting.ics') throw new Error('attachment normalize failed');
console.log('OK: attachments normalize');

const missing = await executeEmailSend({ subject: 'x', body: 'y' });
if (missing.error !== 'At least one recipient (to, cc, or bcc) is required') {
  throw new Error(`expected recipient error, got ${missing.error}`);
}
console.log('OK: validation — recipients required');

const pastedBody = `Please join us.

BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Your Organization//NONSGML v1.0//EN
BEGIN:VEVENT
UID:1234567890@yourdomain.com
DTSTAMP:20230720T100000Z
DTSTART:20260801T130000Z
DTEND:20260801T140000Z
SUMMARY:Dinner
DESCRIPTION:Agent demo
END:VEVENT
END:VCALENDAR`;

const extracted = await executeEmailSend({
  to: process.env.WORKFLOW_TEST_EMAIL_TO || 'test@example.com',
  subject: 'ICS-in-body extraction test',
  body: pastedBody,
});
if (extracted.body?.includes('BEGIN:VCALENDAR')) throw new Error('ICS still in email body');
if (!extracted.calendarSent) throw new Error('expected calendarSent from pasted ICS body');
if (!extracted.icsExtractedFromBody) throw new Error('expected icsExtractedFromBody flag');
console.log('OK: pasted ICS in body auto-converted to calendar attachment');

const to = process.env.WORKFLOW_TEST_EMAIL_TO;
if (to && process.env.WORKFLOW_SMTP_HOST) {
  const out = await executeEmailSend({
    to: [to, to],
    cc: to,
    subject: 'Agent OS email_send tool test',
    body: `email_send smoke test at ${new Date().toISOString()}`,
    calendar: {
      title: 'Agent OS Test Meeting',
      start: new Date(Date.now() + 86400000).toISOString(),
      end: new Date(Date.now() + 90000000).toISOString(),
      description: 'Calendar invite from email_send tool test',
      attendees: [to],
    },
  });
  console.log('SMTP result:', out);
  if (!out.sent) throw new Error(`SMTP send failed: ${out.error}`);
  console.log('OK: live SMTP + calendar invite');
} else {
  console.log('SKIP live SMTP (set WORKFLOW_SMTP_* and WORKFLOW_TEST_EMAIL_TO)');
}

console.log('\nALL email_send TESTS PASSED');

/**
 * E2E: prompt COO to invoke email_send with a calendar invite.
 *
 * Usage (backend container on VPS):
 *   node scripts/test-coo-email-send-calendar.js
 *
 * Env:
 *   COO_EMAIL_TEST_TO — recipient (defaults WORKFLOW_TEST_EMAIL_TO)
 *   COO_TOOLS_SKIP_LIVE_SMTP=1 — only assert tool invocation, not SMTP success
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { seedEmailSendToolIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantEmailSendToAllAgents } from '../src/services/agent-feedback.js';

initDb();
seedEmailSendToolIfMissing();
grantEmailSendToAllAgents();

const AGENT_ID = process.env.COO_AGENT_ID || 'balserve';
const OWNER_USER_ID = process.env.COO_TOOLS_OWNER_USER_ID || process.env.WORKFLOW_TEST_OWNER_USER_ID || 'default';
const SESSION_USER = process.env.COO_TOOLS_SESSION_USER || `agent-os-${AGENT_ID}-${OWNER_USER_ID}`;
const GATEWAY_URL = (
  process.env.OPENCLAW_GATEWAY_URL ||
  (existsSync('/.dockerenv') ? 'http://openclaw:18789' : 'http://127.0.0.1:18789')
).replace(/\/$/, '');
const TEST_TO = process.env.COO_EMAIL_TEST_TO || process.env.WORKFLOW_TEST_EMAIL_TO || '';

function loadGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN) {
    return process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN;
  }
  for (const p of ['/root/.openclaw/openclaw.json', join(process.env.HOME || '', '.openclaw', 'openclaw.json')]) {
    try {
      if (!existsSync(p)) continue;
      const cfg = JSON.parse(readFileSync(p, 'utf8'));
      if (cfg?.gateway?.auth?.token) return cfg.gateway.auth.token;
    } catch (_) {}
  }
  return '';
}

const TOKEN = loadGatewayToken();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function latestToolLog(afterIso) {
  return getDb()
    .prepare(
      `SELECT id, tool_name, status, request_payload, substr(response_payload, 1, 600) AS response_payload, created_at
       FROM content_tool_logs WHERE tool_name = 'email_send' AND created_at >= ? ORDER BY id DESC LIMIT 1`
    )
    .get(afterIso);
}

async function chatCoo(prompt, { timeoutMs = 240000 } = {}) {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': AGENT_ID,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({
      model: 'openclaw',
      messages: [{ role: 'user', content: prompt }],
      user: SESSION_USER,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  const assistant = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || text.slice(0, 800);
  return { ok: res.ok, status: res.status, assistant: String(assistant || ''), raw: text.slice(0, 1500) };
}

async function main() {
  if (!TEST_TO) {
    console.error('Set COO_EMAIL_TEST_TO or WORKFLOW_TEST_EMAIL_TO');
    process.exit(1);
  }

  console.log('=== COO email_send calendar invite E2E ===');
  console.log('agent', AGENT_ID, 'to', TEST_TO, 'gateway', GATEWAY_URL);

  try {
    const { registerOpenClawSessionOwner } = await import('../src/services/tool-owner-scope.js');
    registerOpenClawSessionOwner(`agent:${AGENT_ID}:${SESSION_USER}`, OWNER_USER_ID);
  } catch (e) {
    console.warn('session owner register skipped', e.message);
  }

  const grant = getDb()
    .prepare(`SELECT 1 FROM agent_tool_grants WHERE agent_id = ? AND tool_name = 'email_send'`)
    .get(AGENT_ID);
  if (!grant) throw new Error(`email_send not granted to ${AGENT_ID}`);

  const afterIso = new Date(Date.now() - 2000).toISOString().replace('T', ' ').slice(0, 19);
  const forced = process.env.COO_EMAIL_FORCE_TOOL === '1';
  const prompt = forced
    ? `You must call the email_send tool now. Do not use browser or agent_workflow_trigger.

Send an email to ${TEST_TO} with:
- subject: "Dinner with meeting — Agent OS test"
- body: "Calendar invite test from COO email_send tool."
- calendar: title "Dinner with meeting", start "2026-08-01T21:00:00+08:00", end "2026-08-01T22:00:00+08:00", description "Agent demo"

Invoke email_send with JSON containing to, subject, body, and calendar object. After the tool returns, confirm whether the email and calendar invite were sent.`
    : `Send an email to ${TEST_TO} with a calendar invite for Aug 1 9pm SGT, title Dinner, 1 hour, description Agent demo`;

  console.log('\nprompt:', prompt.slice(0, 200), '…');
  const chat = await chatCoo(prompt);
  console.log('gateway', chat.status, chat.ok);
  console.log('assistant:', chat.assistant.slice(0, 400).replace(/\s+/g, ' '));

  await sleep(2000);
  let log = latestToolLog(afterIso);
  for (let i = 0; i < 10 && !log; i++) {
    await sleep(1500);
    log = latestToolLog(afterIso);
  }

  if (!log) {
    console.error('FAIL: COO did not invoke email_send (no content_tool_logs row)');
    process.exit(1);
  }

  console.log('tool log', { id: log.id, status: log.status, created_at: log.created_at });
  console.log('response', log.response_payload?.slice(0, 400));

  let req = {};
  try {
    req = JSON.parse(log.request_payload || '{}');
  } catch (_) {}

  const hasCalendar =
    req.calendar ||
    req.meeting ||
    req.ics ||
    (Array.isArray(req.attachments) && req.attachments.some((a) => /\.ics/i.test(a?.filename || '')));

  if (!hasCalendar && !String(log.request_payload || '').includes('calendar')) {
    console.warn('WARN: request may not include calendar/ics — check payload:', log.request_payload?.slice(0, 300));
  }

  const skipLive = process.env.COO_TOOLS_SKIP_LIVE_SMTP === '1';
  if (skipLive) {
    console.log('OK: email_send invoked (COO_TOOLS_SKIP_LIVE_SMTP=1)');
    process.exit(0);
  }

  if (log.status !== 'ok') {
    console.error('FAIL: email_send log status=', log.status, log.response_payload);
    process.exit(1);
  }

  let resp = {};
  try {
    resp = JSON.parse(log.response_payload || '{}');
  } catch (_) {}

  if (!resp.sent && !resp.calendarSent) {
    console.error('FAIL: SMTP did not send', resp);
    process.exit(1);
  }

  console.log('OK: COO invoked email_send with calendar invite', {
    sent: resp.sent,
    calendarSent: resp.calendarSent,
    attachmentsSent: resp.attachmentsSent,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Verify Kanban timestamps render in the platform timezone and that task activity survives
 * an archived agent chat (chat_context).
 *
 * Usage: node backend/scripts/test-kanban-timezone-and-chat-context.js [ownerUserId] [baseUrl]
 */
import { initDb } from '../src/db/schema.js';
import { getDbForCeo } from '../src/db/request-db.js';
import { createSession } from '../src/services/auth/session.js';
import { getPlatformTimezone, parseApiDate } from '../src/utils/format-datetime.js';

const owner = process.argv[2] || process.env.KANBAN_TEST_OWNER || 'ceo-bala';
const BASE = (process.argv[3] || process.env.API_BASE || 'http://127.0.0.1:3001/api').replace(/\/$/, '');

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

function utcHourMinute(sqlTs) {
  const d = parseApiDate(sqlTs);
  if (!d) return null;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

async function main() {
  initDb();
  const tz = getPlatformTimezone();
  console.log(`[kanban-tz] owner=${owner} base=${BASE} platform_timezone=${tz}`);

  const { token } = createSession(owner);
  const auth = { Authorization: `Bearer ${token}` };

  const list = await fetch(`${BASE}/kanban/tasks?view=monthly&limit=50`, { headers: auth }).then((r) => r.json());
  const tasks = list.tasks || [];
  check('GET /kanban/tasks returns tasks', tasks.length > 0, `count=${tasks.length}`);
  check('list exposes server_timezone', !!list.server_timezone, list.server_timezone || 'missing');

  const withTime = tasks.find((t) => t.created_at);
  if (withTime) {
    check('list task has created_at_display', !!withTime.created_at_display, withTime.created_at_display || '');
    check('list task has updated_at_display', !!withTime.updated_at_display, withTime.updated_at_display || '');
    // Non-UTC platforms must not echo the raw UTC clock back to the UI.
    const offsetMinutes = new Date().getTimezoneOffset();
    if (offsetMinutes !== 0) {
      const utcHM = utcHourMinute(withTime.created_at);
      const showsUtcClock = utcHM && String(withTime.created_at_display).includes(utcHM.replace(/^0/, ''));
      check('created_at_display is not raw UTC clock', !showsUtcClock, `${withTime.created_at} -> ${withTime.created_at_display}`);
      check('display carries a timezone label', /GMT|UTC|[A-Z]{2,5}$/.test(String(withTime.created_at_display)), withTime.created_at_display);
    }
  }

  const detail = await fetch(`${BASE}/kanban/tasks/${tasks[0].id}`, { headers: auth }).then((r) => r.json());
  check('detail exposes server_timezone', detail.server_timezone === tz, `${detail.server_timezone}`);
  check('detail exposes chat_context', !!detail.chat_context, detail.chat_context?.source || 'missing');
  const msgs = detail.messages || [];
  if (msgs.length) {
    check('task messages carry created_at_display', msgs.every((m) => !!m.created_at_display), `n=${msgs.length}`);
  }

  // Cards whose agent chat is archived must still surface their conversation.
  const db = getDbForCeo(owner);
  const archivedAgent = db
    .prepare(
      `SELECT DISTINCT agent_id FROM chat_sessions WHERE owner_user_id = ? AND status = 'archived'`
    )
    .all(owner)
    .map((r) => r.agent_id);
  const candidate = tasks.find((t) => archivedAgent.includes(t.assigned_agent_id));
  if (candidate) {
    const d2 = await fetch(`${BASE}/kanban/tasks/${candidate.id}`, { headers: auth }).then((r) => r.json());
    const turns = d2.chat_context?.turns || [];
    const hasBody =
      !!d2.delegation_prompt ||
      !!d2.delegation_response ||
      (d2.messages || []).length > 0 ||
      turns.length > 0 ||
      String(d2.description || '').trim().length > 0;
    check(
      `task #${candidate.id} (agent ${candidate.assigned_agent_id} has archived chats) is not blank`,
      hasBody,
      `chat_turns=${turns.length} source=${d2.chat_context?.source}`
    );
  } else {
    console.log('  SKIP  no task assigned to an agent with archived chats');
  }

  console.log(failures ? `[kanban-tz] ${failures} check(s) failed` : '[kanban-tz] all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('[kanban-tz] error:', e?.message || e);
  process.exit(2);
});

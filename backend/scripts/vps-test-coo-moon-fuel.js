/**
 * Test COO AGENTS.md intent delegation for moon rocket fuel (ceo-bala).
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import {
  isCooNativeWork,
  classifyCooDelegationTargets,
} from '../src/services/coo-specialty-delegation.js';

initDb();
const db = getDb();
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const PROMPT = 'how much fuel required to land on the moon from earth for rocket';

const CEO =
  db.prepare(`SELECT id, name FROM platform_users WHERE name = ?`).get('Balaji Ranganathan') ||
  db.prepare(`SELECT id, name FROM platform_users WHERE id = 'ceo-bala'`).get();
if (!CEO) throw new Error('Balaji Ranganathan not found');
console.log('CEO', CEO);

console.log('isCooNativeWork', isCooNativeWork(PROMPT));
const classified = await classifyCooDelegationTargets(CEO.id, PROMPT);
console.log('classified (AGENTS.md)', classified);

const token = createSession(CEO.id).token;
const res = await fetch(`${BASE}/api/agents/balserve/chat`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ message: PROMPT }),
  signal: AbortSignal.timeout(180000),
});
const data = await res.json().catch(() => ({}));
console.log('chat status', res.status);
console.log('reply', String(data.reply || data.error || '').slice(0, 600));
console.log('specialty_delegation', JSON.stringify(data.specialty_delegation || null, null, 2));

const apiCount = Number(data.specialty_delegation?.count || 0);
const apiNames = data.specialty_delegation?.agent_names || [];

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

ok(!isCooNativeWork(PROMPT), 'not COO-native');
ok(res.status < 400, `chat ok status=${res.status}`);
ok(!!data.specialty_delegation, 'hard-path specialty_delegation present');
ok(apiCount >= 1 && apiCount <= 2, `delegated 1–2 agents (got ${apiCount}: ${apiNames.join(', ')})`);
ok(
  apiNames.some((n) => /tech|research/i.test(String(n))) ||
    Object.keys(classified).some((id) => /tech|research/i.test(id)),
  `includes tech/research specialist (names=${apiNames.join(', ')}; classified=${JSON.stringify(classified)})`
);
ok(
  !apiNames.some((n) => /social|expense|job\s*discover|code\s*assist/i.test(String(n))),
  `not social/expense/code (names=${apiNames.join(', ')})`
);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('PASS');

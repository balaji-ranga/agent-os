/**
 * Test COO AGENTS.md intent delegation for biryani water (ceo-bala).
 * Usage (in container): node scripts/vps-test-coo-biryani-delegate.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import {
  isCooNativeWork,
  classifyCooDelegationTargets,
} from '../src/services/coo-specialty-delegation.js';
import { listAgentsForUser } from '../src/services/users.js';

initDb();
const db = getDb();
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const PROMPT = 'how much water required for 1kg biryani';

const CEO =
  db.prepare(`SELECT id, name FROM platform_users WHERE name = ?`).get('Balaji Ranganathan') ||
  db.prepare(`SELECT id, name FROM platform_users WHERE id = 'ceo-bala'`).get();
if (!CEO) throw new Error('Balaji Ranganathan not found');
console.log('CEO', CEO);

const agents = listAgentsForUser(CEO.id).map((a) => ({
  id: a.id,
  name: a.name,
  department: a.department,
  role: a.role,
  is_coo: a.is_coo,
}));
console.log(
  'org agents',
  agents.filter((a) => !a.is_coo).map((a) => `${a.id} (${a.department || '-'})`)
);

console.log('isCooNativeWork', isCooNativeWork(PROMPT));
const classified = await classifyCooDelegationTargets(CEO.id, PROMPT);
console.log('classified (AGENTS.md)', classified);

const token = createSession(CEO.id).token;
const before = db
  .prepare(
    `SELECT COUNT(*) AS n FROM agent_delegation_tasks WHERE owner_user_id = ? OR standup_id IN (SELECT id FROM standups WHERE owner_user_id = ?)`
  )
  .get(CEO.id, CEO.id).n;

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
console.log('reply', String(data.reply || data.error || '').slice(0, 500));
console.log('specialty_delegation', JSON.stringify(data.specialty_delegation || null, null, 2));

const afterRows = db
  .prepare(
    `SELECT d.id, d.to_agent_id, d.status, substr(d.prompt,1,120) AS prompt, d.created_at
     FROM agent_delegation_tasks d
     WHERE d.owner_user_id = ? OR d.standup_id IN (SELECT id FROM standups WHERE owner_user_id = ?)
     ORDER BY d.id DESC LIMIT 15`
  )
  .all(CEO.id, CEO.id);

const recent = afterRows.filter((r) => /biryani|water/i.test(r.prompt || '') || r.id > before);
console.log('recent biryani/water delegations', JSON.stringify(recent.slice(0, 8), null, 2));

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
  apiNames.some((n) => /social/i.test(String(n))) ||
    Object.keys(classified).some((id) => /social/i.test(id)),
  `includes social specialist (names=${apiNames.join(', ')}; classified=${JSON.stringify(classified)})`
);
ok(
  !apiNames.some((n) => /tech|research|expense|job\s*discover|code\s*assist/i.test(String(n))),
  `not tech/expense/code (names=${apiNames.join(', ')})`
);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('PASS');

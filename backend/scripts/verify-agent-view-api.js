/**
 * Authenticated API check for the Agent View / budgets / org-members endpoints.
 * Mints a session for the first CEO and exercises each route.
 *
 * Usage: node backend/scripts/verify-agent-view-api.js [baseUrl]
 */
import { getDb, initDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';

const BASE = (process.argv[2] || process.env.API_BASE || 'http://127.0.0.1:3001/api').replace(/\/$/, '');

async function call(path, token, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, body };
}

function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  initDb();
  const ceo = getDb()
    .prepare("SELECT id, email FROM platform_users WHERE role = 'ceo' ORDER BY rowid LIMIT 1")
    .get();
  if (!ceo) {
    console.error('[verify] no CEO user found');
    process.exit(2);
  }
  const { token } = createSession(ceo.id);
  console.log(`[verify] base=${BASE} ceo=${ceo.id}`);

  const unauth = await call('/org-members', null);
  check('GET /org-members unauthenticated is rejected', unauth.status === 401, `status=${unauth.status}`);

  const members = await call('/org-members', token);
  check('GET /org-members', members.status === 200, `count=${members.body?.members?.length ?? 'n/a'}`);

  const effAgents = await call('/efficiency/agents', token);
  const list = effAgents.body?.members || [];
  check('GET /efficiency/agents', effAgents.status === 200 && Array.isArray(list), `count=${list.length}`);

  const first = list[0];
  if (!first) {
    console.log('[verify] no members for this CEO — skipping detail checks');
    return;
  }
  const key = encodeURIComponent(first.member_key);

  const detail = await call(`/efficiency/agents/${key}?days=30`, token);
  const d = detail.body || {};
  check(
    `GET /efficiency/agents/${first.member_key}`,
    detail.status === 200 && !!d.totals && Array.isArray(d.timeline),
    `prompts=${d.totals?.prompts ?? '?'} tokens=${d.totals?.tokens ?? '?'} points=${d.timeline?.length ?? '?'}`
  );
  check('detail includes budget block', !!d.budget, `state=${d.budget?.state}`);
  check('detail includes resolved member', d.member?.member_key === first.member_key);
  check('detail includes top tools array', Array.isArray(d.top_tools));

  const put = await call(`/efficiency/agents/${key}/budget`, token, {
    method: 'PUT',
    body: JSON.stringify({ monthly_token_budget: 250000, error_budget_pct: 5 }),
  });
  check('PUT /efficiency/agents/:memberKey/budget', put.status === 200, `state=${put.body?.status?.state}`);
  check(
    'budget persisted',
    Number(put.body?.budget?.monthly_token_budget) === 250000,
    `value=${put.body?.budget?.monthly_token_budget}`
  );

  const bad = await call('/efficiency/agents/__not_a_member__?days=30', token);
  check('unknown member is rejected', bad.status === 404 || bad.status === 400, `status=${bad.status}`);

  console.log(process.exitCode ? '[verify] FAILURES above' : '[verify] PASS');
}

main().catch((e) => {
  console.error('[verify] error:', e?.message || e);
  process.exit(1);
});

/**
 * Full regression pack — post-CEO-login platform coverage (no admin / onboarding).
 * Includes security hardening checks + core API surfaces.
 *
 *   node tests/regression-full.js
 * Optional: REGRESSION_IBKR=1 to hit IBKR analytics/validate (needs gateway when live).
 */
import { ceoLogin, createRunner, request, apiBase } from './lib/ceo-session.js';

const runner = createRunner('full');

function loadInternalToken() {
  return String(process.env.AGENT_OS_INTERNAL_TOKEN || '').trim();
}

async function main() {
  console.log('Agent OS full regression (post CEO login)\n');
  console.log(`BASE ${apiBase()}\n`);

  await runner.expectStatus('health', 'GET', '/health', {}, 200);

  let token;
  let user;
  await runner.check('CEO login', async () => {
    const session = await ceoLogin();
    token = session.token;
    user = session.user;
  });
  if (!token) {
    process.exit(runner.summary());
    return;
  }

  // --- Auth / session ---
  await runner.check('GET /api/auth/me shape', async () => {
    const { status, data } = await request('GET', '/api/auth/me', { token });
    if (status !== 200) throw new Error(`status ${status}`);
    if (!data.user?.id) throw new Error('missing user');
    if (!Array.isArray(data.agents)) throw new Error('agents not array');
  });
  await runner.expectStatus('MFA status', 'GET', '/api/auth/mfa/status', { token }, 200);

  // --- Agents ---
  let agentId = null;
  await runner.check('agents list + get', async () => {
    const { status, data } = await request('GET', '/api/agents', { token });
    if (status !== 200 || !Array.isArray(data)) throw new Error(`bad list ${status}`);
    if (!data.length) throw new Error('no agents');
    agentId = data[0].id;
    const one = await request('GET', `/api/agents/${agentId}`, { token });
    if (one.status !== 200) throw new Error(`get agent ${one.status}`);
  });
  if (agentId) {
    await runner.expectStatus('agent tools', 'GET', `/api/agents/${agentId}/tools`, { token }, 200);
    await runner.expectStatus(
      'agent workspace files',
      'GET',
      `/api/agents/${agentId}/workspace/files`,
      { token },
      [200, 500] // 500 if workspace path unset
    );
  }

  // --- Standups / Kanban / Cron (auth) ---
  await runner.expectStatus('standups list', 'GET', '/api/standups', { token }, 200);
  await runner.expectStatus('standups notifications', 'GET', '/api/standups/notifications', { token }, 200);
  await runner.expectStatus('kanban', 'GET', '/api/kanban/tasks', { token }, 200);
  await runner.expectStatus(
    'cron process-delegations (auth)',
    'POST',
    '/api/cron/process-delegations',
    { token, body: {} },
    200
  );

  // --- Workflows ---
  await runner.expectStatus('workflow task types', 'GET', '/api/agent-workflows/meta/task-types', { token }, 200);
  await runner.expectStatus('workflows list', 'GET', '/api/agent-workflows', { token }, 200);
  await runner.expectStatus('workflow templates', 'GET', '/api/agent-workflows/meta/templates', { token }, [200, 404]);

  // --- Job applicant ---
  await runner.expectStatus('job profiles', 'GET', '/api/job-applicant/profiles', { token }, 200);

  // --- Tools / workspace ---
  await runner.expectStatus('tools meta', 'GET', '/api/tools/meta', { token }, 200);
  await runner.expectStatus('workspace files', 'GET', '/api/workspace/files', { token }, [200, 500]);

  // --- Integrations (CEO) ---
  await runner.expectStatus('MCP integrations', 'GET', '/api/integrations/mcp', { token }, 200);
  await runner.expectStatus('custom scripts', 'GET', '/api/integrations/custom-scripts', { token }, 200);
  await runner.expectStatus('external agents', 'GET', '/api/integrations/external-agents', { token }, 200);

  // --- Efficiency Agent View + budgets + org leaf members ---
  await runner.expectStatus('efficiency summary', 'GET', '/api/efficiency/summary?days=14', { token }, 200);
  await runner.expectStatus('efficiency agents list', 'GET', '/api/efficiency/agents', { token }, 200);
  await runner.expectStatus('org-members list', 'GET', '/api/org-members', { token }, 200);
  await runner.expectStatus('org-members unauth → 401', 'GET', '/api/org-members', {}, 401);
  await runner.expectStatus('efficiency agents unauth → 401', 'GET', '/api/efficiency/agents', {}, 401);
  await runner.check('Agent View for first member + unknown rejected', async () => {
    const list = await request('GET', '/api/efficiency/agents', { token });
    if (list.status !== 200 || !Array.isArray(list.data?.members)) {
      throw new Error(`bad agents list ${list.status}`);
    }
    if (!list.data.members.length) throw new Error('no efficiency members');
    const key = list.data.members[0].member_key;
    const detail = await request('GET', `/api/efficiency/agents/${encodeURIComponent(key)}?days=30`, { token });
    if (detail.status !== 200) throw new Error(`detail ${detail.status}`);
    if (!detail.data?.totals || !Array.isArray(detail.data.timeline)) {
      throw new Error('detail missing totals/timeline');
    }
    if (!detail.data.budget) throw new Error('detail missing budget');
    if (detail.data.member?.member_key !== key) throw new Error('detail member mismatch');
    const unknown = await request('GET', '/api/efficiency/agents/__regression_missing__?days=30', { token });
    if (unknown.status !== 404) throw new Error(`expected 404 for unknown member, got ${unknown.status}`);
  });
  await runner.check('budget PUT round-trip for first member', async () => {
    const list = await request('GET', '/api/efficiency/agents', { token });
    const key = list.data?.members?.[0]?.member_key;
    if (!key) throw new Error('no member for budget put');
    const put = await request('PUT', `/api/efficiency/agents/${encodeURIComponent(key)}/budget`, {
      token,
      body: { monthly_token_budget: 250000, error_budget_pct: 5 },
    });
    if (put.status !== 200) throw new Error(`budget put ${put.status}`);
    if (Number(put.data?.budget?.monthly_token_budget) !== 250000) {
      throw new Error(`budget not persisted: ${JSON.stringify(put.data?.budget)}`);
    }
  });

  // --- IBKR ---
  await runner.expectStatus('IBKR config', 'GET', '/api/ibkr-trading/config', { token }, 200);
  await runner.expectStatus('IBKR day status', 'GET', '/api/ibkr-trading/day-status', { token }, 200);
  if (process.env.REGRESSION_IBKR === '1') {
    await runner.expectStatus(
      'IBKR analytics summary',
      'GET',
      '/api/ibkr-trading/analytics/summary?include_live=0',
      { token },
      200
    );
    await runner.expectStatus(
      'IBKR validate empty plan',
      'POST',
      '/api/ibkr-trading/validate-plan',
      { token, body: { trades_to_place: [], residual: [] } },
      [200, 400]
    );
  }

  // --- Security hardening ---
  await runner.expectStatus('unauth agents → 401', 'GET', '/api/agents', {}, 401);
  await runner.expectStatus('unauth standups → 401', 'GET', '/api/standups', {}, 401);
  await runner.expectStatus('unauth workspace → 401', 'GET', '/api/workspace/files', {}, 401);
  await runner.expectStatus('unauth broadcast → 401', 'POST', '/api/broadcast', { body: { message: 'x' } }, 401);
  await runner.expectStatus('unauth cron → 401', 'POST', '/api/cron/run-standup', { body: {} }, 401);
  await runner.expectStatus(
    'unauth cron-callback → 401',
    'POST',
    '/api/standups/cron-callback?standup_id=1&request_id=x&agent_id=coo&task_id=1',
    { body: {} },
    401
  );
  await runner.expectStatus(
    'x-internal-test alone rejected',
    'GET',
    '/api/ibkr-trading/config',
    { headers: { 'x-internal-test': '1' } },
    401
  );
  await runner.expectStatus(
    'body policy override ignored (still auth ok)',
    'POST',
    '/api/ibkr-trading/preflight',
    {
      token,
      body: { cash_usd: 1000, daily_budget_usd: 999999, allowlist: [{ key: 'SMART:HACK', symbol: 'HACK' }] },
    },
    [200, 400, 503]
  );

  const internalToken = loadInternalToken();
  if (internalToken) {
    await runner.expectStatus(
      'query internal_token rejected off cron-callback',
      'GET',
      `/api/ibkr-trading/config?internal_token=${encodeURIComponent(internalToken)}`,
      {},
      401
    );
    await runner.expectStatus(
      'query internal_token accepted on cron-callback path (auth ok; bad ids may 4xx)',
      'POST',
      `/api/standups/cron-callback?standup_id=1&request_id=x&agent_id=coo&task_id=1&internal_token=${encodeURIComponent(internalToken)}`,
      { body: {} },
      [200, 400, 404]
    );
    await runner.expectStatus(
      'internal token accepted on IBKR config',
      'GET',
      '/api/ibkr-trading/config',
      { headers: { 'x-agent-os-internal': internalToken } },
      200
    );
  } else {
    console.log('  SKIP internal token check (AGENT_OS_INTERNAL_TOKEN not in env/.env)');
  }

  // Path traversal on agent workspace (auth required; should 400/500 not leak)
  if (agentId) {
    await runner.check('workspace path traversal rejected', async () => {
      const { status, data } = await request(
        'GET',
        `/api/agents/${agentId}/workspace/files/${encodeURIComponent('memory/../../../../etc/passwd')}`,
        { token }
      );
      if (status === 200 && data?.text && String(data.text).includes('root:')) {
        throw new Error('path traversal leaked file contents');
      }
      if (![200, 400, 404, 500].includes(status)) throw new Error(`unexpected ${status}`);
      // empty text or error is fine
      if (status === 200 && data?.text && /root:x:/.test(data.text)) {
        throw new Error('passwd contents returned');
      }
    });
  }

  await runner.check('debug intent requires auth', async () => {
    const unauth = await request('GET', '/api/debug/intent-last', {});
    if (unauth.status !== 401) throw new Error(`expected 401 got ${unauth.status}`);
  });

  console.log(`\nCEO user: ${user?.email || user?.id}`);
  process.exit(runner.summary());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

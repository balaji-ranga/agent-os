/**
 * Full regression pack — isolated post-login platform coverage.
 * Includes semantic router contracts, Company Setup + Operate lifecycle,
 * security hardening checks, and core API surfaces.
 *
 *   node tests/regression-full.js
 * Optional: REGRESSION_IBKR=1 to hit IBKR analytics/validate (needs gateway when live).
 */
import { ceoLogin, createRunner, request, apiBase } from './lib/ceo-session.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = createRunner('full');

function loadInternalToken() {
  return String(process.env.AGENT_OS_INTERNAL_TOKEN || '').trim();
}

function runBackendScript(scriptName, expectedMarker, extraEnv = {}) {
  const testsDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(testsDir, '..');
  const script = path.join(root, 'backend', 'scripts', scriptName);
  const result = spawnSync(process.execPath, [script], {
    cwd: path.join(root, 'backend'),
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    timeout: 180000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${scriptName} exit ${result.status}`);
  if (expectedMarker && !String(result.stdout || '').includes(expectedMarker)) {
    throw new Error(`${scriptName} missing ${expectedMarker}`);
  }
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

  // --- Shared semantic router (all Dashboard agents) ---
  await runner.check('semantic router context boundaries + execution modes', async () => {
    runBackendScript('test-chat-context-boundaries.mjs', 'CHAT_CONTEXT_BOUNDARIES_OK');
  });
  await runner.check('delegation result callback correlation', async () => {
    runBackendScript('test-delegation-result-callback.mjs', 'DELEGATION_RESULT_CALLBACK_OK');
  });
  await runner.check('company setup LLM structured-output retry contract', async () => {
    runBackendScript('test-company-llm-design.mjs', 'company LLM design structured-output tests: OK');
  });

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

  // --- Fresh-company lifecycle (only the isolated fixture created by the VPS runner) ---
  if (process.env.REGRESSION_ISOLATED_USER === '1' && process.env.REGRESSION_COMPANY_LIFECYCLE !== '0') {
    await runner.expectStatus('company setup unauth → 401', 'GET', '/api/company-setup/gate', {}, 401);
    await runner.expectStatus('company operate unauth → 401', 'GET', '/api/company-operate/gate', {}, 401);
    await runner.check('company setup initial gate + operate blocked', async () => {
      const setup = await request('GET', '/api/company-setup/gate', { token });
      if (setup.status !== 200 || setup.data?.setup_gate !== 'pending' || setup.data?.needs_gate !== true) {
        throw new Error(`unexpected setup gate ${setup.status}: ${JSON.stringify(setup.data)?.slice(0, 300)}`);
      }
      const operate = await request('GET', '/api/company-operate/gate', { token });
      if (operate.status !== 200 || operate.data?.operate_gate !== 'blocked_need_company') {
        throw new Error(`unexpected pre-setup operate gate ${operate.status}: ${JSON.stringify(operate.data)?.slice(0, 300)}`);
      }
    });
    await runner.check('company setup begin → funnel → deterministic design', async () => {
      const begin = await request('POST', '/api/company-setup/begin', { token, body: {} });
      if (begin.status !== 200 || begin.data?.setup_gate !== 'in_progress') {
        throw new Error(`begin ${begin.status}: ${JSON.stringify(begin.data)?.slice(0, 300)}`);
      }
      const draft = await request('PUT', '/api/company-setup/funnel', {
        token,
        body: {
          funnel_step: 'review',
          company_type: 'saas',
          company_name: 'Flolah Regression Company',
          mission: 'Validate isolated company setup and operating-model installation.',
          describe_company: 'A small SaaS company used only for automated regression testing.',
          org_dna: 'data_driven',
          management_style: 'after_approval',
          systems: [],
          crm_provider: 'none',
          erp_provider: 'none',
        },
      });
      if (draft.status !== 200 || !Array.isArray(draft.data?.proposal?.departments) || !draft.data.proposal.departments.length) {
        throw new Error(`funnel ${draft.status}: ${JSON.stringify(draft.data)?.slice(0, 300)}`);
      }
      const design = await request('POST', '/api/company-setup/design', { token, body: {} });
      if (design.status !== 200 || !Array.isArray(design.data?.proposal?.agents) || !design.data.proposal.agents.length) {
        throw new Error(`design ${design.status}: ${JSON.stringify(design.data)?.slice(0, 300)}`);
      }
    });
    await runner.check('company setup apply completes owner-scoped company', async () => {
      const applied = await request('POST', '/api/company-setup/apply', {
        token,
        body: { confirm_override: true },
      });
      if (applied.status !== 200 || applied.data?.setup_gate !== 'completed') {
        throw new Error(`apply ${applied.status}: ${JSON.stringify(applied.data)?.slice(0, 500)}`);
      }
      if (!applied.data?.applied || !applied.data?.day1) throw new Error('company apply result missing applied/day1 evidence');
    });
    await runner.check('company operate Day 0 design + confirm', async () => {
      const gate = await request('GET', '/api/company-operate/gate', { token });
      if (gate.status !== 200 || gate.data?.operate_gate !== 'pending' || gate.data?.company_formed !== true) {
        throw new Error(`operate gate ${gate.status}: ${JSON.stringify(gate.data)?.slice(0, 300)}`);
      }
      const begin = await request('POST', '/api/company-operate/begin', { token, body: {} });
      if (begin.status !== 200 || begin.data?.operate_gate !== 'in_progress') {
        throw new Error(`operate begin ${begin.status}: ${JSON.stringify(begin.data)?.slice(0, 300)}`);
      }
      const design = await request('POST', '/api/company-operate/design', {
        token,
        body: { source: 'template' },
      });
      if (design.status !== 200 || !Array.isArray(design.data?.operating_model?.loops) || !design.data.operating_model.loops.length) {
        throw new Error(`operate design ${design.status}: ${JSON.stringify(design.data)?.slice(0, 400)}`);
      }
      const draft = await request('PUT', '/api/company-operate/draft', {
        token,
        body: { operate_step: 'review', digest: { mode: 'daily', channel: 'in_app' } },
      });
      if (draft.status !== 200 || draft.data?.operate_step !== 'review') {
        throw new Error(`operate draft ${draft.status}: ${JSON.stringify(draft.data)?.slice(0, 300)}`);
      }
      const confirmed = await request('POST', '/api/company-operate/confirm', { token, body: {} });
      if (confirmed.status !== 200 || confirmed.data?.operate_gate !== 'day0_confirmed' || Number(confirmed.data?.operating_model_version) < 1) {
        throw new Error(`operate confirm ${confirmed.status}: ${JSON.stringify(confirmed.data)?.slice(0, 400)}`);
      }
    });
    await runner.check('company operate Day 1 install + idempotent replay', async () => {
      const applied = await request('POST', '/api/company-operate/apply-day1', { token, body: {} });
      if (applied.status !== 200 || applied.data?.operate_gate !== 'day1_applied') {
        throw new Error(`Day1 ${applied.status}: ${JSON.stringify(applied.data)?.slice(0, 700)}`);
      }
      if (applied.data?.day1_result?.acceptance?.ok !== true && applied.data?.day1?.acceptance?.ok !== true) {
        throw new Error('Day1 acceptance evidence missing/failed');
      }
      const replay = await request('POST', '/api/company-operate/apply-day1', { token, body: {} });
      if (replay.status !== 200 || replay.data?.idempotent !== true) {
        throw new Error(`Day1 replay not idempotent ${replay.status}: ${JSON.stringify(replay.data)?.slice(0, 400)}`);
      }
    });
  } else {
    console.log('  SKIP company lifecycle (requires REGRESSION_ISOLATED_USER=1)');
  }

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


  // --- Durable multi-intent goal plans (CRM→ERP + Platform Help specialty + notify) ---
  await runner.expectStatus('agent-goal-runs list', 'GET', '/api/agent-goal-runs?limit=5', { token }, 200);
  await runner.expectStatus('agent-goal-runs unauth → 401', 'GET', '/api/agent-goal-runs', {}, 401);
  await runner.check('goal plan adhoc e2e (CRM+ERP+Help+notify)', async () => {
    if (process.env.REGRESSION_GOAL_PLAN === '0') {
      console.log('    (skipped REGRESSION_GOAL_PLAN=0)');
      return;
    }
    runBackendScript('test-goal-plan-adhoc-e2e.mjs', 'GOAL_PLAN_ADHOC_E2E_OK', {
        REGRESSION_GOAL_PLAN_FORCE_TERMINAL: process.env.REGRESSION_GOAL_PLAN_FORCE_TERMINAL || '1',
        REGRESSION_CEO_ID: process.env.REGRESSION_CEO_ID || user?.id || '',
    });
  });

  console.log(`\nCEO user: ${user?.email || user?.id}`);
  process.exit(runner.summary());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Minimal regression pack — core platform after CEO login.
 * Excludes admin + user onboarding.
 *
 *   node tests/regression-minimal.js
 * Prereq: backend on BASE_URL (default http://127.0.0.1:3001)
 */
import { ceoLogin, createRunner, request } from './lib/ceo-session.js';

const runner = createRunner('minimal');

async function main() {
  console.log('Agent OS minimal regression (post CEO login)\n');

  await runner.expectStatus('health', 'GET', '/health', {}, 200);

  let token;
  await runner.check('CEO login', async () => {
    const session = await ceoLogin();
    token = session.token;
  });
  if (!token) {
    process.exit(runner.summary());
    return;
  }

  await runner.expectStatus('auth /me', 'GET', '/api/auth/me', { token }, 200);
  await runner.expectStatus('agents list', 'GET', '/api/agents', { token }, 200);
  await runner.expectStatus('kanban list', 'GET', '/api/kanban/tasks', { token }, 200);
  await runner.expectStatus('standups list', 'GET', '/api/standups', { token }, 200);
  await runner.expectStatus('workflows list', 'GET', '/api/agent-workflows', { token }, 200);
  await runner.expectStatus('job-applicant profiles', 'GET', '/api/job-applicant/profiles', { token }, 200);
  await runner.expectStatus('tools meta', 'GET', '/api/tools/meta', { token }, 200);
  await runner.expectStatus('IBKR config', 'GET', '/api/ibkr-trading/config', { token }, 200);
  await runner.expectStatus('MFA status', 'GET', '/api/auth/mfa/status', { token }, 200);

  // Unauthenticated must fail on protected surfaces
  await runner.expectStatus('agents unauth → 401', 'GET', '/api/agents', {}, 401);
  await runner.expectStatus('standups unauth → 401', 'GET', '/api/standups', {}, 401);
  await runner.expectStatus('cron unauth → 401', 'POST', '/api/cron/process-delegations', { body: {} }, 401);
  await runner.expectStatus(
    'legacy x-internal-test rejected on IBKR',
    'POST',
    '/api/ibkr-trading/preflight',
    { headers: { 'x-internal-test': '1', 'Content-Type': 'application/json' }, body: {} },
    401
  );

  process.exit(runner.summary());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

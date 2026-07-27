/**
 * VPS smoke: Admin Tools Onboarding (Docker) with TOTP step-up.
 * Run inside backend container.
 */
import { generateTotp } from '../src/services/auth/totp.js';
import { initDb, getDb } from '../src/db/schema.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const EMAIL = process.env.ADMIN2_EMAIL || 'admin2@agent-os.local';
const PASS = process.env.ADMIN2_PASSWORD || '';
const SECRET = process.env.ADMIN2_TOTP_SECRET || '';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function json(res) {
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  initDb();
  let secret = SECRET;
  if (!secret) {
    const row = getDb()
      .prepare("SELECT mfa_secret FROM platform_users WHERE lower(email)=?")
      .get(EMAIL.toLowerCase());
    secret = row?.mfa_secret || '';
  }
  assert(secret, 'admin2 TOTP secret missing');
  assert(PASS, 'ADMIN2_PASSWORD required');

  // Login
  let r = await json(
    await fetch(`${BASE}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASS }),
    })
  );
  let token = r.data?.session?.token || r.data?.token;
  if (r.data?.mfa_required || r.data?.mfa_setup_required) {
    const mfaToken = r.data.mfa_token;
    const code = generateTotp(secret);
    if (r.data.mfa_setup_required) {
      // finish setup if needed
      r = await json(
        await fetch(`${BASE}/api/auth/mfa/setup-challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mfa_token: mfaToken, code }),
        })
      );
    } else {
      r = await json(
        await fetch(`${BASE}/api/auth/mfa/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mfa_token: mfaToken, code }),
        })
      );
    }
    token = r.data?.session?.token || r.data?.token;
  }
  assert(token, `login failed: ${JSON.stringify(r.data)}`);
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  console.log('login ok');

  // Status
  r = await json(await fetch(`${BASE}/api/admin/tool-onboarding/status`, { headers: auth }));
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.enabled === true, 'DOCKER_TOOLS_ENABLED should be true');
  assert(r.data.docker_ok === true, `docker socket not ok: ${r.data.docker_error}`);
  console.log('status ok', { network: r.data.network_resolved, allow: r.data.registry_allow });

  // Deny without stepup
  r = await json(
    await fetch(`${BASE}/api/admin/tool-onboarding`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: 'echo_probe',
        display_name: 'Echo Probe',
        purpose: 'VPS smoke echo tool',
        image: 'ealen/echo-server:0.9.2',
        container_port: 80,
        invoke_path: '/',
        method: 'POST',
      }),
    })
  );
  assert(r.status === 401, `expected 401 without stepup, got ${r.status}`);
  console.log('deny without stepup ok');

  // Stepup
  const code = generateTotp(secret);
  r = await json(
    await fetch(`${BASE}/api/admin/tool-onboarding/stepup`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ code }),
    })
  );
  assert(r.status === 200 && r.data.stepup_token, `stepup failed ${JSON.stringify(r.data)}`);
  const stepup = r.data.stepup_token;
  console.log('stepup ok');

  // Deny non-allowlisted image
  r = await json(
    await fetch(`${BASE}/api/admin/tool-onboarding`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: 'bad_image',
        display_name: 'Bad',
        purpose: 'should fail',
        image: 'malicious.example/evil:latest',
        stepup_token: stepup,
      }),
    })
  );
  assert(r.status === 403, `expected 403 for deny image, got ${r.status} ${JSON.stringify(r.data)}`);
  console.log('registry allow-list ok');

  // Declare + deploy echo server
  r = await json(
    await fetch(`${BASE}/api/admin/tool-onboarding`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: 'echo_probe',
        display_name: 'Echo Probe',
        purpose: 'VPS smoke echo tool for Tools Onboarding',
        image: 'ealen/echo-server:0.9.2',
        container_port: 80,
        invoke_path: '/',
        method: 'POST',
        request_schema: { type: 'object' },
        response_schema: { type: 'object' },
        stepup_token: stepup,
      }),
    })
  );
  assert(r.status === 201 || r.status === 200, `declare failed ${r.status} ${JSON.stringify(r.data)}`);
  console.log('declare ok');

  r = await json(
    await fetch(`${BASE}/api/admin/tool-onboarding/echo_probe/deploy`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ stepup_token: stepup }),
    })
  );
  assert(r.status === 200 && r.data.tool?.status === 'running', `deploy failed ${r.status} ${JSON.stringify(r.data)}`);
  console.log('deploy ok', r.data.tool.endpoint);

  // No host ports
  const inspect = await fetch('http://127.0.0.1:2375/containers/json').catch(() => null);
  // use docker via backend discover
  r = await json(await fetch(`${BASE}/api/admin/tool-onboarding/discover`, { headers: auth }));
  assert(r.status === 200, 'discover failed');
  const found = (r.data.containers || []).find((c) => String(c.tool_name).includes('echo_probe'));
  assert(found, 'echo_probe container not discovered');
  console.log('discover ok', found.state || found.status);

  // Health (HTTP probe to internal container DNS)
  r = await json(await fetch(`${BASE}/api/admin/tool-onboarding/echo_probe/health`, { headers: auth }));
  assert(r.status === 200 && r.data.running === true, `health not running ${JSON.stringify(r.data)}`);
  assert(r.data.http?.ok === true, `health HTTP failed ${JSON.stringify(r.data.http || r.data)}`);
  console.log('health ok', r.data.http);

  // Content tools meta lists it
  r = await json(await fetch(`${BASE}/api/tools/meta`, { headers: auth }));
  const meta = (r.data || r.data?.tools || []).find?.((t) => t.name === 'echo_probe') ||
    (Array.isArray(r.data) ? r.data.find((t) => t.name === 'echo_probe') : null);
  // tools/meta returns array directly typically
  const list = Array.isArray(r.data) ? r.data : r.data?.tools || [];
  assert(list.some((t) => t.name === 'echo_probe'), `echo_probe missing from content tools meta: ${JSON.stringify(r.data).slice(0, 200)}`);
  console.log('content tools registry ok');

  // Invoke via tools/test (admin session) — facade
  r = await json(
    await fetch(`${BASE}/api/tools/test/echo_probe`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ hello: 'tools-onboarding', n: 1 }),
    })
  );
  assert(r.status === 200, `tools/test failed ${r.status} ${JSON.stringify(r.data)}`);
  console.log('facade invoke ok');

  // Cleanup stop+delete
  await json(
    await fetch(`${BASE}/api/admin/tool-onboarding/echo_probe/stop`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ stepup_token: stepup }),
    })
  );
  r = await json(
    await fetch(`${BASE}/api/admin/tool-onboarding/echo_probe?remove_content_tool=1&stepup_token=${encodeURIComponent(stepup)}`, {
      method: 'DELETE',
      headers: auth,
    })
  );
  assert(r.status === 200, `delete failed ${r.status}`);
  console.log('cleanup ok');
  console.log('TOOLS_ONBOARDING_VPS_OK');
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
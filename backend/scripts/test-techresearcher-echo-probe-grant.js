/**
 * Deploy echo_probe, grant via Agent Workspace tools API (CEO Balaji → TechResearcher), invoke as tenant agent.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { generateTotp } from '../src/services/auth/totp.js';
import { tenantOpenClawAgentId } from '../src/services/openclaw-tenant.js';
import { getAgentToolGrants } from '../src/services/openclaw-agent-tools.js';

initDb();
const db = getDb();
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const TOOL = 'echo_probe';
const AGENT_ID = 'techresearcher';
const CEO_ID = 'ceo-bala';
const ADMIN_EMAIL = process.env.ADMIN2_EMAIL || 'admin2@agent-os.local';
const ADMIN_PASS = process.env.ADMIN2_PASSWORD || '';
const ADMIN_SECRET = process.env.ADMIN2_TOTP_SECRET || '';

function assert(c, m) {
  if (!c) throw new Error(m);
}

async function json(res) {
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function adminLogin() {
  let secret = ADMIN_SECRET;
  if (!secret) {
    secret =
      db.prepare('SELECT mfa_secret FROM platform_users WHERE lower(email)=?').get(ADMIN_EMAIL.toLowerCase())
        ?.mfa_secret || '';
  }
  assert(secret && ADMIN_PASS, 'admin2 creds required');
  let r = await json(
    await fetch(`${BASE}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    })
  );
  let token = r.data?.session?.token || r.data?.token;
  if (r.data?.mfa_required || r.data?.mfa_setup_required) {
    const mfaToken = r.data.mfa_token;
    const code = generateTotp(secret);
    const path = r.data.mfa_setup_required ? '/api/auth/mfa/setup-challenge' : '/api/auth/mfa/verify';
    r = await json(
      await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_token: mfaToken, code }),
      })
    );
    token = r.data?.session?.token || r.data?.token;
  }
  assert(token, `admin login failed ${JSON.stringify(r.data)}`);
  return { token, secret };
}

async function main() {
  const ceo = db.prepare('SELECT id, name, email FROM platform_users WHERE id=?').get(CEO_ID);
  assert(ceo, 'ceo-bala missing');
  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(AGENT_ID);
  assert(agent, 'techresearcher missing');
  const entitled = db
    .prepare('SELECT 1 AS ok FROM user_agents WHERE user_id=? AND agent_id=? AND enabled=1')
    .get(CEO_ID, AGENT_ID);
  assert(entitled, 'techresearcher not granted to ceo-bala');

  // --- Admin: ensure tool running ---
  const { token: adminToken, secret } = await adminLogin();
  const adminAuth = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  let r = await json(
    await fetch(`${BASE}/api/admin/tool-onboarding/stepup`, {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({ code: generateTotp(secret) }),
    })
  );
  assert(r.data?.stepup_token, `stepup failed ${JSON.stringify(r.data)}`);
  const stepup = r.data.stepup_token;

  r = await json(await fetch(`${BASE}/api/admin/tool-onboarding/${TOOL}`, { headers: adminAuth }));
  if (r.status === 404) {
    r = await json(
      await fetch(`${BASE}/api/admin/tool-onboarding`, {
        method: 'POST',
        headers: adminAuth,
        body: JSON.stringify({
          name: TOOL,
          display_name: 'Echo Probe',
          purpose: 'Docker onboarding smoke tool for TechResearcher grant test',
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
    assert(r.status === 201 || r.status === 200, `declare ${r.status} ${JSON.stringify(r.data)}`);
    console.log('declared', TOOL);
  } else {
    console.log('already declared', TOOL, r.data?.tool?.status || r.data?.status);
  }

  r = await json(
    await fetch(`${BASE}/api/admin/tool-onboarding/${TOOL}/deploy`, {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({ stepup_token: stepup }),
    })
  );
  assert(r.status === 200 && r.data.tool?.status === 'running', `deploy ${r.status} ${JSON.stringify(r.data)}`);
  console.log('deployed', r.data.tool.endpoint);

  // --- CEO Balaji: Agent Workspace tool access (same as frontend PUT /agents/:id/tools) ---
  const { token: ceoToken } = createSession(CEO_ID, { userAgent: 'workspace-tool-grant-test' });
  const ceoAuth = { Authorization: `Bearer ${ceoToken}`, 'Content-Type': 'application/json' };

  r = await json(await fetch(`${BASE}/api/agents/${AGENT_ID}/tools`, { headers: ceoAuth }));
  assert(r.status === 200, `GET tools ${r.status} ${JSON.stringify(r.data)}`);
  const before = new Set(r.data.grants || []);
  console.log('grants before', [...before].sort().join(',') || '(none)');
  assert(
    (r.data.tools || []).some((t) => t.name === TOOL),
    `${TOOL} not in content tools catalog for workspace UI`
  );

  // Deny invoke before grant
  const toolsKey = process.env.TOOLS_API_KEY || '';
  assert(toolsKey, 'TOOLS_API_KEY required');
  const tenantOcId = tenantOpenClawAgentId(CEO_ID, agent.openclaw_agent_id || AGENT_ID);
  console.log('tenant openclaw id', tenantOcId);

  r = await json(
    await fetch(`${BASE}/api/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${toolsKey}`,
        'x-openclaw-agent-id': tenantOcId,
        'x-ceo-user-id': CEO_ID,
      },
      body: JSON.stringify({ tool_name: TOOL, probe: 'pre-grant', from: 'techresearcher' }),
    })
  );
  assert(r.status === 403, `expected 403 before grant, got ${r.status} ${JSON.stringify(r.data)}`);
  console.log('deny before grant ok');

  const nextGrants = [...new Set([...before, TOOL])];
  r = await json(
    await fetch(`${BASE}/api/agents/${AGENT_ID}/tools`, {
      method: 'PUT',
      headers: ceoAuth,
      body: JSON.stringify({ tools: nextGrants, sync_tools_md: true }),
    })
  );
  assert(r.status === 200, `PUT tools ${r.status} ${JSON.stringify(r.data)}`);
  assert((r.data.grants || []).includes(TOOL), 'echo_probe not in saved grants');
  const catalog = (r.data.tools || []).find((t) => t.name === TOOL);
  assert(catalog?.granted === true, 'catalog.granted should be true after save');
  console.log('workspace tool access saved (sync_tools_md=true)');
  console.log('db grants', getAgentToolGrants(AGENT_ID).join(','));

  // Invoke as TechResearcher (OpenClaw plugin path)
  r = await json(
    await fetch(`${BASE}/api/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${toolsKey}`,
        'x-openclaw-agent-id': tenantOcId,
        'x-ceo-user-id': CEO_ID,
      },
      body: JSON.stringify({
        tool_name: TOOL,
        probe: 'post-grant',
        from: 'techresearcher',
        ceo: 'Balaji Ranganathan',
      }),
    })
  );
  assert(r.status === 200, `invoke failed ${r.status} ${JSON.stringify(r.data)}`);
  console.log('invoke ok keys', Object.keys(r.data || {}).slice(0, 8).join(','));
  console.log(
    'echo body snippet',
    JSON.stringify(r.data?.request?.body || r.data?.http || r.data).slice(0, 240)
  );

  console.log('TECHRESEARCHER_ECHO_PROBE_OK', {
    ceo: ceo.name,
    agent: agent.name,
    tenantOcId,
    tool: TOOL,
    endpoint: r.data?.host?.hostname || '(echo response)',
  });
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
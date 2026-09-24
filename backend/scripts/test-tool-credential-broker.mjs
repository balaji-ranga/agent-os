import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-tool-broker-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.OPENCLAW_DIR = join(root, 'openclaw');
process.env.TOOLS_LEGACY_FTC_ENABLED = '0';

let failed = 0;
let openedDb = null;
function check(value, message) {
  if (value) console.log(`OK: ${message}`);
  else {
    failed += 1;
    console.error(`FAIL: ${message}`);
  }
}

try {
  const { initDb, getDb } = await import('../src/db/schema.js');
  const {
    getToolBrokerSecret,
    issueToolCredentialLease,
    legacyToolCredentialsEnabled,
    revokeAllToolCredentialLeases,
    verifyToolBrokerSecret,
    verifyToolScopedToken,
  } = await import('../src/services/tool-scoped-token.js');
  const { platformRuntimeSecretStatus, rotatePlatformRuntimeSecret } = await import('../src/services/platform-runtime-secrets.js');
  const {
    mergeOpenClawAllowList,
    SENSITIVE_OPENCLAW_RUNTIME_TOOLS,
  } = await import('../src/services/openclaw-runtime-tools.js');
  const { tenantOpenClawAgentId } = await import('../src/services/openclaw-tenant.js');
  const { requireToolsAccess } = await import('../src/middleware/tools-auth.js');

  initDb();
  const db = getDb();
  openedDb = db;
  db.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role,enabled)
    VALUES (?,?,?,?,?,1)`).run('ceo-a', 'a@test.local', 'x', 'CEO A', 'ceo');
  db.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role,enabled)
    VALUES (?,?,?,?,?,1)`).run('ceo-b', 'b@test.local', 'x', 'CEO B', 'ceo');
  db.prepare(`INSERT INTO agents (id,name,openclaw_agent_id,is_coo) VALUES (?,?,?,1)`)
    .run('balserve', 'COO', 'balserve');
  db.prepare(`INSERT INTO user_agents (user_id,agent_id,enabled) VALUES (?,?,1)`).run('ceo-a', 'balserve');
  db.prepare(`INSERT INTO user_agents (user_id,agent_id,enabled) VALUES (?,?,1)`).run('ceo-b', 'balserve');

  const agentA = tenantOpenClawAgentId('ceo-a', 'balserve');
  const agentB = tenantOpenClawAgentId('ceo-b', 'balserve');
  const sessionA = `agent:${agentA}:agent-os-user-ceo-a`;
  const broker = getToolBrokerSecret();
  check(broker.length >= 32, 'broker secret is generated in the protected runtime store');
  check(verifyToolBrokerSecret(broker), 'broker secret verifies');
  check(!verifyToolBrokerSecret(`${broker}x`), 'wrong broker secret is rejected');

  const lease = issueToolCredentialLease({
    ownerUserId: 'ceo-a', agentId: agentA, sessionKey: sessionA, toolName: 'ceo_profile', ttlSec: 60,
  });
  const valid = verifyToolScopedToken(lease.token, { requestedTool: 'ceo_profile', sessionKey: sessionA });
  check(valid?.ownerUserId === 'ceo-a' && valid?.agentId === agentA, 'lease binds owner and caller agent');
  check(!verifyToolScopedToken(lease.token, { requestedTool: 'crm_search', sessionKey: sessionA }), 'lease cannot call another tool');
  check(!verifyToolScopedToken(lease.token, { requestedTool: 'ceo_profile', sessionKey: `agent:${agentB}:main` }), 'lease cannot cross sessions or tenants');
  db.prepare(`UPDATE tool_credential_leases SET expires_at = ? WHERE token_prefix = ?`)
    .run(new Date(Date.now() - 1000).toISOString(), lease.token.slice(0, 12));
  check(!verifyToolScopedToken(lease.token, { requestedTool: 'ceo_profile', sessionKey: sessionA }), 'expired ISO timestamp lease is rejected');
  check(!legacyToolCredentialsEnabled(), 'legacy ftc authentication is disabled by default');

  const routeLease = issueToolCredentialLease({
    ownerUserId: 'ceo-a', agentId: agentA, sessionKey: sessionA, toolName: 'ceo_profile', ttlSec: 60,
  });
  const authRequest = (path) => ({
    path,
    url: path,
    body: { tool_name: 'ceo_profile', caller_agent_id: agentA },
    headers: {
      authorization: `Bearer ${routeLease.token}`,
      'x-openclaw-agent-id': agentA,
      'x-openclaw-session-key': sessionA,
      'x-ceo-user-id': 'ceo-a',
    },
    socket: { remoteAddress: '172.18.0.10' },
  });
  let directStatus = 0;
  let directNext = false;
  requireToolsAccess(authRequest('/ceo-profile'), {
    status(code) { directStatus = code; return this; },
    json() { return this; },
  }, () => { directNext = true; });
  check(directStatus === 401 && !directNext, 'short-lived lease cannot authenticate a direct tool route');
  let invokeNext = false;
  requireToolsAccess(authRequest('/invoke'), {
    status() { return this; },
    json() { return this; },
  }, () => { invokeNext = true; });
  check(invokeNext, 'short-lived lease authenticates the canonical /invoke dispatcher');

  const allow = mergeOpenClawAllowList(
    ['read', 'write', 'exec', 'process', 'sessions_history'],
    ['ceo_profile'],
    { dropBrowser: true }
  );
  check(SENSITIVE_OPENCLAW_RUNTIME_TOOLS.every((tool) => !allow.includes(tool)), 'tenant allowlist strips filesystem and command tools');
  check(allow.includes('read') && allow.includes('sessions_history') && allow.includes('ceo_profile'), 'workspace read, safe runtime, and granted content tools remain available');

  const freshLease = issueToolCredentialLease({
    ownerUserId: 'ceo-a', agentId: agentA, sessionKey: sessionA, toolName: 'ceo_profile', ttlSec: 60,
  });
  const revoked = revokeAllToolCredentialLeases();
  check(revoked >= 1, 'active leases can be revoked during rotation');
  check(!verifyToolScopedToken(freshLease.token, { requestedTool: 'ceo_profile', sessionKey: sessionA }), 'revoked lease no longer authenticates');
  const oldBroker = broker;
  rotatePlatformRuntimeSecret('tool_broker');
  check(!verifyToolBrokerSecret(oldBroker), 'broker rotation invalidates the previous broker secret');
  check(!JSON.stringify(platformRuntimeSecretStatus()).includes(oldBroker), 'security status never returns secret values');

  const plugin = readFileSync(join(process.cwd(), '..', 'openclaw-extensions', 'agent-os-content-tools', 'index.js'), 'utf8');
  check(plugin.includes('/api/tools/lease'), 'OpenClaw plugin requests short-lived leases');
  check(!plugin.includes('agent-os-tool-credentials.json'), 'OpenClaw plugin no longer reads the shared ftc credential file');
  check(!plugin.includes(':tenant-scoped`'), 'OpenClaw plugin never fabricates a session key');
  check(!/const fromParams\s*=/.test(plugin), 'model parameters cannot override trusted caller identity');
  check(
    plugin.includes('"__openclaw_agent_id", "caller_agent_id", "agent_id"'),
    'caller identity fields are hidden from the model-visible schema'
  );
} finally {
  try { openedDb?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log('Tool credential broker harness passed.');

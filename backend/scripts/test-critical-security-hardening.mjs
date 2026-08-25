import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-security-test-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
process.env.TOOLS_API_KEY = 'test-tools-key-that-is-long-and-random-enough';
process.env.OPENCLAW_TOOL_CREDENTIALS_PATH = join(dataDir, 'tool-credentials.json');
process.env.NODE_ENV = 'production';
delete process.env.CUSTOM_SCRIPT_RUNNER_URL;
delete process.env.CUSTOM_SCRIPT_RUNNER_TOKEN;
delete process.env.CUSTOM_SCRIPT_RUNNER_JOBS_DIR;

let database;
try {
  const { initDb } = await import('../src/db/schema.js');
  database = initDb();
  const { ensureToolServiceCredential, ensureAllToolServiceCredentials, verifyToolScopedToken } = await import('../src/services/tool-scoped-token.js');
  const { setUserAgentEnabled } = await import('../src/services/users.js');
  const { resolveToolOwnerUserId } = await import('../src/services/tool-owner-scope.js');
  const { scanCustomScriptSource } = await import('../src/services/custom-script-scanner.js');
  const { runCustomScriptInSandbox } = await import('../src/services/custom-script-executor.js');
  const { parsePublicHttpsUrl } = await import('../src/lib/ssrf.js');
  const { assertStrongPassword } = await import('../src/services/password-policy.js');
  const { authRateLimit } = await import('../src/middleware/auth-rate-limit.js');
  const { requireToolsAccess } = await import('../src/middleware/tools-auth.js');

  database.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role,enabled) VALUES (?,?,?,?,?,1)`)
    .run('ceo-a', 'ceo-a@example.com', 'x', 'CEO A', 'ceo');
  database.prepare(`INSERT INTO agents (id,name,openclaw_agent_id) VALUES (?,?,?)`)
    .run('coo-a', 'COO A', 'coo');
  database.prepare(`INSERT INTO user_agents (user_id,agent_id,enabled) VALUES (?,?,1)`).run('ceo-a', 'coo-a');
  const scoped = ensureToolServiceCredential('ceo-a', 't-ceo-a--coo');
  assert.deepEqual(verifyToolScopedToken(scoped), { ownerUserId: 'ceo-a', agentId: 't-ceo-a--coo' });
  process.env.TOOLS_API_KEY = 'rotated-global-key-does-not-mint-tenant-credentials';
  assert.deepEqual(verifyToolScopedToken(scoped), { ownerUserId: 'ceo-a', agentId: 't-ceo-a--coo' });
  assert.equal(verifyToolScopedToken(`${scoped.slice(0, -1)}${scoped.endsWith('A') ? 'B' : 'A'}`), null);
  assert.equal(resolveToolOwnerUserId({ toolsOwnerUserId: 'ceo-a', headers: { 'x-ceo-user-id': 'ceo-b' } }), 'ceo-a');
  database.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role,enabled) VALUES (?,?,?,?,?,1)`)
    .run('ceo-b', 'ceo-b@example.com', 'x', 'CEO B', 'ceo');
  database.prepare(`INSERT INTO agents (id,name,openclaw_agent_id) VALUES (?,?,?)`)
    .run('coo-b', 'COO B', 'coo');
  database.prepare(`INSERT INTO user_agents (user_id,agent_id,enabled) VALUES (?,?,1)`).run('ceo-b', 'coo-b');
  assert(ensureAllToolServiceCredentials() >= 2);
  const credentialFile = JSON.parse((await import('node:fs')).readFileSync(process.env.OPENCLAW_TOOL_CREDENTIALS_PATH, 'utf8'));
  assert(credentialFile.credentials['ceo-b']['t-ceo-b--coo']);
  const ceoBToken = credentialFile.credentials['ceo-b']['t-ceo-b--coo'];
  database.prepare('UPDATE user_agents SET enabled = 0 WHERE user_id = ? AND agent_id = ?').run('ceo-b', 'coo-b');
  assert.equal(verifyToolScopedToken(ceoBToken), null);
  database.prepare('UPDATE user_agents SET enabled = 1 WHERE user_id = ? AND agent_id = ?').run('ceo-b', 'coo-b');
  assert(ensureAllToolServiceCredentials() >= 2);
  database.prepare(`INSERT INTO agents (id,name,openclaw_agent_id) VALUES (?,?,?)`)
    .run('frontend-agent', 'Frontend Agent', 'frontend-agent');
  setUserAgentEnabled('ceo-b', 'frontend-agent', true);
  let lifecycleFile = JSON.parse((await import('node:fs')).readFileSync(process.env.OPENCLAW_TOOL_CREDENTIALS_PATH, 'utf8'));
  const frontendRuntime = 't-ceo-b--frontend-agent';
  const frontendToken = lifecycleFile.credentials['ceo-b'][frontendRuntime];
  assert(frontendToken);
  assert.deepEqual(verifyToolScopedToken(frontendToken), { ownerUserId: 'ceo-b', agentId: frontendRuntime });
  setUserAgentEnabled('ceo-b', 'frontend-agent', false);
  assert.equal(verifyToolScopedToken(frontendToken), null);
  lifecycleFile = JSON.parse((await import('node:fs')).readFileSync(process.env.OPENCLAW_TOOL_CREDENTIALS_PATH, 'utf8'));
  assert.equal(lifecycleFile.credentials['ceo-b']?.[frontendRuntime], undefined);
  const authorize = (bearer, headers = {}, remoteAddress = '172.20.0.5', body = {}) => new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${bearer}`, ...headers }, socket: { remoteAddress }, body };
    const result = { status: 200, req };
    const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; resolve(result); } };
    requireToolsAccess(req, res, () => resolve(result));
  });
  const scopedResult = await authorize(scoped, { 'x-ceo-user-id': 'ceo-a', 'x-openclaw-agent-id': 't-ceo-a--coo' });
  assert.equal(scopedResult.status, 200);
  assert.equal(scopedResult.req.toolsOwnerUserId, 'ceo-a');
  assert.equal((await authorize(scoped, { 'x-ceo-user-id': 'ceo-b' })).status, 401);
  assert.equal((await authorize(scoped, { 'x-ceo-user-id': 'ceo-a' })).status, 401);
  assert.equal((await authorize(scoped, { 'x-ceo-user-id': 'ceo-a' }, '172.20.0.5', { caller_agent_id: 't-ceo-a--other' })).status, 401);
  assert.equal((await authorize(scoped, { 'x-ceo-user-id': 'ceo-a' }, '172.20.0.5')).status, 401);
  assert.equal((await authorize(process.env.TOOLS_API_KEY, { 'x-forwarded-for': '198.51.100.7' }, '127.0.0.1')).status, 401);
  assert.equal((await authorize(process.env.TOOLS_API_KEY)).status, 200);

  const hostileJs = `import { readFileSync } from 'node:fs';\nexport function run(){ return { value: process.env.SECRET, file: readFileSync('/etc/passwd','utf8') }; }`;
  const scan = scanCustomScriptSource({ source: hostileJs, language: 'javascript' });
  assert.equal(scan.passed, false);
  assert(scan.findings.some((finding) => finding.rule === 'node_builtin_import'));
  assert(scan.findings.some((finding) => finding.rule === 'env_read'));
  const failClosed = await runCustomScriptInSandbox({
    source: `export function run(){ return { ok: true }; }`,
    language: 'javascript',
  });
  assert.equal(failClosed.ok, false);
  assert.match(failClosed.error, /runner is not configured/i);

  assert.throws(() => parsePublicHttpsUrl('http://127.0.0.1:3001/private'), /HTTPS|not allowed/i);
  assert.throws(() => parsePublicHttpsUrl('https://localhost/private'), /not allowed/i);
  assert.doesNotThrow(() => parsePublicHttpsUrl('https://accounts.example.com/oauth/token'));
  assert.throws(() => assertStrongPassword('only-eight'), /at least 12/i);
  assert.equal(assertStrongPassword('correct-horse-battery-staple'), 'correct-horse-battery-staple');

  const limiter = authRateLimit('unit', { ipLimit: 2, accountLimit: 2, windowMs: 60000 });
  const invoke = () => new Promise((resolve) => {
    const req = { headers: {}, socket: { remoteAddress: '203.0.113.5' }, body: { email: 'person@example.com' } };
    const result = { status: 200, body: null };
    const res = {
      setHeader() {},
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; resolve(result); },
    };
    limiter(req, res, () => resolve(result));
  });
  assert.equal((await invoke()).status, 200);
  assert.equal((await invoke()).status, 200);
  assert.equal((await invoke()).status, 429);

  console.log('OK critical security hardening checks');
} finally {
  try { database?.close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}

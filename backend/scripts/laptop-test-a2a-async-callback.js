/**
 * Laptop client: invoke VPS async A2A agent, test enquire + callback inbox.
 *
 *   node backend/scripts/laptop-test-a2a-async-callback.js --publish-id <id>
 *   # or: $env:A2A_ENDPOINT="https://flolah.cloud/api/a2a/<id>"
 */
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';

const PUBLIC = String(process.env.AGENT_OS_PUBLIC_URL || 'https://flolah.cloud').replace(/\/$/, '');
const HOST = process.env.VPS_SSH_HOST || '76.13.209.30';
const KEY = process.env.VPS_SSH_KEY || `${process.env.USERPROFILE || process.env.HOME}\\.ssh\\agent-os-vps`;
const REMOTE = process.env.VPS_REMOTE_ROOT || '/opt/agent-os';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

let endpoint = process.env.A2A_ENDPOINT || argValue('--endpoint');
const publishIdArg = process.env.A2A_PUBLISH_ID || argValue('--publish-id');
if (!endpoint && publishIdArg) endpoint = `${PUBLIC}/api/a2a/${publishIdArg}`;
if (!endpoint) {
  console.error('Set A2A_ENDPOINT or --publish-id');
  process.exit(1);
}
endpoint = endpoint.replace(/\/$/, '');
const publishId = endpoint.split('/').pop();

function ssh(cmd) {
  const r = spawnSync(
    'ssh',
    ['-i', KEY, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', `root@${HOST}`, cmd],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error(`ssh failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

async function rpc(method, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

console.log('==> Laptop → VPS async A2A test');
console.log('    endpoint:', endpoint);

const send = await rpc('message/send', {
  message: {
    role: 'user',
    messageId: randomUUID(),
    parts: [{ kind: 'text', text: 'laptop async callback enquire test' }],
  },
  metadata: { skillId: 'default' },
});
if (send.json.error) {
  console.error('FAIL message/send', send.json.error);
  process.exit(1);
}
const taskId = send.json.result?.task?.id;
const state0 = send.json.result?.task?.status?.state;
console.log('PASS async accept:', { state: state0, taskId, run_id: send.json.result?.metadata?.run_id });
if (state0 !== 'working' || !taskId) {
  console.error('FAIL expected working + task id');
  process.exit(1);
}

let enquireState = null;
let enquirePayload = null;
for (let i = 0; i < 40; i += 1) {
  const eg = await rpc('tasks/get', { id: taskId });
  if (eg.json.error) {
    console.error('FAIL tasks/get', eg.json.error);
    process.exit(1);
  }
  enquireState = eg.json.result?.task?.status?.state;
  enquirePayload = eg.json.result;
  console.log(`    tasks/get #${i + 1}:`, enquireState);
  if (['completed', 'failed', 'cancelled'].includes(enquireState)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (!['completed', 'failed', 'cancelled'].includes(enquireState)) {
  console.error('FAIL enquire did not reach terminal state');
  process.exit(1);
}
console.log('PASS enquire tasks/get →', enquireState);
console.log('    metadata.run:', JSON.stringify(enquirePayload?.metadata?.run || {}).slice(0, 280));

const skill = await rpc('message/send', {
  message: {
    role: 'user',
    messageId: randomUUID(),
    parts: [{ kind: 'data', data: { taskId } }],
  },
  metadata: { skillId: 'enquire-progress' },
});
if (skill.json.error) {
  console.error('FAIL enquire-progress', skill.json.error);
  process.exit(1);
}
console.log('PASS enquire-progress skill →', skill.json.result?.task?.status?.state);

// Allow callback delivery a moment
await new Promise((r) => setTimeout(r, 1500));

console.log('==> Mock callback inbox on VPS');
const out = ssh(
  `cd ${REMOTE}/deploy && docker compose exec -T -e TASK_ID='${taskId}' backend node scripts/check-a2a-callback-inbox.js`
);
console.log(out.trim());
const line = out
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.startsWith('{'))
  .pop();
const parsed = JSON.parse(line);
const body = parsed?.entry?.body;
if (!(parsed?.count > 0) || !body) {
  console.error('FAIL no callback in mock inbox for task', taskId);
  process.exit(1);
}
if (body.task_id && body.task_id !== taskId) {
  console.error('FAIL inbox task_id mismatch', body.task_id, taskId);
  process.exit(1);
}
if (!body.event || !body.status?.state) {
  console.error('FAIL callback missing event/status', body);
  process.exit(1);
}
console.log('PASS callback webhook JSON:', {
  event: body.event,
  status: body.status,
  final_output: String(body.final_output || '').slice(0, 100),
});

console.log('\n======== CONCLUSION ========');
console.log(`Publish id: ${publishId}`);
console.log('1. Laptop message/send → async accept (working) + task id + run metadata');
console.log(`2. Enquiry tasks/get + enquire-progress → ${enquireState}`);
console.log('3. Mock callback POST /api/a2a-callback-inbox → Flolah webhook JSON (not A2A RPC)');
console.log('4. AgentExchange: Async badge + (i) tip shows callback JSON for callback-enabled agents');
console.log('ALL LAPTOP CLIENT TESTS PASSED');

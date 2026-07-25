/**
 * Laptop: prove per-request callbackUrl (publish has no default).
 *
 *   node backend/scripts/laptop-test-a2a-per-request-callback.js
 */
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';

const PUBLIC = 'https://flolah.cloud';
const PUBLISH_ID = process.env.A2A_PUBLISH_ID || 'wf-a2a-async-callback-demo-agent-6a74bd';
const ENDPOINT = `${PUBLIC}/api/a2a/${PUBLISH_ID}`;
const CALLBACK = process.env.CALLBACK_URL || `${PUBLIC}/api/a2a-callback-inbox`;
const HOST = '76.13.209.30';
const KEY = `${process.env.USERPROFILE}\\.ssh\\agent-os-vps`;

function ssh(cmd) {
  const r = spawnSync(
    'ssh',
    ['-i', KEY, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', `root@${HOST}`, cmd],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || String(r.status));
  return r.stdout;
}

async function rpc(method, params) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
  });
  return res.json();
}

console.log('==> Per-request callback test');
console.log('    endpoint:', ENDPOINT);
console.log('    per-request callbackUrl:', CALLBACK);

const send = await rpc('message/send', {
  message: {
    role: 'user',
    messageId: randomUUID(),
    parts: [{ kind: 'text', text: 'per-request callback only' }],
  },
  metadata: {
    skillId: 'default',
    callbackUrl: CALLBACK, // per-request override
  },
});

if (send.error) {
  console.error('FAIL send', send.error);
  process.exit(1);
}

const taskId = send.result?.task?.id;
const acceptedCb = send.result?.metadata?.callback_url;
console.log('PASS accept:', {
  state: send.result?.task?.status?.state,
  taskId,
  echoed_callback_url: acceptedCb,
});
if (!taskId) process.exit(1);
if (acceptedCb !== CALLBACK) {
  console.error('FAIL accept did not echo per-request callback', acceptedCb);
  process.exit(1);
}

let state = null;
for (let i = 0; i < 30; i += 1) {
  const eg = await rpc('tasks/get', { id: taskId });
  state = eg.result?.task?.status?.state;
  if (['completed', 'failed', 'cancelled'].includes(state)) break;
  await new Promise((r) => setTimeout(r, 800));
}
console.log('PASS enquire →', state);

await new Promise((r) => setTimeout(r, 1500));
const out = ssh(
  `cd /opt/agent-os/deploy && docker compose exec -T -e TASK_ID='${taskId}' backend node scripts/check-a2a-callback-inbox.js`
);
console.log(out.trim());
const parsed = JSON.parse(
  out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop()
);
const body = parsed?.entry?.body;
if (!(parsed?.count > 0) || body?.task_id !== taskId) {
  console.error('FAIL callback not received for per-request URL');
  process.exit(1);
}
console.log('PASS per-request callback delivered:', {
  event: body.event,
  final_output: String(body.final_output || '').slice(0, 80),
});
console.log('\nALL PER-REQUEST CALLBACK TESTS PASSED');

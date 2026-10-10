import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { parseAgentCommand, createAgentCommandRunner } from '../src/services/agent-slash-commands.js';
import { createCommandReceiptStore } from '../src/services/agent-command-receipts.js';
import { registerFlolahCommands } from '../../openclaw-extensions/agent-os-content-tools/slash-commands.js';

for (const command of ['/', '/commands', '/flolah']) assert.equal(parseAgentCommand(command).kind, 'help');
assert.equal(parseAgentCommand('/flolah tools download').query, 'download');
assert.equal(parseAgentCommand('/flolah steer').kind, 'targets');
assert.deepEqual(parseAgentCommand('/flolah tool download_file {"url":"https://example.org/a.pdf"}').params, { url: 'https://example.org/a.pdf' });
assert.equal(parseAgentCommand('/flolah steer schedule:abc-123 Focus remaining steps').message, 'Focus remaining steps');
assert.equal(parseAgentCommand('/flolah steer status goal:goal-1').kind, 'history');
assert.equal(parseAgentCommand('/flolah skills research').query, 'research');
assert.equal(parseAgentCommand('/flolah skill research Summarize the report').prompt, 'Summarize the report');
for (const invalid of ['/exec ls', '/tool x', '/tool x []', '/tool x null', '/tool x shell', '/tool x {"owner_user_id":"victim"}', '/tool x {"nested":{"approval_token":"stolen"}}', '/tool x {"__proto__":{}}', '/steer goal:x', '/steer newest Do it', '/steer status goal:x Do it', '/tools ' + 'a'.repeat(16000)]) assert.throws(() => parseAgentCommand(invalid));
let calls = 0, enqueued = [];
const catalog = [{ name: 'download_file', purpose: 'Download public content', display_name: 'Download' }];
const runner = createAgentCommandRunner({
  tools: (owner, agent) => owner === 'ownerA' && agent === 'coo' ? catalog : [],
  skills: (owner, agent) => owner === 'ownerA' && agent === 'coo' ? [{ skill_id: 'skill-a', slug: 'research', name: 'Research', ready: true, version: 1, description: 'Cited research', missing: [] }, { skill_id: 'skill-b', slug: 'blocked', name: 'Blocked', ready: false, version: 1, missing: ['paid_tool'] }] : [],
  targets: (owner, agent) => owner === 'ownerA' && agent === 'coo' ? [{ kind: 'goal', id: 'goal-1', title: 'Research', delivery: 'Next checkpoint' }] : [],
  history: () => [{ status: 'delivered', message: 'Cite sources', checkpoint: 'tool_result' }],
  enqueue: (owner, actor, body) => { enqueued.push({ owner, actor, body }); return { status: 'queued' }; },
  invoke: async args => { calls++; return { ok: false, status: 403, reply: 'Approval required', args }; },
});
const context = { ownerUserId: 'ownerA', actor: { id: 'human' }, agentId: 'coo', idempotencyKey: 'stable-test-key' };
assert.equal((await runner({ ...context, text: '/flolah tools' })).count, 1);
assert.equal((await runner({ ...context, text: '/flolah tools absent' })).count, 0);
assert.equal((await runner({ ...context, text: '/flolah skills research' })).skills.length, 1);
const selection = await runner({ ...context, text: '/flolah skill research Research this report' });
assert.equal(selection.route, 'slash_skill_prepare'); assert.deepEqual(selection.skill_refs, ['skill-a']); assert.match(selection.reply, /no work started/);
assert.equal(calls, 0); assert.equal(enqueued.length, 0, 'Selection never invokes a tool or starts work');
await assert.rejects(() => runner({ ...context, text: '/flolah skill blocked' }), /not ready/);
await assert.rejects(() => runner({ ...context, ownerUserId: 'ownerB', text: '/flolah skill research' }), /not found/);
assert.match((await runner({ ...context, text: '/flolah steer' })).reply, /goal:goal-1/);
assert.match((await runner({ ...context, text: '/flolah steer status goal:goal-1' })).reply, /delivered.*tool_result/);
await runner({ ...context, text: '/flolah steer goal:goal-1 Cite sources' });
assert.equal(enqueued.length, 1); assert.equal(enqueued[0].actor, 'human');
for (const delta of [{ ownerUserId: 'ownerB' }, { agentId: 'other' }]) await assert.rejects(() => runner({ ...context, ...delta, text: '/flolah steer goal:goal-1 Do it' }), /Exact active/);
await assert.rejects(() => runner({ ...context, actor: null, text: '/tools' }), /Authenticated/);
await assert.rejects(() => runner({ ...context, text: '/tool exec {}' }), /not granted/);
const blocked = await runner({ ...context, text: '/tool download_file {}' });
assert.equal(blocked.status, 403); assert.equal(calls, 1, 'No automatic approval/retry');

const db = new Database(':memory:');
const receipts = createCommandReceiptStore(db);
const invocation = { ...context, tool_name: 'download_file', params: { url: 'https://example.org/a' } };
assert.equal(receipts.claim(invocation), null);
assert.throws(() => receipts.claim(invocation), /outcome unverified/);
assert.throws(() => receipts.claim({ ...invocation, params: {} }), /different command/);
receipts.complete(invocation, { reply: 'Completed result', ok: true });
assert.equal(receipts.claim(invocation).reply, 'Completed result');
assert.equal(receipts.claim({ ...invocation, ownerUserId: 'ownerB' }), null, 'Owner isolated');
assert.equal(receipts.claim({ ...invocation, actor: { id: 'different-human' } }), null, 'Actor isolated');
assert.throws(() => receipts.claim({ ...invocation, idempotencyKey: null }), /stable/);
db.close();

const commands = []; let requests = [];
registerFlolahCommands({ registerCommand: c => commands.push(c) }, { baseUrl: 'http://backend:3001', brokerSecret: () => 'test-broker', request: async (url, options) => {
  requests.push({ url, ...options, body: JSON.parse(options.body) });
  return { ok: true, json: async () => ({ reply: 'Queued', media_uri: 'MEDIA:/root/.openclaw/media/downloads/ownerA/a.pdf' }) };
} });
assert.equal(commands.length, 1); assert.equal(commands[0].name, 'flolah'); assert.equal(commands[0].requireAuth, true); assert.deepEqual(commands[0].channels, ['whatsapp']);
const ctx = { isAuthorizedSender: true, channel: 'whatsapp', agentId: 't-ownera--coo', senderId: '+6590000000', accountId: 't-ownera--coo', sessionKey: 'agent:t-ownera--coo:whatsapp:direct:+6590000000', from: 'whatsapp:+6590000000', args: 'steer goal:goal-1 Cite sources' };
const reply = await commands[0].handler(ctx);
assert.equal(reply.continueAgent, false); assert.equal(reply.mediaUrl, '/root/.openclaw/media/downloads/ownerA/a.pdf');
assert.equal(requests[0].body.command, '/flolah steer goal:goal-1 Cite sources');
assert.equal(requests[0].body.sender_id, ctx.senderId); assert.equal(requests[0].body.agent_id, ctx.agentId);
for (const delta of [{ isAuthorizedSender: false }, { channel: 'telegram' }, { senderId: null }, { agentId: null }, { sessionKey: null }, { from: '123@g.us' }, { sessionKey: 'agent:coo:whatsapp:group:123' }]) await commands[0].handler({ ...ctx, ...delta });
assert.equal(requests.length, 1, 'Invalid/untrusted/group context never invokes backend');
const failureCommands = [];
let failureCalls = 0;
registerFlolahCommands({ registerCommand: c => failureCommands.push(c) }, { baseUrl: 'http://backend', brokerSecret: () => 'test', request: async () => { failureCalls++; throw new Error('timeout'); } });
assert.match((await failureCommands[0].handler(ctx)).text, /unverified/); assert.equal(failureCalls, 1);
console.log('Slash command parser, exact steering scope, guarded tools, durable replay and native WhatsApp handler tests passed');

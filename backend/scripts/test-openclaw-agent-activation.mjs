import assert from 'node:assert/strict';
import {
  activatePersistedOpenClawRuntimeAgent,
  buildRuntimeActivationPatch,
  clearOpenClawRuntimeActivationCache,
  runtimeAgentIsActive,
} from '../src/services/openclaw-agent-activation.js';

const runtimeId = `t-ceo-test--new-hire-${Date.now()}`;
const config = {
  agents: {
    defaults: { model: { primary: 'provider/model' } },
    ownership: 'explicit',
    entries: {
      [runtimeId]: {
        name: 'New Hire',
        workspace: '/tmp/new-hire',
        tools: { allow: ['sessions_history'], deny: ['image'] },
      },
    },
  },
};
const compatibilityEntry = { id: runtimeId, ...config.agents.entries[runtimeId] };

assert.deepEqual(buildRuntimeActivationPatch(config, compatibilityEntry), {
  agents: {
    ownership: 'explicit',
    entries: { [runtimeId]: config.agents.entries[runtimeId] },
  },
});
assert.equal(runtimeAgentIsActive({ payload: { agents: [{ id: runtimeId }] } }, runtimeId), true);
assert.equal(runtimeAgentIsActive({ payload: [] }, runtimeId), false);

let active = false;
let patchCalls = 0;
const calls = [];
const rpc = async (method, params) => {
  calls.push(method);
  if (method === 'agents.list') return { ok: true, payload: { agents: active ? [{ id: runtimeId }] : [] } };
  if (method === 'config.get') return { ok: true, payload: { hash: 'test-revision', config } };
  if (method === 'config.patch') {
    patchCalls += 1;
    assert.equal(params.baseHash, 'test-revision');
    const patch = JSON.parse(params.raw);
    assert.equal(patch.agents.entries[runtimeId].workspace, '/tmp/new-hire');
    active = true;
    return { ok: true, payload: { changedPaths: [`agents.entries.${runtimeId}`] } };
  }
  throw new Error(`Unexpected RPC ${method}`);
};

clearOpenClawRuntimeActivationCache(runtimeId);
const activated = await activatePersistedOpenClawRuntimeAgent(runtimeId, {
  rpc,
  readConfig: () => ({ ...config, agents: { ...config.agents, list: [compatibilityEntry] } }),
  wait: async () => {},
});
assert.equal(activated.active, true);
assert.equal(activated.source, 'config_rpc');
assert.equal(patchCalls, 1);
assert.deepEqual(calls.slice(0, 3), ['agents.list', 'config.get', 'config.patch']);

const cached = await activatePersistedOpenClawRuntimeAgent(runtimeId, { rpc });
assert.equal(cached.source, 'cache');
assert.equal(patchCalls, 1, 'cache prevents repeated config publications');

active = true;
const verified = await activatePersistedOpenClawRuntimeAgent(runtimeId, { rpc, forceVerify: true });
assert.equal(verified.source, 'live_registry', 'unknown-agent recovery bypasses stale process cache');

const missingId = `${runtimeId}-missing`;
clearOpenClawRuntimeActivationCache(missingId);
await assert.rejects(
  () => activatePersistedOpenClawRuntimeAgent(missingId, {
    rpc: async (method) => method === 'agents.list'
      ? { ok: true, payload: [] }
      : { ok: true, payload: { hash: 'unused' } },
    readConfig: () => ({ agents: { entries: {}, list: [] } }),
    wait: async () => {},
  }),
  (error) => error.code === 'OPENCLAW_AGENT_ACTIVATION_FAILED' && /persisted.*missing/i.test(error.message)
);

console.log(JSON.stringify({ ok: true, checks: ['entries-schema-patch', 'runtime-list-normalization', 'config-rpc-activation', 'activation-cache', 'missing-entry-fails-loudly'] }, null, 2));

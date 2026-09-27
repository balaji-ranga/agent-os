/**
 * Make a persisted OpenClaw agent visible to the live Gateway registry.
 *
 * Agent OS historically wrote openclaw.json directly. OpenClaw validates that
 * file, but some releases can publish the new config snapshot without
 * reconciling the HTTP agent selector. The supported config RPC provides an
 * application acknowledgement and repairs that gap without restarting the
 * container.
 */
import { openclawAdminRpc } from '../gateway/openclaw-admin-rpc.js';
import { readOpenClawConfigSafe } from './openclaw-config-safe.js';

const activeRuntimeIds = new Set();
const activationsInFlight = new Map();

function rpcPayload(result) {
  return result?.payload ?? result?.result ?? result ?? {};
}

export function runtimeAgentList(result) {
  const payload = rpcPayload(result);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.agents)) return payload.agents;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

export function runtimeAgentIsActive(result, runtimeId) {
  const needle = String(runtimeId || '').trim().toLowerCase();
  return runtimeAgentList(result).some((entry) => String(entry?.id || '').trim().toLowerCase() === needle);
}

function persistedRuntimeEntry(runtimeId, readConfig) {
  const config = readConfig();
  const needle = String(runtimeId || '').trim().toLowerCase();
  const entry = (config?.agents?.list || []).find(
    (candidate) => String(candidate?.id || '').trim().toLowerCase() === needle
  );
  if (!entry) {
    const error = new Error(`Persisted AgentSystem entry is missing for '${runtimeId}'`);
    error.status = 503;
    error.code = 'OPENCLAW_AGENT_NOT_PERSISTED';
    throw error;
  }
  return { config, entry };
}

export function buildRuntimeActivationPatch(config, entry) {
  const { id, ...value } = entry || {};
  if (!id) throw new Error('Runtime agent id is required');
  if (config?.agents?.entries && typeof config.agents.entries === 'object') {
    return { agents: { ownership: 'explicit', entries: { [id]: value } } };
  }
  return { agents: { list: [entry] } };
}

function activationError(runtimeId, cause) {
  const error = new Error(
    `AgentSystem did not activate newly hired employee '${runtimeId}': ${cause?.message || cause || 'unknown error'}`
  );
  error.status = 503;
  error.code = 'OPENCLAW_AGENT_ACTIVATION_FAILED';
  error.cause = cause;
  return error;
}

/**
 * Verify the live registry and, only when missing, republish the persisted
 * entry through OpenClaw's supported config control plane. Calls for the same
 * runtime are coalesced so simultaneous chat/delegation requests do not race.
 */
export async function activatePersistedOpenClawRuntimeAgent(runtimeId, options = {}) {
  const id = String(runtimeId || '').trim();
  if (!id) throw new Error('runtimeId is required');
  if (!options.forceVerify && activeRuntimeIds.has(id)) return { active: true, runtime_id: id, source: 'cache' };
  if (activationsInFlight.has(id)) return activationsInFlight.get(id);

  const rpc = options.rpc || openclawAdminRpc;
  const readConfig = options.readConfig || readOpenClawConfigSafe;
  const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const work = (async () => {
    try {
      const before = await rpc('agents.list', {}, { timeoutMs: 30000 });
      if (runtimeAgentIsActive(before, id)) {
        activeRuntimeIds.add(id);
        return { active: true, runtime_id: id, source: 'live_registry' };
      }

      const { config, entry } = persistedRuntimeEntry(id, readConfig);
      const currentResult = await rpc('config.get', {}, { timeoutMs: 30000 });
      const current = rpcPayload(currentResult);
      if (!current?.hash) throw new Error('AgentSystem config.get did not return a revision hash');
      const patch = buildRuntimeActivationPatch(config, entry);
      await rpc(
        'config.patch',
        {
          raw: JSON.stringify(patch),
          baseHash: current.hash,
          note: `Activate newly hired Flolah employee ${id}`,
        },
        { timeoutMs: 90000 }
      );

      for (const delayMs of [0, 250, 750, 1500]) {
        if (delayMs) await wait(delayMs);
        const state = await rpc('agents.list', {}, { timeoutMs: 30000 });
        if (runtimeAgentIsActive(state, id)) {
          activeRuntimeIds.add(id);
          return { active: true, runtime_id: id, source: 'config_rpc' };
        }
      }
      throw new Error('runtime registry still does not list the employee after config acknowledgement');
    } catch (error) {
      throw activationError(id, error);
    } finally {
      activationsInFlight.delete(id);
    }
  })();

  activationsInFlight.set(id, work);
  return work;
}

export function clearOpenClawRuntimeActivationCache(runtimeId = '') {
  if (runtimeId) activeRuntimeIds.delete(String(runtimeId));
  else activeRuntimeIds.clear();
}

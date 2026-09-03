import { getPlatformSetting, setPlatformSetting } from './platform-llm-settings.js';

const DEFINITIONS = Object.freeze({
  llm_chat: { label: 'General model call', category: 'Models', env: 'LLM_CHAT_TIMEOUT_MS', defaultMs: 120000, minMs: 5000, maxMs: 900000 },
  semantic_router: { label: 'Semantic intent router', category: 'Models', env: 'AGENT_TURN_ROUTER_TIMEOUT_MS', defaultMs: 60000, minMs: 5000, maxMs: 180000 },
  goal_adjudicator: { label: 'Goal adjudicator', category: 'Models', env: 'AGENT_TURN_ADJUDICATOR_TIMEOUT_MS', defaultMs: 45000, minMs: 5000, maxMs: 180000 },
  goal_plan_llm: { label: 'Goal maker / checker call', category: 'Goals', env: 'GOAL_PLAN_LLM_CALL_TIMEOUT_MS', defaultMs: 120000, minMs: 10000, maxMs: 300000 },
  goal_agent_step: { label: 'Goal agent step', category: 'Goals', env: 'GOAL_AGENT_CONTINUE_TIMEOUT_MS', defaultMs: 240000, minMs: 30000, maxMs: 1800000 },
  goal_wakeup_stale: { label: 'Goal wake-up stale threshold', category: 'Goals', env: 'GOAL_RUN_WAKE_STALE_MS', defaultMs: 120000, minMs: 30000, maxMs: 3600000 },
  openclaw_chat: { label: 'OpenClaw gateway call', category: 'Agents', env: 'OPENCLAW_FETCH_TIMEOUT_MS', defaultMs: 240000, minMs: 30000, maxMs: 1800000 },
  openclaw_local_chat: { label: 'Local model agent chat', category: 'Agents', env: 'OPENCLAW_OLLAMA_CHAT_TIMEOUT_MS', defaultMs: 900000, minMs: 60000, maxMs: 3600000 },
  browser_job: { label: 'Browser executor job', category: 'Browser', env: 'BROWSER_WORKER_JOB_TIMEOUT_MS', defaultMs: 120000, minMs: 10000, maxMs: 1800000 },
  browser_offline: { label: 'Browser worker offline threshold', category: 'Browser', env: 'BROWSER_WORKER_OFFLINE_MS', defaultMs: 90000, minMs: 15000, maxMs: 600000 },
  workflow_node: { label: 'Workflow node default', category: 'Workflows', env: 'WORKFLOW_NODE_TIMEOUT_MS', defaultMs: 1200000, minMs: 1000, maxMs: 86400000 },
  a2a_request: { label: 'A2A request', category: 'Agents', env: 'A2A_REQUEST_TIMEOUT_MS', defaultMs: 90000, minMs: 5000, maxMs: 900000 },
});

function envDefault(definition) {
  const value = Number(process.env[definition.env]);
  return Number.isFinite(value) && value > 0 ? value : definition.defaultMs;
}

function clamp(value, definition) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) throw Object.assign(new Error('Timeout must be a number of milliseconds'), { status: 400 });
  if (number < definition.minMs || number > definition.maxMs) {
    throw Object.assign(new Error(`Timeout must be between ${definition.minMs} and ${definition.maxMs} milliseconds`), { status: 400 });
  }
  return number;
}

export function getPlatformTimeoutMs(id) {
  const definition = DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown platform timeout: ${id}`);
  const fallback = envDefault(definition);
  const stored = Number(getPlatformSetting(`timeout.${id}`, String(fallback)));
  return Number.isFinite(stored) && stored >= definition.minMs && stored <= definition.maxMs ? stored : fallback;
}

export function listPlatformTimeouts() {
  return Object.entries(DEFINITIONS).map(([id, definition]) => ({
    id,
    label: definition.label,
    category: definition.category,
    value_ms: getPlatformTimeoutMs(id),
    default_ms: envDefault(definition),
    min_ms: definition.minMs,
    max_ms: definition.maxMs,
    environment_key: definition.env,
  }));
}

export function updatePlatformTimeouts(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw Object.assign(new Error('timeouts object is required'), { status: 400 });
  }
  for (const [id, raw] of Object.entries(values)) {
    const definition = DEFINITIONS[id];
    if (!definition) throw Object.assign(new Error(`Unknown platform timeout: ${id}`), { status: 400 });
    setPlatformSetting(`timeout.${id}`, clamp(raw, definition));
  }
  return listPlatformTimeouts();
}

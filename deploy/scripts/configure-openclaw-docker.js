/**
 * Merge production/container settings into openclaw.json after apply-openclaw-agents-config.js.
 * - gateway.auth.token from OPENCLAW_GATEWAY_TOKEN
 * - agent-os-content-tools plugin baseUrl from AGENT_OS_INTERNAL_API_URL (default http://backend:3001)
 * - agent-os-content-tools plugin apiKey from TOOLS_API_KEY (must match backend env)
 * - Ollama provider baseUrl from OLLAMA_BASE_URL (default http://ollama:11434 when profile enabled)
 * - tools.sessions.visibility = agent (Agent OS delegation / session history)
 *
 * Run: node deploy/scripts/configure-openclaw-docker.js
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveOpenClawDir } from '../../scripts/lib/openclaw-paths.js';
import {
  REQUIRED_GLOBAL_CONTENT_TOOLS,
  COO_CONTENT_TOOLS_ALLOW,
  WORKFLOW_BUILDER_CONTENT_TOOLS_ALLOW,
  PLATFORM_HELP_CONTENT_TOOLS_ALLOW,
} from '../../scripts/lib/content-tools-allow.js';

const OPENCLAW_DIR = resolveOpenClawDir();
const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || join(OPENCLAW_DIR, 'openclaw.json');

const GATEWAY_TOKEN = String(process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
const TOOLS_API_KEY = String(process.env.TOOLS_API_KEY || '').trim();
const INTERNAL_API = String(process.env.AGENT_OS_INTERNAL_API_URL || 'http://backend:3001').replace(/\/$/, '');
const OLLAMA_BASE = String(process.env.OLLAMA_BASE_URL || 'http://ollama:11434').replace(/\/?$/, '');
const GATEWAY_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT || 18789);
const SESSION_VISIBILITY = process.env.OPENCLAW_SESSION_VISIBILITY || 'agent';

if (!existsSync(CONFIG_PATH)) {
  console.error('openclaw.json not found at', CONFIG_PATH);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  console.error('Could not parse openclaw.json:', e.message);
  process.exit(1);
}

if (!config.gateway) config.gateway = {};
config.gateway.mode = config.gateway.mode || 'local';
config.gateway.port = GATEWAY_PORT;
if (!config.gateway.http) config.gateway.http = {};
if (!config.gateway.http.endpoints) config.gateway.http.endpoints = {};
if (!config.gateway.http.endpoints.chatCompletions) {
  config.gateway.http.endpoints.chatCompletions = { enabled: true };
} else {
  config.gateway.http.endpoints.chatCompletions.enabled = true;
}

if (GATEWAY_TOKEN) {
  config.gateway.auth = { ...(config.gateway.auth || {}), token: GATEWAY_TOKEN };
  console.log('Set gateway.auth.token from OPENCLAW_GATEWAY_TOKEN');
} else {
  console.warn('OPENCLAW_GATEWAY_TOKEN not set — gateway may require device pairing (see GATEWAY-PAIRING-1008.md)');
}

// Codex app-server auto-enables for openai/* and rejects plugin tools with type "custom"
// (OpenAI 400 invalid_request_error). Keep Agent OS content-tools on the embedded runner.
if (!config.plugins) config.plugins = {};
if (!config.plugins.entries) config.plugins.entries = {};
config.plugins.entries.codex = { ...(config.plugins.entries.codex || {}), enabled: false };
if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
for (const id of ['agent-os-content-tools', 'browser', 'agent-os-bootstrap-watcher']) {
  if (!config.plugins.allow.includes(id)) config.plugins.allow.push(id);
}
config.plugins.allow = config.plugins.allow.filter((id) => id !== 'codex');
console.log('Disabled plugins.entries.codex; plugins.allow=', config.plugins.allow.join(', '));

if (!config.tools) config.tools = {};
if (!config.tools.sessions) config.tools.sessions = {};
config.tools.sessions.visibility = SESSION_VISIBILITY;
console.log('Set tools.sessions.visibility:', SESSION_VISIBILITY);

// OpenClaw intersects agent tools.allow with global tools.allow. Plugin tools missing
// from the global list are stripped (COO learnings_summary regressed this way).
if (!Array.isArray(config.tools.allow)) config.tools.allow = [];
let globalAdded = 0;
for (const name of REQUIRED_GLOBAL_CONTENT_TOOLS) {
  if (!config.tools.allow.includes(name)) {
    config.tools.allow.push(name);
    globalAdded += 1;
  }
}
if (globalAdded) {
  console.log(`Added ${globalAdded} tool(s) to global tools.allow (incl. learnings_summary)`);
} else {
  console.log('Global tools.allow already includes required content tools');
}

// Keep COO / Workflow Builder agent allows current across volume-persisted configs.
const AGENT_CONTENT_TOOLS = {
  balserve: COO_CONTENT_TOOLS_ALLOW,
  workflowbuilder: WORKFLOW_BUILDER_CONTENT_TOOLS_ALLOW,
  platformhelp: PLATFORM_HELP_CONTENT_TOOLS_ALLOW,
};
if (Array.isArray(config.agents?.list)) {
  for (const agent of config.agents.list) {
    const id = String(agent?.id || '').toLowerCase();
    const required = AGENT_CONTENT_TOOLS[id];
    if (!required) continue;
    agent.tools = agent.tools || {};
    if (!Array.isArray(agent.tools.allow)) agent.tools.allow = [];
    let n = 0;
    for (const name of required) {
      if (!agent.tools.allow.includes(name)) {
        agent.tools.allow.push(name);
        n += 1;
      }
    }
    if (!agent.tools.deny) agent.tools.deny = ['image'];
    if (n) console.log(`Added ${n} tool(s) to agents.list ${id} tools.allow`);
  }
}

if (!config.plugins) config.plugins = {};
if (!config.plugins.entries) config.plugins.entries = {};
const plugin = config.plugins.entries['agent-os-content-tools'] || {};
const pluginConfig = {
  ...(plugin.config || {}),
  baseUrl: INTERNAL_API,
};
if (TOOLS_API_KEY) {
  pluginConfig.apiKey = TOOLS_API_KEY;
  console.log('Set agent-os-content-tools apiKey from TOOLS_API_KEY');
} else {
  console.warn(
    'TOOLS_API_KEY not set — content-tools plugin will fail until deploy/.env has TOOLS_API_KEY and init is re-run'
  );
}
config.plugins.entries['agent-os-content-tools'] = {
  ...plugin,
  enabled: true,
  config: pluginConfig,
};
console.log('Set agent-os-content-tools baseUrl:', INTERNAL_API);

if (config.models?.providers?.ollama) {
  config.models.providers.ollama.baseUrl = `${OLLAMA_BASE}/v1`;
  console.log('Set Ollama baseUrl:', `${OLLAMA_BASE}/v1`);
  // Agent bootstrap is large, but forcing 128k makes small VPS Ollama thrash / "fetch failed".
  const ollamaCtx = Math.max(
    8192,
    Number(process.env.OLLAMA_CONTEXT_WINDOW || process.env.OPENCLAW_OLLAMA_CONTEXT_WINDOW || 32768) || 32768
  );
  const ollamaMaxTok = Math.max(
    1024,
    Number(process.env.OLLAMA_MAX_TOKENS || process.env.OPENCLAW_OLLAMA_MAX_TOKENS || 4096) || 4096
  );
  const ollamaModels = config.models.providers.ollama.models;
  if (Array.isArray(ollamaModels)) {
    config.models.providers.ollama.models = ollamaModels.map((m) => {
      if (typeof m === 'string') {
        return {
          id: m,
          name: m,
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: ollamaCtx,
          maxTokens: ollamaMaxTok,
        };
      }
      return {
        ...m,
        contextWindow: Math.min(Math.max(Number(m.contextWindow) || 0, 8192), ollamaCtx) || ollamaCtx,
        maxTokens: Math.min(Math.max(Number(m.maxTokens) || 0, 1024), ollamaMaxTok) || ollamaMaxTok,
      };
    });
    console.log(
      'Set ollama contextWindow:',
      config.models.providers.ollama.models.map((m) => `${m.id}:${m.contextWindow}`).join(', ')
    );
  }
}

// Register OpenAI-compatible provider from env (official OpenAI or DeepSeek / other bases).
// When admin has switched to secondary, honor platform-llm-active.json (written by syncPlatformEndpointToOpenClaw)
// so restart does not wipe openai/gpt-4o back to OPENCLAW_MODEL_PRIMARY=deepseek.
let platformActive = 'primary';
let markerPrimarySlug = '';
try {
  const markerPath = join(OPENCLAW_DIR, 'platform-llm-active.json');
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    if (String(marker?.active || '').toLowerCase() === 'secondary') platformActive = 'secondary';
    markerPrimarySlug = String(marker?.primary || '').trim();
  }
} catch {
  /* ignore */
}
const useSecondaryPlatform =
  platformActive === 'secondary' &&
  String(process.env.OPENAI_SECONDARY_API_KEY || '').trim() &&
  String(process.env.OPENAI_SECONDARY_MODEL || '').trim();

const openaiKey = useSecondaryPlatform
  ? String(process.env.OPENAI_SECONDARY_API_KEY || '').trim()
  : String(process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
const primarySlug = useSecondaryPlatform
  ? markerPrimarySlug && markerPrimarySlug.startsWith('openai/')
    ? markerPrimarySlug
    : `openai/${String(process.env.OPENAI_SECONDARY_MODEL || 'gpt-4o').trim().replace(/^[^/]+\//, '')}`
  : markerPrimarySlug || String(process.env.OPENCLAW_MODEL_PRIMARY || 'openai/gpt-4o-mini').trim();
const primaryId = primarySlug.includes('/')
  ? primarySlug.slice(primarySlug.indexOf('/') + 1)
  : primarySlug || 'gpt-4o-mini';
const primaryModelHint = `${primarySlug} ${useSecondaryPlatform ? process.env.OPENAI_SECONDARY_MODEL : process.env.OPENAI_PRIMARY_MODEL || ''}`.toLowerCase();
const looksLikeDeepSeek = primaryModelHint.includes('deepseek');
let openaiBaseRaw = useSecondaryPlatform
  ? String(process.env.OPENAI_SECONDARY_BASE_URL || '')
      .trim()
      .replace(/\/$/, '')
  : String(process.env.OPENAI_BASE_URL || process.env.OPENAI_PRIMARY_BASE_URL || '')
      .trim()
      .replace(/\/$/, '');
if (!openaiBaseRaw && looksLikeDeepSeek) {
  openaiBaseRaw = 'https://api.deepseek.com/v1';
}
if (!openaiBaseRaw) {
  openaiBaseRaw = 'https://api.openai.com/v1';
}
const openaiBase = openaiBaseRaw.endsWith('/v1') ? openaiBaseRaw : `${openaiBaseRaw}/v1`;
function isOfficialOpenAiBase(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'api.openai.com';
  } catch {
    return false;
  }
}
const useOfficialOpenAi = isOfficialOpenAiBase(openaiBase) && !looksLikeDeepSeek;
if (useSecondaryPlatform) {
  console.log(
    'Honoring platform-llm-active.json secondary → primary=',
    primarySlug,
    'base=',
    openaiBase
  );
}
if (openaiKey) {
  if (!config.models) config.models = {};
  if (!config.models.providers) config.models.providers = {};
  const existing = config.models.providers.openai || {};
  // Custom bases (e.g. DeepSeek) only catalog the configured primary — avoid bogus gpt-* ids.
  const catalogIds = useOfficialOpenAi
    ? [primaryId, 'gpt-4o-mini', 'gpt-4o']
    : [primaryId, 'deepseek-v4-flash', 'deepseek-v4-pro'].filter(
        (id, i, arr) => id && arr.indexOf(id) === i
      );
  const ctxWindow = useOfficialOpenAi ? 128000 : 1000000;
  const maxTok = useOfficialOpenAi ? 16384 : 65536;
  let models;
  if (useOfficialOpenAi) {
    models = Array.isArray(existing.models) ? existing.models.slice() : [];
    const ids = new Set(models.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean));
    for (const id of catalogIds) {
      if (ids.has(id)) continue;
      models.push({
        id,
        name: id,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: ctxWindow,
        maxTokens: maxTok,
      });
      ids.add(id);
    }
  } else {
    models = catalogIds.map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: ctxWindow,
      maxTokens: maxTok,
    }));
  }
  if (useOfficialOpenAi) {
    // Official OpenAI Responses API. Keep explicit api.openai.com baseUrl when admin
    // secondary is active — otherwise gateway may fall back to container OPENAI_BASE_URL
    // (often DeepSeek primary) and gpt-4o-mini requests fail.
    config.models.providers.openai = {
      ...existing,
      apiKey: openaiKey,
      api: existing.api || 'openai-responses',
      models: models.map((m) =>
        typeof m === 'string' ? m : { ...m, api: m.api || 'openai-responses' }
      ),
    };
    if (useSecondaryPlatform) {
      config.models.providers.openai.baseUrl = 'https://api.openai.com/v1';
    } else {
      delete config.models.providers.openai.baseUrl;
    }
    console.log(
      'Set models.providers.openai (official Responses); models=',
      models.map((m) => m.id || m).join(', '),
      useSecondaryPlatform ? 'baseUrl=https://api.openai.com/v1' : 'baseUrl=(omitted)'
    );
  } else {
    // DeepSeek / OpenAI-compatible: Chat Completions + baseUrl required.
    config.models.providers.openai = {
      baseUrl: openaiBase,
      apiKey: openaiKey,
      api: 'openai-completions',
      models: models.map((m) => ({ ...m, api: 'openai-completions' })),
    };
    console.log(
      'Set models.providers.openai (completions + baseUrl=',
      openaiBase,
      '); models=',
      models.map((m) => m.id || m).join(', ')
    );
  }
  config.models.mode = 'replace';
  // Gateway prefers process env OPENAI_API_KEY over providers.openai.apiKey — write a
  // runtime env file that openclaw-entrypoint.sh sources after configure.
  try {
    const runtimePath = join(OPENCLAW_DIR, 'platform-llm-runtime.env');
    const lines = [`OPENAI_API_KEY=${openaiKey}`];
    if (useOfficialOpenAi || useSecondaryPlatform) {
      lines.push('OPENAI_BASE_URL=https://api.openai.com/v1');
    } else if (openaiBase) {
      lines.push(`OPENAI_BASE_URL=${openaiBase}`);
    }
    writeFileSync(runtimePath, `${lines.join('\n')}\n`, 'utf8');
    console.log(
      'Wrote',
      runtimePath,
      'keyPrefix=',
      `${openaiKey.slice(0, 10)}...`,
      useSecondaryPlatform ? '(secondary)' : '(primary)'
    );
  } catch (e) {
    console.warn('Could not write platform-llm-runtime.env:', e?.message || e);
  }
} else {
  console.warn('OPENAI_API_KEY not set — openai/* models may fall back to ollama and overflow context');
}

// Always align default primary model with OPENCLAW_MODEL_PRIMARY.
if (!config.agents) config.agents = {};
if (!config.agents.defaults) config.agents.defaults = {};
if (!config.agents.defaults.model) config.agents.defaults.model = {};
config.agents.defaults.model.primary = primarySlug;
console.log('Set agents.defaults.model.primary=', primarySlug);

// Model fallbacks: OPENCLAW_MODEL_FALLBACKS (comma-separated) or optional Ollama toggle.
// OPENCLAW_ENABLE_OLLAMA_FALLBACK=0 strips ollama/* even if listed in OPENCLAW_MODEL_FALLBACKS
// (otherwise Admin LLM auth failures silently dump tool schemas via llama).
{
  const enableOllamaFallback =
    process.env.OPENCLAW_ENABLE_OLLAMA_FALLBACK === '1' ||
    process.env.OPENCLAW_ENABLE_OLLAMA_FALLBACK === 'true';
  const primary = String(config.agents.defaults.model.primary || primarySlug || '').trim();
  let fallbacks = String(process.env.OPENCLAW_MODEL_FALLBACKS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== primary);
  if (!enableOllamaFallback) {
    fallbacks = fallbacks.filter((s) => !String(s).toLowerCase().startsWith('ollama/'));
  } else if (!fallbacks.some((s) => String(s).toLowerCase().startsWith('ollama/'))) {
    const ollamaModel = (
      process.env.OPENCLAW_OLLAMA_FALLBACK_MODEL ||
      process.env.OLLAMA_MODEL ||
      'llama3.2'
    ).trim();
    fallbacks.push(`ollama/${ollamaModel}`);
  }
  config.agents.defaults.model.fallbacks = fallbacks;
  console.log(
    fallbacks.length
      ? `Set agents.defaults.model.fallbacks: ${fallbacks.join(', ')}`
      : 'Cleared agents.defaults.model.fallbacks (OPENCLAW_ENABLE_OLLAMA_FALLBACK=0)'
  );
}

// Ensure Agent OS extensions are on plugins.load.paths; remap Windows paths for Linux containers.
if (!config.plugins.load) config.plugins.load = {};
const requiredExtPaths = [
  join(OPENCLAW_DIR, 'extensions', 'agent-os-content-tools'),
  join(OPENCLAW_DIR, 'extensions', 'agent-os-bootstrap-watcher'),
];
const pathSet = new Set(
  (Array.isArray(config.plugins.load.paths) ? config.plugins.load.paths : []).map(String)
);
for (const p of requiredExtPaths) pathSet.add(p);
config.plugins.load.paths = [...pathSet].map((p) => {
  const s = String(p || '');
  if (/^[A-Za-z]:[\\/]/.test(s) || s.includes('\\Users\\') || s.includes('/Users/')) {
    const base = s.replace(/\\/g, '/').split('/extensions/').pop();
    if (base) return join(OPENCLAW_DIR, 'extensions', base);
  }
  return s;
});
if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
for (const id of ['agent-os-content-tools', 'agent-os-bootstrap-watcher']) {
  if (!config.plugins.allow.includes(id)) config.plugins.allow.push(id);
}
console.log('Normalized plugins.load.paths for container:', config.plugins.load.paths);

if (!existsSync(OPENCLAW_DIR)) mkdirSync(OPENCLAW_DIR, { recursive: true });
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
console.log('Updated', CONFIG_PATH);

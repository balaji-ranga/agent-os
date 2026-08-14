/**
 * Merge production/container settings into openclaw.json after apply-openclaw-agents-config.js.
 * - gateway.auth.token from OPENCLAW_GATEWAY_TOKEN
 * - gateway.http.endpoints.chatCompletions.enabled = true (required for Agent Chat /v1/chat/completions)
 * - Prefer entrypoint ensure-openclaw-gateway-config.js first (restores wiped sections from bak)
 * - agent-os-content-tools plugin baseUrl from AGENT_OS_INTERNAL_API_URL (default http://backend:3001)
 * - agent-os-content-tools plugin apiKey from TOOLS_API_KEY (must match backend env)
 * - Ollama provider baseUrl from OLLAMA_BASE_URL (default http://ollama:11434 when profile enabled)
 * - tools.sessions.visibility = agent (Agent OS delegation / session history)
 *
 * Backend rewrites MUST use src/services/openclaw-config-safe.js so they never strip gateway/tools/plugins/browser.
 *
 * Run: node deploy/scripts/configure-openclaw-docker.js
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveOpenClawDir } from '../../scripts/lib/openclaw-paths.js';
import { ensureChannelRoutingOnConfig } from '../../scripts/lib/openclaw-channel-routing.js';
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

function isLocalOllamaBase(baseUrl) {
  try {
    const host = new URL(String(baseUrl || '')).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === 'ollama';
  } catch {
    return false;
  }
}

function ollamaModelObject(id, ctx, maxTok) {
  return {
    id,
    name: id,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: ctx,
    maxTokens: maxTok,
    api: 'openai-completions',
  };
}

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
// Persist browser plugin enablement so gateway HTTP/WS routes (incl. /browser/extension)
// register at startup instead of tool-only auto-enable.
config.plugins.entries.browser = { ...(config.plugins.entries.browser || {}), enabled: true };
// Admin HTTP RPC: backend WhatsApp QR (web.login.*) over private Docker network.
config.plugins.entries['admin-http-rpc'] = {
  ...(config.plugins.entries['admin-http-rpc'] || {}),
  enabled: true,
};
const whatsappExt = join(OPENCLAW_DIR, 'extensions', 'whatsapp');
if (existsSync(whatsappExt)) {
  config.plugins.entries.whatsapp = { ...(config.plugins.entries.whatsapp || {}), enabled: true };
}
if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
for (const id of [
  'agent-os-content-tools',
  'browser',
  'agent-os-bootstrap-watcher',
  'admin-http-rpc',
  ...(existsSync(whatsappExt) ? ['whatsapp'] : []),
]) {
  if (!config.plugins.allow.includes(id)) config.plugins.allow.push(id);
}
config.plugins.allow = config.plugins.allow.filter((id) => id !== 'codex');
console.log('Disabled plugins.entries.codex; plugins.allow=', config.plugins.allow.join(', '));

// Root browser block is required for the built-in `browser` tool to register.
// Without it, /tools/invoke returns "Tool not available: browser" for every agent.
if (!config.browser || typeof config.browser !== 'object') config.browser = {};
config.browser.enabled = true;
config.browser.defaultProfile = config.browser.defaultProfile || 'openclaw';
if (!config.browser.profiles || typeof config.browser.profiles !== 'object') {
  config.browser.profiles = { openclaw: { cdpPort: 18800, color: '#FF4500' } };
} else if (!config.browser.profiles.openclaw) {
  config.browser.profiles.openclaw = { cdpPort: 18800, color: '#FF4500' };
}
if (config.browser.headless == null) config.browser.headless = true;
if (config.browser.noSandbox == null) config.browser.noSandbox = true;
console.log(
  'Set browser.enabled=true defaultProfile=%s headless=%s',
  config.browser.defaultProfile,
  config.browser.headless
);

// Nginx (host network) + docker-proxy appear as these peers; without trustedProxies the
// gateway warns and treats Browser Relay clients as remote.
if (!Array.isArray(config.gateway.trustedProxies) || config.gateway.trustedProxies.length === 0) {
  config.gateway.trustedProxies = ['127.0.0.1', '::1', '172.16.0.0/12', '10.0.0.0/8'];
  console.log('Set gateway.trustedProxies for reverse-proxy / docker peers');
}

if (!config.tools) config.tools = {};
if (!config.tools.sessions) config.tools.sessions = {};
config.tools.sessions.visibility = SESSION_VISIBILITY;
console.log('Set tools.sessions.visibility:', SESSION_VISIBILITY);

// Disable OpenClaw auto media-understanding when it fails (ProviderHttpError / no vision)
// and replaces usable MEDIA: paths with "[whatsapp attachment unavailable]".
// Agent OS mirrors inbound files to workspace inbound/attachments + speech_stt / workflows.
if (!config.tools.media || typeof config.tools.media !== 'object') config.tools.media = {};
for (const cap of ['image', 'audio', 'video']) {
  if (!config.tools.media[cap] || typeof config.tools.media[cap] !== 'object') {
    config.tools.media[cap] = {};
  }
  config.tools.media[cap].enabled = false;
}
console.log('Disabled tools.media.{image,audio,video}.enabled (Agent OS inbound sync + speech tools handle A/V)');

// OpenClaw intersects agent tools.allow with global tools.allow. Plugin tools missing
// from the global list are stripped (COO learnings_summary regressed this way).
if (!Array.isArray(config.tools.allow)) config.tools.allow = [];
// OpenClaw 2026.7+: `browser` is a plugin tool with empty tool-profiles. Listing it in
// tools.allow marks it as an unavailable core entry. Keep it out of the global allowlist;
// enable via agents.list browser-cdp tools.profile + tools.alsoAllow instead.
config.tools.allow = config.tools.allow.filter((name) => String(name) !== 'browser');
delete config.tools.alsoAllow;
let globalAdded = 0;
for (const name of REQUIRED_GLOBAL_CONTENT_TOOLS) {
  if (name === 'browser') continue;
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
// Chat agents that must use browse_* (not built-in browser). Do NOT blanket-deny
// browser for every agent that has browse_task_start — that breaks backend CDP
// invokes (jobdiscovery / browser-cdp) and job portal automation.
const BROWSER_DENIED_AGENT_IDS = new Set(['techresearcher', 'balserve', 'workflowbuilder', 'platformhelp']);
const BROWSER_CDP_AGENT_ID = String(process.env.BROWSER_TASK_CDP_AGENT_ID || 'browser-cdp').trim() || 'browser-cdp';

function applyBrowserCdpAgentTools(agent) {
  agent.tools = agent.tools || {};
  // OpenClaw forbids allow + alsoAllow in the same scope. Browser is not in coding/minimal/
  // messaging profiles, so enable it with profile + alsoAllow only.
  delete agent.tools.allow;
  agent.tools.profile = 'coding';
  agent.tools.alsoAllow = ['browser'];
  agent.tools.deny = ['image'];
}

// Dedicated backend CDP agent: always allowed to use built-in browser tool.
if (!Array.isArray(config.agents.list)) config.agents.list = [];
{
  const existing = config.agents.list.find(
    (a) => String(a?.id || '').toLowerCase() === BROWSER_CDP_AGENT_ID.toLowerCase()
  );
  if (existing) {
    existing.name = existing.name || 'Browser CDP';
    applyBrowserCdpAgentTools(existing);
  } else {
    const cdpAgent = {
      id: BROWSER_CDP_AGENT_ID,
      name: 'Browser CDP',
      tools: {},
    };
    applyBrowserCdpAgentTools(cdpAgent);
    config.agents.list.push(cdpAgent);
  }
  console.log('Ensured CDP browser agent:', BROWSER_CDP_AGENT_ID, '(profile=coding alsoAllow=browser)');
}

if (Array.isArray(config.agents?.list)) {
  for (const agent of config.agents.list) {
    const id = String(agent?.id || '').toLowerCase();
    const leafId = id.includes('--') ? id.split('--').pop() : id;
    const isCdpAgent = id === BROWSER_CDP_AGENT_ID.toLowerCase() || leafId === BROWSER_CDP_AGENT_ID.toLowerCase();
    if (isCdpAgent) {
      applyBrowserCdpAgentTools(agent);
      continue;
    }
    const required = AGENT_CONTENT_TOOLS[id] || AGENT_CONTENT_TOOLS[leafId];
    agent.tools = agent.tools || {};
    if (!Array.isArray(agent.tools.allow)) agent.tools.allow = [];
    // Keep allowlists free of the unavailable core `browser` entry.
    agent.tools.allow = agent.tools.allow.filter((name) => String(name) !== 'browser');
    delete agent.tools.alsoAllow;
    let added = 0;
    for (const name of required || []) {
      if (name === 'browser') continue;
      if (!agent.tools.allow.includes(name)) {
        agent.tools.allow.push(name);
        added += 1;
      }
    }
    const deny = Array.isArray(agent.tools.deny) ? agent.tools.deny : [];
    const mustDenyBrowser = BROWSER_DENIED_AGENT_IDS.has(id) || BROWSER_DENIED_AGENT_IDS.has(leafId);
    if (required || mustDenyBrowser) {
      if (!deny.includes('image')) deny.push('image');
    }
    if (mustDenyBrowser) {
      if (!deny.includes('browser')) deny.push('browser');
    }
    agent.tools.deny = deny;
    if (added) console.log(`Added ${added} tool(s) to agents.list ${id} tools.allow`);
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

{
  if (!config.models) config.models = {};
  if (!config.models.providers) config.models.providers = {};
  const ollamaCtx = Math.max(
    8192,
    Number(process.env.OLLAMA_CONTEXT_WINDOW || process.env.OPENCLAW_OLLAMA_CONTEXT_WINDOW || 32768) || 32768
  );
  const ollamaMaxTok = Math.max(
    1024,
    Number(process.env.OLLAMA_MAX_TOKENS || process.env.OPENCLAW_OLLAMA_MAX_TOKENS || 4096) || 4096
  );
  const wantedIds = [];
  const primaryHint = String(process.env.OPENCLAW_MODEL_PRIMARY || '').trim();
  if (primaryHint.toLowerCase().startsWith('ollama/')) {
    wantedIds.push(primaryHint.slice(primaryHint.indexOf('/') + 1));
  }
  for (const raw of [
    process.env.OLLAMA_MODEL,
    process.env.OPENCLAW_OLLAMA_FALLBACK_MODEL,
    process.env.OPENAI_PRIMARY_MODEL,
  ]) {
    const id = String(raw || '').trim();
    if (id && !id.includes('://') && !wantedIds.includes(id)) wantedIds.push(id);
  }
  const existingOllama = config.models.providers.ollama || {};
  const existingModels = Array.isArray(existingOllama.models) ? existingOllama.models : [];
  const byId = new Map();
  for (const m of existingModels) {
    const id = typeof m === 'string' ? m : m?.id;
    if (!id) continue;
    byId.set(
      id,
      typeof m === 'string' ? ollamaModelObject(id, ollamaCtx, ollamaMaxTok) : { ...m, id }
    );
  }
  for (const id of wantedIds) {
    if (!byId.has(id)) byId.set(id, ollamaModelObject(id, ollamaCtx, ollamaMaxTok));
  }
  if (!byId.size) {
    byId.set('llama3.2', ollamaModelObject('llama3.2', ollamaCtx, ollamaMaxTok));
  }
  const models = [...byId.values()].map((m) => ({
    ...m,
    api: 'openai-completions',
    contextWindow: Math.min(Math.max(Number(m.contextWindow) || 0, 8192), ollamaCtx) || ollamaCtx,
    maxTokens: Math.min(Math.max(Number(m.maxTokens) || 0, 1024), ollamaMaxTok) || ollamaMaxTok,
  }));
  config.models.providers.ollama = {
    ...existingOllama,
    baseUrl: `${OLLAMA_BASE}/v1`,
    apiKey: process.env.OLLAMA_API_KEY || existingOllama.apiKey || 'ollama-local',
    api: 'openai-completions',
    models,
  };
  console.log(
    'Set Ollama provider',
    `${OLLAMA_BASE}/v1`,
    'models=',
    models.map((m) => `${m.id}:${m.contextWindow}`).join(', ')
  );
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

const envPrimary = String(process.env.OPENCLAW_MODEL_PRIMARY || 'openai/gpt-4o-mini').trim();
const useLocalOllamaPrimary =
  !useSecondaryPlatform &&
  (process.env.PLATFORM_USE_LOCAL_OLLAMA === '1' ||
    process.env.PLATFORM_USE_LOCAL_OLLAMA === 'true' ||
    envPrimary.toLowerCase().startsWith('ollama/'));
const openaiKey = useSecondaryPlatform
  ? String(process.env.OPENAI_SECONDARY_API_KEY || '').trim()
  : String(process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
const primarySlug = useSecondaryPlatform
  ? markerPrimarySlug && markerPrimarySlug.startsWith('openai/')
    ? markerPrimarySlug
    : `openai/${String(process.env.OPENAI_SECONDARY_MODEL || 'gpt-4o').trim().replace(/^[^/]+\//, '')}`
  : useLocalOllamaPrimary
    ? envPrimary
    : markerPrimarySlug || envPrimary;
const primaryId = primarySlug.includes('/')
  ? primarySlug.slice(primarySlug.indexOf('/') + 1)
  : primarySlug || 'gpt-4o-mini';
const primaryIsOllama = String(primarySlug || '').toLowerCase().startsWith('ollama/');
const primaryModelHint = `${primarySlug} ${useSecondaryPlatform ? process.env.OPENAI_SECONDARY_MODEL : process.env.OPENAI_PRIMARY_MODEL || ''}`.toLowerCase();
const looksLikeDeepSeek = !primaryIsOllama && primaryModelHint.includes('deepseek');
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
if (openaiKey && !primaryIsOllama && !isLocalOllamaBase(openaiBase)) {
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
} else if (primaryIsOllama || isLocalOllamaBase(openaiBase)) {
  try {
    const runtimePath = join(OPENCLAW_DIR, 'platform-llm-runtime.env');
    const ollamaKey = process.env.OLLAMA_API_KEY || openaiKey || 'ollama-local';
    writeFileSync(
      runtimePath,
      `OPENAI_API_KEY=${ollamaKey}\nOPENAI_BASE_URL=${OLLAMA_BASE}/v1\n`,
      'utf8'
    );
    console.log('Wrote', runtimePath, 'for local Ollama primary=', primarySlug);
  } catch (e) {
    console.warn('Could not write platform-llm-runtime.env for Ollama:', e?.message || e);
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
// OpenClaw intersects global tools.allow with agent alsoAllow and strips `browser`
// (plugin tool outside coding/messaging profiles). Keep content tools on per-agent
// allowlists; omit the global allowlist so browser-cdp profile+alsoAllow works.
if (config.tools) {
  delete config.tools.allow;
  delete config.tools.alsoAllow;
  console.log('Cleared global tools.allow (required for browser CDP /tools/invoke)');
}
// Restore Slack/WhatsApp accounts+bindings from sidecar if this rewrite would drop them.
const routing = ensureChannelRoutingOnConfig(config, OPENCLAW_DIR);
if (routing.restored) {
  console.log('Restored channels/bindings from agent-os-channel-routing.json');
}
if (config.channels == null) delete config.channels;
if (config.bindings == null) delete config.bindings;
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
console.log('Updated', CONFIG_PATH);
if (config.channels?.whatsapp?.accounts) {
  console.log(
    'Preserved channels.whatsapp accounts:',
    Object.keys(config.channels.whatsapp.accounts).join(', ') || '(none)'
  );
}

// Apply media size limit AFTER channel routing restore (sidecar replace would drop it).
{
  const mediaMaxMb = Math.max(
    50,
    Number.parseInt(String(process.env.OPENCLAW_MEDIA_MAX_MB || '128'), 10) || 128
  );
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  config.agents.defaults.mediaMaxMb = mediaMaxMb;
  if (config.channels?.whatsapp && typeof config.channels.whatsapp === 'object') {
    config.channels.whatsapp.mediaMaxMb = mediaMaxMb;
    // DM allowFrom does not block @g.us; default groupPolicy to disabled when unset.
    if (!config.channels.whatsapp.groupPolicy) {
      config.channels.whatsapp.groupPolicy = 'disabled';
    }
    const accounts = config.channels.whatsapp.accounts;
    if (accounts && typeof accounts === 'object') {
      for (const id of Object.keys(accounts)) {
        const acc = accounts[id];
        if (!acc || typeof acc !== 'object') continue;
        acc.mediaMaxMb = mediaMaxMb;
        if (!acc.groupPolicy) acc.groupPolicy = 'disabled';
      }
    }
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  console.log('Set WhatsApp/agents mediaMaxMb=', mediaMaxMb);
}

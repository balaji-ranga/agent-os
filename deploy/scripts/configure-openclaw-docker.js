/**
 * Merge production/container settings into openclaw.json after apply-openclaw-agents-config.js.
 * - gateway.auth.token from OPENCLAW_GATEWAY_TOKEN
 * - gateway.http.endpoints.chatCompletions.enabled = true (required for Agent Chat /v1/chat/completions)
 * - Prefer entrypoint ensure-openclaw-gateway-config.js first (restores wiped sections from bak)
 * - agent-os-content-tools plugin baseUrl from AGENT_OS_INTERNAL_API_URL (default http://backend:3001)
 * - agent-os-content-tools uses backend-provisioned owner/agent credentials (no shared API key)
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
  applyWhatsAppFromPrefixToChannel,
  applyIdentityNameToAgentEntry,
} from '../../scripts/lib/openclaw-whatsapp-from-prefix.js';
import {
  REQUIRED_GLOBAL_CONTENT_TOOLS,
  COO_CONTENT_TOOLS_ALLOW,
  WORKFLOW_BUILDER_CONTENT_TOOLS_ALLOW,
  PLATFORM_HELP_CONTENT_TOOLS_ALLOW,
} from '../../scripts/lib/content-tools-allow.js';
import {
  resolveLocalOllamaContextWindow,
  resolveLocalOllamaInferCtx,
  resolveLocalOllamaTimeoutSeconds,
} from '../../scripts/lib/local-ollama-context.js';

const OPENCLAW_DIR = resolveOpenClawDir();
const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || join(OPENCLAW_DIR, 'openclaw.json');

const GATEWAY_TOKEN = String(process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
const INTERNAL_API = String(process.env.AGENT_OS_INTERNAL_API_URL || 'http://backend:3001').replace(/\/$/, '');
const OLLAMA_BASE = String(process.env.OLLAMA_BASE_URL || 'http://ollama:11434')
  .replace(/\/?$/, '')
  .replace(/\/v1$/i, '');
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

function ollamaModelObject(id, ctx, maxTok, inferCtx) {
  return {
    id,
    name: id,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: ctx,
    maxTokens: maxTok,
    api: 'ollama',
    params: {
      num_ctx: inferCtx,
      thinking: false,
      keep_alive: '30m',
    },
  };
}

if (!existsSync(CONFIG_PATH)) {
  console.error('openclaw.json not found at', CONFIG_PATH);
  process.exit(1);
}

let config;
let originalConfigText = '';
try {
  originalConfigText = readFileSync(CONFIG_PATH, 'utf8');
  config = JSON.parse(originalConfigText);
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

// OpenClaw 2026.8+ implicitly selects its optional Codex app-server harness for
// compatible openai/* routes. That harness rejects Agent OS plugin tools with
// type "custom" (OpenAI 400 invalid_request_error), so Flolah deliberately uses
// the embedded OpenClaw harness. The provider-level agentRuntime pin is applied
// below after models.providers.openai is assembled.
if (!config.plugins) config.plugins = {};
if (!config.plugins.entries) config.plugins.entries = {};
// Do not retain even a disabled entry: OpenClaw validates its manifest path at
// startup, so an uninstalled legacy plugin referenced here causes a crash loop.
delete config.plugins.entries.codex;
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
// DeepSeek models are exposed through Flolah's OpenAI-compatible provider
// routing. The optional external OpenClaw DeepSeek plugin is therefore not
// required and can independently drift beyond the pinned gateway API version,
// preventing the gateway from starting. Keep it opt-in for installations that
// explicitly need plugin-native DeepSeek behaviour.
const enableDeepSeekPlugin = String(process.env.OPENCLAW_ENABLE_DEEPSEEK_PLUGIN || '0') === '1';
config.plugins.allow = config.plugins.allow.filter(
  (id) => id !== 'codex' && (enableDeepSeekPlugin || id !== 'deepseek')
);
if (!enableDeepSeekPlugin) {
  // Keep an explicit disabled policy entry. Deleting it lets the official plugin
  // catalog auto-discover DeepSeek and demand capability consent at gateway boot.
  config.plugins.entries.deepseek = { enabled: false };
  console.log('Disabled optional DeepSeek plugin; models remain available through provider routing');
}
console.log('Removed optional Codex harness configuration; plugins.allow=', config.plugins.allow.join(', '));

// Root browser block is required for the built-in `browser` tool to register.
// Without it, /tools/invoke returns "Tool not available: browser" for every agent.
if (!config.browser || typeof config.browser !== 'object') config.browser = {};
config.browser.enabled = true;
config.browser.defaultProfile = config.browser.defaultProfile || 'openclaw';
if (!config.browser.profiles || typeof config.browser.profiles !== 'object') {
  config.browser.profiles = { openclaw: { cdpPort: 18800 } };
} else if (!config.browser.profiles.openclaw) {
  config.browser.profiles.openclaw = { cdpPort: 18800 };
}
// OpenClaw 2026.9 removed the profile-level color field.
delete config.browser.profiles.openclaw.color;
if (config.browser.headless == null) config.browser.headless = true;
if (config.browser.noSandbox == null) config.browser.noSandbox = true;
console.log(
  'Set browser.enabled=true defaultProfile=%s headless=%s',
  config.browser.defaultProfile,
  config.browser.headless
);

function dockerDefaultGateway() {
  try {
    const rows = readFileSync('/proc/net/route', 'utf8').trim().split(/\r?\n/).slice(1);
    const route = rows.map((line) => line.trim().split(/\s+/)).find((cols) => cols[1] === '00000000');
    const hex = route?.[2];
    if (!/^[0-9A-Fa-f]{8}$/.test(hex || '')) return '';
    return [6, 4, 2, 0].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join('.');
  } catch {
    return '';
  }
}

function resolveTrustedProxies() {
  const configured = String(process.env.OPENCLAW_TRUSTED_PROXIES || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const gateway = dockerDefaultGateway();
  return [...new Set(configured.length > 0 ? configured : ['127.0.0.1', '::1', gateway].filter(Boolean))];
}

// Trust only loopback and the container's exact default gateway (host-network nginx via
// docker-proxy). Never trust whole private/Docker CIDRs: doing so misclassifies direct
// backend calls as proxy traffic and OpenClaw correctly rejects them without client attribution.
config.gateway.trustedProxies = resolveTrustedProxies();
console.log('Set narrow gateway.trustedProxies=%j', config.gateway.trustedProxies);

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

// OpenClaw can persist either the legacy agents.list roster or the newer
// agents.entries map. Adapt in memory and write back in the same schema.
const usesAgentEntries =
  config.agents.entries && typeof config.agents.entries === 'object' && !Array.isArray(config.agents.entries);
const agentRoster = usesAgentEntries
  ? Object.entries(config.agents.entries).map(([id, entry]) => ({ id, ...(entry || {}) }))
  : Array.isArray(config.agents.list)
    ? config.agents.list
    : [];
// Multi-agent rosters require explicit ownership in supported pinned runtimes,
// regardless of whether the roster is represented as list or entries.
config.agents.ownership = 'explicit';
function persistAgentRoster() {
  if (usesAgentEntries) {
    config.agents.entries = Object.fromEntries(
      agentRoster.map((entry) => {
        const { id, ...value } = entry;
        return [String(id), value];
      })
    );
    delete config.agents.list;
  } else {
    config.agents.list = agentRoster;
  }
}

// Dedicated backend CDP agent: always allowed to use built-in browser tool.
{
  const existing = agentRoster.find(
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
    agentRoster.push(cdpAgent);
  }
  console.log('Ensured CDP browser agent:', BROWSER_CDP_AGENT_ID, '(profile=coding alsoAllow=browser)');
}

if (agentRoster.length) {
  for (const agent of agentRoster) {
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
delete pluginConfig.apiKey;
console.log('Removed legacy shared apiKey from agent-os-content-tools; using owner/agent credentials');
config.plugins.entries['agent-os-content-tools'] = {
  ...plugin,
  enabled: true,
  config: pluginConfig,
};
console.log('Set agent-os-content-tools baseUrl:', INTERNAL_API);

{
  if (!config.models) config.models = {};
  if (!config.models.providers) config.models.providers = {};

  const ollamaIsPrimary =
    process.env.PLATFORM_USE_LOCAL_OLLAMA === '1' ||
    process.env.PLATFORM_USE_LOCAL_OLLAMA === 'true' ||
    String(process.env.OPENCLAW_MODEL_PRIMARY || '').toLowerCase().startsWith('ollama/');
  const ollamaCtx = ollamaIsPrimary
    ? resolveLocalOllamaContextWindow(
        process.env.OLLAMA_CONTEXT_WINDOW || process.env.OPENCLAW_OLLAMA_CONTEXT_WINDOW,
        process.env.OLLAMA_MODEL_NATIVE_CONTEXT
      )
    : Math.max(
        8192,
        Number(process.env.OLLAMA_CONTEXT_WINDOW || process.env.OPENCLAW_OLLAMA_CONTEXT_WINDOW || 8192) || 8192
      );
  const ollamaMaxTok = Math.max(
    1024,
    Number(process.env.OLLAMA_MAX_TOKENS || process.env.OPENCLAW_OLLAMA_MAX_TOKENS || 4096) || 4096
  );
  const ollamaInferCtx = resolveLocalOllamaInferCtx(process.env.OLLAMA_NUM_CTX);
  const ollamaTimeoutSec = resolveLocalOllamaTimeoutSeconds(
    process.env.OPENCLAW_OLLAMA_CHAT_TIMEOUT_MS
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
      typeof m === 'string'
        ? ollamaModelObject(id, ollamaCtx, ollamaMaxTok, ollamaInferCtx)
        : { ...m, id }
    );
  }
  for (const id of wantedIds) {
    if (!byId.has(id)) byId.set(id, ollamaModelObject(id, ollamaCtx, ollamaMaxTok, ollamaInferCtx));
  }
  if (!byId.size) {
    byId.set('llama3.2', ollamaModelObject('llama3.2', ollamaCtx, ollamaMaxTok, ollamaInferCtx));
  }
  const models = [...byId.values()].map((m) => ({
    ...m,
    api: 'ollama',
    contextWindow: ollamaCtx,
    maxTokens: Math.min(Math.max(Number(m.maxTokens) || 0, 1024), ollamaMaxTok) || ollamaMaxTok,
    params: {
      ...(m.params && typeof m.params === 'object' ? m.params : {}),
      num_ctx: ollamaInferCtx,
      thinking: false,
      keep_alive: m.params?.keep_alive || '30m',
    },
  }));
  config.models.providers.ollama = {
    ...existingOllama,
    baseUrl: OLLAMA_BASE,
    apiKey: process.env.OLLAMA_API_KEY || existingOllama.apiKey || 'ollama-local',
    api: 'ollama',
    timeoutSeconds: ollamaTimeoutSec,
    models,
  };
  console.log(
    'Set Ollama provider',
    OLLAMA_BASE,
    `timeoutSeconds=${ollamaTimeoutSec}`,
    `num_ctx=${ollamaInferCtx}`,
    'models=',
    models.map((m) => `${m.id}:${m.contextWindow}`).join(', ')
  );
}

// Register OpenAI-compatible provider from env (official OpenAI or DeepSeek / other bases).
// When admin has switched to secondary, honor platform-llm-active.json (written by syncPlatformEndpointToOpenClaw)
// so restart does not wipe openai/gpt-4o back to OPENCLAW_MODEL_PRIMARY=deepseek.
let platformActive = 'primary';
let markerPrimarySlug = '';
let markerFallbacks = [];
try {
  const markerPath = join(OPENCLAW_DIR, 'platform-llm-active.json');
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    if (String(marker?.active || '').toLowerCase() === 'secondary') platformActive = 'secondary';
    markerPrimarySlug = String(marker?.primary || '').trim();
    markerFallbacks = Array.isArray(marker?.fallbacks)
      ? marker.fallbacks.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  }
} catch {
  /* ignore */
}
const envPrimary = String(process.env.OPENCLAW_MODEL_PRIMARY || 'openai/gpt-4o-mini').trim();
const forceLocalOllama =
  process.env.PLATFORM_USE_LOCAL_OLLAMA === '1' ||
  process.env.PLATFORM_USE_LOCAL_OLLAMA === 'true' ||
  envPrimary.toLowerCase().startsWith('ollama/');
const useSecondaryPlatform =
  !forceLocalOllama &&
  platformActive === 'secondary' &&
  String(process.env.OPENAI_SECONDARY_API_KEY || '').trim() &&
  String(process.env.OPENAI_SECONDARY_MODEL || '').trim();
const useLocalOllamaPrimary = forceLocalOllama;
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

// Keep Flolah agents on the embedded runtime for every OpenAI-compatible route.
// This is provider-scoped (not agent-scoped), so Admin primary/secondary model
// switching still works while all tenant agents retain Agent OS custom tools.
// Apply after provider assembly because the custom/DeepSeek branch replaces the
// provider object rather than spreading the previous value.
if (config.models.providers.openai && typeof config.models.providers.openai === 'object') {
  config.models.providers.openai.agentRuntime = { id: 'openclaw' };
  console.log('Pinned models.providers.openai.agentRuntime=openclaw');
}

// Always align default primary model with OPENCLAW_MODEL_PRIMARY.
if (!config.agents) config.agents = {};
if (!config.agents.defaults) config.agents.defaults = {};
if (!config.agents.defaults.model) config.agents.defaults.model = {};
config.agents.defaults.model.primary = primarySlug;
console.log('Set agents.defaults.model.primary=', primarySlug);
if (primaryIsOllama && !config.agents.defaults.compaction) {
  config.agents.defaults.compaction = { mode: 'safeguard' };
  console.log('Set agents.defaults.compaction.mode=safeguard for local Ollama primary');
}
if (primaryIsOllama) {
  const ocTimeoutSec = resolveLocalOllamaTimeoutSeconds(
    process.env.OPENCLAW_OLLAMA_CHAT_TIMEOUT_MS
  );
  config.agents.defaults.maxConcurrent = 1;
  config.agents.defaults.timeoutSeconds = ocTimeoutSec;
  if (!config.agents.defaults.subagents || typeof config.agents.defaults.subagents !== 'object') {
    config.agents.defaults.subagents = {};
  }
  config.agents.defaults.subagents.maxConcurrent = 1;
  console.log(
    `Set agents.defaults.maxConcurrent=1 timeoutSeconds=${ocTimeoutSec} for local Ollama primary`
  );
}

// Model fallbacks: OPENCLAW_MODEL_FALLBACKS (comma-separated) or optional Ollama toggle.
// OPENCLAW_ENABLE_OLLAMA_FALLBACK=0 strips ollama/* even if listed in OPENCLAW_MODEL_FALLBACKS
// (otherwise Admin LLM auth failures silently dump tool schemas via llama).
{
  const enableOllamaFallback =
    process.env.OPENCLAW_ENABLE_OLLAMA_FALLBACK === '1' ||
    process.env.OPENCLAW_ENABLE_OLLAMA_FALLBACK === 'true';
  const primary = String(config.agents.defaults.model.primary || primarySlug || '').trim();
  let fallbacks = [
    ...markerFallbacks,
    ...String(process.env.OPENCLAW_MODEL_FALLBACKS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  ].filter((s, index, all) => s && s !== primary && all.indexOf(s) === index);
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
persistAgentRoster();
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
    applyWhatsAppFromPrefixToChannel(config.channels.whatsapp);
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
  const identityRoster = usesAgentEntries ? Object.values(config.agents.entries || {}) : config.agents.list || [];
  if (Array.isArray(identityRoster)) {
    for (const entry of identityRoster) {
      applyIdentityNameToAgentEntry(entry);
    }
  }
  const serializedConfig = `${JSON.stringify(config, null, 2)}\n`;
  if (serializedConfig.trim() !== originalConfigText.trim()) {
    writeFileSync(CONFIG_PATH, serializedConfig, 'utf8');
    console.log('Updated', CONFIG_PATH);
  } else {
    console.log('Configuration already current; preserving file revision', CONFIG_PATH);
  }
  console.log('Set WhatsApp/agents mediaMaxMb=', mediaMaxMb, 'responsePrefix=From: {identityName}');
}

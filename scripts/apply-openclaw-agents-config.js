/**
 * Apply agents.list (Bala, COO, TechResearcher) to OpenClaw config and restart the gateway.
 * Run from agent-os: node scripts/apply-openclaw-agents-config.js
 * Requires: write access to ~/.openclaw/openclaw.json
 * Loads backend/.env (and deploy/.env if present) so OPENAI_* / OPENCLAW_MODEL_PRIMARY apply.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveOpenClawDir } from './lib/openclaw-paths.js';
import {
  REQUIRED_GLOBAL_CONTENT_TOOLS,
  COO_CONTENT_TOOLS_ALLOW,
  WORKFLOW_BUILDER_CONTENT_TOOLS_ALLOW,
  PLATFORM_HELP_CONTENT_TOOLS_ALLOW,
} from './lib/content-tools-allow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_OS_ROOT = join(__dirname, '..');

/** Minimal .env loader (no dotenv dependency in scripts/). Does not override existing env. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(join(AGENT_OS_ROOT, 'backend', '.env'));
loadEnvFile(join(AGENT_OS_ROOT, 'deploy', '.env'));

const OPENCLAW_DIR = resolveOpenClawDir();
const CONFIG_PATH = join(OPENCLAW_DIR, 'openclaw.json');

// Use forward slashes so JSON is valid and OpenClaw accepts them on Windows
const toSlash = (p) => p.replace(/\\/g, '/');

// Same tools config for all agents that should be able to invoke Agent OS tools.
// IMPORTANT: keep this list to actual TOOL NAMES only. Non-tool entries can cause OpenClaw
// to ignore the allowlist and the agent will not see the tools.
const CONTENT_TOOLS_ALLOW = [...COO_CONTENT_TOOLS_ALLOW];
const CONTENT_TOOLS_CONFIG = { allow: [...CONTENT_TOOLS_ALLOW], deny: ['image'] };

// Remove stale/unknown tool names that cause OpenClaw to ignore tools.allow completely.
const REMOVE_FROM_ALLOWLIST = new Set(['cron.add', 'cron_add']);

const AGENTS_LIST = [
  { id: 'bala', name: 'Bala', default: true, workspace: toSlash(join(OPENCLAW_DIR, 'workspace')) },
  { id: 'balserve', name: 'COO', workspace: toSlash(join(OPENCLAW_DIR, 'workspace-balserve')), tools: { ...CONTENT_TOOLS_CONFIG } },
  {
    id: 'workflowbuilder',
    name: 'Workflow Builder',
    workspace: toSlash(join(OPENCLAW_DIR, 'workspace-workflowbuilder')),
    tools: {
      allow: [...WORKFLOW_BUILDER_CONTENT_TOOLS_ALLOW],
      deny: ['image'],
    },
  },
  {
    id: 'platformhelp',
    name: 'Platform Help',
    workspace: toSlash(join(OPENCLAW_DIR, 'workspace-platformhelp')),
    tools: {
      allow: [...PLATFORM_HELP_CONTENT_TOOLS_ALLOW],
      deny: ['image'],
    },
  },
  { id: 'techresearcher', name: 'TechResearcher', workspace: toSlash(join(OPENCLAW_DIR, 'workspace-techresearcher')), tools: { ...CONTENT_TOOLS_CONFIG } },
  { id: 'expensemanager', name: 'ExpenseManager', workspace: toSlash(join(OPENCLAW_DIR, 'workspace-expenses')), tools: { ...CONTENT_TOOLS_CONFIG } },
  { id: 'socialasstant', name: 'SocialAssistant', workspace: toSlash(join(OPENCLAW_DIR, 'workspace-socialasstant')), tools: { ...CONTENT_TOOLS_CONFIG } },
];

const GATEWAY_DEFAULTS = {
  mode: 'local',
  port: 18789,
  http: { endpoints: { chatCompletions: { enabled: true } } },
};

function mergeDeep(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] != null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (target[key] == null) target[key] = {};
      mergeDeep(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

let config = {};
if (existsSync(CONFIG_PATH)) {
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error('Could not parse existing openclaw.json:', e.message);
    process.exit(1);
  }
}

// Primary model for OpenClaw agents. Override with OPENCLAW_MODEL_PRIMARY (e.g. openai/gpt-4o-mini).
const DEFAULT_MODEL = process.env.OPENCLAW_MODEL_PRIMARY || 'openai/gpt-4o-mini';
// Local Ollama as secondary fallback when primary fails. Override with OPENCLAW_OLLAMA_FALLBACK_MODEL (e.g. llama3.3).
const OLLAMA_FALLBACK = process.env.OPENCLAW_OLLAMA_FALLBACK_MODEL || 'llama3.2';
const OLLAMA_FALLBACK_ID = `ollama/${OLLAMA_FALLBACK}`;

if (!config.agents) config.agents = {};
// Merge AGENTS_LIST into existing list by id so we set tools for techresearcher/expensemanager/socialasstant like SocialAssistant, and don't drop other agents
const existingList = Array.isArray(config.agents.list) ? config.agents.list : [];
const byId = new Map(existingList.map((a) => [(a.id || '').toLowerCase(), a]));
for (const agent of AGENTS_LIST) {
  const id = (agent.id || '').toLowerCase();
  const existing = byId.get(id);
  if (existing) {
    Object.assign(existing, agent);
    byId.set(id, existing);
  } else {
    byId.set(id, { ...agent });
  }
}
config.agents.list = Array.from(byId.values());

// Ensure per-agent tool allowlists don't contain stale entries.
for (const a of config.agents.list) {
  if (a?.tools?.allow && Array.isArray(a.tools.allow)) {
    a.tools.allow = a.tools.allow.filter((t) => !REMOVE_FROM_ALLOWLIST.has(String(t)));
  }
}
if (!config.agents.defaults) config.agents.defaults = {};
if (!config.agents.defaults.model) config.agents.defaults.model = {};
config.agents.defaults.model.primary = DEFAULT_MODEL;
// Fallbacks: OPENCLAW_MODEL_FALLBACKS (comma-separated) or optional Ollama toggle.
const enableOllamaFallback =
  process.env.OPENCLAW_ENABLE_OLLAMA_FALLBACK === '1' ||
  process.env.OPENCLAW_ENABLE_OLLAMA_FALLBACK === 'true';
const extraFallbacks = String(process.env.OPENCLAW_MODEL_FALLBACKS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (extraFallbacks.length) {
  config.agents.defaults.model.fallbacks = extraFallbacks.filter((s) => s && s !== DEFAULT_MODEL);
} else {
  config.agents.defaults.model.fallbacks = enableOllamaFallback ? [OLLAMA_FALLBACK_ID] : [];
}

if (!config.models) config.models = {};
if (!config.models.providers) config.models.providers = {};

// OpenAI-compatible primary (official OpenAI or DeepSeek / custom base from backend .env).
{
  const openaiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
  const openaiBaseRaw = String(
    process.env.OPENAI_BASE_URL || process.env.OPENAI_PRIMARY_BASE_URL || 'https://api.openai.com/v1'
  )
    .trim()
    .replace(/\/$/, '');
  const openaiBase = openaiBaseRaw.endsWith('/v1') ? openaiBaseRaw : `${openaiBaseRaw}/v1`;
  let useOfficialOpenAi = false;
  try {
    useOfficialOpenAi = new URL(openaiBase).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    useOfficialOpenAi = false;
  }
  const primaryId = DEFAULT_MODEL.includes('/')
    ? DEFAULT_MODEL.slice(DEFAULT_MODEL.indexOf('/') + 1)
    : DEFAULT_MODEL || 'gpt-4o-mini';
  if (openaiKey) {
    const existing = config.models.providers.openai || {};
    const catalogIds = useOfficialOpenAi
      ? [primaryId, 'gpt-4o-mini', 'gpt-4o']
      : [primaryId, 'deepseek-v4-flash', 'deepseek-v4-pro'].filter(
          (id, i, arr) => id && arr.indexOf(id) === i
        );
    const ctxWindow = useOfficialOpenAi ? 128000 : 1000000;
    const maxTok = useOfficialOpenAi ? 16384 : 65536;
    const models = catalogIds.map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: ctxWindow,
      maxTokens: maxTok,
      api: useOfficialOpenAi ? 'openai-responses' : 'openai-completions',
    }));
    if (useOfficialOpenAi) {
      config.models.providers.openai = {
        ...existing,
        apiKey: openaiKey,
        api: 'openai-responses',
        models,
      };
      delete config.models.providers.openai.baseUrl;
    } else {
      config.models.providers.openai = {
        ...existing,
        baseUrl: openaiBase,
        apiKey: openaiKey,
        api: 'openai-completions',
        models,
      };
    }
    config.models.mode = 'replace';
    console.log(
      'Set models.providers.openai',
      useOfficialOpenAi ? '(official Responses)' : `(completions ${openaiBase})`,
      'primary=',
      DEFAULT_MODEL
    );
  }
}

// Ollama on localhost: optional explicit provider so fallback works without relying only on auto-discovery.
// Set OLLAMA_API_KEY=ollama-local (or any value) so OpenClaw can use Ollama; baseUrl defaults to localhost:11434.
// OpenClaw requires models.providers.ollama.models to be an array of model objects (not strings).
function ollamaModelObject(id) {
  return {
    id,
    name: id,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 81920,
  };
}
if (!config.models.providers.ollama) {
  const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/?$/, '');
  config.models.providers.ollama = {
    baseUrl: ollamaBase + '/v1',
    apiKey: process.env.OLLAMA_API_KEY || 'ollama-local',
    api: 'openai-responses',
    models: [ollamaModelObject(OLLAMA_FALLBACK)],
  };
} else if (!Array.isArray(config.models.providers.ollama.models) || (config.models.providers.ollama.models[0] && typeof config.models.providers.ollama.models[0] === 'string')) {
  config.models.providers.ollama.models = [ollamaModelObject(OLLAMA_FALLBACK)];
}

// Agent-to-agent: explicit allow list (gateway may not accept "*"). All listed agents can use sessions_send.
if (!config.tools) config.tools = {};
config.tools.agentToAgent = {
  enabled: true,
  allow: ['bala', 'balserve', 'workflowbuilder', 'platformhelp', 'techresearcher', 'expensemanager', 'socialasstant'],
};

// Remove agents.defaults.subagents if present (can prevent gateway from starting).
if (config.agents?.defaults?.subagents) delete config.agents.defaults.subagents;

// Skills: enable agent-send and agent-os-content-tools so they appear in the dashboard and are loaded.
if (!config.skills) config.skills = {};
if (!config.skills.entries) config.skills.entries = {};
config.skills.entries['agent-send'] = { enabled: true, ...config.skills.entries['agent-send'] };
config.skills.entries['agent-os-content-tools'] = { enabled: true, ...config.skills.entries['agent-os-content-tools'] };
config.skills.entries['browser-automation'] = { enabled: true, ...config.skills.entries['browser-automation'] };

// Plugins: load agent-os-content-tools extension so summarize_url, generate_image, generate_video appear as tools.
// Install first: node scripts/install-agent-os-content-tools-extension.js
// Set baseUrl in config or AGENT_OS_API_URL env (e.g. http://127.0.0.1:3001).
const extensionsDir = toSlash(join(OPENCLAW_DIR, 'extensions', 'agent-os-content-tools'));
if (!config.plugins) config.plugins = {};
if (!config.plugins.load) config.plugins.load = {};
if (!Array.isArray(config.plugins.load.paths)) config.plugins.load.paths = [];
if (!config.plugins.load.paths.includes(extensionsDir)) config.plugins.load.paths.push(extensionsDir);
if (!config.plugins.entries) config.plugins.entries = {};
const existingPlugin = config.plugins.entries['agent-os-content-tools'];
config.plugins.entries['agent-os-content-tools'] = {
  ...existingPlugin,
  enabled: true,
  config: existingPlugin?.config || {},
};
if (!config.plugins.allow) config.plugins.allow = [];
if (!config.plugins.allow.includes('agent-os-content-tools')) config.plugins.allow.push('agent-os-content-tools');

// Bootstrap watcher: hot-reload SOUL/AGENTS/TOOLS/MEMORY from disk (Workspace UI edits).
const bootstrapWatcherDir = toSlash(join(OPENCLAW_DIR, 'extensions', 'agent-os-bootstrap-watcher'));
if (!config.plugins.load.paths.includes(bootstrapWatcherDir)) config.plugins.load.paths.push(bootstrapWatcherDir);
const existingBootstrap = config.plugins.entries['agent-os-bootstrap-watcher'];
config.plugins.entries['agent-os-bootstrap-watcher'] = {
  ...existingBootstrap,
  enabled: true,
  config: existingBootstrap?.config || {},
};
if (!config.plugins.allow.includes('agent-os-bootstrap-watcher')) config.plugins.allow.push('agent-os-bootstrap-watcher');

// Browser automation (Playwright-managed openclaw profile). Install: .\scripts\install-openclaw-playwright.ps1
// Root browser block activates bundled browser tool; do not add "browser" to plugins.allow.
if (!config.browser) config.browser = {};
config.browser.enabled = true;
config.browser.defaultProfile = config.browser.defaultProfile || 'openclaw';
if (!config.browser.profiles) {
  config.browser.profiles = { openclaw: { cdpPort: 18800, color: '#FF4500' } };
}

// Tools: allow content tools, kanban tools, intent-classify-and-delegate.
// Note: OpenClaw will ignore the entire tools.allow if it contains unknown tool names.
// The Gateway cron tools (cron.add / cron_add) are not present in newer OpenClaw builds,
// so we do NOT include them here.
const contentToolNames = [...REQUIRED_GLOBAL_CONTENT_TOOLS];
if (!Array.isArray(config.tools.allow)) config.tools.allow = [];
config.tools.allow = config.tools.allow.filter((t) => !REMOVE_FROM_ALLOWLIST.has(String(t)));
for (const name of contentToolNames) {
  if (!config.tools.allow.includes(name)) config.tools.allow.push(name);
}

// Per-agent tool overrides: ~/.openclaw/agent-os-tool-overrides.json maps tool_name -> ["agent1","agent2"] or "All"
const OVERRIDES_PATH = join(OPENCLAW_DIR, 'agent-os-tool-overrides.json');
let toolOverrides = {};
if (existsSync(OVERRIDES_PATH)) {
  try {
    toolOverrides = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch (_) {}
}
for (const a of config.agents.list) {
  const aid = (a.id || '').toLowerCase();
  const allow = Array.isArray(a.tools?.allow) ? [...a.tools.allow] : [...contentToolNames];
  for (const [toolName, agentsSpec] of Object.entries(toolOverrides)) {
    if (agentsSpec === 'All' || (Array.isArray(agentsSpec) && agentsSpec.some((id) => String(id).toLowerCase() === aid))) {
      if (!allow.includes(toolName)) allow.push(toolName);
    }
  }
  a.tools = a.tools || {};
  a.tools.allow = allow;
}

// Bindings: optional. Route inbound channel messages (WhatsApp/Telegram/Discord) to agents.
// Agent OS HTTP chat uses x-openclaw-agent-id; bindings are for channel routing when enabled.

if (!config.gateway) config.gateway = {};
mergeDeep(config.gateway, GATEWAY_DEFAULTS);

if (!existsSync(OPENCLAW_DIR)) mkdirSync(OPENCLAW_DIR, { recursive: true });
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
console.log(
  'Written agents.list + model.primary:',
  DEFAULT_MODEL,
  '+ fallbacks:',
  JSON.stringify(config.agents.defaults.model.fallbacks || []),
  '+ tools.agentToAgent to',
  CONFIG_PATH
);
console.log('TechResearcher, ExpenseManager, SocialAssistant: same tools.allow (agent-os-content-tools + kanban/intent tools).');
console.log('Restart the OpenClaw gateway so the dashboard picks up the agents:');
console.log('  openclaw gateway restart');
console.log('Or stop the gateway (Ctrl+C) and run: openclaw gateway --port 18789');

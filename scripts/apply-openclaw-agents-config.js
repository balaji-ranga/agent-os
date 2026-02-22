/**
 * Apply agents.list (Bala, COO, TechResearcher) to OpenClaw config and restart the gateway.
 * Run from agent-os: node scripts/apply-openclaw-agents-config.js
 * Requires: write access to ~/.openclaw/openclaw.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const USERPROFILE = process.env.USERPROFILE || process.env.HOME || '';
const OPENCLAW_DIR = join(USERPROFILE, '.openclaw');
const CONFIG_PATH = join(OPENCLAW_DIR, 'openclaw.json');

// Use forward slashes so JSON is valid and OpenClaw accepts them on Windows
const toSlash = (p) => p.replace(/\\/g, '/');
const AGENTS_LIST = [
  { id: 'bala', name: 'Bala', default: true, workspace: toSlash(join(OPENCLAW_DIR, 'workspace')) },
  { id: 'balserve', name: 'COO', workspace: toSlash(join(OPENCLAW_DIR, 'workspace-balserve')) },
  { id: 'techresearcher', name: 'TechResearcher', workspace: toSlash(join(OPENCLAW_DIR, 'workspace-techresearcher')) },
  { id: 'expensemanager', name: 'ExpenseManager', workspace: toSlash(join(OPENCLAW_DIR, 'workspace-expenses')) },
  // Per-agent: allow content-tools plugin; deny built-in "image" (analyze-only) so the agent uses generate_image for creating images.
  { id: 'socialasstant', name: 'SocialAssistant', workspace: toSlash(join(OPENCLAW_DIR, 'workspace-socialasstant')), tools: { allow: ['agent-os-content-tools'], deny: ['image'] } },
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
config.agents.list = AGENTS_LIST;
if (!config.agents.defaults) config.agents.defaults = {};
if (!config.agents.defaults.model) config.agents.defaults.model = {};
config.agents.defaults.model.primary = DEFAULT_MODEL;
config.agents.defaults.model.fallbacks = [OLLAMA_FALLBACK_ID];

// Ollama on localhost: optional explicit provider so fallback works without relying only on auto-discovery.
// Set OLLAMA_API_KEY=ollama-local (or any value) so OpenClaw can use Ollama; baseUrl defaults to localhost:11434.
if (!config.models) config.models = {};
if (!config.models.providers) config.models.providers = {};
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
  allow: ['bala', 'balserve', 'techresearcher', 'expensemanager', 'socialasstant'],
};

// Remove agents.defaults.subagents if present (can prevent gateway from starting).
if (config.agents?.defaults?.subagents) delete config.agents.defaults.subagents;

// Skills: enable agent-send and agent-os-content-tools so they appear in the dashboard and are loaded.
if (!config.skills) config.skills = {};
if (!config.skills.entries) config.skills.entries = {};
config.skills.entries['agent-send'] = { enabled: true, ...config.skills.entries['agent-send'] };
config.skills.entries['agent-os-content-tools'] = { enabled: true, ...config.skills.entries['agent-os-content-tools'] };

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

// Tools: allow content tools and cron.add so backend can delegate via /tools/invoke.
const contentToolNames = ['summarize_url', 'generate_image', 'generate_video'];
const cronToolNames = ['cron.add', 'cron_add'];
if (!Array.isArray(config.tools.allow)) config.tools.allow = [];
for (const name of [...contentToolNames, ...cronToolNames]) {
  if (!config.tools.allow.includes(name)) config.tools.allow.push(name);
}

// Bindings: optional. Route inbound channel messages (WhatsApp/Telegram/Discord) to agents.
// Agent OS HTTP chat uses x-openclaw-agent-id; bindings are for channel routing when enabled.

if (!config.gateway) config.gateway = {};
mergeDeep(config.gateway, GATEWAY_DEFAULTS);

if (!existsSync(OPENCLAW_DIR)) mkdirSync(OPENCLAW_DIR, { recursive: true });
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
console.log('Written agents.list + model.primary:', DEFAULT_MODEL, '+ fallbacks:', OLLAMA_FALLBACK_ID, '+ tools.agentToAgent to', CONFIG_PATH);
console.log('Restart the OpenClaw gateway so the dashboard picks up the agents:');
console.log('  openclaw gateway restart');
console.log('Or stop the gateway (Ctrl+C) and run: openclaw gateway --port 18789');

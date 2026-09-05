/**
 * Verify Docker/bare-metal OpenClaw bootstrap matches Agent OS expectations.
 * Run: node deploy/scripts/verify-openclaw-parity.js
 * Exit 0 = all checks passed; 1 = missing items (prints list).
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveOpenClawDir, resolveOpenClawConfigPath } from '../../scripts/lib/openclaw-paths.js';
import {
  REQUIRED_GLOBAL_CONTENT_TOOLS,
  BROWSER_SESSION_CONTENT_TOOLS,
} from '../../scripts/lib/content-tools-allow.js';

const OPENCLAW_DIR = resolveOpenClawDir();
const CONFIG_PATH = resolveOpenClawConfigPath();

const REQUIRED_AGENTS = [
  'bala',
  'balserve',
  'workflowbuilder',
  'platformhelp',
  'techresearcher',
  'expensemanager',
  'socialasstant',
];

const OPTIONAL_JOB_AGENTS = ['jobdiscovery', 'fitscorer', 'resumetailor', 'applicationagent'];

const REQUIRED_GLOBAL_TOOLS = [
  'summarize_url',
  'generate_image',
  'generate_video',
  'browser',
  'agent_workflow_list',
  'agent_workflow_trigger',
  'intent_classify_and_delegate',
  'learnings_summary',
];

// Soft-check the full content-tool floor (configure-openclaw-docker maintains these).
const EXPECTED_GLOBAL_CONTENT_TOOLS = REQUIRED_GLOBAL_CONTENT_TOOLS;
const REQUIRED_SKILLS = ['agent-send', 'agent-os-content-tools', 'browser-automation'];

const REQUIRED_PLUGINS = ['agent-os-content-tools', 'agent-os-bootstrap-watcher'];

const REQUIRED_EXTENSIONS = ['agent-os-content-tools', 'agent-os-bootstrap-watcher'];

const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

if (!existsSync(CONFIG_PATH)) {
  console.error('Missing', CONFIG_PATH);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  console.error('Invalid openclaw.json:', e.message);
  process.exit(1);
}

// Gateway
if (!config.gateway?.http?.endpoints?.chatCompletions?.enabled) {
  fail('gateway.http.endpoints.chatCompletions.enabled is not true');
}
if (!config.gateway?.auth?.token) {
  warn('gateway.auth.token not set (pairing may be required)');
}

// Browser
if (!config.browser?.enabled) {
  fail('browser.enabled is not true');
}

// Dedicated CDP agent for backend browse_* / job portal tools/invoke
const BROWSER_CDP_AGENT_ID = String(process.env.BROWSER_TASK_CDP_AGENT_ID || 'browser-cdp').trim() || 'browser-cdp';
{
  const cdp = (config.agents?.list || []).find(
    (a) => String(a?.id || '').toLowerCase() === BROWSER_CDP_AGENT_ID.toLowerCase()
  );
  if (!cdp) {
    fail(`agents.list missing CDP browser agent "${BROWSER_CDP_AGENT_ID}"`);
  } else {
    const also = cdp.tools?.alsoAllow || [];
    if (!also.includes('browser')) {
      fail(`${BROWSER_CDP_AGENT_ID} tools.alsoAllow must include browser`);
    }
    if (Array.isArray(cdp.tools?.allow) && cdp.tools.allow.length) {
      fail(`${BROWSER_CDP_AGENT_ID} must not use tools.allow with alsoAllow (OpenClaw forbids both)`);
    }
    if (String(cdp.tools?.profile || '') !== 'coding') {
      warn(`${BROWSER_CDP_AGENT_ID} tools.profile should be coding (got ${cdp.tools?.profile})`);
    }
  }
}

// Session visibility (Agent OS delegation)
const vis = config.tools?.sessions?.visibility;
if (vis && vis !== 'agent' && vis !== 'all') {
  warn(`tools.sessions.visibility is "${vis}" (expected agent or all)`);
}

// Skills on disk + config
for (const skill of REQUIRED_SKILLS) {
  const skillDir = join(OPENCLAW_DIR, 'skills', skill);
  if (!existsSync(skillDir)) fail(`missing skill directory: ${skillDir}`);
  if (!config.skills?.entries?.[skill]?.enabled) fail(`skill not enabled in config: ${skill}`);
}

// Extensions on disk + plugins
for (const ext of REQUIRED_EXTENSIONS) {
  const extDir = join(OPENCLAW_DIR, 'extensions', ext);
  if (!existsSync(extDir)) fail(`missing extension directory: ${extDir}`);
}
for (const plugin of REQUIRED_PLUGINS) {
  if (!config.plugins?.entries?.[plugin]?.enabled) fail(`plugin not enabled: ${plugin}`);
  if (!config.plugins?.allow?.includes(plugin)) warn(`plugin not in plugins.allow: ${plugin}`);
}

const contentTools = config.plugins?.entries?.['agent-os-content-tools'];
const baseUrl = contentTools?.config?.baseUrl || process.env.AGENT_OS_INTERNAL_API_URL;
if (!baseUrl) {
  warn('agent-os-content-tools config.baseUrl not set (uses AGENT_OS_API_URL env at runtime)');
} else if (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')) {
  warn(`agent-os-content-tools baseUrl is local (${baseUrl}) — use http://backend:3001 in Docker`);
}
if (contentTools?.config?.apiKey) {
  fail('agent-os-content-tools still contains legacy shared apiKey — re-run configure-openclaw-docker.js');
}
const scopedCredentials = join(OPENCLAW_DIR, 'agent-os-tool-credentials.json');
if (!existsSync(scopedCredentials)) {
  fail('owner/agent tool credentials missing — restart backend to provision them');
}

// OpenClaw 2026.7+ content-tools must use definePluginEntry + contracts.tools
const contentToolsJs = join(OPENCLAW_DIR, 'extensions', 'agent-os-content-tools', 'index.js');
const contentToolsManifest = join(OPENCLAW_DIR, 'extensions', 'agent-os-content-tools', 'openclaw.plugin.json');
if (!existsSync(contentToolsJs)) {
  fail('missing agent-os-content-tools/index.js — run sync-openclaw-extensions.js / restart openclaw gateway');
} else {
  const jsSrc = readFileSync(contentToolsJs, 'utf8');
  if (!jsSrc.includes('definePluginEntry')) {
    fail('agent-os-content-tools/index.js missing definePluginEntry (OpenClaw 2026.7+ tool plugin shape)');
  }
}
if (existsSync(contentToolsManifest)) {
  try {
    const manifest = JSON.parse(readFileSync(contentToolsManifest, 'utf8'));
    const tools = manifest.contracts?.tools || [];
    if (!Array.isArray(tools) || tools.length === 0) {
      fail('agent-os-content-tools openclaw.plugin.json missing contracts.tools');
    } else if (!tools.includes('agent_workflow_list')) {
      fail('contracts.tools missing agent_workflow_list');
    } else {
      for (const bt of BROWSER_SESSION_CONTENT_TOOLS) {
        if (!tools.includes(bt)) fail(`contracts.tools missing ${bt}`);
      }
    }
  } catch (e) {
    fail(`agent-os-content-tools manifest unreadable: ${e.message}`);
  }
} else {
  fail('missing agent-os-content-tools/openclaw.plugin.json');
}

if (!process.env.TOOLS_BASE_URL && process.env.AGENT_OS_PUBLIC_URL?.startsWith('https://')) {
  warn(
    'TOOLS_BASE_URL unset while AGENT_OS_PUBLIC_URL is HTTPS — set TOOLS_BASE_URL=http://127.0.0.1:3001 to avoid tool invoke fetch failed'
  );
}

// Global tools.allow
// OpenClaw intersects global allow with agent alsoAllow — `browser` in the global
// list strips browser-cdp. configure-openclaw-docker.js clears tools.allow.
const globalAllow = config.tools?.allow;
if (Array.isArray(globalAllow) && globalAllow.includes('browser')) {
  fail('global tools.allow must not include browser (breaks browser-cdp alsoAllow)');
}
if (Array.isArray(globalAllow) && globalAllow.length > 0) {
  for (const t of REQUIRED_GLOBAL_TOOLS) {
    if (t === 'browser') continue;
    if (!globalAllow.includes(t)) warn(`tools.allow missing: ${t}`);
  }
  for (const t of EXPECTED_GLOBAL_CONTENT_TOOLS) {
    if (t === 'browser') continue;
    if (!globalAllow.includes(t)) warn(`tools.allow missing content tool: ${t}`);
  }
} else {
  warn('global tools.allow cleared/empty (expected for browser CDP); agent allowlists + content-tools plugin carry grants');
}
if (config.plugins?.entries?.codex) {
  fail('plugins.entries.codex must be absent (legacy harness breaks Agent OS content tools)');
}
if (Array.isArray(config.plugins?.allow) && config.plugins.allow.includes('codex')) {
  fail('plugins.allow must not include codex');
}
if (config.models?.providers?.openai?.agentRuntime?.id !== 'openclaw') {
  fail('models.providers.openai.agentRuntime.id must be openclaw (preserves Agent OS custom tools)');
}
const balserve = (config.agents?.list || []).find((a) => String(a.id || '').toLowerCase() === 'balserve');
if (balserve && !(balserve.tools?.allow || []).includes('learnings_summary')) {
  fail('balserve tools.allow missing learnings_summary');
}
if (balserve) {
  const allow = balserve.tools?.allow || [];
  for (const bt of ['browse_task_start', 'browse_recipe_list', 'browse_recipe_run']) {
    if (!allow.includes(bt)) warn(`balserve tools.allow missing ${bt} (backend grants sync on next start)`);
  }
}
const platformhelp = (config.agents?.list || []).find((a) => String(a.id || '').toLowerCase() === 'platformhelp');
if (platformhelp) {
  const allow = platformhelp.tools?.allow || [];
  for (const t of ['master_data_rag', 'master_data_list_documents', 'notify_ceo']) {
    if (!allow.includes(t)) fail(`platformhelp tools.allow missing ${t}`);
  }
} else {
  fail('agents.list missing platformhelp (cannot check tools.allow)');
}

// Agents
const agentIds = (config.agents?.list || []).map((a) => String(a.id || '').toLowerCase());
for (const id of REQUIRED_AGENTS) {
  if (!agentIds.includes(id)) fail(`agents.list missing: ${id}`);
}
const jobPresent = OPTIONAL_JOB_AGENTS.filter((id) => agentIds.includes(id));
if (jobPresent.length === 0) {
  warn('Job Applicant agents not in openclaw.json (run setup-job-applicant-agents.js if needed)');
} else if (jobPresent.length < OPTIONAL_JOB_AGENTS.length) {
  warn(`Partial Job Applicant agents: ${jobPresent.join(', ')}`);
}

// Agent-to-agent
if (!config.tools?.agentToAgent?.enabled) {
  warn('tools.agentToAgent.enabled is not true');
}

// Tools list file (backend sync)
const toolsListPath = join(OPENCLAW_DIR, 'agent-os-tools.json');
if (!existsSync(toolsListPath)) {
  warn('agent-os-tools.json missing (backend writeOpenClawToolsList runs on startup)');
}

console.log('OpenClaw dir:', OPENCLAW_DIR);
console.log('Config:', CONFIG_PATH);
console.log('Agents:', agentIds.length, '→', agentIds.join(', '));

if (warnings.length) {
  console.log('\nWarnings:');
  warnings.forEach((w) => console.log('  ⚠', w));
}

if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  ✗', f));
  process.exit(1);
}

console.log('\nAll required OpenClaw parity checks passed.');
if (jobPresent.length === OPTIONAL_JOB_AGENTS.length) {
  console.log('Job Applicant agents present.');
}

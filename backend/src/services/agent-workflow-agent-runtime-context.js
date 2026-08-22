/**
 * Runtime environment snapshot for the Workflow Builder agent — agents, MCP, tools, defaults.
 */
import { listEnabledContentTools } from './content-tools-meta.js';
import { listAgentsForUser, getUserById } from './users.js';
import { listMcpServersForWorkflow } from './mcp-servers.js';
import { getWorkflowTemplates } from './agent-workflow-templates.js';
import { defaultNodeConfig, getTaskCatalog } from './agent-workflow-task-catalog.js';
import { listUserApiKeys } from './user-api-keys.js';
import { getConnectedConnectorApps } from './openconnector.js';
import {
  lastOllamaAvailable,
  lastOllamaModel,
  ollamaAvailabilitySnapshot,
  resolveOllamaChatModel,
} from './agent-workflow-secrets.js';

export function defaultBrainConfig() {
  const cfg = defaultNodeConfig('brain');
  return {
    ...cfg,
    modelSource: process.env.BRAIN_MCP_TEST_PROVIDER === 'openai' ? 'openai' : 'ollama',
    apiEndpoint: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
    model: resolveOllamaChatModel(process.env.OLLAMA_MODEL || process.env.OPENCLAW_OLLAMA_MODEL || 'llama3.2'),
    maxTokens: 512,
    systemPrompt: 'You are a concise assistant.\n\nContext:\n{{input}}',
    mcpToolCalling: false,
    mcpServerIds: [],
    mcpToolAllowlist: [],
    mcpMaxToolRounds: 8,
    mcpServerAuth: {},
    httpHeadersJson: '{}',
  };
}

/** Keep connected apps plus OpenConnector's public no-key Hacker News — not a guessed SaaS list. */
export function selectConnectorsForWorkflowPrompt(apps = []) {
  const list = Array.isArray(apps) ? apps : [];
  return list
    .map((a) => {
      const id = String(a?.id || a?.app_id || '').trim();
      if (!id) return null;
      const noKey = id.toLowerCase() === 'hackernews';
      const connected = a.connected === true;
      if (!connected && !noKey) return null;
      const name = String(a.name || a.provider_name || id).trim();
      const account = String(a.account_name || '').trim();
      return {
        id,
        name,
        needsKey: !noKey,
        connected: connected || noKey,
        purpose: account
          ? `Connected as ${account}`
          : noKey
            ? 'Public Hacker News (no API key)'
            : 'Connected SaaS app — use this exact id',
      };
    })
    .filter(Boolean);
}

async function loadConnectorsForOwner(ownerUserId) {
  try {
    const { apps } = await Promise.race([
      getConnectedConnectorApps(ownerUserId),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('connector catalog timeout')), 2500);
      }),
    ]);
    return selectConnectorsForWorkflowPrompt(apps);
  } catch (e) {
    console.warn('[workflow-builder] connector catalog skipped: %s', e?.message || e);
    return [];
  }
}

export async function buildWorkflowAgentRuntimeContext(ownerUserId) {
  const authUser = getUserById(ownerUserId) || { id: ownerUserId, role: 'ceo' };

  const agents = listAgentsForUser(ownerUserId).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role || '',
  }));

  const mcpServers = listMcpServersForWorkflow(authUser).map((s) => ({
    id: s.id,
    name: s.name,
    base_url: s.base_url || '',
    tools: (s.tools || []).slice(0, 25).map((t) => t.name),
    prompts: (s.prompts || []).slice(0, 8).map((p) => p.name),
  }));

  const contentTools = listEnabledContentTools();

  const templates = getWorkflowTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    default_chat_phrase: t.default_chat_phrase || '',
    category: t.category || '',
  }));

  const brain = defaultBrainConfig();
  const firstMcp = mcpServers[0]?.id || null;
  const connectors = await loadConnectorsForOwner(ownerUserId);
  const hn = connectors.find((c) => String(c.id).toLowerCase() === 'hackernews');

  let vaultKeys = [];
  try {
    vaultKeys = listUserApiKeys(ownerUserId).map((k) => ({
      name: k.key_name,
      set: !k.is_unset && k.key_hint !== 'unset',
    }));
  } catch {
    vaultKeys = [];
  }
  const ollama = ollamaAvailabilitySnapshot();

  return {
    agents,
    mcpServers,
    contentTools,
    nodeTypes: getTaskCatalog().map((t) => t.type),
    templates,
    vaultKeys,
    connectors,
    defaults: {
      brain,
      firstMcpId: firstMcp,
      trigger_modes: ['manual', 'chat'],
      ollama_base: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
      ollama_model: lastOllamaModel() || resolveOllamaChatModel(process.env.OLLAMA_MODEL || 'llama3.2'),
      ollama_available: lastOllamaAvailable() || ollama.ok,
      no_key_connector: hn ? { appId: hn.id, actionId: `${hn.id}.get_top_stories` } : null,
    },
  };
}

export function formatRuntimeContextForPrompt(ctx) {
  const lines = ['\n## Runtime environment (use these IDs — do not invent)'];

  if (ctx.agents?.length) {
    lines.push(
      '\nEmployees (agent nodes — use only when this role is the actual work; never because a word in the ask overlaps the name):',
      ctx.agents
        .map((a) => `- ${a.name} (id: ${a.id}) role: ${a.role || '(none listed)'}`)
        .join('\n')
    );
  } else {
    lines.push('\nEmployees: (none granted — use brain / catalog nodes instead of agent nodes)');
  }

  if (ctx.nodeTypes?.length) {
    lines.push('\nGraph node types available:', ctx.nodeTypes.join(', '));
  }

  if (ctx.connectors?.length) {
    lines.push(
      '\nConnectors (connector nodes — exact ids from this CEO\'s OpenConnector connections; do not invent apps):',
      ctx.connectors
        .map(
          (c) =>
            `- ${c.name} (id: ${c.id}) ${c.needsKey ? 'connected' : 'no key'}: ${c.purpose}`
        )
        .join('\n')
    );
  } else {
    lines.push(
      '\nConnectors: none connected for this CEO — skip connector nodes; use Browser Session content tools for signed-in sites'
    );
  }

  if (ctx.mcpServers?.length) {
    lines.push(
      '\nMCP servers (healthy):',
      ctx.mcpServers
        .map(
          (s) =>
            `- ${s.name} (id: ${s.id}) tools: [${(s.tools || []).join(', ')}]${s.prompts?.length ? ` prompts: [${s.prompts.join(', ')}]` : ''}`
        )
        .join('\n')
    );
  } else {
    lines.push('\nMCP servers: none healthy — skip mcp_tool / mcp listen unless user provides server id');
  }

  if (ctx.contentTools?.length) {
    const purposeMax = 160;
    lines.push(
      `\nContent tools (ALL ${ctx.contentTools.length} enabled — pick toolName from this list for tool nodes; use enquire_content_tools if unsure):`,
      ctx.contentTools
        .map((t) => {
          const purpose = String(t.purpose || t.display_name || '').trim();
          const clipped =
            purpose.length > purposeMax ? `${purpose.slice(0, purposeMax)}…` : purpose;
          return `- ${t.name}: ${clipped}`;
        })
        .join('\n')
    );
  } else {
    lines.push('\nContent tools: (none registered)');
  }

  if (ctx.templates?.length) {
    lines.push(
      '\nBuilt-in templates (prefer create_from_template when intent matches):',
      ctx.templates.map((t) => `- ${t.id}: ${t.name} — ${t.description}`).join('\n')
    );
  }

  lines.push(
    '\nDefault brain config (copy into task_config unless user specifies otherwise):',
    'Brain nodes default to free Ollama — never paste API keys. Bind paid providers with apiKeyRef to a Settings → API Keys name.',
    JSON.stringify(ctx.defaults?.brain || {}, null, 2),
    `\nOllama available: ${ctx.defaults?.ollama_available ? 'yes (prefer this, no key)' : 'unknown/no — bind apiKeyRef=Platform_BYOK if a paid model is required'}`,
    `\nDefault MCP server if needed: ${ctx.defaults?.firstMcpId || '(none)'}`,
    `\nNo-key connector for news: ${JSON.stringify(ctx.defaults?.no_key_connector || {})}`
  );
  if (ctx.vaultKeys?.length) {
    lines.push(
      '\nAPI Keys vault (names only — never copy secret values into the graph):',
      ctx.vaultKeys.map((k) => `- ${k.name}${k.set ? '' : ' (unset)'}`).join('\n')
    );
  }

  return lines.join('\n');
}

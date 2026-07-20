/**
 * Workflow Builder node catalog — purposes, attributes, publish preflight for the agent.
 */
import { getTaskCatalog, getTaskTypeDef } from './agent-workflow-task-catalog.js';
import { validateWorkflowBrainCredentials } from './agent-workflow-brain-providers.js';
import { defaultBrainConfig } from './agent-workflow-agent-runtime-context.js';
import { enquireContentTools, listEnabledContentTools } from './content-tools-meta.js';

const NODE_PURPOSE = {
  trigger: 'Entry point. Starts runs via manual button, chat phrase, cron schedule, or webhook.',
  agent: 'Delegates work to a workspace agent with a prompt template. Use {{input}} for prior step text.',
  tool: 'Runs a registered content tool by exact toolName (see Content tools catalog / enquire_content_tools).',
  mcp_tool: 'Calls a tool on an MCP server. Requires mcpServerId + toolName from Runtime environment.',
  mcp_listen: 'Long-running SSE listener on an MCP stream; dispatches downstream on each event.',
  sse_listen: 'Long-running SSE HTTP listener; dispatches downstream on each event.',
  sub_workflow: 'Runs another published workflow as a child run.',
  email: 'Sends email via SMTP (useEnvSmtp or per-node SMTP fields).',
  api: 'HTTP request (GET/POST/etc.) to an external API; supports auth headers and body templates.',
  externalAgent: 'Invokes a registered external agent via A2A JSON-RPC (skillId, message).',
  custom_script: 'Runs an approved Python/JS script in a sandbox (customScriptId).',
  masterdata: 'Query this CEO master-data tables (CSV) or RAG over uploaded documents. Owner is always the workflow owner — never spoof.',
  filesystem: 'List/stat/read/move files under WORKFLOW_FS_ROOTS. Prefer schedule trigger to poll a folder instead of a separate file-poller service.',
  parallel: 'Fans out to multiple branches concurrently.',
  merge: 'Joins parallel branches before continuing.',
  ceo_approval: 'Pauses for CEO approve/reject; outputs decision (approved/rejected).',
  if: 'Branches on condition — true/false source handles.',
  while: 'Loops while condition holds — loop/exit source handles.',
  brain: 'Direct LLM call. Set systemPrompt for guardrails/instructions. Default to ollama (local, no API key). Only use openai/anthropic/openrouter when apiKey is set on the node.',
};

const BRAIN_EXAMPLES = {
  guardrail: {
    label: 'Content guardrail',
    systemPrompt:
      'You are a content safety filter. Review the user message and your response. Reject or rewrite any sexual, abusive, hateful, or harmful content. Respond with safe, professional language only.\n\nUser input:\n{{input}}',
    modelSource: 'ollama',
    maxTokens: 512,
  },
  summarize: {
    label: 'Summarize input',
    systemPrompt: 'Summarize the following concisely in 3-5 bullet points.\n\n{{input}}',
    modelSource: 'ollama',
    maxTokens: 400,
  },
};

/** Normalize brain taskConfig — prefer ollama when no API key (avoids publish failures). */
export function normalizeBrainTaskConfig(cfg = {}, runtimeDefaults = null) {
  const defaults = runtimeDefaults || defaultBrainConfig();
  const merged = { ...defaults, ...cfg };
  const apiKey = String(merged.apiKey || merged.api_key || '').trim();
  const source = String(merged.modelSource || 'ollama').toLowerCase();
  const keyedProviders = new Set(['openai', 'anthropic', 'openrouter']);

  if (keyedProviders.has(source) && !apiKey) {
    merged.modelSource = 'ollama';
    merged.apiEndpoint = defaults.apiEndpoint || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1';
    merged.model = defaults.model || process.env.OLLAMA_MODEL || 'llama3.2';
    merged.apiKey = '';
  }

  if (merged.modelSource === 'ollama' && !merged.apiEndpoint) {
    merged.apiEndpoint = defaults.apiEndpoint || 'http://127.0.0.1:11434/v1';
  }
  if (merged.modelSource === 'ollama' && !merged.model) {
    merged.model = defaults.model || 'llama3.2';
  }
  if (merged.modelSource === 'deepseek' && !merged.apiEndpoint) {
    merged.apiEndpoint =
      defaults.apiEndpoint ||
      process.env.DEEPSEEK_BASE_URL ||
      process.env.OLLAMA_BASE_URL ||
      'http://ollama:11434/v1';
  }
  if (merged.modelSource === 'deepseek' && !merged.model) {
    merged.model = defaults.model || process.env.DEEPSEEK_MODEL || 'deepseek-v3';
  }

  delete merged.api_key;
  return merged;
}

export function buildWorkflowNodeCatalog() {
  return getTaskCatalog().map((t) => ({
    type: t.type,
    label: t.label,
    purpose: NODE_PURPOSE[t.type] || t.label,
    inputs: (t.inputs || []).map((i) => ({
      id: i.id,
      label: i.label,
      mode: i.mode || i.defaultMode,
      required: !!i.required,
      description: i.description || '',
    })),
    outputs: (t.outputs || []).map((o) => ({
      id: o.id,
      label: o.label,
      description: o.description || '',
    })),
    configFields: (t.configFields || []).map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      options: f.options,
      default: f.default,
      placeholder: f.placeholder || '',
      description: f.description || '',
    })),
    examples: t.type === 'brain' ? BRAIN_EXAMPLES : undefined,
  }));
}

export function getWorkflowNodeTypeSpec(nodeType) {
  const t = String(nodeType || '').trim();
  const def = getTaskTypeDef(t);
  if (!def) return { error: `Unknown node type: ${t}`, validTypes: getTaskCatalog().map((x) => x.type) };
  const catalog = buildWorkflowNodeCatalog().find((c) => c.type === t);
  return {
    ...catalog,
    wiring: t === 'trigger' ? 'Must be first node; no incoming edges.' : 'Connect via connect_from or add_edge from prior node.',
    publishNotes:
      t === 'brain'
        ? 'Use modelSource=ollama unless apiKey is set. systemPrompt goes in task_config.systemPrompt on add_node or update_node.'
        : undefined,
  };
}

export function validateWorkflowForPublish(graph) {
  const errors = [];
  const nodes = graph?.nodes || [];

  if (!nodes.length) errors.push('Workflow has no nodes.');
  if (!nodes.some((n) => n.type === 'trigger')) errors.push('Workflow must include a Trigger node.');

  errors.push(...validateWorkflowBrainCredentials(graph));

  for (const node of nodes) {
    if (node.type === 'mcp_tool') {
      const cfg = node.data?.taskConfig || {};
      if (!cfg.mcpServerId) errors.push(`MCP node "${node.data?.label || node.id}": set mcpServerId.`);
      if (!cfg.toolName) errors.push(`MCP node "${node.data?.label || node.id}": set toolName.`);
    }
    if (node.type === 'custom_script') {
      const cfg = node.data?.taskConfig || {};
      if (!cfg.customScriptId) errors.push(`Custom script node "${node.data?.label || node.id}": set customScriptId.`);
    }
  }

  return errors;
}

export function formatCatalogForPrompt({ nodeType = null } = {}) {
  if (nodeType) {
    return JSON.stringify(getWorkflowNodeTypeSpec(nodeType), null, 2);
  }
  return JSON.stringify(buildWorkflowNodeCatalog(), null, 2);
}

/** Fast-path: user asks about node types / attributes without mutating workflow. */
export function tryCatalogQueryResponse(message) {
  const t = String(message || '').trim();
  if (!t) return null;

  const contentToolsHit = tryContentToolsQueryResponse(t);
  if (contentToolsHit) return contentToolsHit;

  const typeMatch = t.match(/\b(trigger|agent|brain|tool|mcp_tool|mcp_listen|sse_listen|sub_workflow|email|api|externalAgent|custom_script|masterdata|parallel|merge|ceo_approval|if|while)\b/i);
  const asksCatalog =
    /(?:what|explain|describe|how\s+(?:do|does)|tell\s+me\s+about).*(?:node|nodes|step|steps|catalog|attribute|config|task_config)/i.test(t) ||
    /(?:node|nodes)\s+(?:types?|catalog|reference)/i.test(t) ||
    /what\s+(?:is|are)\s+(?:a\s+)?(?:brain|trigger|mcp|agent)\s*(?:node)?/i.test(t);

  if (!asksCatalog) return null;

  if (typeMatch) {
    const spec = getWorkflowNodeTypeSpec(typeMatch[1]);
    return {
      reply: `## ${spec.label || typeMatch[1]} node (\`${typeMatch[1].toLowerCase()}\`)\n\n**Purpose:** ${spec.purpose || ''}\n\n**Config fields:**\n${(spec.configFields || []).map((f) => `- \`${f.id}\` (${f.type}): ${f.description || f.label}${f.default != null ? ` [default: ${JSON.stringify(f.default)}]` : ''}`).join('\n') || '(none)'}\n\n**Inputs:** ${(spec.inputs || []).map((i) => i.id).join(', ') || 'none'}\n**Outputs:** ${(spec.outputs || []).map((o) => o.id).join(', ') || 'none'}${spec.examples ? `\n\n**Examples:**\n\`\`\`json\n${JSON.stringify(spec.examples, null, 2)}\n\`\`\`` : ''}${spec.publishNotes ? `\n\n**Publish:** ${spec.publishNotes}` : ''}`,
      actions: [],
    };
  }

  const catalog = buildWorkflowNodeCatalog();
  const lines = ['## Workflow node catalog', ''];
  for (const c of catalog) {
    lines.push(`- **${c.label}** (\`${c.type}\`): ${c.purpose}`);
  }
  lines.push('', 'Ask about a specific type, e.g. "explain brain node config".');
  return { reply: lines.join('\n'), actions: [] };
}

/**
 * Fast-path: list/recommend content tools from natural language without an LLM round-trip.
 */
export function tryContentToolsQueryResponse(message) {
  const t = String(message || '').trim();
  if (!t) return null;

  const asksList =
    /(?:list|show|what(?:\s+are)?|which)\s+(?:all\s+)?(?:the\s+)?content\s+tools/i.test(t) ||
    /content\s+tools?\s+(?:catalog|list|available)/i.test(t) ||
    /(?:what|which)\s+tools?\s+(?:can|do)\s+(?:i|we|you)\s+use/i.test(t);

  const recommendMatch = t.match(
    /(?:which|what)\s+(?:content\s+)?tool(?:\s+should\s+i\s+use)?(?:\s+for|\s+to)?\s+(.+)/i
  ) || t.match(
    /(?:recommend|suggest|find)\s+(?:a\s+)?(?:content\s+)?tool(?:\s+for|\s+to)?\s+(.+)/i
  ) || t.match(
    /(?:content\s+)?tool\s+for\s+(.+)/i
  );

  if (!asksList && !recommendMatch) return null;

  if (asksList && !recommendMatch) {
    const tools = listEnabledContentTools();
    const lines = [`## Content tools (${tools.length} enabled)`, ''];
    for (const tool of tools) {
      lines.push(`- **${tool.display_name}** (\`${tool.name}\`): ${tool.purpose || '(no purpose set)'}`);
    }
    lines.push(
      '',
      'To wire one into a workflow: `add_node` with `node_type: "tool"` and `toolName` set to the exact name.',
      'Ask e.g. "which content tool for summarizing a URL?" for a ranked recommendation.'
    );
    return { reply: lines.join('\n'), actions: [] };
  }

  const query = String(recommendMatch?.[1] || t).trim();
  const out = enquireContentTools(query, { limit: 8 });
  if (!out.tools.length) {
    return {
      reply: `No content tool matched **${query}**. Try "list content tools" or a broader phrase (summarize, image, IBKR, learnings, brain history).`,
      actions: [],
    };
  }

  const lines = [`## Content tool recommendations for “${out.query}”`, ''];
  if (out.top_recommendation) {
    lines.push(
      `**Top pick:** \`${out.top_recommendation.name}\` — ${out.top_recommendation.purpose}`,
      '',
      out.top_recommendation.how_to_use,
      '',
      'Other matches:'
    );
  }
  for (const tool of out.tools) {
    lines.push(`- \`${tool.name}\` (score ${tool.score}): ${tool.purpose || tool.display_name}`);
  }
  return { reply: lines.join('\n'), actions: [] };
}

/**
 * Brain node — direct LLM invocation (Anthropic, OpenAI, Ollama, OpenRouter).
 * Optional MCP tool-calling loop when mcpToolCalling is enabled.
 */

import { resolveWorkflowBrainProviderConfig, isOllamaServiceBaseUrl } from './agent-workflow-brain-providers.js';
import {
  probeOllamaAvailable,
  resolveOllamaChatModel,
} from './agent-workflow-secrets.js';
import {
  buildMcpToolRegistry,
  dispatchToolCall,
  entriesToAnthropicTools,
  entriesToOpenAiTools,
  parseBrainMcpConfig,
} from './agent-workflow-brain-mcp.js';
import { executeCustomScript } from './custom-scripts.js';
import { prependCeoGuardrailsToSystemPrompt } from './ceo-guardrails.js';
import { renderWorkflowTemplates } from './agent-workflow-io.js';
import {
  addUsage,
  estimateTokens,
  normalizeProviderUsage,
  recordTokenUsage,
} from './token-usage.js';

function isLocalOllama(baseUrl) {
  if (!baseUrl) return false;
  try {
    const u = new URL(baseUrl);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === 'ollama';
  } catch {
    return false;
  }
}

function normalizeBaseUrl(url) {
  if (!url) return '';
  const u = String(url).trim().replace(/\/$/, '');
  if (u.endsWith('/chat/completions')) return u.replace(/\/chat\/completions$/, '');
  if (u.endsWith('/messages')) return u.replace(/\/messages$/, '');
  return u;
}

/** Ollama defaults num_ctx≈4096; W1 maker prompts often exceed that — raise via OLLAMA_CONTEXT_WINDOW. */
function ollamaOpenAiExtraBody({ provider, baseUrl } = {}) {
  const ollamaLike =
    provider === 'ollama' ||
    isLocalOllama(baseUrl) ||
    isOllamaServiceBaseUrl(baseUrl);
  if (!ollamaLike) return {};
  const numCtx = Math.max(
    8192,
    Number(process.env.OLLAMA_CONTEXT_WINDOW || process.env.OPENCLAW_OLLAMA_CONTEXT_WINDOW || 65536) || 65536
  );
  return { options: { num_ctx: numCtx } };
}

/** Primary input for Brain {{input}} — trigger payload, then bound inputs (same priority as user message). */
export function resolveBrainInputPlaceholder(context, resolved = {}) {
  const initial = String(context?.initial_input || '').trim();
  if (initial) return initial;
  if (resolved.userMessage) return String(resolved.userMessage);
  if (resolved.prompt) return String(resolved.prompt);
  if (resolved.body) return String(resolved.body);
  const first = Object.entries(resolved)
    .filter(([k, v]) => v && !['systemPrompt'].includes(k))
    .map(([, v]) => String(v).trim())
    .find(Boolean);
  return first || '';
}

/** Replace {{input}}, {{nodeId.outputKey}}, {{var.key}} in system prompt. */
export function renderBrainPrompt(template, context, graph, resolved = {}) {
  if (!template) return '';
  const inputText = resolveBrainInputPlaceholder(context, resolved);
  const ctx = {
    ...(context || {}),
    initial_input: inputText != null && inputText !== '' ? inputText : context?.initial_input,
  };
  return renderWorkflowTemplates(String(template), ctx);
}

function buildUserMessage(resolved) {
  if (resolved.userMessage) return resolved.userMessage;
  if (resolved.prompt) return resolved.prompt;
  if (resolved.body) return resolved.body;
  const parts = Object.entries(resolved)
    .filter(([k, v]) => v && !['systemPrompt'].includes(k))
    .map(([k, v]) => `${k}:\n${v}`);
  return parts.join('\n\n') || '(no input)';
}

function parseToolArguments(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function usesMaxCompletionTokens(model = '') {
  const m = String(model).toLowerCase();
  return /^(gpt-5|o[1-9]|o\d)/.test(m) || m.includes('gpt-5');
}

function openAiTokenLimitFields(model, maxTokens) {
  if (usesMaxCompletionTokens(model)) return { max_completion_tokens: maxTokens };
  return { max_tokens: maxTokens };
}

/**
 * Thinking / reasoning body fields for DeepSeek + OpenRouter Brain nodes.
 * @param {'deepseek'|'openrouter'|string} provider
 * @param {{ thinkingMode?: string, thinkingEffort?: string }} cfg
 */
export function buildBrainThinkingFields(provider, cfg = {}) {
  const src = String(provider || '').toLowerCase();
  if (src !== 'deepseek' && src !== 'openrouter') return {};
  const mode = String(cfg.thinkingMode || 'enabled').trim().toLowerCase();
  if (mode === 'off' || mode === 'omit' || mode === 'default') return {};
  const enabled = mode !== 'disabled' && mode !== 'false' && mode !== '0';
  const effortRaw = String(cfg.thinkingEffort || '').trim().toLowerCase();

  if (src === 'deepseek') {
    const fields = { thinking: { type: enabled ? 'enabled' : 'disabled' } };
    if (enabled) {
      fields.reasoning_effort = effortRaw === 'max' ? 'max' : 'high';
    }
    return fields;
  }

  if (!enabled) {
    return { reasoning: { effort: 'none', enabled: false } };
  }
  const effort = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal'].includes(effortRaw)
    ? effortRaw
    : 'high';
  return { reasoning: { enabled: true, effort } };
}

function extractAssistantText(msg) {
  if (!msg) return { text: '', reasoning_content: '' };
  const content = msg.content ?? '';
  const reasoning =
    msg.reasoning_content ||
    msg.reasoning ||
    (Array.isArray(msg.reasoning_details)
      ? msg.reasoning_details.map((d) => d?.text || d?.content || '').filter(Boolean).join('\n')
      : '') ||
    '';
  return {
    text: typeof content === 'string' ? content : String(content),
    reasoning_content: typeof reasoning === 'string' ? reasoning : String(reasoning || ''),
  };
}

async function callOpenAiCompatible({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userMessage,
  maxTokens,
  provider = 'openai',
  extraHeaders = {},
  thinkingFields = {},
}) {
  const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const messages = [];
  if (systemPrompt?.trim()) messages.push({ role: 'system', content: systemPrompt.trim() });
  messages.push({ role: 'user', content: userMessage });
  const ollamaLike =
    provider === 'ollama' || isLocalOllama(baseUrl) || isOllamaServiceBaseUrl(baseUrl);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      ...openAiTokenLimitFields(model, maxTokens),
      messages,
      ...thinkingFields,
      ...ollamaOpenAiExtraBody({ provider, baseUrl }),
    }),
    // DeepSeek-via-Ollama still sets provider=deepseek; allow long local inference.
    signal: AbortSignal.timeout(ollamaLike ? 600000 : 180000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || data?.error || res.statusText);
  const { text, reasoning_content } = extractAssistantText(data?.choices?.[0]?.message);
  return {
    text,
    reasoning_content,
    model_used: model,
    provider,
    usage: normalizeProviderUsage(data?.usage),
  };
}

async function runOpenAiWithMcpTools({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userMessage,
  maxTokens,
  provider,
  extraHeaders,
  openAiTools,
  entries,
  authUser,
  serverAuthMap,
  legacyAuth,
  maxRounds,
  thinkingFields = {},
}) {
  const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const messages = [];
  if (systemPrompt?.trim()) messages.push({ role: 'system', content: systemPrompt.trim() });
  messages.push({ role: 'user', content: userMessage });

  const toolCallLog = [];
  let lastReasoning = '';
  let usage = null;
  for (let round = 0; round < maxRounds; round++) {
    const ollamaLike =
      provider === 'ollama' || isLocalOllama(baseUrl) || isOllamaServiceBaseUrl(baseUrl);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        ...openAiTokenLimitFields(model, maxTokens),
        messages,
        tools: openAiTools,
        tool_choice: 'auto',
        ...thinkingFields,
        ...ollamaOpenAiExtraBody({ provider, baseUrl }),
      }),
      signal: AbortSignal.timeout(ollamaLike ? 600000 : 180000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.error || res.statusText);

    usage = addUsage(usage, normalizeProviderUsage(data?.usage));

    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error('No message from LLM');
    const extracted = extractAssistantText(msg);
    if (extracted.reasoning_content) lastReasoning = extracted.reasoning_content;

    const toolCalls = msg.tool_calls || [];
    if (!toolCalls.length) {
      return {
        text: extracted.text,
        reasoning_content: lastReasoning,
        model_used: model,
        provider,
        toolCallLog,
        usage,
      };
    }

    messages.push(msg);
    for (const tc of toolCalls) {
      const ref = tc.function?.name;
      const args = parseToolArguments(tc.function?.arguments);
      const { log, content } = await dispatchToolCall(ref, args, entries, authUser, serverAuthMap, legacyAuth);
      toolCallLog.push(log);
      messages.push({ role: 'tool', tool_call_id: tc.id, content });
    }
  }

  throw new Error(`MCP tool loop exceeded ${maxRounds} rounds`);
}

async function callAnthropic({ baseUrl, apiKey, model, systemPrompt, userMessage, maxTokens }) {
  const url = `${normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1')}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt?.trim() || undefined,
      messages: [{ role: 'user', content: userMessage }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || data?.error?.type || res.statusText);
  const block = data?.content?.find((c) => c.type === 'text');
  const text = block?.text ?? '';
  return {
    text,
    model_used: model,
    provider: 'anthropic',
    usage: normalizeProviderUsage(data?.usage),
  };
}

async function runAnthropicWithMcpTools({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userMessage,
  maxTokens,
  anthropicTools,
  entries,
  authUser,
  serverAuthMap,
  legacyAuth,
  maxRounds,
}) {
  const url = `${normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1')}/messages`;
  const messages = [{ role: 'user', content: userMessage }];
  const toolCallLog = [];
  let usage = null;

  for (let round = 0; round < maxRounds; round++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt?.trim() || undefined,
        messages,
        tools: anthropicTools,
      }),
      signal: AbortSignal.timeout(180000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.error?.type || res.statusText);

    usage = addUsage(usage, normalizeProviderUsage(data?.usage));

    const content = data?.content || [];
    const toolUses = content.filter((b) => b.type === 'tool_use');
    const textBlock = content.find((b) => b.type === 'text');

    if (!toolUses.length) {
      return {
        text: textBlock?.text ?? '',
        model_used: model,
        provider: 'anthropic',
        toolCallLog,
        usage,
      };
    }

    messages.push({ role: 'assistant', content });

    const toolResults = [];
    for (const tu of toolUses) {
      const args = parseToolArguments(tu.input);
      const { log, content: resultContent } = await dispatchToolCall(tu.name, args, entries, authUser, serverAuthMap, legacyAuth);
      toolCallLog.push(log);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: resultContent,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error(`MCP tool loop exceeded ${maxRounds} rounds`);
}

function appendMcpToolsHint(systemPrompt, entries) {
  if (!entries.length) return systemPrompt;
  const lines = entries.map((e) => `- ${e.ref}: ${e.serverName} / ${e.toolName}`);
  const hint =
    'You have MCP tools available. Call them when you need external data or actions. ' +
    'Available tools:\n' +
    lines.join('\n');
  return systemPrompt?.trim() ? `${systemPrompt.trim()}\n\n${hint}` : hint;
}

/**
 * @param {object} taskConfig - node.data.taskConfig
 * @param {object} resolved - resolved input bindings
 * @param {object} context - workflow run context
 * @param {object} graph - workflow graph
 * @param {{ authUser?: object }} options - workflow owner for MCP registry access
 */
/**
 * Decide which org member a Brain call belongs to, so Agent View and budgets see the spend.
 *
 * A workflow published over A2A *is* the leaf member doing the work, so an A2A-invoked run bills
 * the `a2a:<publishId>` leaf. Runs an agent kicked off (COO delegation, agent tool call,
 * sub-workflow) bill that agent. Anything left (manual, schedule, webhook) has no org member to
 * charge and falls back to a workflow-scoped key.
 *
 * @param {object} context - workflow run context
 * @returns {string} token ledger member key
 */
export function resolveBrainMemberKey(context = {}) {
  const explicit = String(context?.member_key || '').trim();
  if (explicit) return explicit;

  const actorId = String(context?.actor?.id || '').trim();
  const actorType = String(context?.actor?.type || '').trim().toLowerCase();
  if (actorType === 'a2a_client' && /^a2a:/i.test(actorId)) return actorId;

  const agentId = String(context?.agent_id || '').trim();
  if (agentId) return agentId;
  if (actorId && ['coo', 'agent', 'workflow_builder'].includes(actorType)) return actorId;

  return context?.definition_id ? `workflow:${context.definition_id}` : 'workflow:unknown';
}

/**
 * Attribute one Brain call to the token ledger. Uses provider usage when returned,
 * otherwise a chars/4 estimate flagged as estimated. Never throws.
 */
function meterBrainUsage({ ownerId, context, result, model, systemPrompt, userMessage }) {
  if (!ownerId) return null;
  const provided = result?.usage || null;
  const usage =
    provided ||
    (() => {
      const input = estimateTokens(`${systemPrompt || ''}\n${userMessage || ''}`);
      const output = estimateTokens(result?.text || '');
      return input || output
        ? { input_tokens: input, output_tokens: output, total_tokens: input + output }
        : null;
    })();
  if (!usage) return null;
  const memberKey = resolveBrainMemberKey(context);
  recordTokenUsage(ownerId, {
    memberKey,
    agentId: context?.agent_id || null,
    source: 'workflow_brain',
    modelId: result?.model_used || model || null,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    estimated: !provided,
    runId: context?.run_id ?? null,
    traceId: context?.trace_id || (context?.goal_run_id ? String(context.goal_run_id) : null),
  });
  return { ...usage, estimated: !provided };
}

export async function executeBrainTask(taskConfig = {}, resolved = {}, context = {}, graph = {}, options = {}) {
  const cfg = taskConfig || {};
  const { authUser } = options;
  const scriptMode = String(cfg.customScriptMode || 'off').toLowerCase();
  const scriptId = cfg.customScriptId?.trim() || '';
  const userMessage = buildUserMessage(resolved);

  async function runCustomScriptHook(llmResult = null, reason = 'post') {
    if (!scriptId || !authUser) return null;
    const scriptInputs = {
      userMessage,
      resolved,
      llm_text: llmResult?.text || '',
      llm_provider: llmResult?.provider || '',
      reason,
    };
    const scriptContext = {
      workflow: context?.definition_id || null,
      run_id: context?.run_id || null,
      node_outputs: context?.node_outputs || {},
      initial_input: context?.initial_input || '',
    };
    const run = await executeCustomScript(scriptId, authUser, {
      inputs: scriptInputs,
      context: scriptContext,
    });
    return run.output || {};
  }

  if (scriptMode === 'only' && scriptId) {
    const scriptOut = await runCustomScriptHook(null, 'only');
    const text = scriptOut.text != null ? String(scriptOut.text) : JSON.stringify(scriptOut);
    return {
      text,
      model_used: 'custom_script',
      provider: 'custom_script',
      system_prompt_rendered: '',
      mcp_tools_available: 0,
      mcp_tool_calls: [],
      custom_script_ran: true,
      custom_script_output: scriptOut,
    };
  }

  const maxTokens = Number(cfg.maxTokens) || 1024;
  const ownerId =
    String(authUser?.id || context?.owner_user_id || context?.ceo_user_id || '').trim() || null;
  const renderedCfg = { ...cfg };
  if (context) {
    for (const key of ['apiKey', 'api_key', 'apiEndpoint', 'api_endpoint', 'model']) {
      if (renderedCfg[key] != null) {
        renderedCfg[key] = renderWorkflowTemplates(String(renderedCfg[key]), context);
      }
    }
  }
  const { source: modelSource, baseUrl, apiKey, model: resolvedModel, protocol, requiresKey, extraHeaders, configuredKey } =
    resolveWorkflowBrainProviderConfig(renderedCfg.modelSource, renderedCfg, ownerId);
  let model = resolvedModel;
  if (modelSource === 'ollama' || isLocalOllama(baseUrl) || isOllamaServiceBaseUrl(baseUrl)) {
    try {
      await probeOllamaAvailable({ timeoutMs: 1500 });
    } catch {
      /* non-blocking */
    }
    const installed = resolveOllamaChatModel(model);
    if (installed && installed !== model) {
      console.info('[workflow-brain] using installed Ollama model', { requested: model, using: installed });
      model = installed;
    }
  }
  const thinkingFields = buildBrainThinkingFields(modelSource, cfg);

  if (requiresKey && !configuredKey && !isLocalOllama(baseUrl) && !isOllamaServiceBaseUrl(baseUrl)) {
    const keyHint =
      modelSource === 'openrouter'
        ? 'OpenRouter API key required on Brain node (platform .env keys are not used)'
        : modelSource === 'anthropic'
          ? 'Anthropic API key required on Brain node (platform .env keys are not used)'
          : modelSource === 'deepseek'
            ? 'DeepSeek API key required on Brain node for cloud endpoint (leave blank only for local Ollama)'
            : 'OpenAI API key required on Brain node (platform .env keys are not used)';
    throw new Error(keyHint);
  }

  const mcpCfg = parseBrainMcpConfig(cfg, context);
  let mcpEntries = [];
  if (mcpCfg.enabled && authUser && mcpCfg.serverIds.length) {
    mcpEntries = buildMcpToolRegistry(mcpCfg.serverIds, mcpCfg.allowlist, authUser);
  }

  let systemPrompt = renderBrainPrompt(cfg.systemPrompt || '', context, graph, resolved);
  const maxPromptChars = Math.min(
    Math.max(Number(process.env.BRAIN_MAX_SYSTEM_PROMPT_CHARS || 14000), 2000),
    100000
  );
  if (systemPrompt.length > maxPromptChars) {
    systemPrompt = `${systemPrompt.slice(0, maxPromptChars)}\n…[truncated for model context window]`;
  }
  if (ownerId) {
    systemPrompt = prependCeoGuardrailsToSystemPrompt(systemPrompt, ownerId);
  }

  if (mcpEntries.length) {
    systemPrompt = appendMcpToolsHint(systemPrompt, mcpEntries);
  }

  let result;
  try {
  if (mcpEntries.length) {
    if (protocol === 'anthropic') {
      result = await runAnthropicWithMcpTools({
        baseUrl,
        apiKey,
        model,
        systemPrompt,
        userMessage,
        maxTokens,
        anthropicTools: entriesToAnthropicTools(mcpEntries),
        entries: mcpEntries,
        authUser,
        serverAuthMap: mcpCfg.serverAuthMap,
        legacyAuth: mcpCfg.legacyAuth,
        maxRounds: mcpCfg.maxRounds,
      });
    } else {
      const openAiProvider =
        modelSource === 'openrouter'
          ? 'openrouter'
          : modelSource === 'deepseek'
            ? 'deepseek'
            : modelSource === 'ollama' || isLocalOllama(baseUrl) || isOllamaServiceBaseUrl(baseUrl)
              ? 'ollama'
              : 'openai';
      result = await runOpenAiWithMcpTools({
        baseUrl,
        apiKey,
        model,
        systemPrompt,
        userMessage,
        maxTokens,
        provider: openAiProvider,
        extraHeaders,
        openAiTools: entriesToOpenAiTools(mcpEntries),
        entries: mcpEntries,
        authUser,
        serverAuthMap: mcpCfg.serverAuthMap,
        legacyAuth: mcpCfg.legacyAuth,
        maxRounds: mcpCfg.maxRounds,
        thinkingFields,
      });
    }
  } else if (protocol === 'anthropic') {
    result = await callAnthropic({ baseUrl, apiKey, model, systemPrompt, userMessage, maxTokens });
  } else {
    const openAiProvider =
      modelSource === 'openrouter'
        ? 'openrouter'
        : modelSource === 'deepseek'
          ? 'deepseek'
          : modelSource === 'ollama' || isLocalOllama(baseUrl) || isOllamaServiceBaseUrl(baseUrl)
            ? 'ollama'
            : 'openai';
    result = await callOpenAiCompatible({
      baseUrl,
      apiKey,
      model,
      systemPrompt,
      userMessage,
      maxTokens,
      provider: openAiProvider,
      extraHeaders,
      thinkingFields,
    });
  }

  let customScriptOut = null;
  let customScriptRan = false;

  if (scriptMode === 'post' && scriptId) {
    customScriptOut = await runCustomScriptHook(result, 'post');
    customScriptRan = true;
    if (customScriptOut?.text) {
      result = { ...result, text: String(customScriptOut.text) };
    }
  }

  const usage = meterBrainUsage({
    ownerId,
    context,
    result,
    model,
    systemPrompt,
    userMessage,
  });

  return {
    text: result.text,
    reasoning_content: result.reasoning_content || '',
    model_used: result.model_used,
    provider: result.provider,
    token_usage: usage,
    thinking_mode: thinkingFields.thinking?.type || (thinkingFields.reasoning ? (thinkingFields.reasoning.enabled === false ? 'disabled' : 'enabled') : 'off'),
    // Keep enough of the rendered prompt to debug {{node}} feedback injection (was 500 — truncated mid-allowlist)
    system_prompt_rendered: systemPrompt.slice(0, 8000),
    user_message_preview: String(userMessage || '').slice(0, 2000),
    mcp_tools_available: mcpEntries.length,
    mcp_tool_calls: result.toolCallLog || [],
    custom_script_ran: customScriptRan,
    custom_script_output: customScriptOut,
  };
  } catch (brainErr) {
    if (scriptMode === 'fallback' && scriptId) {
      const scriptOut = await runCustomScriptHook(null, 'fallback');
      const text = scriptOut.text != null ? String(scriptOut.text) : JSON.stringify(scriptOut);
      return {
        text,
        model_used: 'custom_script',
        provider: 'custom_script',
        system_prompt_rendered: systemPrompt?.slice(0, 8000) || '',
        user_message_preview: String(userMessage || '').slice(0, 2000),
        mcp_tools_available: mcpEntries.length,
        mcp_tool_calls: [],
        custom_script_ran: true,
        custom_script_output: scriptOut,
        brain_error: brainErr.message,
      };
    }
    throw brainErr;
  }
}

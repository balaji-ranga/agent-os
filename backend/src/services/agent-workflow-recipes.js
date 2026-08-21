/**
 * Curated workflow recipes — turn high-level intent into a full action batch (like Cursor e2e setup).
 */
import { buildBrainApprovalTestGraph } from '../../scripts/seed-brain-approval-workflow.js';
import { buildBrainMcpLoopGraph } from '../../scripts/seed-brain-mcp-loop-workflow.js';
import { JOB_APPLICANT_TEMPLATE_ID, JOB_APPLICANT_CHAT_PHRASE } from './agent-workflow-templates.js';
import { defaultBrainConfig } from './agent-workflow-agent-runtime-context.js';
import { BRAIN_PROVIDERS } from './agent-workflow-brain-providers.js';
import { PLATFORM_BYOK_KEY_NAME } from './user-api-keys.js';

function slugify(name) {
  return String(name || 'workflow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function extractWorkflowName(message) {
  const t = String(message || '');
  let m = t.match(/(?:called|named|call\s+it)\s+["']([^"']+)["']/i);
  if (m) return m[1].trim();
  m = t.match(/(?:called|named|call\s+it)\s+([^"'\n.]+?)(?:\s*[.,]|\s+(?:get|make|trigger|set|use|with)\b)/i);
  if (m) return m[1].trim();
  m = t.match(/(?:called|named|call\s+it)\s+["']?([^"'\n]+?)["']?\s*$/i);
  if (m) return m[1].trim();
  m = t.match(/workflow\s*:\s*(.+)$/i);
  if (m) return m[1].trim().slice(0, 80);
  return null;
}

export function inferTriggerModes(message) {
  const t = String(message || '').toLowerCase();
  const modes = [];
  if (/\bmanual(?:ly)?\b/i.test(t)) modes.push('manual');
  if (/\bchat\b/i.test(t)) modes.push('chat');
  if (/\bschedule|cron\b/i.test(t)) modes.push('schedule');
  if (/\bevent|webhook|hook\b/i.test(t)) modes.push('event');
  return modes.length ? modes : ['manual', 'chat'];
}

function openRouterBrainConfig() {
  const preset = BRAIN_PROVIDERS.openrouter;
  return {
    ...defaultBrainConfig(),
    modelSource: 'openrouter',
    apiEndpoint: preset.baseUrl,
    apiKey: '',
    apiKeyRef: PLATFORM_BYOK_KEY_NAME,
    model: preset.model,
    maxTokens: 512,
    systemPrompt: 'You are a helpful assistant. Respond clearly and concisely.\n\nUser input:\n{{input}}',
    mcpToolCalling: false,
    mcpServerIds: [],
  };
}

function triggerNode(phrase, modes = ['manual', 'chat'], extra = {}) {
  return {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 40, y: 120 },
    data: {
      label: 'Start',
      triggerModes: modes,
      scheduleCron: extra.scheduleCron || '',
      chatPhrase: modes.includes('chat') ? phrase : '',
      outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
    },
  };
}

function ollamaBrainNode(id, label, x, y, systemPrompt, sourceNodeId = 'trigger-1', sourceOutputKey = 'text') {
  return {
    id,
    type: 'brain',
    position: { x, y },
    data: {
      label,
      inputBindings: [
        {
          id: 'userMessage',
          label: 'User message',
          mode: 'dynamic',
          sourceNodeId,
          sourceOutputKey,
        },
      ],
      taskConfig: {
        ...defaultBrainConfig(),
        maxTokens: 400,
        systemPrompt,
      },
    },
  };
}

function publicApiNode(id, label, x, y, url, method = 'GET') {
  return {
    id,
    type: 'api',
    position: { x, y },
    data: {
      label,
      inputBindings: [
        { id: 'url', label: 'URL', mode: 'static', value: url },
        { id: 'headers', label: 'Headers', mode: 'static', value: '{"Accept":"application/json"}' },
      ],
      outputs: [
        { id: 'status', label: 'HTTP status' },
        { id: 'body', label: 'Response body' },
        { id: 'ok', label: 'Success' },
      ],
      taskConfig: { method, authType: 'none', timeoutMs: 120000, timeoutAction: 'fail', defaultTimeoutOutput: '{}' },
    },
  };
}

function connectorHnNode(id, x, y) {
  return {
    id,
    type: 'connector',
    position: { x, y },
    data: {
      label: 'Latest stories',
      inputBindings: [
        { id: 'input', label: 'Action input', mode: 'static', value: '{"limit":5}' },
      ],
      taskConfig: {
        appId: 'hackernews',
        appName: 'Hacker News',
        actionId: 'hackernews.get_top_stories',
        timeoutMs: 120000,
        timeoutAction: 'fail',
      },
    },
  };
}

function mcpToolNode(id, x, y, mcp) {
  const toolName = mcp?.tools?.[0] || 'get_random_number';
  return {
    id,
    type: 'mcp_tool',
    position: { x, y },
    data: {
      label: 'Connected tool',
      inputBindings: [],
      taskConfig: {
        mcpInvokeKind: 'tool',
        mcpServerId: mcp?.id || '',
        toolName,
        staticArguments: '{}',
        httpHeadersJson: '{}',
      },
    },
  };
}

function apiEchoNode(id, label, x, y, bodySourceNodeId, bodySourceKey = 'text') {
  return {
    id,
    type: 'api',
    position: { x, y },
    data: {
      label,
      inputBindings: [
        { id: 'url', label: 'URL', mode: 'static', value: 'https://postman-echo.com/post' },
        {
          id: 'body',
          label: 'Request body',
          mode: 'dynamic',
          sourceNodeId: bodySourceNodeId,
          sourceOutputKey: bodySourceKey,
          value: '',
        },
        { id: 'headers', label: 'Headers', mode: 'static', value: '{"Content-Type":"application/json"}' },
      ],
      outputs: [
        { id: 'status', label: 'HTTP status' },
        { id: 'body', label: 'Response body' },
        { id: 'ok', label: 'Success' },
      ],
      taskConfig: { method: 'POST', authType: 'none', timeoutMs: 1200000, timeoutAction: 'fail', defaultTimeoutOutput: '{}' },
    },
  };
}

function wantsAutoTest(message) {
  return /\b(test|e2e|verify|working|validate)\b/i.test(String(message || ''));
}

export const WORKFLOW_RECIPES = [
  {
    id: 'brain-ceo-approval',
    label: 'Brain → CEO Approval → If approved',
    score(message) {
      const t = message.toLowerCase();
      let s = 0;
      if (/brain/i.test(t)) s += 2;
      if (/ceo|approval|kanban|approve/i.test(t)) s += 3;
      if (/summar/i.test(t)) s += 1;
      if (/→|->|then/i.test(t)) s += 1;
      return s;
    },
    build(message, ctx) {
      const name = extractWorkflowName(message) || 'Brain + CEO Approval';
      const phrase = `run ${slugify(name)}`;
      const graph = buildBrainApprovalTestGraph();
      graph.nodes.find((n) => n.id === 'trigger-1').data.chatPhrase = phrase;
      return {
        name,
        chat_phrase: phrase,
        graph,
        autoTest: wantsAutoTest(message),
        summary: 'Brain drafts summary → CEO Kanban approval → if approved branch',
      };
    },
  },
  {
    id: 'brain-mcp-loop',
    label: 'Brain with MCP tool-calling',
    score(message) {
      const t = message.toLowerCase();
      let s = 0;
      if (/brain/i.test(t)) s += 2;
      if (/mcp/i.test(t)) s += 3;
      if (/tool.?call|random|sse/i.test(t)) s += 2;
      return s;
    },
    build(message, ctx) {
      const name = extractWorkflowName(message) || 'Brain MCP Loop';
      const mcpId = ctx?.defaults?.firstMcpId;
      let graph = buildBrainMcpLoopGraph();
      if (mcpId) {
        const brain = graph.nodes.find((n) => n.id === 'brain-1');
        if (brain?.data?.taskConfig) {
          brain.data.taskConfig.mcpServerIds = [mcpId];
        }
      }
      const phrase = `run ${slugify(name)}`;
      const trigger = graph.nodes.find((n) => n.id === 'trigger-1');
      if (trigger?.data) {
        trigger.data.triggerModes = ['manual', 'chat'];
        trigger.data.chatPhrase = phrase;
      }
      return {
        name,
        chat_phrase: phrase,
        graph,
        autoTest: wantsAutoTest(message),
        summary: 'Brain with MCP tool-calling loop (uses first healthy MCP server)',
      };
    },
  },
  {
    id: 'brain-summarize',
    label: 'Trigger → Brain summarize',
    score(message) {
      const t = message.toLowerCase();
      if (/brain/i.test(t) && /summar/i.test(t) && !/ceo|approval|mcp/i.test(t)) return 5;
      if (/brain/i.test(t) && !/ceo|approval|mcp|agent/i.test(t)) return 2;
      return 0;
    },
    build(message, ctx) {
      const name = extractWorkflowName(message) || 'Brain Summarize';
      const phrase = `run ${slugify(name)}`;
      const brainCfg = { ...defaultBrainConfig(), maxTokens: 256, systemPrompt: 'Summarize the input in 2-3 sentences.\n\n{{input}}' };
      return {
        name,
        chat_phrase: phrase,
        graph: {
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger',
              position: { x: 40, y: 120 },
              data: { label: 'Start', triggerModes: ['manual', 'chat'], chatPhrase: phrase, scheduleCron: '' },
            },
            {
              id: 'brain-1',
              type: 'brain',
              position: { x: 260, y: 120 },
              data: {
                label: 'Summarize',
                inputBindings: [
                  { id: 'userMessage', label: 'User message', mode: 'dynamic', sourceNodeId: 'trigger-1', sourceOutputKey: 'text' },
                ],
                taskConfig: brainCfg,
              },
            },
          ],
          edges: [{ id: 'e1', source: 'trigger-1', target: 'brain-1' }],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        autoTest: wantsAutoTest(message),
        summary: 'Simple trigger → brain summarize chain',
      };
    },
  },
  {
    id: 'brain-content-guardrail',
    label: 'Trigger → Brain content guardrail',
    score(message) {
      const t = message.toLowerCase();
      let s = 0;
      if (/brain/i.test(t)) s += 2;
      if (/guardrail|content\s+safety|safe\s+content|moderation|filter/i.test(t)) s += 3;
      if (/sexual|abusive|harmful|hate|nsfw|profan/i.test(t)) s += 3;
      if (/system\s*prompt/i.test(t)) s += 1;
      return s;
    },
    build(message, ctx) {
      const name = extractWorkflowName(message) || 'Content Guardrail';
      const phrase = `run ${slugify(name)}`;
      const brainCfg = {
        ...defaultBrainConfig(),
        maxTokens: 512,
        systemPrompt:
          'You are a content safety filter. Review user requests and your responses. Reject, refuse, or rewrite any sexual, abusive, hateful, violent, or harmful content. Respond with safe, professional language only.\n\nUser input:\n{{input}}',
      };
      return {
        name,
        chat_phrase: phrase,
        graph: {
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger',
              position: { x: 40, y: 120 },
              data: { label: 'Start', triggerModes: ['manual', 'chat'], chatPhrase: phrase, scheduleCron: '' },
            },
            {
              id: 'brain-1',
              type: 'brain',
              position: { x: 260, y: 120 },
              data: {
                label: 'Content Guardrail',
                inputBindings: [
                  { id: 'userMessage', label: 'User message', mode: 'dynamic', sourceNodeId: 'trigger-1', sourceOutputKey: 'text' },
                ],
                taskConfig: brainCfg,
              },
            },
          ],
          edges: [{ id: 'e1', source: 'trigger-1', target: 'brain-1' }],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        autoTest: wantsAutoTest(message),
        summary: 'Trigger → Brain with content-safety system prompt (ollama default)',
      };
    },
  },
  {
    id: 'job-applicant-template',
    label: 'Job Applicant Pipeline (template)',
    score(message) {
      const t = message.toLowerCase();
      if (/job\s+applicant|applicant\s+pipeline|job\s+pipeline/i.test(t)) return 8;
      if (/job\s+discovery.*fit|discovery.*scoring.*resume/i.test(t)) return 6;
      return 0;
    },
    build(message) {
      const name = extractWorkflowName(message) || 'Job Applicant Pipeline';
      return {
        name,
        template_id: JOB_APPLICANT_TEMPLATE_ID,
        chat_phrase: JOB_APPLICANT_CHAT_PHRASE,
        autoTest: false,
        summary: 'Full job applicant pipeline from built-in template',
      };
    },
  },
  {
    id: 'brain-openrouter-api-echo',
    label: 'Brain (OpenRouter) → API echo',
    score(message) {
      const t = message.toLowerCase();
      let s = 0;
      if (/brain/i.test(t)) s += 2;
      if (/openrouter|open\s*router/i.test(t)) s += 5;
      if (/\bapi\b/i.test(t)) s += 2;
      if (/echo/i.test(t)) s += 3;
      if (/after\s+brain|invoke.*api|api\s+after/i.test(t)) s += 2;
      return s;
    },
    build(message) {
      const name = extractWorkflowName(message) || 'Brain OpenRouter API Echo';
      const phrase = `run ${slugify(name)}`;
      const modes = inferTriggerModes(message);
      const brainCfg = openRouterBrainConfig();
      return {
        name,
        chat_phrase: phrase,
        trigger_modes: modes,
        graph: {
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger',
              position: { x: 40, y: 120 },
              data: {
                label: 'Start',
                triggerModes: modes,
                scheduleCron: '',
                chatPhrase: modes.includes('chat') ? phrase : '',
                inputBindings: [],
                outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
              },
            },
            {
              id: 'brain-1',
              type: 'brain',
              position: { x: 260, y: 120 },
              data: {
                label: 'Brain (OpenRouter)',
                inputBindings: [
                  {
                    id: 'userMessage',
                    label: 'User message',
                    mode: 'dynamic',
                    sourceNodeId: 'trigger-1',
                    sourceOutputKey: 'text',
                  },
                ],
                taskConfig: brainCfg,
              },
            },
            apiEchoNode('api-1', 'Echo brain response', 480, 120, 'brain-1', 'text'),
          ],
          edges: [
            { id: 'e1', source: 'trigger-1', target: 'brain-1' },
            { id: 'e2', source: 'brain-1', target: 'api-1' },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        autoTest: wantsAutoTest(message),
        summary: 'Trigger → Brain (OpenRouter) → Postman echo API with brain text as body',
      };
    },
  },
  {
    id: 'brain-api-echo',
    label: 'Brain → API echo',
    score(message) {
      const t = message.toLowerCase();
      if (/openrouter|open\s*router/i.test(t)) return 0;
      let s = 0;
      if (/brain/i.test(t)) s += 2;
      if (/\bapi\b/i.test(t)) s += 2;
      if (/echo/i.test(t)) s += 3;
      if (/after\s+brain|invoke.*api|api\s+after/i.test(t)) s += 2;
      return s;
    },
    build(message, ctx) {
      const name = extractWorkflowName(message) || 'Brain API Echo';
      const phrase = `run ${slugify(name)}`;
      const modes = inferTriggerModes(message);
      const brainCfg = { ...defaultBrainConfig(), maxTokens: 512, systemPrompt: 'Respond helpfully.\n\n{{input}}' };
      return {
        name,
        chat_phrase: phrase,
        trigger_modes: modes,
        graph: {
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger',
              position: { x: 40, y: 120 },
              data: {
                label: 'Start',
                triggerModes: modes,
                chatPhrase: modes.includes('chat') ? phrase : '',
                scheduleCron: '',
              },
            },
            {
              id: 'brain-1',
              type: 'brain',
              position: { x: 260, y: 120 },
              data: {
                label: 'Brain',
                inputBindings: [
                  { id: 'userMessage', label: 'User message', mode: 'dynamic', sourceNodeId: 'trigger-1', sourceOutputKey: 'text' },
                ],
                taskConfig: brainCfg,
              },
            },
            apiEchoNode('api-1', 'Echo brain response', 480, 120, 'brain-1', 'text'),
          ],
          edges: [
            { id: 'e1', source: 'trigger-1', target: 'brain-1' },
            { id: 'e2', source: 'brain-1', target: 'api-1' },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        autoTest: wantsAutoTest(message),
        summary: 'Trigger → Brain → API echo (postman-echo.com)',
      };
    },
  },
  {
    id: 'mcp-tool-single',
    label: 'Trigger → MCP tool call',
    score(message) {
      const t = message.toLowerCase();
      if (/mcp/i.test(t) && /tool|call|invoke/i.test(t) && !/brain|listen|sse/i.test(t)) return 5;
      return 0;
    },
    build(message, ctx) {
      const mcp = ctx?.mcpServers?.[0];
      const toolName = mcp?.tools?.[0] || 'get_random_number';
      const name = extractWorkflowName(message) || `MCP ${mcp?.name || 'Tool'} Test`;
      const phrase = `run ${slugify(name)}`;
      return {
        name,
        chat_phrase: phrase,
        graph: {
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger',
              position: { x: 40, y: 120 },
              data: { label: 'Start', triggerModes: ['manual', 'chat'], chatPhrase: phrase },
            },
            {
              id: 'mcp-1',
              type: 'mcp_tool',
              position: { x: 280, y: 120 },
              data: {
                label: 'MCP Tool',
                inputBindings: [],
                taskConfig: {
                  mcpInvokeKind: 'tool',
                  mcpServerId: mcp?.id || '',
                  toolName,
                  staticArguments: '{}',
                  httpHeadersJson: '{}',
                },
              },
            },
          ],
          edges: [{ id: 'e1', source: 'trigger-1', target: 'mcp-1' }],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        autoTest: wantsAutoTest(message),
        summary: `MCP tool ${toolName} on ${mcp?.id || 'first server'}`,
      };
    },
  },
  {
    id: 'enduser-research-briefing',
    label: 'Look up a public page and write a short briefing',
    score(message) {
      const t = message.toLowerCase();
      if (isOpsOrLifecycleIntent(t)) return 0;
      let s = 0;
      if (/\b(look\s+up|look\s+this\s+up|research|find\s+out|check\s+(?:the\s+)?(?:web|news|weather|site))\b/i.test(t)) s += 4;
      if (/\b(summar|recap|briefing|plain\s+english|tell\s+me)\b/i.test(t)) s += 3;
      if (/\b(i\s+(?:want|need)|help\s+me|can\s+you|please)\b/i.test(t)) s += 2;
      if (/\b(api|http|url|website)\b/i.test(t)) s += 1;
      if (/openrouter|mcp|connector|job\s+applicant/i.test(t)) s -= 4;
      return s;
    },
    build(message) {
      const name = extractWorkflowName(message) || 'Research briefing';
      const phrase = `run ${slugify(name)}`;
      const modes = inferTriggerModes(message);
      return {
        name,
        chat_phrase: phrase,
        trigger_modes: modes,
        graph: {
          nodes: [
            triggerNode(phrase, modes),
            publicApiNode(
              'api-1',
              'Fetch public sample',
              280,
              40,
              'https://jsonplaceholder.typicode.com/todos/1'
            ),
            ollamaBrainNode(
              'brain-1',
              'Write a short briefing',
              520,
              120,
              'Write a friendly 3-sentence briefing in plain English from the data below. No jargon.\n\n{{api-1.body}}\n\nOriginal request:\n{{input}}',
              'api-1',
              'body'
            ),
          ],
          edges: [
            { id: 'e1', source: 'trigger-1', target: 'api-1' },
            { id: 'e2', source: 'api-1', target: 'brain-1' },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        autoTest: wantsAutoTest(message),
        summary: 'Fetches a public API (no key) then writes a short briefing with free Ollama',
      };
    },
  },
  {
    id: 'enduser-connector-briefing',
    label: 'Read connected app news and summarize',
    score(message) {
      const t = message.toLowerCase();
      if (isOpsOrLifecycleIntent(t)) return 0;
      let s = 0;
      if (/\b(connector|connected\s+app|hacker\s*news|github|gmail|slack)\b/i.test(t)) s += 5;
      if (/\b(news|stories|inbox|profile)\b/i.test(t)) s += 2;
      if (/\b(summar|recap|briefing|plain\s+english)\b/i.test(t)) s += 2;
      if (/\b(i\s+(?:want|need)|help\s+me|can\s+you)\b/i.test(t)) s += 1;
      if (/openrouter|job\s+applicant/i.test(t)) s -= 3;
      return s;
    },
    build(message) {
      const name = extractWorkflowName(message) || 'Connected app briefing';
      const phrase = `run ${slugify(name)}`;
      const modes = inferTriggerModes(message);
      return {
        name,
        chat_phrase: phrase,
        trigger_modes: modes,
        graph: {
          nodes: [
            triggerNode(phrase, modes),
            connectorHnNode('connector-1', 280, 120),
            ollamaBrainNode(
              'brain-1',
              'Summarize stories',
              540,
              120,
              'Summarize the top stories in 4 friendly bullets. No technical jargon.\n\n{{connector-1.text}}\n\n{{connector-1.result}}',
              'connector-1'
            ),
          ],
          edges: [
            { id: 'e1', source: 'trigger-1', target: 'connector-1' },
            { id: 'e2', source: 'connector-1', target: 'brain-1' },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        autoTest: wantsAutoTest(message),
        summary: 'Hacker News connector (no API key) → free Ollama summary',
      };
    },
  },
  {
    id: 'enduser-complex-ops',
    label: 'Public API + connected news + optional MCP, then a plain-English recap',
    score(message) {
      const t = message.toLowerCase();
      if (isOpsOrLifecycleIntent(t)) return 0;
      let s = 0;
      const mentionsApi = /\b(api|website|web|http|look\s+up|public)\b/i.test(t);
      const mentionsMcp = /\b(mcp|connected\s+tool|my\s+tools|extra\s+tools|wired\s+up)\b/i.test(t);
      const mentionsConn = /\b(connector|hacker\s*news|connected\s+app)\b/i.test(t);
      const combo = [mentionsApi, mentionsMcp, mentionsConn].filter(Boolean).length;
      if (combo >= 2) s += 8;
      if (combo === 3) s += 4;
      if (/\b(summar|recap|briefing|plain\s+english)\b/i.test(t)) s += 2;
      if (/openrouter|job\s+applicant/i.test(t)) s -= 6;
      return s;
    },
    build(message, ctx) {
      const name = extractWorkflowName(message) || 'Ops recap';
      const phrase = `run ${slugify(name)}`;
      const modes = inferTriggerModes(message);
      const mcp = ctx?.mcpServers?.[0];
      const nodes = [
        triggerNode(phrase, modes),
        publicApiNode(
          'api-1',
          'Public sample lookup',
          260,
          40,
          'https://jsonplaceholder.typicode.com/todos/1'
        ),
        connectorHnNode('connector-1', 260, 220),
      ];
      const edges = [
        { id: 'e1', source: 'trigger-1', target: 'api-1' },
        { id: 'e2', source: 'trigger-1', target: 'connector-1' },
      ];
      if (mcp?.id) {
        nodes.push(mcpToolNode('mcp-1', 260, 400, mcp));
        edges.push({ id: 'e3', source: 'trigger-1', target: 'mcp-1' });
      }
      nodes.push(
        ollamaBrainNode(
          'brain-1',
          'Plain-English recap',
          560,
          180,
          'Combine the lookup, news, and any tool result into one short recap a non-technical person can act on.\n\nAPI:\n{{api-1.body}}\n\nNews:\n{{connector-1.text}}\n\nTool:\n{{mcp-1.text}}',
          'api-1'
        )
      );
      edges.push({ id: 'e-brain-api', source: 'api-1', target: 'brain-1' });
      edges.push({ id: 'e-brain-conn', source: 'connector-1', target: 'brain-1' });
      if (mcp?.id) edges.push({ id: 'e-brain-mcp', source: 'mcp-1', target: 'brain-1' });
      return {
        name,
        chat_phrase: phrase,
        trigger_modes: modes,
        graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } },
        autoTest: wantsAutoTest(message),
        summary:
          'Public API (no key) + Hacker News connector + optional MCP, then free Ollama recap. Store no secrets in the graph.',
      };
    },
  },
  {
    id: 'enduser-note-summary',
    label: 'Turn my note into a short friendly summary',
    score(message) {
      const t = message.toLowerCase();
      if (isOpsOrLifecycleIntent(t)) return 0;
      let s = 0;
      if (/\b(i\s+(?:want|need)|help\s+me|can\s+you|please)\b/i.test(t)) s += 3;
      if (/\b(note|notes|message|text|something)\b/i.test(t) && /\b(summar|recap|short|friendly)\b/i.test(t)) s += 5;
      if (/\bworkflow\b/i.test(t)) s += 1;
      if (/brain|mcp|openrouter|connector|job\s+applicant|api\s+echo/i.test(t)) s -= 5;
      return s;
    },
    build(message) {
      const name = extractWorkflowName(message) || 'Morning Recap';
      const phrase = `run ${slugify(name)}`;
      const modes = inferTriggerModes(message);
      return {
        name,
        chat_phrase: phrase,
        trigger_modes: modes,
        graph: {
          nodes: [
            triggerNode(phrase, modes),
            ollamaBrainNode(
              'brain-1',
              'Friendly summary',
              280,
              120,
              'Rewrite the note in 2-3 warm, non-technical sentences.\n\n{{input}}'
            ),
          ],
          edges: [{ id: 'e1', source: 'trigger-1', target: 'brain-1' }],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        autoTest: wantsAutoTest(message),
        summary: 'Trigger → free Ollama summary (no API key)',
      };
    },
  },
];

export function isOpsOrLifecycleIntent(message) {
  const t = String(message || '').toLowerCase();
  return (
    /(?:failed\s+run|why\s+(?:did|does)|root\s*cause|\brca\b)/i.test(t) ||
    /(?:unpublish|revert\s+to\s+draft|make\s+draft|set\s+to\s+draft|put\s+(?:it|this)\s+back\s+in\s+draft)/i.test(t) ||
    /(?:delete|remove)\s+(?:this\s+)?(?:workflow|flow)/i.test(t) ||
    /(?:publish\s+as\s+a2a|agent\s+exchange|share\s+(?:this|it)\s+as\s+an?\s+agent)/i.test(t) ||
    /(?:inspect|status)\s+(?:latest|last|run)/i.test(t)
  );
}

export function isWorkflowCreateIntent(message) {
  const t = String(message || '').trim();
  if (!t) return false;

  const strongCreate =
    /(?:create|build|make|add|new|setup|set\s+up)\s+(?:a\s+)?(?:new\s+)?workflow/i.test(t) ||
    /^workflow\s*:/i.test(t) ||
    (/(?:i\s+(?:want|need)|help\s+me|can\s+you)\b/i.test(t) &&
      /(?:summar|recap|briefing|automat|look\s+up|research|note|news|connector|connected)/i.test(t)) ||
    (/\b(look\s+up|look\s+something\s+up|public\s+webpage|hacker\s*news|connected\s+apps?)\b/i.test(t) &&
      /\b(briefing|summar|recap|explain|plain\s+english|stories|act\s+on)\b/i.test(t)) ||
    (/call\s+it\s+/i.test(t) && /\b(summar|briefing|recap|news|look\s+up|note|stories)\b/i.test(t));

  if (strongCreate) return true;
  if (isOpsOrLifecycleIntent(t)) return false;
  if (
    /(?:every\s+(?:morning|day)|when\s+(?:a\s+)?(?:customer|someone)|look\s+(?:this|it)\s+up|send\s+me\s+a\s+(?:recap|summary|briefing))/i.test(
      t
    )
  ) {
    return true;
  }
  return (
    /(?:brain|mcp|approval|agent|email|sse|api|openrouter|connector)/i.test(t) &&
    /(?:→|->|then|workflow|trigger|provider|invoke|echo)/i.test(t)
  );
}

export function matchWorkflowRecipe(message, { minScore = 4 } = {}) {
  if (!isWorkflowCreateIntent(message)) return null;
  let best = null;
  let bestScore = 0;
  for (const recipe of WORKFLOW_RECIPES) {
    const s = recipe.score(message);
    if (s > bestScore) {
      bestScore = s;
      best = recipe;
    }
  }
  return bestScore >= minScore ? best : null;
}

export function buildRecipeActionBatch(recipe, message, runtime) {
  const spec = recipe.build(message, runtime);
  const actions = [];

  if (spec.template_id) {
    actions.push({
      action: 'create_from_template',
      template_id: spec.template_id,
      name: spec.name,
      chat_phrase: spec.chat_phrase,
    });
  } else {
    actions.push({
      action: 'create_workflow',
      name: spec.name,
      chat_phrase: spec.chat_phrase,
      trigger_modes: spec.trigger_modes || ['manual', 'chat'],
      graph: spec.graph,
    });
  }

  actions.push({ action: 'publish' });

  if (spec.autoTest) {
    actions.push({
      action: 'test_workflow',
      input: 'Automated recipe test run',
      wait: true,
      timeout_ms: 60000,
    });
  }

  return { actions, spec };
}

/** Chat → existing recipe graph + publish (+ optional sandbox test). No node-level edits. */
export function planRecipePublishFromChat(message, runtime = {}) {
  const recipe = matchWorkflowRecipe(message, { minScore: 4 });
  if (!recipe) return { ok: false, reason: 'no_recipe' };
  const { actions, spec } = buildRecipeActionBatch(recipe, message, runtime);
  const mutatesNodes = (actions || []).some((a) =>
    ['add_node', 'update_node', 'add_edge', 'connect', 'connect_nodes'].includes(a.action)
  );
  return {
    ok: true,
    recipe_id: recipe.id,
    actions,
    spec,
    node_edits: mutatesNodes,
  };
}

/** When the LLM only emits create_workflow with a bare trigger, substitute a matching recipe graph. */
export function enrichCreateWorkflowActions(message, actions, runtime) {
  const list = Array.isArray(actions) ? [...actions] : [];
  const createAction = list.find((a) => a.action === 'create_workflow');
  if (!createAction) return list;

  const nodeCount = createAction.graph?.nodes?.length || 0;
  const hasFollowUpNodes = list.some((a) =>
    ['add_node', 'update_node', 'add_edge', 'connect', 'connect_nodes'].includes(a.action)
  );
  if (nodeCount > 1 || hasFollowUpNodes) return list;

  const recipe = matchWorkflowRecipe(message, { minScore: 4 });
  if (!recipe) return list;

  const { actions: recipeActions, spec } = buildRecipeActionBatch(recipe, message, runtime);
  if (createAction.name) recipeActions[0].name = createAction.name;
  if (createAction.chat_phrase || createAction.chat_trigger_phrase) {
    recipeActions[0].chat_phrase = createAction.chat_phrase || createAction.chat_trigger_phrase;
  }
  const keepPublish = list.some((a) => a.action === 'publish');
  const keepTest = list.find((a) => a.action === 'test_workflow');
  const out = [recipeActions[0]];
  if (keepPublish || recipeActions.some((a) => a.action === 'publish')) {
    out.push({ action: 'publish' });
  }
  if (keepTest) out.push(keepTest);
  else if (recipeActions.some((a) => a.action === 'test_workflow')) {
    out.push(recipeActions.find((a) => a.action === 'test_workflow'));
  }
  return out;
}

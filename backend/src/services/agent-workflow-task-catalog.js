/**
 * Standard workflow task catalog — input/output schemas for built-in tasks.
 */
import { withNodeTimeoutConfigFields, DEFAULT_NODE_TIMEOUT_MS } from './agent-workflow-node-timeout.js';

export const WORKFLOW_TASK_TYPES = {
  trigger: {
    type: 'trigger',
    label: 'Trigger',
    color: '#16a34a',
    inputs: [],
    outputs: [{ id: 'trigger_input', label: 'Trigger payload', description: 'Initial message or schedule context' }],
  },
  agent: {
    type: 'agent',
    label: 'Agent',
    color: '#2563eb',
    inputs: [
      { id: 'prompt', label: 'Task / prompt', required: false, mode: 'dynamic', defaultMode: 'dynamic', description: 'Static text or previous step output via {{input}}' },
    ],
    outputs: [{ id: 'text', label: 'Agent response', description: 'Full agent reply text' }],
  },
  tool: {
    type: 'tool',
    label: 'Content Tool',
    color: '#9333ea',
    inputs: [
      { id: 'payload', label: 'Tool payload', required: false, mode: 'dynamic', description: 'Merged with tool-specific static fields' },
    ],
    outputs: [{ id: 'result', label: 'Tool result', description: 'JSON or text from tool' }],
  },
  mcp_tool: {
    type: 'mcp_tool',
    label: 'MCP',
    color: '#0ea5e9',
    inputs: [
      { id: 'arguments', label: 'Arguments (JSON)', required: false, mode: 'dynamic', description: 'Merged with static args (tools/prompts)' },
      { id: 'uri', label: 'Resource URI', required: false, mode: 'dynamic', description: 'Override resource URI when invoke kind is resource' },
    ],
    outputs: [
      { id: 'text', label: 'Response text' },
      { id: 'result', label: 'Full MCP result JSON' },
      { id: 'ok', label: 'Success' },
    ],
    configFields: withNodeTimeoutConfigFields([
      { id: 'mcpInvokeKind', label: 'Invoke kind', type: 'select', options: ['tool', 'prompt', 'resource'], default: 'tool' },
      { id: 'mcpServerId', label: 'MCP server', type: 'text' },
      { id: 'toolName', label: 'Tool name', type: 'text' },
      { id: 'promptName', label: 'Prompt name', type: 'text' },
      { id: 'resourceUri', label: 'Resource URI', type: 'text' },
      { id: 'staticArguments', label: 'Static arguments (JSON)', type: 'textarea', placeholder: '{}' },
      {
        id: 'authBearer',
        label: 'Bearer token (optional)',
        type: 'text',
        placeholder: 'token or {{api-login.body.accessToken}}',
      },
      {
        id: 'httpHeadersJson',
        label: 'HTTP headers (JSON)',
        type: 'textarea',
        placeholder: '{"Authorization":"Bearer {{api-login.body.accessToken}}"}',
      },
    ]),
  },
  mcp_listen: {
    type: 'sse_listen',
    label: 'SSE Listen',
    color: '#0284c7',
    inputs: [],
    outputs: [
      { id: 'event', label: 'Latest SSE event JSON' },
      { id: 'text', label: 'Latest event as text' },
      { id: 'event_count', label: 'Events received' },
      { id: 'last_event_at', label: 'Last event timestamp' },
    ],
    configFields: [
      { id: 'streamUrl', label: 'SSE stream URL (optional)', type: 'text', placeholder: 'https://your-mcp.example.com/events/stream' },
      { id: 'mcpServerId', label: 'MCP server (optional)', type: 'text' },
      { id: 'eventsPath', label: 'Events path (with MCP server)', type: 'text', default: '/events/stream' },
      { id: 'httpHeadersJson', label: 'HTTP headers (JSON)', type: 'textarea', placeholder: '{}' },
    ],
  },
  sse_listen: {
    type: 'sse_listen',
    label: 'SSE Listen',
    color: '#0284c7',
    inputs: [],
    outputs: [
      { id: 'event', label: 'Latest SSE event JSON' },
      { id: 'text', label: 'Latest event as text' },
      { id: 'event_count', label: 'Events received' },
      { id: 'last_event_at', label: 'Last event timestamp' },
    ],
    configFields: [
      { id: 'streamUrl', label: 'SSE stream URL (optional)', type: 'text' },
      { id: 'mcpServerId', label: 'MCP server (optional)', type: 'text' },
      { id: 'eventsPath', label: 'Events path (with MCP server)', type: 'text', default: '/events/stream' },
      { id: 'httpHeadersJson', label: 'HTTP headers (JSON)', type: 'textarea', placeholder: '{}' },
    ],
  },
  sub_workflow: {
    type: 'sub_workflow',
    label: 'Sub-workflow',
    color: '#4f46e5',
    inputs: [],
    outputs: [
      { id: 'run_id', label: 'Child run ID' },
      { id: 'run_number', label: 'Child run number' },
      { id: 'definition_id', label: 'Target workflow ID' },
      { id: 'status', label: 'Child run status' },
      { id: 'text', label: 'Summary' },
      { id: 'ok', label: 'Success' },
    ],
    configFields: [
      { id: 'targetWorkflowId', label: 'Target workflow ID', type: 'text' },
      {
        id: 'triggerMode',
        label: 'Trigger as',
        type: 'select',
        options: ['manual', 'event', 'chat'],
        default: 'manual',
      },
      { id: 'inputTemplate', label: 'Input JSON template', type: 'textarea', placeholder: '{{event}}' },
      { id: 'waitForCompletion', label: 'Wait for child to finish', type: 'boolean', default: false },
    ],
  },
  email: {
    type: 'email',
    label: 'Send Email',
    color: '#dc2626',
    inputs: [
      { id: 'to', label: 'To address', required: true, mode: 'static', placeholder: 'team@example.com' },
      { id: 'cc', label: 'CC', required: false, mode: 'static', placeholder: '' },
      { id: 'subject', label: 'Subject', required: true, mode: 'static', placeholder: 'Job discovery update' },
      { id: 'body', label: 'Email body', required: true, mode: 'dynamic', description: 'Usually from previous agent step output' },
    ],
    outputs: [
      { id: 'sent', label: 'Sent', description: 'true if SMTP accepted the message' },
      { id: 'attempted', label: 'Attempted', description: 'true if send was tried' },
      { id: 'messageId', label: 'Message ID', description: 'SMTP message id when sent' },
      { id: 'error', label: 'Error', description: 'Error message if send failed' },
    ],
    configFields: [
      { id: 'useEnvSmtp', label: 'Use WORKFLOW_SMTP_* from .env', type: 'boolean', default: true },
      { id: 'smtpHost', label: 'SMTP host', type: 'text', placeholder: 'smtp.example.com' },
      { id: 'smtpPort', label: 'SMTP port', type: 'number', default: 587 },
      { id: 'smtpSecure', label: 'TLS / secure', type: 'boolean', default: false },
      { id: 'smtpUser', label: 'SMTP user', type: 'text' },
      { id: 'smtpPass', label: 'SMTP password', type: 'password' },
      { id: 'fromAddress', label: 'From address', type: 'text', placeholder: 'agent-os@example.com' },
    ],
  },
  api: {
    type: 'api',
    label: 'Call API',
    color: '#7c3aed',
    inputs: [
      { id: 'url', label: 'URL', required: true, mode: 'static', placeholder: 'https://api.example.com/hook' },
      { id: 'body', label: 'Request body', required: false, mode: 'dynamic', description: 'JSON or text from previous step' },
      { id: 'headers', label: 'Extra headers (JSON)', required: false, mode: 'static', placeholder: '{}' },
    ],
    outputs: [
      { id: 'status', label: 'HTTP status' },
      { id: 'body', label: 'Response body' },
      { id: 'ok', label: 'Success (2xx)' },
      { id: 'audio', label: 'Audio media ref (binary mode)' },
      { id: 'video', label: 'Video media ref (binary mode)' },
      { id: 'media', label: 'Media ref (binary mode)' },
    ],
    configFields: withNodeTimeoutConfigFields([
      { id: 'method', label: 'HTTP method', type: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'POST' },
      { id: 'authType', label: 'Auth type', type: 'select', options: ['none', 'basic', 'bearer', 'api_key'], default: 'none' },
      {
        id: 'responseMode',
        label: 'Response mode',
        type: 'select',
        options: ['auto', 'json', 'text', 'binary'],
        default: 'auto',
        description: 'binary stores audio/video/octet-stream as a media artifact ref',
      },
    ]),
  },
  elevenlabs: {
    type: 'elevenlabs',
    label: 'ElevenLabs',
    color: '#0ea5e9',
    inputs: [
      {
        id: 'text',
        label: 'Text (TTS)',
        required: false,
        mode: 'dynamic',
        description: 'Text to synthesize (TTS mode)',
      },
      {
        id: 'audio',
        label: 'Audio (STT)',
        required: false,
        mode: 'dynamic',
        description: 'Media ref or artifact id from prior step (STT mode)',
      },
    ],
    outputs: [
      { id: 'text', label: 'Text (transcript or echo)' },
      { id: 'audio', label: 'Audio media ref (TTS)' },
      { id: 'result', label: 'Full result JSON' },
      { id: 'ok', label: 'Success' },
    ],
    configFields: withNodeTimeoutConfigFields([
      {
        id: 'mode',
        label: 'Mode',
        type: 'select',
        options: ['tts', 'stt'],
        default: 'tts',
      },
      { id: 'voiceId', label: 'Voice ID (TTS)', type: 'text', placeholder: '21m00Tcm4TlvDq8ikWAM' },
      {
        id: 'modelId',
        label: 'Model ID',
        type: 'text',
        placeholder: 'eleven_flash_v2_5',
        description: 'Use eleven_flash_v2_5 / eleven_turbo_v2_5 for low latency; multilingual_v2 for quality',
      },
      {
        id: 'apiKeyRef',
        label: 'Vault key name (optional)',
        type: 'text',
        placeholder: 'ElevenLabs',
        description: 'CEO API Keys vault name; falls back to ELEVENLABS_API_KEY',
      },
      {
        id: 'outputFormat',
        label: 'TTS output format',
        type: 'text',
        default: 'mp3_22050_32',
        description: 'Lower bitrate (mp3_22050_32) downloads faster; mp3_44100_128 for higher quality',
      },
    ]),
  },
  speech_stt: {
    type: 'speech_stt',
    label: 'Speech STT',
    color: '#059669',
    inputs: [
      {
        id: 'audio',
        label: 'Audio',
        required: true,
        mode: 'dynamic',
        description: 'Media ref or artifact id (faster-whisper / local STT)',
      },
    ],
    outputs: [
      { id: 'text', label: 'Transcript' },
      { id: 'result', label: 'Full result JSON' },
      { id: 'ok', label: 'Success' },
    ],
    configFields: withNodeTimeoutConfigFields([
      {
        id: 'model',
        label: 'Model',
        type: 'text',
        default: 'whisper-1',
        description: 'OpenAI-compatible model id on the whisper service',
      },
      {
        id: 'language',
        label: 'Language (optional)',
        type: 'text',
        placeholder: 'en',
        description: 'ISO language hint for transcription',
      },
    ]),
  },
  analyze_image: {
    type: 'analyze_image',
    label: 'Analyze Image',
    color: '#7c3aed',
    inputs: [
      {
        id: 'image',
        label: 'Image',
        required: true,
        mode: 'dynamic',
        description: 'inbound/attachments/… path, MEDIA:/…, or chat text containing the path',
      },
      {
        id: 'prompt',
        label: 'Prompt (optional)',
        required: false,
        mode: 'dynamic',
        description: 'Extra instructions (e.g. thumbnail review focus)',
      },
    ],
    outputs: [
      { id: 'text', label: 'Description / analysis' },
      { id: 'description', label: 'Description' },
      { id: 'ocr_text', label: 'OCR text' },
      { id: 'ok', label: 'Success' },
    ],
    configFields: withNodeTimeoutConfigFields([
      {
        id: 'mode',
        label: 'Mode',
        type: 'text',
        default: 'full',
        description: 'full | describe | ocr | review',
      },
      {
        id: 'prompt',
        label: 'Default prompt',
        type: 'textarea',
        placeholder: 'Focus on thumbnail legibility…',
        description: 'Optional fixed instructions when input prompt is empty',
      },
    ]),
  },
  speech_tts: {
    type: 'speech_tts',
    label: 'Speech TTS',
    color: '#047857',
    inputs: [
      {
        id: 'text',
        label: 'Text',
        required: true,
        mode: 'dynamic',
        description: 'Text to synthesize with Piper (local, free)',
      },
    ],
    outputs: [
      { id: 'text', label: 'Spoken text' },
      { id: 'audio', label: 'Audio media ref' },
      { id: 'result', label: 'Full result JSON' },
      { id: 'ok', label: 'Success' },
    ],
    configFields: withNodeTimeoutConfigFields([
      {
        id: 'voice',
        label: 'Voice',
        type: 'text',
        placeholder: 'en_US-lessac-medium',
        description: 'Piper voice id installed on the piper service',
      },
      {
        id: 'lengthScale',
        label: 'Length scale',
        type: 'text',
        placeholder: '1.0',
        description: 'Speaking rate (>1 slower)',
      },
      {
        id: 'speakClean',
        label: 'Clean avatar speak text',
        type: 'select',
        options: ['true', 'false'],
        default: 'true',
      },
    ]),
  },
  model3d: {
    type: 'model3d',
    label: '3D Model',
    color: '#a855f7',
    inputs: [
      {
        id: 'avatarId',
        label: 'Avatar ID',
        required: false,
        mode: 'static',
        description: 'CEO avatar id (or set in node config)',
      },
      {
        id: 'audio',
        label: 'Audio media',
        required: false,
        mode: 'dynamic',
        description: 'TTS audio media ref',
      },
      {
        id: 'animation',
        label: 'Animation JSON',
        required: false,
        mode: 'dynamic',
        description: 'Clips + visemes JSON from Brain or prior step',
      },
      {
        id: 'visemes',
        label: 'Visemes (optional)',
        required: false,
        mode: 'dynamic',
      },
    ],
    outputs: [
      { id: 'playback', label: 'Playback payload for Virtual Room' },
      { id: 'text', label: 'Summary text' },
      { id: 'result', label: 'Full result JSON' },
      { id: 'ok', label: 'Success' },
    ],
    configFields: withNodeTimeoutConfigFields([
      { id: 'avatarId', label: 'Default avatar ID', type: 'text' },
    ]),
  },
  connector: {
    type: 'connector',
    label: 'Connector',
    color: '#f59e0b',
    inputs: [
      {
        id: 'input',
        label: 'Action input',
        required: false,
        mode: 'static',
        placeholder: '{"username":"octocat"}',
        description:
          'JSON for the connector action. Use mode Static for fixed JSON (supports {{trigger-1.trigger_input}}), or From previous step to take a prior node’s output.',
      },
    ],
    outputs: [
      { id: 'text', label: 'Connector response text' },
      { id: 'result', label: 'Full connector result JSON' },
      { id: 'ok', label: 'Success' },
      { id: 'action_id', label: 'Executed action ID' },
      { id: 'transport', label: 'Transport used (http|mcp)' },
    ],
    configFields: withNodeTimeoutConfigFields([
      { id: 'appId', label: 'Connector app ID', type: 'text' },
      { id: 'appName', label: 'Connector app name', type: 'text' },
      { id: 'actionId', label: 'Action ID', type: 'text' },
      { id: 'connectionName', label: 'Connection name (optional)', type: 'text', placeholder: 'ceo-...' },
    ]),
  },
  externalAgent: {
    type: 'externalAgent',
    label: 'External Agent (A2A)',
    color: '#059669',
    inputs: [
      {
        id: 'message',
        label: 'Message / prompt',
        required: true,
        mode: 'dynamic',
        description: 'Task for the external agent (supports {{input}} and prior step outputs)',
      },
      { id: 'contextId', label: 'Context ID (optional)', required: false, mode: 'static', description: 'A2A conversation context id' },
    ],
    outputs: [
      { id: 'text', label: 'Agent response text' },
      { id: 'result', label: 'Full A2A result JSON' },
      { id: 'task_id', label: 'A2A task ID' },
      { id: 'task_state', label: 'Task state' },
      { id: 'ok', label: 'Success' },
    ],
    configFields: [
      { id: 'externalAgentId', label: 'External agent', type: 'text' },
      { id: 'skillId', label: 'Skill ID (optional)', type: 'text' },
      { id: 'waitForCompletion', label: 'Wait for task completion', type: 'boolean', default: true },
      { id: 'timeoutMs', label: 'Timeout (ms)', type: 'number', default: 120000 },
      {
        id: 'authBearer',
        label: 'Bearer token override (optional)',
        type: 'text',
        placeholder: 'token or {{api-login.body.accessToken}}',
      },
      {
        id: 'httpHeadersJson',
        label: 'Extra auth headers (JSON)',
        type: 'textarea',
        placeholder: '{}',
      },
    ],
  },
  parallel: {
    type: 'parallel',
    label: 'Parallel',
    color: '#ea580c',
    inputs: [{ id: 'in', label: 'Input', mode: 'dynamic' }],
    outputs: [{ id: 'out', label: 'Branch signal' }],
  },
  merge: {
    type: 'merge',
    label: 'Merge',
    color: '#0891b2',
    inputs: [{ id: 'branches', label: 'Branch inputs', mode: 'dynamic' }],
    outputs: [{ id: 'merged', label: 'Merged context' }],
  },
  ceo_approval: {
    type: 'ceo_approval',
    label: 'CEO Approval',
    color: '#ca8a04',
    inputs: [
      {
        id: 'summary',
        label: 'Summary for CEO',
        required: true,
        mode: 'dynamic',
        description: 'Context shown on Kanban (from previous step)',
      },
    ],
    outputs: [
      { id: 'decision', label: 'Decision', description: 'approved or rejected' },
      { id: 'comment', label: 'CEO comment' },
      { id: 'approved', label: 'Approved (true/false)' },
      { id: 'text', label: 'Full outcome text' },
    ],
    configFields: [
      { id: 'title', label: 'Kanban title', type: 'text', placeholder: 'CEO review required' },
      { id: 'instructions', label: 'Instructions for CEO', type: 'text', placeholder: 'Review and approve or reject' },
    ],
  },
  if: {
    type: 'if',
    label: 'IF',
    color: '#0d9488',
    inputs: [],
    outputs: [
      { id: 'result', label: 'Condition result (true/false)' },
      { id: 'text', label: 'Branch taken' },
    ],
    configFields: [
      { id: 'sourceNodeId', label: 'Source step ID', type: 'text' },
      { id: 'sourceOutputKey', label: 'Output key', type: 'text', default: 'text' },
      {
        id: 'operator',
        label: 'Operator',
        type: 'select',
        options: ['eq', 'ne', 'contains', 'not_contains', 'gt', 'lt', 'empty', 'not_empty', 'approved', 'rejected'],
        default: 'contains',
      },
      { id: 'compareValue', label: 'Compare value', type: 'text' },
    ],
  },
  while: {
    type: 'while',
    label: 'While',
    color: '#db2777',
    inputs: [],
    outputs: [
      { id: 'iterations', label: 'Iteration count' },
      { id: 'text', label: 'Last condition result' },
    ],
    configFields: [
      { id: 'sourceNodeId', label: 'Source step ID', type: 'text' },
      { id: 'sourceOutputKey', label: 'Output key', type: 'text', default: 'text' },
      {
        id: 'operator',
        label: 'Operator',
        type: 'select',
        options: ['eq', 'ne', 'contains', 'not_contains', 'gt', 'lt', 'empty', 'not_empty'],
        default: 'not_empty',
      },
      { id: 'compareValue', label: 'Compare value', type: 'text' },
      { id: 'maxIterations', label: 'Max iterations', type: 'number', default: 10 },
    ],
  },
  brain: {
    type: 'brain',
    label: 'Brain (LLM)',
    color: '#6366f1',
    inputs: [
      { id: 'userMessage', label: 'User message', mode: 'dynamic', description: 'From previous step or static' },
    ],
    outputs: [
      { id: 'text', label: 'LLM response' },
      { id: 'reasoning_content', label: 'Thinking / reasoning text' },
      { id: 'thinking_mode', label: 'Thinking mode used' },
      { id: 'model_used', label: 'Model used' },
      { id: 'provider', label: 'Provider' },
      { id: 'mcp_tools_available', label: 'MCP tools available' },
      { id: 'mcp_tool_calls', label: 'MCP tool calls (JSON)' },
      { id: 'custom_script_ran', label: 'Custom script executed' },
      { id: 'custom_script_output', label: 'Custom script output JSON' },
    ],
    configFields: withNodeTimeoutConfigFields([
      {
        id: 'modelSource',
        label: 'Model source',
        type: 'select',
        options: ['openai', 'anthropic', 'ollama', 'openrouter', 'deepseek'],
        default: 'ollama',
      },
      {
        id: 'apiEndpoint',
        label: 'API endpoint (base URL)',
        type: 'text',
        placeholder: 'https://api.openai.com/v1 or https://openrouter.ai/api/v1',
      },
      { id: 'apiKey', label: 'API key (required on node)', type: 'password' },
      {
        id: 'model',
        label: 'Model name',
        type: 'text',
        placeholder: 'gpt-4o-mini or openai/gpt-4o-mini (OpenRouter)',
      },
      {
        id: 'thinkingMode',
        label: 'Thinking mode (DeepSeek / OpenRouter)',
        type: 'select',
        options: ['enabled', 'disabled', 'off'],
        default: 'enabled',
        description:
          'DeepSeek: thinking toggle. OpenRouter: unified reasoning. Off = omit param (provider default). Hidden for other sources in the editor.',
      },
      {
        id: 'thinkingEffort',
        label: 'Thinking effort',
        type: 'select',
        options: ['high', 'max', 'xhigh', 'medium', 'low'],
        default: 'high',
        description: 'DeepSeek: high|max. OpenRouter: high|xhigh|medium|low. Ignored when thinking is disabled/off.',
      },
      { id: 'maxTokens', label: 'Max tokens', type: 'number', default: 1024 },
      {
        id: 'systemPrompt',
        label: 'System prompt',
        type: 'textarea',
        placeholder: 'You are a helpful assistant. Context: {{brain-1.text}}',
      },
      { id: 'mcpToolCalling', label: 'Let LLM call MCP tools', type: 'boolean', default: false },
      { id: 'mcpServerIds', label: 'MCP server IDs (JSON array)', type: 'textarea', placeholder: '[]' },
      { id: 'mcpToolAllowlist', label: 'MCP tool allowlist (JSON array)', type: 'textarea', placeholder: '[]' },
      { id: 'mcpMaxToolRounds', label: 'Max MCP tool rounds', type: 'number', default: 8 },
      { id: 'mcpServerAuth', label: 'Per-MCP auth (JSON object)', type: 'textarea', placeholder: '{}' },
      {
        id: 'customScriptMode',
        label: 'Custom script mode',
        type: 'select',
        options: ['off', 'fallback', 'post', 'only'],
        default: 'off',
      },
      { id: 'customScriptId', label: 'Custom script ID', type: 'text', placeholder: 'script-my-graph-abc123' },
    ]),
  },
  custom_script: {
    type: 'custom_script',
    label: 'Custom Script',
    color: '#b45309',
    inputs: [
      {
        id: 'payload',
        label: 'Input payload',
        required: false,
        mode: 'dynamic',
        description: 'JSON or text passed to run_graph(inputs) / run(inputs)',
      },
    ],
    outputs: [
      { id: 'text', label: 'Script text output' },
      { id: 'result', label: 'Full script result JSON' },
      { id: 'ok', label: 'Success' },
      { id: 'script_id', label: 'Script ID' },
    ],
    configFields: withNodeTimeoutConfigFields([
      { id: 'customScriptId', label: 'Custom script', type: 'text' },
      { id: 'customScriptName', label: 'Script name (display)', type: 'text' },
    ]),
  },
  masterdata: {
    type: 'masterdata',
    label: 'Master Data',
    color: '#0f766e',
    inputs: [
      {
        id: 'query',
        label: 'Query / question',
        required: false,
        mode: 'dynamic',
        description: 'Keyword or natural-language query over this CEO master tables/documents',
      },
    ],
    outputs: [
      { id: 'text', label: 'Answer / result text' },
      { id: 'mode', label: 'Mode used (table|rag)' },
      { id: 'count', label: 'Hit count' },
      { id: 'result', label: 'Full result JSON' },
    ],
    configFields: withNodeTimeoutConfigFields([
      {
        id: 'mode',
        label: 'Mode',
        type: 'select',
        options: ['auto', 'table', 'rag'],
        default: 'auto',
      },
      { id: 'tableId', label: 'Table ID (table mode)', type: 'text', placeholder: 'mdt-…' },
      { id: 'documentId', label: 'Document ID (optional RAG filter)', type: 'text', placeholder: 'mdd-…' },
      { id: 'topK', label: 'RAG top-K chunks', type: 'number', default: 5 },
      { id: 'column', label: 'Column filter (optional)', type: 'text' },
      { id: 'equals', label: 'Column equals (optional)', type: 'text' },
      { id: 'summarize', label: 'LLM summarize RAG hits', type: 'boolean', default: true },
    ]),
  },
  filesystem: {
    type: 'filesystem',
    label: 'Filesystem',
    color: '#57534e',
    inputs: [
      {
        id: 'path',
        label: 'Path',
        required: true,
        mode: 'static',
        description: 'Directory or file under WORKFLOW_FS_ROOTS',
      },
      {
        id: 'glob',
        label: 'Glob (list)',
        required: false,
        mode: 'static',
        description: 'e.g. *.txt when operation=list',
      },
      {
        id: 'destination',
        label: 'Destination (move)',
        required: false,
        mode: 'static',
        description: 'Target path/dir for move',
      },
    ],
    outputs: [
      { id: 'ok', label: 'Success' },
      { id: 'count', label: 'File count (list)' },
      { id: 'names', label: 'File names (list)' },
      { id: 'text', label: 'Text / names' },
      { id: 'has_files', label: 'Has files (list)' },
      { id: 'files', label: 'Files JSON (list)' },
      { id: 'path', label: 'Resolved path' },
      { id: 'result', label: 'Full result JSON' },
    ],
    configFields: [
      {
        id: 'operation',
        label: 'Operation',
        type: 'select',
        options: ['list', 'exists', 'stat', 'read_text', 'move'],
        default: 'list',
      },
      { id: 'path', label: 'Default path', type: 'text', placeholder: 'inbox' },
      { id: 'glob', label: 'Default glob', type: 'text', default: '*', placeholder: '*.txt' },
      { id: 'destination', label: 'Default destination (move)', type: 'text' },
      { id: 'maxBytes', label: 'Max read bytes', type: 'number', default: 65536 },
    ],
  },
  web_scrape: {
    type: 'web_scrape',
    label: 'Web Scrape',
    color: '#c2410c',
    inputs: [
      {
        id: 'startUrl',
        label: 'Start URL / domain',
        required: true,
        mode: 'static',
        description: 'HTTPS URL or domain to crawl (same-origin by default)',
      },
      {
        id: 'phrases',
        label: 'Search phrases',
        required: false,
        mode: 'static',
        description: 'Comma-separated or JSON array. Empty = extract pages within caps',
      },
      {
        id: 'cookie',
        label: 'Cookie header (optional)',
        required: false,
        mode: 'static',
        description: 'Optional Cookie header. Instagram.com uses vault INSTAGRAM_SESSIONID when empty.',
      },
    ],
    outputs: [
      { id: 'ok', label: 'Success' },
      { id: 'text', label: 'Summary text' },
      { id: 'matches', label: 'Matching pages JSON' },
      { id: 'pages', label: 'Visited pages JSON' },
      { id: 'stats', label: 'Crawl stats JSON' },
      { id: 'result', label: 'Full result JSON' },
    ],
    configFields: withNodeTimeoutConfigFields([
      {
        id: 'render',
        label: 'Render',
        type: 'select',
        options: ['auto', 'http', 'playwright'],
        default: 'auto',
        description: 'auto = HTTP then Playwright if the page looks empty/login-walled',
      },
      { id: 'maxPages', label: 'Max pages', type: 'number', default: 25 },
      { id: 'maxDepth', label: 'Max depth', type: 'number', default: 2 },
      {
        id: 'sameOriginOnly',
        label: 'Same origin only',
        type: 'boolean',
        default: true,
      },
      {
        id: 'respectRobotsTxt',
        label: 'Respect robots.txt',
        type: 'boolean',
        default: true,
      },
      { id: 'includeGlobs', label: 'Include URL globs', type: 'text', placeholder: 'https://example.com/blog/*' },
      { id: 'excludeGlobs', label: 'Exclude URL globs', type: 'text', placeholder: '*/tag/*' },
    ]),
  },
};

export function getTaskCatalog() {
  return Object.values(WORKFLOW_TASK_TYPES);
}

export function getTaskTypeDef(type) {
  return WORKFLOW_TASK_TYPES[type] || null;
}

/** Default input bindings for a new node of given type. */
export function defaultInputBindings(type) {
  const def = getTaskTypeDef(type);
  if (!def?.inputs?.length) return [];
  return def.inputs.map((inp) => ({
    id: inp.id,
    label: inp.label,
    mode: inp.defaultMode || inp.mode || 'static',
    value: inp.mode === 'static' ? '' : undefined,
    sourceNodeId: '',
    sourceOutputKey: 'text',
  }));
}

export function defaultNodeConfig(type) {
  const def = getTaskTypeDef(type);
  const config = {};
  for (const f of def?.configFields || []) {
    config[f.id] = f.default ?? (f.type === 'boolean' ? false : f.type === 'number' ? f.default || 0 : '');
  }
  if (type === 'api') {
    config.method = config.method || 'POST';
    config.timeoutMs = config.timeoutMs || DEFAULT_NODE_TIMEOUT_MS;
    config.timeoutAction = config.timeoutAction || 'fail';
    config.defaultTimeoutOutput = config.defaultTimeoutOutput || '{}';
  }
  if (type === 'brain' || type === 'mcp_tool' || type === 'custom_script' || type === 'masterdata' || type === 'web_scrape') {
    config.timeoutMs = config.timeoutMs || DEFAULT_NODE_TIMEOUT_MS;
    config.timeoutAction = config.timeoutAction || 'fail';
    config.defaultTimeoutOutput = config.defaultTimeoutOutput || '{}';
  }
  if (type === 'email') {
    config.useEnvSmtp = config.useEnvSmtp !== false;
    config.smtpPort = config.smtpPort || 587;
  }
  return config;
}

export function defaultOutputsList(type) {
  return (getTaskTypeDef(type)?.outputs || []).map((o) => ({ ...o }));
}

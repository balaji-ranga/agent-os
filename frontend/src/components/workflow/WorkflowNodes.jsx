import { Handle, Position } from '@xyflow/react';

const baseStyle = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1.5px solid var(--border)',
  background: 'var(--surface)',
  minWidth: 118,
  maxWidth: 168,
  fontSize: '0.76rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  position: 'relative',
  lineHeight: 1.25,
};

function NodeShell({ color, icon, title, subtitle, nodeId, handles = {}, children }) {
  return (
    <div style={{ ...baseStyle, borderColor: color }}>
      {handles.target !== false && (
        <Handle type="target" position={Position.Left} style={{ background: color, width: 7, height: 7 }} />
      )}
      <div style={{ fontWeight: 700, color, marginBottom: 2, fontSize: '0.78rem' }}>
        {icon} {title}
      </div>
      {nodeId && (
        <div
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: '0.58rem',
            color: 'var(--muted)',
            marginBottom: subtitle ? 1 : 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {nodeId}
        </div>
      )}
      {subtitle && (
        <div
          style={{
            color: 'var(--muted)',
            fontSize: '0.68rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {subtitle}
        </div>
      )}
      {children}
      {handles.source !== false && !handles.multiSource && (
        <Handle type="source" position={Position.Right} style={{ background: color, width: 7, height: 7 }} />
      )}
    </div>
  );
}

export function TriggerNode({ id, data }) {
  const modes = (data.triggerModes || ['manual']).join(', ');
  return (
    <NodeShell
      nodeId={id}
      color="#16a34a"
      icon="▶"
      title={data.label || 'Trigger'}
      subtitle={`${modes}${data.scheduleCron ? ` · ${data.scheduleCron}` : ''}`}
      handles={{ target: false }}
    />
  );
}

export function AgentNode({ id, data }) {
  return (
    <NodeShell
      nodeId={id}
      color="#2563eb"
      icon="🤖"
      title={data.label || 'Agent'}
      subtitle={data.agentName || data.agentId || 'Select agent'}
    />
  );
}

export function ToolNode({ id, data }) {
  return (
    <NodeShell nodeId={id}
      color="#9333ea"
      icon="🔧"
      title={data.label || 'Tool'}
      subtitle={data.toolName || 'Select content tool'}
    />
  );
}

export function EmailNode({ id, data }) {
  const to = data.inputBindings?.find((b) => b.id === 'to')?.value || '(configure To)';
  return (
    <NodeShell nodeId={id} color="#dc2626" icon="✉" title={data.label || 'Send Email'} subtitle={`To: ${to}`} />
  );
}

export function ApiNode({ id, data }) {
  const url = data.inputBindings?.find((b) => b.id === 'url')?.value || data.taskConfig?.url || '(configure URL)';
  return (
    <NodeShell nodeId={id} color="#7c3aed" icon="⇄" title={data.label || 'Call API'} subtitle={String(url).slice(0, 40)} />
  );
}

export function ElevenLabsNode({ id, data }) {
  return (
    <NodeShell
      nodeId={id}
      color="#0ea5e9"
      icon="🎙"
      title={data.label || 'ElevenLabs'}
      subtitle={(data.taskConfig?.mode || 'tts').toUpperCase()}
    />
  );
}

export function SpeechSttNode({ id, data }) {
  return (
    <NodeShell
      nodeId={id}
      color="#059669"
      icon="🎤"
      title={data.label || 'Speech STT'}
      subtitle={data.taskConfig?.model || 'whisper'}
    />
  );
}

export function SpeechTtsNode({ id, data }) {
  return (
    <NodeShell
      nodeId={id}
      color="#047857"
      icon="🔊"
      title={data.label || 'Speech TTS'}
      subtitle={data.taskConfig?.voice || 'piper'}
    />
  );
}

export function Model3dNode({ id, data }) {
  return (
    <NodeShell
      nodeId={id}
      color="#a855f7"
      icon="🧊"
      title={data.label || '3D Model'}
      subtitle={data.taskConfig?.avatarId || 'avatar'}
    />
  );
}

export function ConnectorNode({ id, data }) {
  const cfg = data.taskConfig || {};
  const app = cfg.appName || cfg.appId || 'select connector';
  const action = cfg.actionId || 'choose action';
  return (
    <NodeShell
      nodeId={id}
      color="#f59e0b"
      icon="🔌"
      title={data.label || 'Connector'}
      subtitle={`${String(app).slice(0, 18)} · ${String(action).slice(0, 18)}`}
    />
  );
}

export function ExternalAgentNode({ id, data }) {
  const cfg = data.taskConfig || {};
  const name = cfg.externalAgentName || cfg.externalAgentId || 'select agent';
  return (
    <NodeShell
      nodeId={id}
      color="#059669"
      icon="🌐"
      title={data.label || 'External Agent'}
      subtitle={`A2A · ${String(name).slice(0, 36)}`}
    />
  );
}

export function CustomScriptNode({ id, data }) {
  const cfg = data.taskConfig || {};
  const name = cfg.customScriptName || cfg.customScriptId || 'select script';
  return (
    <NodeShell
      nodeId={id}
      color="#b45309"
      icon="📜"
      title={data.label || 'Custom Script'}
      subtitle={String(name).slice(0, 40)}
    />
  );
}

export function MasterDataNode({ id, data }) {
  const cfg = data.taskConfig || {};
  const mode = cfg.mode || 'auto';
  const sub =
    mode === 'table'
      ? `table · ${cfg.tableId || 'id'}`
      : mode === 'rag'
        ? `RAG · topK ${cfg.topK || 5}`
        : `auto · ${cfg.tableId || 'tables/docs'}`;
  return (
    <NodeShell
      nodeId={id}
      color="#0f766e"
      icon="🗄"
      title={data.label || 'Master Data'}
      subtitle={String(sub).slice(0, 42)}
    />
  );
}

export function FilesystemNode({ id, data }) {
  const cfg = data.taskConfig || {};
  const op = cfg.operation || 'list';
  const path = cfg.path || data.inputBindings?.find((b) => b.id === 'path')?.value || '';
  return (
    <NodeShell
      nodeId={id}
      color="#57534e"
      icon="📁"
      title={data.label || 'Filesystem'}
      subtitle={`${op}${path ? ` · ${String(path).slice(0, 28)}` : ''}`}
    />
  );
}

export function WebScrapeNode({ id, data }) {
  const cfg = data.taskConfig || {};
  const url =
    data.inputBindings?.find((b) => b.id === 'startUrl')?.value || cfg.startUrl || cfg.url || '';
  const phrases = data.inputBindings?.find((b) => b.id === 'phrases')?.value || cfg.phrases || '';
  const sub = url
    ? `${String(url).slice(0, 28)}${phrases ? ' · phrases' : ''}`
    : `${cfg.render || 'auto'} · max ${cfg.maxPages || 25}`;
  return (
    <NodeShell
      nodeId={id}
      color="#c2410c"
      icon="🕸"
      title={data.label || 'Web Scrape'}
      subtitle={String(sub).slice(0, 42)}
    />
  );
}

export function ParallelNode({ id, data }) {
  return (
    <NodeShell nodeId={id} color="#ea580c" icon="⑂" title={data.label || 'Parallel'} subtitle="Run branches concurrently" />
  );
}

export function MergeNode({ id, data }) {
  return (
    <NodeShell nodeId={id} color="#0891b2" icon="⊕" title={data.label || 'Merge'} subtitle="Wait for all inputs" />
  );
}

export function CeoApprovalNode({ id, data }) {
  return (
    <NodeShell
      nodeId={id}
      color="#ca8a04"
      icon="👤"
      title={data.label || 'CEO Approval'}
      subtitle="Kanban · approve / reject"
    />
  );
}

export function IfNode({ id, data }) {
  const cfg = data.taskConfig || {};
  const sourceLabel = cfg.sourceNodeId || 'pick source step';
  return (
    <NodeShell nodeId={id} color="#0d9488" icon="◇" title={data.label || 'IF'} subtitle={`${cfg.operator || '?'} · ${sourceLabel}`} handles={{ multiSource: true }}>
      <Handle type="source" position={Position.Right} id="true" style={{ top: '35%', background: '#16a34a', width: 7, height: 7 }} />
      <Handle type="source" position={Position.Right} id="false" style={{ top: '65%', background: '#dc2626', width: 7, height: 7 }} />
      <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: 4 }}>
        <span style={{ color: '#16a34a' }}>T</span> / <span style={{ color: '#dc2626' }}>F</span>
      </div>
    </NodeShell>
  );
}

export function WhileNode({ id, data }) {
  const cfg = data.taskConfig || {};
  return (
    <NodeShell
      nodeId={id}
      color="#db2777"
      icon="↻"
      title={data.label || 'While'}
      subtitle={`max ${cfg.maxIterations ?? 10}`}
      handles={{ multiSource: true }}
    >
      <Handle type="source" position={Position.Right} id="loop" style={{ top: '35%', background: '#db2777', width: 7, height: 7 }} />
      <Handle type="source" position={Position.Right} id="exit" style={{ top: '65%', background: '#6366f1', width: 7, height: 7 }} />
      <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: 4 }}>loop / exit</div>
    </NodeShell>
  );
}

export function BrainNode({ id, data }) {
  const cfg = data.taskConfig || {};
  return (
    <NodeShell
      nodeId={id}
      color="#6366f1"
      icon="🧠"
      title={data.label || 'Brain'}
      subtitle={`${cfg.modelSource || 'openai'} · ${cfg.model || 'model'}`}
    />
  );
}

export function McpToolNode({ id, data }) {
  const cfg = data.taskConfig || {};
  return (
    <NodeShell
      nodeId={id}
      color="#0ea5e9"
      icon="⚡"
      title={data.label || 'MCP Tool'}
      subtitle={`${cfg.toolName || 'tool'} · ${cfg.mcpServerId || 'server'}`}
    />
  );
}

export function SseListenNode({ id, data }) {
  const cfg = data.taskConfig || {};
  const sub = cfg.streamUrl || cfg.mcpServerId || 'configure stream';
  return (
    <NodeShell
      nodeId={id}
      color="#0284c7"
      icon="📡"
      title={data.label || 'SSE Listen'}
      subtitle={String(sub).slice(0, 36)}
    />
  );
}

export function SubWorkflowNode({ id, data }) {
  const cfg = data.taskConfig || {};
  return (
    <NodeShell
      nodeId={id}
      color="#4f46e5"
      icon="↳"
      title={data.label || 'Sub-workflow'}
      subtitle={`${cfg.targetWorkflowId || 'workflow id'} · ${cfg.triggerMode || 'manual'}`}
    />
  );
}

export const workflowNodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  tool: ToolNode,
  mcp_tool: McpToolNode,
  mcp_listen: SseListenNode,
  sse_listen: SseListenNode,
  sub_workflow: SubWorkflowNode,
  email: EmailNode,
  api: ApiNode,
  elevenlabs: ElevenLabsNode,
  speech_stt: SpeechSttNode,
  speech_tts: SpeechTtsNode,
  model3d: Model3dNode,
  connector: ConnectorNode,
  externalAgent: ExternalAgentNode,
  custom_script: CustomScriptNode,
  masterdata: MasterDataNode,
  filesystem: FilesystemNode,
  web_scrape: WebScrapeNode,
  parallel: ParallelNode,
  merge: MergeNode,
  ceo_approval: CeoApprovalNode,
  if: IfNode,
  while: WhileNode,
  brain: BrainNode,
};

export const PALETTE_ITEMS = [
  { type: 'trigger', label: 'Trigger', color: '#16a34a', desc: 'Start point (manual / schedule / chat)' },
  { type: 'agent', label: 'Agent', color: '#2563eb', desc: 'Delegate to workspace agent' },
  { type: 'brain', label: 'Brain (LLM)', color: '#6366f1', desc: 'Direct LLM call; optional MCP tool-calling loop' },
  { type: 'ceo_approval', label: 'CEO Approval', color: '#ca8a04', desc: 'Human approve/reject on Kanban' },
  { type: 'if', label: 'IF', color: '#0d9488', desc: 'Branch on condition (true/false handles)' },
  { type: 'while', label: 'While', color: '#db2777', desc: 'Loop while condition (loop/exit handles)' },
  { type: 'email', label: 'Send Email', color: '#dc2626', desc: 'SMTP email with static + dynamic inputs' },
  { type: 'api', label: 'Call API', color: '#7c3aed', desc: 'HTTP request with configurable URL/body' },
  { type: 'elevenlabs', label: 'ElevenLabs', color: '#0ea5e9', desc: 'TTS / STT — audio media refs for downstream nodes' },
  { type: 'speech_stt', label: 'Speech STT', color: '#059669', desc: 'Local faster-whisper transcription (optional-voice)' },
  { type: 'speech_tts', label: 'Speech TTS', color: '#047857', desc: 'Local Piper TTS — free alternative to ElevenLabs' },
  { type: 'model3d', label: '3D Model', color: '#a855f7', desc: 'Build Virtual Room playback (audio + animation clips)' },
  { type: 'connector', label: 'Connector', color: '#f59e0b', desc: 'Run an OpenConnector app action as this CEO' },
  { type: 'externalAgent', label: 'External Agent (A2A)', color: '#059669', desc: 'Invoke external agent via A2A protocol' },
  { type: 'custom_script', label: 'Custom Script', color: '#b45309', desc: 'Run approved LangGraph / Python / JS in sandbox' },
  { type: 'masterdata', label: 'Master Data', color: '#0f766e', desc: 'Query CEO tables (CSV) or RAG over uploaded documents' },
  { type: 'filesystem', label: 'Filesystem', color: '#57534e', desc: 'List/stat/read/move files (use with schedule to poll a folder)' },
  { type: 'web_scrape', label: 'Web Scrape', color: '#c2410c', desc: 'Crawl a site/domain with optional search phrases (Crawlee)' },
  { type: 'tool', label: 'Content Tool', color: '#9333ea', desc: 'Invoke a content tool' },
  { type: 'mcp_tool', label: 'MCP', color: '#0ea5e9', desc: 'Call MCP tool, prompt, or resource' },
  { type: 'mcp_listen', label: 'SSE Listen', color: '#0284c7', desc: 'Long-running SSE stream — dispatches downstream on each event' },
  { type: 'sse_listen', label: 'SSE Listen', color: '#0284c7', desc: 'Long-running SSE stream — dispatches downstream on each event' },
  { type: 'sub_workflow', label: 'Sub-workflow', color: '#4f46e5', desc: 'Invoke another published workflow (manual / event / chat)' },
  { type: 'parallel', label: 'Parallel', color: '#ea580c', desc: 'Fan-out to multiple branches' },
  { type: 'merge', label: 'Merge', color: '#0891b2', desc: 'Join parallel branches' },
];

export function defaultNodeData(type, extra = {}) {
  const id = extra.id || `${type}-${Date.now().toString(36)}`;
  let data = { label: PALETTE_ITEMS.find((p) => p.type === type)?.label || type };
  if (type === 'trigger') {
    data = { ...data, triggerModes: ['manual'], scheduleCron: '', chatPhrase: '' };
  }
  if (type === 'agent') {
    data = { ...data, agentId: '', agentName: '', prompt: 'Complete this task:\n\n{{input}}', inputFrom: '' };
  }
  if (type === 'tool') {
    data = { ...data, toolName: '', toolPayload: {} };
  }
  if (type === 'email' || type === 'brain' || type === 'ceo_approval' || type === 'mcp_tool' || type === 'mcp_listen' || type === 'sse_listen' || type === 'sub_workflow' || type === 'externalAgent' || type === 'custom_script' || type === 'masterdata' || type === 'filesystem' || type === 'web_scrape' || type === 'connector' || type === 'elevenlabs' || type === 'speech_stt' || type === 'speech_tts' || type === 'model3d' || type === 'api') {
    data = { ...data, inputBindings: data.inputBindings || [], outputs: data.outputs || [], taskConfig: data.taskConfig || {} };
  }
  if (type === 'filesystem') {
    data.taskConfig = {
      operation: 'list',
      path: '',
      glob: '*',
      destination: '',
      maxBytes: 65536,
      ...(data.taskConfig || {}),
    };
  }
  if (type === 'web_scrape') {
    data.taskConfig = {
      render: 'auto',
      maxPages: 25,
      maxDepth: 2,
      sameOriginOnly: true,
      respectRobotsTxt: true,
      includeGlobs: '',
      excludeGlobs: '',
      ...(data.taskConfig || {}),
    };
  }
  if (type === 'externalAgent') {
    data.taskConfig = {
      externalAgentId: '',
      externalAgentName: '',
      skillId: '',
      waitForCompletion: true,
      timeoutMs: 120000,
      authBearer: '',
      httpHeadersJson: '{}',
      ...(data.taskConfig || {}),
    };
    data.inputBindings = data.inputBindings?.length
      ? data.inputBindings
      : [
          { id: 'message', label: 'Message', mode: 'dynamic', value: '{{input}}', sourceNodeId: '', sourceOutputKey: 'text' },
          { id: 'contextId', label: 'Context ID', mode: 'static', value: '', sourceNodeId: '', sourceOutputKey: 'text' },
        ];
    data.outputs = data.outputs?.length
      ? data.outputs
      : [
          { id: 'text', label: 'Response text' },
          { id: 'result', label: 'Full result' },
          { id: 'task_id', label: 'Task ID' },
          { id: 'ok', label: 'Success' },
        ];
  }
  if (type === 'custom_script') {
    data.taskConfig = {
      customScriptId: '',
      customScriptName: '',
      timeoutMs: 1200000,
      timeoutAction: 'fail',
      defaultTimeoutOutput: '{}',
      ...(data.taskConfig || {}),
    };
    data.inputBindings = data.inputBindings?.length
      ? data.inputBindings
      : [{ id: 'payload', label: 'Payload', mode: 'dynamic', value: '{{input}}', sourceNodeId: '', sourceOutputKey: 'text' }];
    data.outputs = data.outputs?.length
      ? data.outputs
      : [
          { id: 'text', label: 'Script text' },
          { id: 'result', label: 'Full result' },
          { id: 'ok', label: 'Success' },
        ];
  }
  if (type === 'masterdata') {
    data.taskConfig = {
      mode: 'auto',
      tableId: '',
      documentId: '',
      topK: 5,
      column: '',
      equals: '',
      summarize: true,
      timeoutMs: 1200000,
      timeoutAction: 'fail',
      defaultTimeoutOutput: '{}',
      ...(data.taskConfig || {}),
    };
    data.inputBindings = data.inputBindings?.length
      ? data.inputBindings
      : [{ id: 'query', label: 'Query', mode: 'dynamic', value: '{{input}}', sourceNodeId: '', sourceOutputKey: 'text' }];
    data.outputs = data.outputs?.length
      ? data.outputs
      : [
          { id: 'text', label: 'Answer text' },
          { id: 'mode', label: 'Mode' },
          { id: 'count', label: 'Hit count' },
          { id: 'result', label: 'Full result' },
        ];
  }
  if (type === 'api') {
    data.taskConfig = {
      method: 'GET',
      authType: 'none',
      basicUsername: '',
      basicPassword: '',
      bearerToken: '',
      apiKeyHeader: 'X-API-Key',
      apiKeyValue: '',
      httpHeadersJson: '{}',
      timeoutMs: 1200000,
      timeoutAction: 'fail',
      defaultTimeoutOutput: '{}',
    };
    data.inputBindings = [
      { id: 'url', label: 'URL', mode: 'static', value: '', sourceNodeId: '', sourceOutputKey: 'text' },
      { id: 'body', label: 'Request body', mode: 'static', value: '', sourceNodeId: '', sourceOutputKey: 'text' },
      { id: 'headers', label: 'Extra headers (JSON)', mode: 'static', value: '{}', sourceNodeId: '', sourceOutputKey: 'text' },
    ];
    data.outputs = [
      { id: 'status', label: 'HTTP status' },
      { id: 'body', label: 'Response body' },
      { id: 'ok', label: 'Success (2xx)' },
    ];
  }
  if (type === 'connector') {
    data.taskConfig = {
      appId: '',
      appName: '',
      actionId: '',
      connectionName: '',
      timeoutMs: 1200000,
      timeoutAction: 'fail',
      defaultTimeoutOutput: '{}',
      ...(data.taskConfig || {}),
    };
    // Legacy graphs may still carry staticInputJson; runner reads it as fallback only.
    data.inputBindings = data.inputBindings?.length
      ? data.inputBindings
      : [
          {
            id: 'input',
            label: 'Action input',
            mode: 'static',
            value: '{}',
            sourceNodeId: '',
            sourceOutputKey: 'result',
          },
        ];
    data.outputs = data.outputs?.length
      ? data.outputs
      : [
          { id: 'text', label: 'Connector response text' },
          { id: 'result', label: 'Full connector result JSON' },
          { id: 'ok', label: 'Success' },
          { id: 'action_id', label: 'Executed action ID' },
          { id: 'transport', label: 'Transport used' },
        ];
  }
  if (type === 'if' || type === 'while') {
    data = {
      ...data,
      taskConfig: {
        sourceNodeId: '',
        sourceOutputKey: 'text',
        operator: type === 'while' ? 'not_empty' : 'contains',
        compareValue: '',
        maxIterations: 10,
      },
    };
  }
  if (type === 'brain') {
    data.taskConfig = {
      modelSource: 'ollama',
      apiEndpoint: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      model: 'llama3.2',
      maxTokens: 512,
      systemPrompt: 'You are a concise assistant.\n\nContext:\n{{input}}',
      mcpToolCalling: false,
      mcpServerIds: [],
      mcpToolAllowlist: [],
      mcpServerAuth: {},
      mcpMaxToolRounds: 8,
      customScriptMode: 'off',
      customScriptId: '',
      timeoutMs: 1200000,
      timeoutAction: 'fail',
      defaultTimeoutOutput: '{}',
    };
  }
  if (type === 'sse_listen' || type === 'mcp_listen') {
    data.taskConfig = {
      streamUrl: '',
      mcpServerId: '',
      eventsPath: '/events/stream',
      httpHeadersJson: '{}',
    };
    data.outputs = [
      { id: 'event', label: 'Latest SSE event' },
      { id: 'text', label: 'Event text' },
      { id: 'event_count', label: 'Event count' },
    ];
  }
  if (type === 'sub_workflow') {
    data.taskConfig = {
      targetWorkflowId: '',
      triggerMode: 'manual',
      inputTemplate: '{{event}}',
      waitForCompletion: false,
    };
    data.outputs = [
      { id: 'run_id', label: 'Child run ID' },
      { id: 'status', label: 'Child status' },
      { id: 'text', label: 'Summary' },
    ];
  }
  if (type === 'mcp_tool') {
    data.taskConfig = {
      mcpInvokeKind: 'tool',
      mcpServerId: '',
      toolName: '',
      promptName: '',
      resourceUri: '',
      staticArguments: '{}',
      authBearer: '',
      httpHeadersJson: '{}',
      timeoutMs: 1200000,
      timeoutAction: 'fail',
      defaultTimeoutOutput: '{}',
    };
  }
  if (type === 'ceo_approval') {
    data.taskConfig = { title: 'CEO Approval Required', instructions: 'Review the summary and approve or reject.' };
  }
  if (extra.data) data = { ...data, ...extra.data };
  return {
    id,
    type,
    position: extra.position || { x: 100 + Math.random() * 200, y: 100 + Math.random() * 100 },
    data,
  };
}

export function graphToFlow(graph) {
  return {
    nodes: (graph?.nodes || []).map((n, i) => {
      const position =
        n?.position &&
        typeof n.position.x === 'number' &&
        typeof n.position.y === 'number' &&
        !Number.isNaN(n.position.x) &&
        !Number.isNaN(n.position.y)
          ? n.position
          : { x: 40 + i * 170, y: 100 };
      const data =
        n?.data && typeof n.data === 'object'
          ? n.data
          : {
              label: n?.label || n?.type || 'Step',
              ...(n?.toolName ? { toolName: n.toolName } : {}),
            };
      return {
        ...n,
        id: n?.id || `node-${i + 1}`,
        type: n?.type || 'agent',
        position,
        data,
      };
    }),
    edges: (graph?.edges || []).map((e) => ({
      ...e,
      animated: true,
      style: { stroke: 'var(--accent)' },
      label: e.sourceHandle === 'true' ? 'T' : e.sourceHandle === 'false' ? 'F' : e.sourceHandle === 'loop' ? 'loop' : e.sourceHandle === 'exit' ? 'exit' : undefined,
    })),
    viewport: graph?.viewport || { x: 0, y: 0, zoom: 1 },
  };
}

export function flowToGraph(nodes, edges, viewport) {
  return {
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({
      id,
      source,
      target,
      sourceHandle: sourceHandle || undefined,
      targetHandle: targetHandle || undefined,
    })),
    viewport,
  };
}

/**
 * Desktop-orchestrated workflow runs: create run + persist state on Flolah,
 * execute remote (non-local) nodes on the server when the client asks.
 * Does not call advanceFromNode — client drives the graph.
 */
import { getDb } from '../db/schema.js';
import * as store from './agent-workflow-store.js';
import { isUserEnabled } from './users.js';
import { resolveNodeInputs, resolveInputText, storeNodeOutput, renderPayloadTemplates } from './agent-workflow-io.js';
import { getTaskTypeDef } from './agent-workflow-task-catalog.js';
import { executeBrainTask } from './agent-workflow-brain.js';
import { executeEmailTask, executeApiTask, executeFilesystemTask } from './agent-workflow-tasks.js';
import { executeWebScrapeTask } from './agent-workflow-web-scrape.js';
import { executeConnectorAction } from './openconnector.js';
import { executeCustomScriptTask } from './custom-scripts.js';
import { executeExternalAgentTask } from './agent-workflow-external-agent.js';
import { runMasterDataQuery } from './master-data.js';
import { invokeContentToolHttp } from './content-tool-http-invoke.js';
import {
  getMcpServerForWorkflow,
  callMcpServerTool,
  callMcpServerPrompt,
  callMcpServerResource,
} from './mcp-servers.js';
import { parseMcpAuthFromNodeConfig } from './mcp-auth.js';
import {
  validateWorkflowInput,
  resolveWorkflowInputSchema,
  WorkflowInputSchemaError,
} from './workflow-input-schema.js';
import { validateWorkflowBrainCredentials } from './agent-workflow-brain-providers.js';

function db() {
  return getDb();
}

const REMOTE_NODE_TYPES = new Set([
  'brain',
  'tool',
  'email',
  'api',
  'connector',
  'mcp_tool',
  'custom_script',
  'masterdata',
  'externalAgent',
  'web_scrape',
]);

const UNSUPPORTED_DESKTOP = new Set([
  'agent',
  'ceo_approval',
  'sse_listen',
  'mcp_listen',
  'sub_workflow',
]);

function buildStepInputRecord(node, graph, context) {
  const { resolved, summary } = resolveNodeInputs(node, graph, context);
  const outputSchema = node.data?.outputs || getTaskTypeDef(node.type)?.outputs || [];
  const record = { inputs: summary, resolved, outputs_schema: outputSchema };
  if (node.type === 'agent') {
    record.prompt_template = node.data?.prompt || node.data?.instructions || '';
    record.resolved_prompt = resolveInputText(node, graph, context);
  }
  return record;
}

function buildStepOutputRecord(outputs) {
  if (typeof outputs === 'string') return { text: outputs, outputs: [{ id: 'text', value: outputs }] };
  const list = Object.entries(outputs || {}).map(([id, value]) => ({
    id,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''),
  }));
  return { ...outputs, outputs: list };
}

function saveContext(runId, context) {
  db()
    .prepare(`UPDATE agent_workflow_runs SET context_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(context), runId);
}

function upsertDesktopStep(runId, node, status, extra = {}) {
  const label = node.data?.label || node.id;
  const existing = db()
    .prepare(
      `SELECT id, status FROM agent_workflow_run_steps WHERE run_id = ? AND node_id = ? AND COALESCE(iteration, 1) = ?`
    )
    .get(runId, node.id, extra.iteration || 1);

  if (existing) {
    db()
      .prepare(
        `UPDATE agent_workflow_run_steps SET status = ?, node_label = ?,
         input_json = COALESCE(?, input_json), output_json = COALESCE(?, output_json),
         started_at = COALESCE(started_at, datetime('now')),
         completed_at = ?, error_message = ?, node_type = ?
         WHERE id = ?`
      )
      .run(
        status,
        label,
        extra.input != null ? JSON.stringify(extra.input) : null,
        extra.output != null ? JSON.stringify(extra.output) : null,
        ['completed', 'failed', 'skipped'].includes(status) ? new Date().toISOString() : null,
        extra.error_message ?? null,
        node.type,
        existing.id
      );
    return existing.id;
  }

  db()
    .prepare(
      `INSERT INTO agent_workflow_run_steps
       (run_id, node_id, node_type, node_label, status, input_json, output_json,
        started_at, completed_at, error_message, iteration)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)`
    )
    .run(
      runId,
      node.id,
      node.type,
      label,
      status,
      extra.input != null ? JSON.stringify(extra.input) : null,
      extra.output != null ? JSON.stringify(extra.output) : null,
      ['completed', 'failed', 'skipped'].includes(status) ? new Date().toISOString() : null,
      extra.error_message ?? null,
      extra.iteration || 1
    );
  return db().prepare('SELECT id FROM agent_workflow_run_steps ORDER BY id DESC LIMIT 1').get()?.id;
}

function updateProgress(runId) {
  const steps = db()
    .prepare(`SELECT status FROM agent_workflow_run_steps WHERE run_id = ?`)
    .all(runId);
  if (!steps.length) return;
  const done = steps.filter((s) => ['completed', 'failed', 'skipped'].includes(s.status)).length;
  const pct = Math.min(99, Math.round((done / steps.length) * 100));
  db()
    .prepare(`UPDATE agent_workflow_runs SET progress_pct = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(pct, runId);
}

async function invokeContentTool(toolName, body, ownerUserId = null, opts = {}) {
  return invokeContentToolHttp(toolName, body, ownerUserId, opts);
}

/**
 * Create a desktop-orchestrated run (does NOT advance the graph on the server).
 */
export async function startDesktopOrchestratedRun(
  definitionId,
  ownerUserId,
  { input = '', actor = null } = {}
) {
  if (!isUserEnabled(ownerUserId)) {
    throw new Error('Owner account is disabled — workflow runs are stopped');
  }
  const def = store.getDefinition(definitionId, ownerUserId);
  if (!def) throw new Error('Workflow not found');
  if (def.paused) throw new Error('Workflow is paused — resume it before running');
  if (def.status !== 'published' || !def.published_graph) {
    throw new Error('Workflow must be published before running');
  }

  const graph = def.published_graph;
  const brainErrors = validateWorkflowBrainCredentials(graph, ownerUserId);
  if (brainErrors.length) {
    throw new Error(`Cannot run workflow: ${brainErrors.join('; ')}`);
  }
  const triggerNode = graph.nodes.find((n) => n.type === 'trigger');
  if (!triggerNode) throw new Error('Published workflow has no trigger node');

  let validatedInput = input;
  try {
    const schema = resolveWorkflowInputSchema({ def, graph });
    const validated = validateWorkflowInput(schema, input, { trigger: 'desktop' });
    validatedInput =
      validated.value != null && typeof validated.value === 'object'
        ? validated.value
        : validated.display != null
          ? validated.display
          : input;
  } catch (e) {
    if (e instanceof WorkflowInputSchemaError) throw e;
    throw e;
  }

  const runNumber =
    (db()
      .prepare('SELECT COALESCE(MAX(run_number), 0) + 1 AS n FROM agent_workflow_runs WHERE definition_id = ?')
      .get(definitionId)?.n) || 1;

  const triggerInputForStep =
    validatedInput != null && typeof validatedInput === 'object'
      ? validatedInput
      : validatedInput || 'Triggered via desktop';

  const context = {
    initial_input: validatedInput,
    node_outputs: {},
    actor,
    workflow_variables: def.variables || {},
    variables: def.variables || {},
    definition_id: definitionId,
    owner_user_id: ownerUserId,
    execution_mode: 'desktop',
  };

  db()
    .prepare(
      `INSERT INTO agent_workflow_runs (run_number, definition_id, owner_user_id, status, trigger, context_json, standup_id)
       VALUES (?, ?, ?, 'running', 'desktop', ?, NULL)`
    )
    .run(runNumber, definitionId, ownerUserId, JSON.stringify(context));

  const runId = db().prepare('SELECT id FROM agent_workflow_runs ORDER BY id DESC LIMIT 1').get()?.id;

  store.appendAudit(definitionId, {
    action: 'run_started',
    summary: `Run #${runNumber} started (desktop)`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });

  upsertDesktopStep(runId, triggerNode, 'completed', {
    input: { trigger: 'desktop', initial_input: validatedInput },
    output: buildStepOutputRecord({ trigger_input: triggerInputForStep }),
  });
  context.node_outputs[triggerNode.id] = {
    trigger_input: triggerInputForStep,
    text:
      typeof triggerInputForStep === 'object'
        ? JSON.stringify(triggerInputForStep)
        : String(triggerInputForStep || 'Triggered via desktop'),
  };
  saveContext(runId, context);
  updateProgress(runId);

  return {
    run: store.getRun(runId, ownerUserId),
    context,
    trigger_node_id: triggerNode.id,
    graph,
  };
}

/**
 * Client reports a locally executed step (api localhost / filesystem / control).
 */
export function reportDesktopStep(runId, ownerUserId, payload = {}) {
  const run = store.getRun(runId, ownerUserId);
  if (!run) throw new Error('Run not found');
  if (run.trigger !== 'desktop') throw new Error('Not a desktop-orchestrated run');
  if (run.status !== 'running') throw new Error(`Run is ${run.status}`);

  const def = store.getDefinition(run.definition_id, ownerUserId);
  const graph = def?.published_graph;
  const node = graph?.nodes?.find((n) => n.id === payload.node_id);
  if (!node) throw new Error('Node not found in published graph');

  let context = {};
  try {
    context = JSON.parse(
      db().prepare(`SELECT context_json FROM agent_workflow_runs WHERE id = ?`).get(runId)?.context_json || '{}'
    );
  } catch {
    context = {};
  }

  if (payload.context_patch && typeof payload.context_patch === 'object') {
    if (payload.context_patch.node_outputs) {
      context.node_outputs = { ...(context.node_outputs || {}), ...payload.context_patch.node_outputs };
    }
    if (payload.context_patch.while_loops) {
      context.while_loops = { ...(context.while_loops || {}), ...payload.context_patch.while_loops };
    }
  }

  const status = payload.status || 'completed';
  if (payload.outputs != null && status === 'completed') {
    storeNodeOutput(context, node.id, payload.outputs);
  }

  upsertDesktopStep(runId, node, status, {
    input: payload.input || null,
    output: payload.outputs != null ? buildStepOutputRecord(payload.outputs) : null,
    error_message: payload.error_message || null,
    iteration: payload.iteration || 1,
  });
  saveContext(runId, context);
  updateProgress(runId);

  return { ok: true, context, run: store.getRun(runId, ownerUserId) };
}

/**
 * Execute a remote node on Flolah and persist step + context.
 */
export async function executeDesktopRemoteNode(runId, ownerUserId, nodeId, { context_patch = null } = {}) {
  const runRow = db().prepare(`SELECT * FROM agent_workflow_runs WHERE id = ?`).get(runId);
  if (!runRow || runRow.owner_user_id !== ownerUserId) throw new Error('Run not found');
  if (runRow.trigger !== 'desktop') throw new Error('Not a desktop-orchestrated run');
  if (runRow.status !== 'running') throw new Error(`Run is ${runRow.status}`);

  const def = store.getDefinition(runRow.definition_id, ownerUserId);
  if (!def?.published_graph) throw new Error('Workflow not found');
  const graph = def.published_graph;
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error('Node not found');

  if (UNSUPPORTED_DESKTOP.has(node.type)) {
    throw new Error(
      `Node type "${node.type}" is not supported in desktop packages yet — run this workflow on the server`
    );
  }
  if (node.type !== 'filesystem' && !REMOTE_NODE_TYPES.has(node.type)) {
    throw new Error(
      `Node type "${node.type}" should execute on the desktop client (local orchestrator), not via execute-node`
    );
  }

  let context = {};
  try {
    context = JSON.parse(runRow.context_json || '{}');
  } catch {
    context = {};
  }
  if (context_patch?.node_outputs) {
    context.node_outputs = { ...(context.node_outputs || {}), ...context_patch.node_outputs };
  }
  if (context_patch?.while_loops) {
    context.while_loops = { ...(context.while_loops || {}), ...context_patch.while_loops };
  }

  const inputRecord = buildStepInputRecord(node, graph, context);
  upsertDesktopStep(runId, node, 'in_progress', { input: inputRecord });

  let outputs;
  try {
    outputs = await runRemoteNodeWork(node, graph, context, inputRecord, {
      ownerUserId,
      runId,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    upsertDesktopStep(runId, node, 'failed', { error_message: msg, input: inputRecord });
    db()
      .prepare(
        `UPDATE agent_workflow_runs SET status = 'failed', error_message = ?, completed_at = datetime('now'),
         updated_at = datetime('now'), progress_pct = 100 WHERE id = ?`
      )
      .run(msg, runId);
    throw err;
  }

  storeNodeOutput(context, node.id, outputs);
  saveContext(runId, context);
  upsertDesktopStep(runId, node, 'completed', {
    input: inputRecord,
    output: buildStepOutputRecord(outputs),
  });
  updateProgress(runId);

  return {
    ok: true,
    outputs,
    context,
    run: store.getRun(runId, ownerUserId),
  };
}

async function runRemoteNodeWork(node, graph, context, inputRecord, meta) {
  const config = node.data?.taskConfig || node.data?.config || {};
  const ownerAuth =
    db().prepare('SELECT id, role FROM platform_users WHERE id = ?').get(meta.ownerUserId) || {
      id: meta.ownerUserId,
      role: 'ceo',
    };

  switch (node.type) {
    case 'brain':
      return executeBrainTask(config, inputRecord.resolved, context, graph, { authUser: ownerAuth });
    case 'email':
      return executeEmailTask(inputRecord.resolved, config, context);
    case 'api':
      return executeApiTask(inputRecord.resolved, config, context);
    case 'web_scrape':
      return executeWebScrapeTask(inputRecord.resolved, config, { ...context, owner_user_id: meta.ownerUserId });
    case 'tool': {
      const toolName = node.data?.toolName || node.data?.tool_name;
      if (!toolName) throw new Error('No tool selected');
      let payload = { ...(node.data?.toolPayload || node.data?.tool_payload || {}), ...inputRecord.resolved };
      payload = renderPayloadTemplates(payload, context) || payload;
      if (payload.message == null && inputRecord.resolved.payload) payload.message = inputRecord.resolved.payload;
      if (payload.input == null && inputRecord.resolved.body) payload.input = inputRecord.resolved.body;
      const result = await invokeContentTool(toolName, payload, meta.ownerUserId);
      return { result, text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) };
    }
    case 'connector': {
      const actionId = String(config.actionId || config.action_id || '').trim();
      if (!actionId) throw new Error('Connector action ID required');
      let staticInput = {};
      try {
        const rawJson = config.staticInputJson ?? config.static_input_json;
        const trimmed = String(rawJson ?? '').trim();
        staticInput = trimmed ? JSON.parse(trimmed) : {};
        if (!staticInput || typeof staticInput !== 'object' || Array.isArray(staticInput)) staticInput = {};
      } catch {
        staticInput = {};
      }
      let dynamicInput = {};
      const inputRaw = inputRecord.resolved?.input || inputRecord.resolved?.payload || inputRecord.resolved?.body;
      if (inputRaw) {
        try {
          dynamicInput = typeof inputRaw === 'string' ? JSON.parse(inputRaw) : inputRaw;
        } catch {
          dynamicInput = { input: inputRaw };
        }
      }
      const out = await executeConnectorAction(
        meta.ownerUserId,
        actionId,
        { ...staticInput, ...dynamicInput },
        { connectionName: config.connectionName || config.connection_name || '' }
      );
      return {
        text: out.text || '',
        result: out.data || out,
        ok: !!out.ok,
        action_id: out.action_id || actionId,
        transport: out.transport || 'http',
      };
    }
    case 'mcp_tool': {
      const mcpServerId = config.mcpServerId || config.mcp_server_id;
      const invokeKind = (config.mcpInvokeKind || config.mcp_invoke_kind || 'tool').toLowerCase();
      const toolName = config.toolName || config.tool_name;
      const promptName = config.promptName || config.prompt_name;
      const resourceUri = config.resourceUri || config.resource_uri;
      if (!mcpServerId) throw new Error('MCP server required');
      const server = getMcpServerForWorkflow(mcpServerId, ownerAuth);
      if (!server) throw new Error(`MCP server unavailable: ${mcpServerId}`);
      let staticArgs = {};
      try {
        staticArgs = JSON.parse(config.staticArguments || config.static_arguments || '{}');
      } catch {
        staticArgs = {};
      }
      let dynamicArgs = {};
      const argRaw = inputRecord.resolved?.arguments || inputRecord.resolved?.payload || inputRecord.resolved?.body;
      if (argRaw) {
        try {
          dynamicArgs = typeof argRaw === 'string' ? JSON.parse(argRaw) : argRaw;
        } catch {
          dynamicArgs = { input: argRaw };
        }
      }
      const mergedArgs = { ...staticArgs, ...dynamicArgs };
      const nodeAuth = parseMcpAuthFromNodeConfig(config, context, meta.ownerUserId);
      let out;
      if (invokeKind === 'prompt') {
        if (!promptName) throw new Error('MCP prompt name required');
        out = await callMcpServerPrompt(mcpServerId, promptName, mergedArgs, ownerAuth, nodeAuth);
      } else if (invokeKind === 'resource') {
        const uri = String(
          inputRecord.resolved?.uri || inputRecord.resolved?.resource_uri || resourceUri || ''
        ).trim();
        if (!uri) throw new Error('Resource URI required');
        out = await callMcpServerResource(mcpServerId, uri, ownerAuth, nodeAuth);
      } else {
        if (!toolName) throw new Error('MCP tool name required');
        out = await callMcpServerTool(mcpServerId, toolName, mergedArgs, ownerAuth, nodeAuth);
      }
      return {
        text: typeof out === 'string' ? out : JSON.stringify(out),
        result: out,
        ok: true,
      };
    }
    case 'custom_script':
      return executeCustomScriptTask(
        inputRecord.resolved,
        config,
        { ...context, run_id: meta.runId, definition_id: context.definition_id },
        meta.ownerUserId
      );
    case 'masterdata': {
      const out = await runMasterDataQuery(
        meta.ownerUserId,
        {
          mode: config.mode || 'auto',
          tableId: config.tableId || config.table_id,
          documentId: config.documentId || config.document_id,
          topK: config.topK || config.top_k || 5,
          column: config.column,
          equals: config.equals,
          summarize: config.summarize !== false && config.summarize !== 'false',
          limit: config.limit,
        },
        {
          query: inputRecord.resolved.query || inputRecord.resolved.text || config.query || '',
          equals: inputRecord.resolved.equals,
        }
      );
      return {
        text: out.text || '',
        mode: out.mode || '',
        count: out.count ?? out.hit_count ?? 0,
        result: out,
        ok: !!out.ok,
      };
    }
    case 'externalAgent':
      return executeExternalAgentTask(inputRecord.resolved, config, context, meta.ownerUserId);
    case 'filesystem':
      return executeFilesystemTask(inputRecord.resolved, config, { ...context, owner_user_id: meta.ownerUserId }, {
        ownerUserId: meta.ownerUserId,
      });
    default:
      throw new Error(`Unsupported remote node type: ${node.type}`);
  }
}

export function completeDesktopRun(runId, ownerUserId, { status = 'completed', error_message = null } = {}) {
  const run = store.getRun(runId, ownerUserId);
  if (!run) throw new Error('Run not found');
  if (run.trigger !== 'desktop') throw new Error('Not a desktop-orchestrated run');
  if (!['completed', 'failed', 'cancelled'].includes(status)) {
    throw new Error('status must be completed, failed, or cancelled');
  }
  db()
    .prepare(
      `UPDATE agent_workflow_runs SET status = ?, error_message = ?, completed_at = datetime('now'),
       updated_at = datetime('now'), progress_pct = 100 WHERE id = ? AND owner_user_id = ?`
    )
    .run(status, error_message || null, runId, ownerUserId);
  return store.getRun(runId, ownerUserId);
}

export function isRemoteDesktopNodeType(type) {
  return REMOTE_NODE_TYPES.has(type);
}

export function isUnsupportedDesktopNodeType(type) {
  return UNSUPPORTED_DESKTOP.has(type);
}

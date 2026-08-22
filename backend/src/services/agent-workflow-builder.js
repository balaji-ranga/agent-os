/**
 * Programmatic workflow graph mutations for the Workflow Builder agent.
 */
import * as store from './agent-workflow-store.js';
import {
  defaultInputBindings,
  defaultNodeConfig,
  defaultOutputsList,
  getTaskCatalog,
  getTaskTypeDef,
} from './agent-workflow-task-catalog.js';
import { triggerAgentWorkflowForOwner, resolveWorkflowForTrigger, resolveRunForOwner, summarizeRunForAgent, waitForRunTerminal } from './agent-workflow-chat-tools.js';
import {
  pauseRun,
  deleteRun,
  pauseAllRuns,
  deleteDefinitionWithCleanup,
} from './agent-workflow-run-manager.js';
import { stopSseListen } from './agent-workflow-runner.js';
import { stopScheduleForDefinition, refreshAgentWorkflowSchedules } from './agent-workflow-scheduler.js';
import { getWorkflowTemplate } from './agent-workflow-templates.js';
import { buildDetailedGraphSummary } from './agent-workflow-agent-describe.js';
import {
  normalizeBrainTaskConfig,
  buildWorkflowNodeCatalog,
  getWorkflowNodeTypeSpec,
  validateWorkflowForPublish,
} from './agent-workflow-builder-catalog.js';
import { defaultBrainConfig } from './agent-workflow-agent-runtime-context.js';
import { enquireContentTools, listEnabledContentTools } from './content-tools-meta.js';
import {
  collectRequiredVaultKeys,
  formatVaultKeysSummary,
  graphUsesOllama,
  sanitizeWorkflowGraphSecrets,
} from './agent-workflow-secrets.js';
import { publishWorkflowAsA2A, unpublishWorkflowA2A } from './workflow-a2a-publish.js';
import { setA2AAccessPolicy } from './workflow-a2a-access.js';
import { getConnectedConnectorApps, searchConnectorApps, listConnectorActions, getConnectorActionGuide } from './openconnector.js';
import { listAgentsForUser, getUserById } from './users.js';
import { listMcpServersForWorkflow } from './mcp-servers.js';

const ACTION_ALIASES = {
  connectorsearchactions: 'search_connectors',
  connector_search_actions: 'search_connectors',
  search_actions: 'search_connectors',
  searchconnectors: 'search_connectors',
  search_connector_actions: 'search_connectors',
  connectorlistapps: 'list_connectors',
  connector_list_apps: 'list_connectors',
  listapps: 'list_connectors',
  list_apps: 'list_connectors',
  listconnectors: 'list_connectors',
  list_connector_apps: 'list_connectors',
  listconnectoractions: 'list_connector_actions',
  list_connector_actions: 'list_connector_actions',
  connectorgetactionguide: 'get_connector_action',
  connector_get_action_guide: 'get_connector_action',
  get_connector_action_guide: 'get_connector_action',
  listagents: 'list_agents',
  list_employees: 'list_agents',
  listmcp: 'list_mcp',
  list_mcp_servers: 'list_mcp',
  listmcpservers: 'list_mcp',
  learningssummary: 'summarize_learnings',
  learnings_summary: 'summarize_learnings',
  enquirecontenttools: 'enquire_content_tools',
  listcontenttools: 'list_content_tools',
  getcontenttools: 'list_content_tools',
  getnodecatalog: 'get_node_catalog',
  getnodetype: 'get_node_type',
  recommend_content_tools: 'enquire_content_tools',
  connectorexecuteaction: 'connector_execute_action',
  connector_execute_action: 'connector_execute_action',
};

export const LOOKUP_BUILDER_ACTIONS = new Set([
  'get_node_catalog',
  'get_node_type',
  'list_content_tools',
  'enquire_content_tools',
  'list_connectors',
  'search_connectors',
  'list_connector_actions',
  'get_connector_action',
  'list_agents',
  'list_mcp',
  'summarize_learnings',
  'validate_publish',
]);

export const GRAPH_EDIT_ACTIONS = new Set([
  'create_workflow',
  'create_from_template',
  'clone_workflow',
  'copy_workflow',
  'duplicate_workflow',
  'add_node',
  'update_node',
  'delete_node',
  'add_edge',
  'connect',
  'connect_nodes',
  'delete_edge',
  'set_metadata',
  'update_metadata',
]);

export function canonicalizeBuilderActionName(op) {
  const raw = String(op || '').trim();
  if (!raw) return '';
  const underscored = raw.toLowerCase().replace(/[\s-]+/g, '_');
  const compact = underscored.replace(/_/g, '');
  return ACTION_ALIASES[underscored] || ACTION_ALIASES[compact] || underscored;
}

export function actionsHaveGraphEdit(actions) {
  return (Array.isArray(actions) ? actions : []).some((a) =>
    GRAPH_EDIT_ACTIONS.has(canonicalizeBuilderActionName(a?.action || a?.op || a?.type))
  );
}

function pickConnectFromNodeId(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (!nodes.length) return null;
  const outgoing = new Set((graph.edges || []).map((e) => e.source));
  const leaf = [...nodes].reverse().find((n) => n?.id && !outgoing.has(n.id));
  return leaf?.id || nodes[nodes.length - 1]?.id || null;
}

export function buildEditFallbackActions(message, def, lookupResults = []) {
  const t = String(message || '').trim();
  const graph = def?.draft_graph || def?.published_graph || { nodes: [], edges: [] };
  const connectFrom = pickConnectFromNodeId(graph);
  const rows = Array.isArray(lookupResults) ? lookupResults : [];
  const search = rows.find((r) => r.ok && r.action === 'search_connectors');
  const listed = rows.find((r) => r.ok && r.action === 'list_connectors');
  const apps = search?.apps || listed?.apps || [];
  const connectorActs = search?.actions || rows.find((r) => r.ok && r.action === 'list_connector_actions')?.actions || [];
  const slug =
    (t.match(/\b(github|gmail|slack|hackernews|hacker\s*news|linkedin|google_drive|google_sheets)\b/i) || [])[0] ||
    '';
  const slugId = String(slug).toLowerCase().replace(/\s+/g, '');
  const app =
    apps.find((a) => {
      const blob = `${a.id || ''} ${a.name || ''}`.toLowerCase();
      return slugId ? blob.includes(slugId.replace('hackernews', 'hacker')) || blob.includes(slugId) : false;
    }) ||
    (slugId ? { id: slugId === 'hackernews' ? 'hackernews' : slugId, name: slug || slugId } : null) ||
    apps[0] ||
    null;

  if (app && (/\bconnector\b/i.test(t) || slugId || search || listed)) {
    const act =
      connectorActs.find((x) => String(x.app_id || x.service || '').toLowerCase() === String(app.id).toLowerCase()) ||
      connectorActs[0];
    return [
      {
        action: 'add_node',
        node_type: 'connector',
        label: app.name || app.id,
        connect_from: connectFrom || undefined,
        task_config: {
          appId: app.id,
          appName: app.name || app.id,
          actionId: act?.id || '',
        },
      },
    ];
  }

  const enquire = rows.find((r) => r.ok && r.action === 'enquire_content_tools');
  const toolName = enquire?.top_recommendation?.name;
  if (toolName && /tool|summar|search|generate|learn/i.test(t)) {
    return [
      {
        action: 'add_node',
        node_type: 'tool',
        toolName,
        label: enquire.top_recommendation.display_name || toolName,
        connect_from: connectFrom || undefined,
      },
    ];
  }

  const agents = rows.find((r) => r.ok && r.action === 'list_agents')?.agents || [];
  if (agents.length && /\bagent\b/i.test(t)) {
    const a = agents[0];
    return [
      {
        action: 'add_node',
        node_type: 'agent',
        agent_id: a.id,
        agent_name: a.name,
        label: a.name,
        connect_from: connectFrom || undefined,
      },
    ];
  }

  const mcps = rows.find((r) => r.ok && r.action === 'list_mcp')?.servers || [];
  if (mcps.length && /\bmcp\b/i.test(t)) {
    const s = mcps[0];
    const tool = (s.tools || [])[0] || '';
    return [
      {
        action: 'add_node',
        node_type: 'mcp_tool',
        label: s.name || 'MCP',
        connect_from: connectFrom || undefined,
        task_config: { mcpServerId: s.id, toolName: tool },
      },
    ];
  }

  return [];
}

function ensureDraftForEdit(def, currentId, ownerUserId, actor) {
  if (!def || def.status !== 'published') return def;
  const updated = store.unpublishDefinition(currentId, ownerUserId, actor);
  stopScheduleForDefinition(currentId);
  refreshAgentWorkflowSchedules();
  return updated;
}

const GRAPH_MUTATION_OPS = new Set([
  'add_node', 'update_node', 'delete_node', 'add_edge', 'connect', 'delete_edge', 'set_metadata', 'update_metadata',
]);

const VALID_TYPES = new Set(getTaskCatalog().map((t) => t.type));

function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }));
}

/**
 * Coerce LLM / imported graphs into React Flow shape: every node must have
 * { id, type, position: { x, y }, data }. Missing positions crash the editor.
 */
export function normalizeWorkflowGraph(graph) {
  const raw = cloneGraph(graph);
  const nodesIn = Array.isArray(raw.nodes) ? raw.nodes : [];
  const edgesIn = Array.isArray(raw.edges) ? raw.edges : [];
  const nodes = [];

  for (let i = 0; i < nodesIn.length; i += 1) {
    const n = nodesIn[i];
    if (!n || typeof n !== 'object') continue;
    const type = String(n.type || 'agent').trim();
    if (!VALID_TYPES.has(type)) {
      // Keep unknown types out of the canvas rather than crashing the editor
      continue;
    }

    const id = String(n.id || `${type}-${i + 1}`).trim() || `${type}-${i + 1}`;
    const incomingData = n.data && typeof n.data === 'object' ? { ...n.data } : {};
    if (n.label != null && incomingData.label == null) incomingData.label = n.label;
    if ((n.toolName || n.tool_name) && !incomingData.toolName) {
      incomingData.toolName = n.toolName || n.tool_name;
    }
    if ((n.toolPayload || n.tool_payload) && !incomingData.toolPayload) {
      incomingData.toolPayload = n.toolPayload || n.tool_payload;
    }
    if (n.agentId || n.agent_id) {
      incomingData.agentId = n.agentId || n.agent_id;
      incomingData.agentName = n.agentName || n.agent_name || incomingData.agentId;
    }
    if (n.prompt && !incomingData.prompt) incomingData.prompt = n.prompt;
    if (n.taskConfig || n.task_config) {
      incomingData.taskConfig = {
        ...(incomingData.taskConfig || {}),
        ...(n.taskConfig || n.task_config || {}),
      };
    }

    let position = n.position;
    if (
      !position ||
      typeof position !== 'object' ||
      typeof position.x !== 'number' ||
      typeof position.y !== 'number' ||
      Number.isNaN(position.x) ||
      Number.isNaN(position.y)
    ) {
      position = { x: 40 + i * 220, y: 120 };
    }

    const built = buildDefaultNode(type, {
      nodeId: id,
      label: incomingData.label,
      position,
      data: incomingData,
    });
    nodes.push(built);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [];
  for (let i = 0; i < edgesIn.length; i += 1) {
    const e = edgesIn[i];
    if (!e || typeof e !== 'object') continue;
    const source = e.source;
    const target = e.target;
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) continue;
    edges.push({
      id: e.id || `e${i + 1}`,
      source,
      target,
      sourceHandle: e.sourceHandle || undefined,
      targetHandle: e.targetHandle || undefined,
    });
  }

  // Auto-wire trigger → first non-trigger when LLM forgot edges
  if (!edges.length && nodes.length >= 2) {
    const trigger = nodes.find((n) => n.type === 'trigger');
    const next = nodes.find((n) => n.type !== 'trigger');
    if (trigger && next) {
      edges.push({ id: 'e1', source: trigger.id, target: next.id });
    }
  }

  return sanitizeWorkflowGraphSecrets({
    nodes,
    edges,
    viewport: raw.viewport || { x: 0, y: 0, zoom: 1 },
  }).graph;
}

function normalizeOneBuilderAction(action, message = '') {
  const next = { ...(action || {}) };
  let op = canonicalizeBuilderActionName(next.action || next.op || next.type);
  if (op === 'connector_execute_action') {
    const actionId = next.action_id || next.actionId || next.task_config?.actionId;
    const appId = next.app_id || next.appId || String(actionId || '').split('.')[0];
    if (actionId || appId) {
      return {
        action: 'add_node',
        node_type: 'connector',
        label: next.label || appId || 'Connector',
        connect_from: next.connect_from,
        task_config: {
          ...(next.task_config || {}),
          appId,
          appName: next.app_name || next.appName,
          actionId,
        },
      };
    }
    op = 'search_connectors';
    next.query = next.query || next.q || message;
  }
  if (!LOOKUP_BUILDER_ACTIONS.has(op) && !GRAPH_EDIT_ACTIONS.has(op)) {
    const tools = listEnabledContentTools();
    const hit = tools.find(
      (t) => t.name === op || String(t.name).replace(/_/g, '') === String(op).replace(/_/g, '')
    );
    if (hit) {
      if (hit.name === 'learnings_summary') {
        op = 'summarize_learnings';
      } else if (/^(connector_|browse_|content_tools_)/.test(hit.name) || /search|list|enquire/.test(hit.name)) {
        op = hit.name.startsWith('connector_') ? 'search_connectors' : 'enquire_content_tools';
        next.query = next.query || next.q || message;
      } else if (/(?:add|wire|insert|include|attach)\b/i.test(message)) {
        return {
          action: 'add_node',
          node_type: 'tool',
          toolName: hit.name,
          label: hit.display_name || hit.name,
          connect_from: next.connect_from,
        };
      } else {
        op = 'enquire_content_tools';
        next.query = next.query || message;
      }
    }
  }
  next.action = op;
  return next;
}

function dedupeLookupActions(list) {
  const out = [];
  const seen = new Set();
  for (const a of list) {
    const op = canonicalizeBuilderActionName(a.action);
    if (LOOKUP_BUILDER_ACTIONS.has(op)) {
      const key = `${op}:${a.query || a.q || a.app_id || a.appId || a.topic || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(a);
  }
  return out;
}

/**
 * Ensure create_workflow runs before mutations when no workflow is open.
 * Injects a create_workflow if the batch mutates without one.
 */
export function prepareBuilderActions(actions, { workflowId = null, message = '' } = {}) {
  let list = Array.isArray(actions) ? actions.map((a) => ({ ...a })) : [];
  list = list.map((a) => normalizeOneBuilderAction(a, message)).filter(Boolean);
  list = dedupeLookupActions(list);
  if (!list.length) return list;
  if (workflowId) return list;

  const needsContext = (a) => {
    const op = String(a?.action || a?.op || a?.type || '').toLowerCase();
    return [
      'add_node',
      'update_node',
      'delete_node',
      'add_edge',
      'connect',
      'delete_edge',
      'set_metadata',
      'update_metadata',
      'publish',
      'validate_publish',
      'test_workflow',
      'until_success',
      'build_until_success',
      'until_certified',
      'check_goal',
      'certify_workflow',
      'publish_a2a',
      'unpublish_a2a',
    ].includes(op);
  };
  const isCreate = (a) => {
    const op = String(a?.action || a?.op || a?.type || '').toLowerCase();
    return ['create_workflow', 'create_from_template', 'clone_workflow', 'copy_workflow', 'duplicate_workflow'].includes(op);
  };
  const isOpen = (a) => {
    const op = String(a?.action || a?.op || a?.type || '').toLowerCase();
    return ['open_workflow', 'load_workflow', 'reload_workflow'].includes(op);
  };

  const createIdx = list.findIndex(isCreate);
  const firstMutIdx = list.findIndex(needsContext);
  const openIdx = list.findIndex(isOpen);

  if (openIdx >= 0 && createIdx < 0) return list;

  if (createIdx >= 0 && firstMutIdx >= 0 && createIdx > firstMutIdx) {
    const [createAction] = list.splice(createIdx, 1);
    list.splice(firstMutIdx, 0, createAction);
    return list;
  }

  if (createIdx >= 0) return list;
  if (firstMutIdx < 0) return list;

  // Infer a name from the user message or first add_node label
  const msg = String(message || '');
  const nameMatch =
    msg.match(/(?:create|new|make)\s+(?:a\s+)?(?:new\s+)?workflow\s+[\"']?([a-zA-Z0-9_-]{2,40})/i) ||
    msg.match(/workflow\s+[\"']?([a-zA-Z0-9_-]{2,40})/i);
  const addNode = list.find((a) => String(a?.action || '').toLowerCase() === 'add_node');
  const inferredName =
    (nameMatch?.[1] ? nameMatch[1].trim() : null) ||
    (addNode?.label ? String(addNode.label).trim().slice(0, 40) : null) ||
    'New workflow';

  list.splice(firstMutIdx, 0, {
    action: 'create_workflow',
    name: inferredName,
    trigger_modes: ['manual', 'chat'],
    chat_phrase: `run ${inferredName}`.toLowerCase().replace(/\s+/g, ' ').trim(),
  });
  return list;
}

/** Fill missing toolName on tool nodes from user intent / content-tools enquire. */
export function enrichToolNodeActions(message, actions) {
  const list = Array.isArray(actions) ? actions.map((a) => ({ ...a })) : [];
  const msg = String(message || '').trim();
  if (!msg || !list.length) return list;

  const TOOL_NODE_BLOCKLIST = new Set([
    'agent_workflow_list',
    'agent_workflow_enquire',
    'agent_workflow_trigger',
    'agent_workflow_runs',
    'agent_workflow_get_draft',
    'agent_workflow_mutate',
    'content_tools_enquire',
    'intent_classify_and_delegate',
    'kanban_move_status',
    'kanban_reassign_to_coo',
    'kanban_assign_task',
    'kanban_create_task',
  ]);

  function aliasToolName(text) {
    const t = String(text || '').toLowerCase();
    if (/summariz(?:e|es)\s+(a\s+)?(web\s+)?pages?|summariz(?:e|es)\s+(a\s+)?(web\s+)?urls?|(web\s+)?urls?\s+summar/i.test(t)) {
      return 'summarize_url';
    }
    if (/generat(?:e|es)\s+(an?\s+)?images?|creat(?:e|es)\s+(an?\s+)?images?/i.test(t)) return 'generate_image';
    if (/generat(?:e|es)\s+(a\s+)?videos?|creat(?:e|es)\s+(a\s+)?videos?/i.test(t)) return 'generate_video';
    if (/order\s+learnings?|ibkr\s+order/i.test(t)) return 'ibkr_order_learnings';
    if (/brain\s+histor/i.test(t)) return 'brain_history';
    if (/learnings?\s+summar/i.test(t)) return 'learnings_summary';
    return null;
  }

  function intentQuery(text) {
    const m =
      text.match(/(?:tool(?:\s+node)?|content\s+tool)\s+that\s+(.+)/i) ||
      text.match(/(?:add|use|wire|include)\s+(?:a\s+)?(?:tool(?:\s+node)?\s+)?(?:that\s+)?(.+)/i) ||
      text.match(/(summarize\s+.+|generate\s+.+|ibkr\s+.+|brain\s+histor.+)/i);
    return String(m?.[1] || text).trim().slice(0, 160);
  }

  let recommendation = null;
  const ensureRecommendation = () => {
    if (recommendation !== null) return recommendation;
    const aliased = aliasToolName(msg);
    if (aliased) {
      recommendation = { name: aliased };
      return recommendation;
    }
    const q = intentQuery(msg);
    const ranked = enquireContentTools(q, { limit: 8 }).tools.filter(
      (t) => !TOOL_NODE_BLOCKLIST.has(t.name)
    );
    recommendation = ranked[0] ? { name: ranked[0].name } : null;
    return recommendation;
  };

  for (const action of list) {
    const op = String(action.action || action.op || '').toLowerCase();
    if (op === 'add_node') {
      const type = action.node_type || action.type;
      if (type !== 'tool') continue;
      const existing = action.toolName || action.tool_name || action.data?.toolName;
      if (existing) continue;
      const top = ensureRecommendation();
      if (top?.name) {
        action.toolName = top.name;
        action.data = { ...(action.data || {}), toolName: top.name };
      }
    }
    if (op === 'create_workflow' && action.graph?.nodes?.length) {
      for (const n of action.graph.nodes) {
        if (n.type !== 'tool') continue;
        const existing = n.toolName || n.tool_name || n.data?.toolName;
        if (existing) continue;
        const top = ensureRecommendation();
        if (top?.name) {
          n.toolName = top.name;
          n.data = { ...(n.data || {}), toolName: top.name };
        }
      }
    }
  }
  return list;
}

function nextNodeId(graph, type) {
  const prefix = type.replace(/[^a-z0-9]/gi, '') || 'step';
  let n = 1;
  while (graph.nodes.some((node) => node.id === `${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function nextEdgeId(graph) {
  let n = graph.edges.length + 1;
  while (graph.edges.some((e) => e.id === `e${n}`)) n += 1;
  return `e${n}`;
}

export function buildDefaultNode(type, { nodeId, label, position, data = {} } = {}) {
  if (!VALID_TYPES.has(type)) throw new Error(`Unknown node type: ${type}`);
  const def = getTaskTypeDef(type);
  const id = nodeId || nextNodeId({ nodes: [], edges: [] }, type);
  let pos = position;
  if (
    !pos ||
    typeof pos !== 'object' ||
    typeof pos.x !== 'number' ||
    typeof pos.y !== 'number' ||
    Number.isNaN(pos.x) ||
    Number.isNaN(pos.y)
  ) {
    pos = { x: 120 + Math.random() * 200, y: 80 + Math.random() * 120 };
  }
  const nodeData = {
    label: label || def?.label || type,
    inputBindings: defaultInputBindings(type),
    outputs: defaultOutputsList(type),
    taskConfig: defaultNodeConfig(type),
    ...data,
  };

  if (type === 'trigger') {
    nodeData.triggerModes = data.triggerModes || ['manual', 'chat'];
    nodeData.scheduleCron = data.scheduleCron || '';
    nodeData.chatPhrase = data.chatPhrase || '';
    delete nodeData.inputBindings;
  }
  if (type === 'agent') {
    nodeData.agentId = data.agentId || '';
    nodeData.agentName = data.agentName || '';
    nodeData.prompt = data.prompt || 'Complete this task:\n\n{{input}}';
  }
  if (type === 'tool') {
    nodeData.toolName = data.toolName || '';
    nodeData.toolPayload = data.toolPayload || {};
  }
  if (type === 'brain') {
    nodeData.taskConfig = normalizeBrainTaskConfig(nodeData.taskConfig, defaultBrainConfig());
  }

  return { id, type, position: pos, data: nodeData };
}

export function summarizeGraphForAgent(graph) {
  return buildDetailedGraphSummary(graph);
}

/**
 * Apply one or more builder actions. Returns { workflow, graph, results, workflow_id }.
 */
export async function applyWorkflowBuilderActions(ownerUserId, workflowId, actions, actor, opts = {}) {
  if (!Array.isArray(actions) || !actions.length) {
    throw new Error('actions array required');
  }

  const prepared = prepareBuilderActions(enrichToolNodeActions(opts.message || '', actions), {
    workflowId,
    message: opts.message || '',
  });

  let currentId = workflowId || null;
  let def = currentId ? store.getDefinition(currentId, ownerUserId) : null;
  const results = [];

  for (const action of prepared) {
    const op = canonicalizeBuilderActionName(action.action || action.op || action.type);
    if (!op) {
      results.push({ action: '(missing)', ok: false, error: 'Each action needs action/op/type' });
      continue;
    }

    try {
    if (op === 'get_node_catalog') {
      results.push({ action: op, ok: true, catalog: buildWorkflowNodeCatalog() });
      continue;
    }

    if (op === 'get_node_type') {
      const nodeType = action.node_type || action.type;
      const spec = getWorkflowNodeTypeSpec(nodeType);
      results.push({ action: op, ok: !spec.error, spec, error: spec.error || undefined });
      continue;
    }

    if (op === 'list_content_tools' || op === 'get_content_tools') {
      const tools = listEnabledContentTools();
      results.push({
        action: op,
        ok: true,
        count: tools.length,
        tools,
        hint: 'For tool nodes set toolName to an exact name from this list. Use enquire_content_tools with a user-intent query to rank recommendations.',
      });
      continue;
    }

    if (op === 'enquire_content_tools' || op === 'recommend_content_tools') {
      const query =
        action.query || action.q || action.message || action.description || action.purpose || '';
      const out = enquireContentTools(query, {
        all: action.all === true || (!String(query).trim() && action.all !== false),
        limit: action.limit,
      });
      results.push({
        action: op,
        ok: true,
        ...out,
        hint: out.top_recommendation
          ? `Prefer toolName="${out.top_recommendation.name}" for this intent.`
          : 'No strong match — list_content_tools or broaden the query.',
      });
      continue;
    }

    if (op === 'list_connectors') {
      const q = String(action.query || action.q || '').trim();
      const connected = await getConnectedConnectorApps(ownerUserId);
      let apps = connected.apps || [];
      if (q) {
        try {
          const searched = await searchConnectorApps(ownerUserId, q);
          apps = searched.apps?.length ? searched.apps : apps.filter((a) =>
            `${a.id} ${a.name}`.toLowerCase().includes(q.toLowerCase())
          );
        } catch (e) {
          apps = apps.filter((a) => `${a.id} ${a.name}`.toLowerCase().includes(q.toLowerCase()));
          console.warn('[workflow-builder] list_connectors search: %s', e?.message || e);
        }
      }
      results.push({
        action: op,
        ok: true,
        count: apps.length,
        apps: apps.slice(0, 40),
        hint: 'Wire with add_node node_type=connector and task_config.appId (exact id). If not connected, add the node then Connectors → connect.',
      });
      continue;
    }

    if (op === 'search_connectors') {
      const q = String(action.query || action.q || action.app || opts.message || '').trim();
      let apps = [];
      let source = 'none';
      try {
        const out = await searchConnectorApps(ownerUserId, q);
        apps = out.apps || [];
        source = out.source;
      } catch (e) {
        console.warn('[workflow-builder] search_connectors: %s', e?.message || e);
      }
      const appId = String(action.app_id || action.appId || apps[0]?.id || '').trim();
      let connectorActions = [];
      if (appId) {
        try {
          const listed = await listConnectorActions(ownerUserId, appId, q);
          connectorActions = listed.actions || [];
        } catch (e) {
          console.warn('[workflow-builder] list_connector_actions: %s', e?.message || e);
        }
      }
      results.push({
        action: op,
        ok: true,
        query: q,
        source,
        apps: apps.slice(0, 20),
        actions: connectorActions.slice(0, 20).map((a) => ({
          id: a.id,
          app_id: a.app_id || a.service,
          description: a.description,
        })),
        hint: 'Next: add_node node_type=connector with task_config.appId + actionId from this list.',
      });
      continue;
    }

    if (op === 'list_connector_actions') {
      const appId = String(action.app_id || action.appId || '').trim();
      if (!appId) throw new Error('list_connector_actions requires app_id');
      const listed = await listConnectorActions(ownerUserId, appId, action.query || action.q || '');
      results.push({
        action: op,
        ok: true,
        app_id: appId,
        actions: (listed.actions || []).slice(0, 40),
        hint: 'Use an exact action id on add_node task_config.actionId.',
      });
      continue;
    }

    if (op === 'get_connector_action') {
      const actionId = String(action.action_id || action.actionId || action.id || '').trim();
      if (!actionId) throw new Error('get_connector_action requires action_id');
      const guide = await getConnectorActionGuide(ownerUserId, actionId);
      results.push({
        action: op,
        ok: true,
        action_id: actionId,
        guide: typeof guide === 'string' ? guide.slice(0, 4000) : guide,
        hint: 'Wire with add_node node_type=connector task_config.actionId.',
      });
      continue;
    }

    if (op === 'list_agents') {
      const agents = (listAgentsForUser(ownerUserId) || []).slice(0, 40).map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role_title || a.role || a.agent_type,
        purpose: String(a.purpose || a.description || '').slice(0, 160),
      }));
      results.push({
        action: op,
        ok: true,
        count: agents.length,
        agents,
        hint: 'Wire with add_node node_type=agent agent_id=<exact id>.',
      });
      continue;
    }

    if (op === 'list_mcp') {
      const authUser = getUserById(ownerUserId) || { id: ownerUserId, role: 'ceo' };
      const servers = (listMcpServersForWorkflow(authUser) || []).slice(0, 20).map((s) => ({
        id: s.id,
        name: s.name,
        tools: (s.tools || []).slice(0, 12),
      }));
      results.push({
        action: op,
        ok: true,
        count: servers.length,
        servers,
        hint: 'Wire with add_node node_type=mcp_tool task_config.mcpServerId + toolName.',
      });
      continue;
    }

    if (op === 'summarize_learnings') {
      try {
        const { summarizeLearnings } = await import('./agent-feedback.js');
        const out = await summarizeLearnings({
          ownerUserId,
          agentId: 'workflowbuilder',
          topic: action.topic || action.query || opts.message || 'workflow edit',
          days: Number(action.days) || 30,
        });
        results.push({
          action: op,
          ok: true,
          summary: String(out?.summary || out?.text || '').slice(0, 2500),
          hint: 'Not a graph node. Continue with add_node / update_node.',
        });
      } catch (e) {
        results.push({
          action: op,
          ok: true,
          summary: '',
          skipped: true,
          error: e?.message || String(e),
          hint: 'Learnings unavailable; continue with graph edits.',
        });
      }
      continue;
    }

    if (op === 'validate_publish') {
      if (!currentId || !def) throw new Error('No workflow in context for validate_publish');
      const errors = validateWorkflowForPublish(def.draft_graph, ownerUserId);
      results.push({ action: op, ok: errors.length === 0, errors });
      continue;
    }

    if (GRAPH_MUTATION_OPS.has(op) && currentId && def?.status === 'published') {
      def = ensureDraftForEdit(def, currentId, ownerUserId, actor);
    }

    if (op === 'create_workflow') {
      const name = String(action.name || 'New workflow').trim();
      if (!name) throw new Error('create_workflow requires name');
      let graph = action.graph ? normalizeWorkflowGraph(action.graph) : null;
      if (!graph?.nodes?.length) {
        const trigger = buildDefaultNode('trigger', { nodeId: 'trigger-1', label: 'Start', position: { x: 40, y: 120 } });
        graph = { nodes: [trigger], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
      }
      def = store.createDefinition({
        name,
        description: action.description || '',
        ownerUserId,
        actor,
        graph,
        trigger_modes: action.trigger_modes || ['manual'],
        chat_trigger_phrase: action.chat_phrase || action.chat_trigger_phrase || '',
        schedule_cron: action.schedule_cron || '',
      });
      currentId = def.id;
      results.push({ action: op, ok: true, workflow_id: currentId, name: def.name });
      continue;
    }

    if (op === 'create_from_template') {
      const templateId = String(action.template_id || '').trim();
      const tpl = getWorkflowTemplate(templateId);
      if (!tpl?.graph) throw new Error(`Template not found or has no graph: ${templateId}`);
      const name = String(action.name || tpl.name || 'New workflow').trim();
      def = store.createDefinition({
        name,
        description: action.description || tpl.description || '',
        ownerUserId,
        actor,
        graph: normalizeWorkflowGraph(tpl.graph),
        trigger_modes: action.trigger_modes || tpl.default_trigger_modes || ['manual'],
        chat_trigger_phrase: action.chat_phrase || action.chat_trigger_phrase || tpl.default_chat_phrase || '',
        schedule_cron: action.schedule_cron || tpl.default_schedule_cron || '',
      });
      currentId = def.id;
      results.push({ action: op, ok: true, workflow_id: currentId, name: def.name, template_id: templateId });
      continue;
    }

    if (op === 'clone_workflow' || op === 'copy_workflow' || op === 'duplicate_workflow') {
      const source = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.source_workflow_id || action.workflow_id || action.from_workflow_id || currentId,
        workflow_name: action.source_workflow_name || action.workflow_name || action.from_name || action.name,
      });
      if (!source) throw new Error('Source workflow not found for clone');
      const sourceGraph =
        source.status === 'published' && source.published_graph?.nodes?.length
          ? source.published_graph
          : source.draft_graph;
      if (!sourceGraph?.nodes?.length) throw new Error(`Source workflow "${source.name}" has an empty graph`);

      const newName = String(
        action.new_name || action.clone_name || (action.name && action.name !== source.name ? action.name : null) || `${source.name} (copy)`
      ).trim();
      let chatPhrase =
        action.chat_phrase || action.chat_trigger_phrase || '';
      if (!chatPhrase && source.chat_trigger_phrase) {
        chatPhrase = `${source.chat_trigger_phrase} copy`.trim();
      }
      const triggerModes = action.trigger_modes || source.trigger_modes || ['manual'];
      // Do not copy live schedules by default — avoid duplicate cron fires
      const scheduleCron =
        action.schedule_cron != null
          ? action.schedule_cron
          : action.copy_schedule
            ? source.schedule_cron || ''
            : '';

      def = store.createDefinition({
        name: newName,
        description:
          action.description ||
          source.description ||
          `Clone of "${source.name}" (${source.id})`,
        ownerUserId,
        actor,
        graph: normalizeWorkflowGraph(sourceGraph),
        trigger_modes: triggerModes,
        chat_trigger_phrase: chatPhrase,
        schedule_cron: scheduleCron,
        variables: action.variables != null ? action.variables : source.variables || {},
      });
      currentId = def.id;
      if (action.publish === true || action.auto_publish === true) {
        def = store.publishDefinition(currentId, ownerUserId, actor);
        refreshAgentWorkflowSchedules();
      }
      results.push({
        action: op,
        ok: true,
        workflow_id: currentId,
        name: def.name,
        status: def.status,
        cloned_from: source.id,
        cloned_from_name: source.name,
      });
      continue;
    }

    if (op === 'open_workflow' || op === 'load_workflow' || op === 'reload_workflow') {
      const target = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.workflow_id || currentId,
        workflow_name: action.workflow_name || action.name,
      });
      if (!target) throw new Error('Workflow not found for open/reload');
      currentId = target.id;
      def = store.getDefinition(currentId, ownerUserId);
      results.push({ action: op, ok: true, workflow_id: currentId, name: def.name, status: def.status });
      continue;
    }

    if (
      op === 'unpublish' ||
      op === 'revert_to_draft' ||
      op === 'unpublish_workflow' ||
      (op === 'set_status' && String(action.status || '').toLowerCase() === 'draft')
    ) {
      const target = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.workflow_id || currentId,
        workflow_name: action.workflow_name || action.name,
      });
      if (!target) throw new Error('Workflow not found');
      def = store.unpublishDefinition(target.id, ownerUserId, actor);
      stopScheduleForDefinition(target.id);
      refreshAgentWorkflowSchedules();
      currentId = target.id;
      results.push({ action: op, ok: true, workflow_id: target.id, status: def.status, name: def.name });
      continue;
    }

    if (op === 'pause_workflow') {
      const target = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.workflow_id || currentId,
        workflow_name: action.workflow_name || action.name,
      });
      if (!target) throw new Error('Workflow not found');
      def = store.setPaused(target.id, ownerUserId, true, actor);
      stopScheduleForDefinition(target.id);
      pauseAllRuns(ownerUserId, { definitionId: target.id, actor });
      refreshAgentWorkflowSchedules();
      currentId = target.id;
      results.push({ action: op, ok: true, workflow_id: target.id, paused: true });
      continue;
    }

    if (op === 'resume_workflow') {
      const target = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.workflow_id || currentId,
        workflow_name: action.workflow_name || action.name,
      });
      if (!target) throw new Error('Workflow not found');
      def = store.setPaused(target.id, ownerUserId, false, actor);
      refreshAgentWorkflowSchedules();
      currentId = target.id;
      results.push({ action: op, ok: true, workflow_id: target.id, paused: false });
      continue;
    }

    if (op === 'trigger_workflow' || op === 'trigger_run') {
      const run = await triggerAgentWorkflowForOwner(ownerUserId, {
        message: action.message || action.input || action.chat_phrase || '',
        workflow_id: action.workflow_id || currentId,
        workflow_name: action.workflow_name || action.name || action.workflowName,
        actor,
      });
      results.push({
        action: op,
        ok: true,
        run_id: run.id,
        run_number: run.run_number,
        definition_id: run.definition_id,
      });
      continue;
    }

    if (op === 'pause_run') {
      const run = resolveRunForOwner(ownerUserId, {
        run_id: action.run_id,
        run_number: action.run_number,
        workflow_id: action.workflow_id || action.definition_id || currentId,
      });
      if (!run) throw new Error('Run not found');
      const updated = pauseRun(run.id, ownerUserId, actor);
      results.push({ action: op, ok: true, run_id: run.id, run_number: run.run_number, status: updated?.status });
      continue;
    }

    if (op === 'stop_run' || op === 'cancel_run' || op === 'delete_run') {
      const run = resolveRunForOwner(ownerUserId, {
        run_id: action.run_id,
        run_number: action.run_number,
        workflow_id: action.workflow_id || action.definition_id || currentId,
      });
      if (!run) throw new Error('Run not found');
      deleteRun(run.id, ownerUserId, actor);
      results.push({ action: op, ok: true, run_id: run.id, run_number: run.run_number, deleted: true });
      continue;
    }

    if (op === 'pause_all_runs') {
      const definitionId = action.workflow_id || action.definition_id || currentId || null;
      const out = pauseAllRuns(ownerUserId, { definitionId, actor });
      results.push({ action: op, ok: true, paused: out.paused, definition_id: definitionId });
      continue;
    }

    if (op === 'inspect_run') {
      let targetWorkflowId = action.workflow_id || action.definition_id || currentId;
      if (!targetWorkflowId && (action.workflow_name || action.name)) {
        const target = resolveWorkflowForTrigger(ownerUserId, {
          workflow_name: action.workflow_name || action.name,
        });
        if (target) targetWorkflowId = target.id;
      }
      const run = resolveRunForOwner(ownerUserId, {
        run_id: action.run_id,
        run_number: action.run_number,
        workflow_id: targetWorkflowId,
        workflow_name: action.workflow_name || action.name,
        latest_failed: action.latest_failed,
      });
      if (!run) throw new Error('Run not found');
      results.push({ action: op, ok: true, run: summarizeRunForAgent(run) });
      continue;
    }

    if (op === 'list_runs') {
      const target = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.workflow_id || action.definition_id || currentId,
        workflow_name: action.workflow_name || action.name,
      });
      if (!target) throw new Error('Workflow not found for list_runs');
      const limit = Math.min(Number(action.limit) || 20, 50);
      const runs = store.listRuns(target.id, ownerUserId, limit).map((r) => ({
        run_id: r.id,
        run_number: r.run_number,
        status: r.status,
        progress_pct: r.progress_pct,
        error_message: r.error_message || null,
        started_at: r.started_at,
        completed_at: r.completed_at,
      }));
      currentId = target.id;
      def = store.getDefinition(currentId, ownerUserId);
      results.push({ action: op, ok: true, workflow_id: target.id, runs });
      continue;
    }

    if (op === 'test_workflow') {
      const target = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.workflow_id || currentId,
        workflow_name: action.workflow_name || action.name,
        message: action.message || action.input || '',
      });
      if (!target) throw new Error('Workflow not found for test');
      if (!store.isWorkflowTriggerable(target)) {
        throw new Error(`Workflow "${target.name}" is not runnable — publish and resume first`);
      }
      const run = await triggerAgentWorkflowForOwner(ownerUserId, {
        workflow_id: target.id,
        input: action.input || action.message || `Test run: ${target.name}`,
        actor,
      });
      currentId = target.id;
      def = store.getDefinition(currentId, ownerUserId);
      const wait = action.wait !== false;
      let inspected = null;
      if (wait) {
        const terminal = await waitForRunTerminal(ownerUserId, run.id, Number(action.timeout_ms) || 45000);
        inspected = summarizeRunForAgent(terminal);
      }
      results.push({
        action: op,
        ok: true,
        run_id: run.id,
        run_number: run.run_number,
        definition_id: run.definition_id,
        run: inspected,
      });
      continue;
    }

    if (op === 'until_success' || op === 'build_until_success') {
      const targetId = action.workflow_id || currentId;
      if (!targetId) throw new Error('until_success requires a workflow in context');
      const { executeUntilSuccess } = await import('./agent-workflow-agent-until-success.js');
      const outcome = await executeUntilSuccess({
        ownerUserId,
        workflowId: targetId,
        actor,
        input: action.input || action.message || `Until-success test`,
        successCriteria: action.success_criteria || action.criteria || null,
        maxAttempts: action.max_attempts || action.maxAttempts || 3,
        timeoutMs: Number(action.timeout_ms) || 45000,
        applyStructuralFixes: action.apply_fixes !== false,
      });
      currentId = outcome.workflow_id || targetId;
      def = store.getDefinition(currentId, ownerUserId);
      results.push({
        action: 'until_success',
        ok: outcome.success,
        success: outcome.success,
        attempts: outcome.attempts,
        last_run: outcome.last_run,
        success_criteria: outcome.success_criteria,
        workflow_id: currentId,
      });
      continue;
    }

    if (op === 'compile_goal') {
      const { compileGoal } = await import('./agent-workflow-certify.js');
      const goal = compileGoal(action.message || action.intent || action.raw || '', {
        workflowId: action.workflow_id || currentId,
        existingGoal: action.goal || null,
      });
      results.push({ action: op, ok: true, goal });
      continue;
    }

    if (op === 'check_goal') {
      const targetId = action.workflow_id || currentId;
      if (!targetId) throw new Error('check_goal requires a workflow in context');
      const { compileGoal, checkGoal } = await import('./agent-workflow-certify.js');
      const target = store.getDefinition(targetId, ownerUserId);
      if (!target) throw new Error(`Workflow not found: ${targetId}`);
      const goal =
        action.goal ||
        compileGoal(action.message || 'Certify workflow', { workflowId: targetId });
      let lastRun = action.run || null;
      if (!lastRun && (action.run_id || action.run_number)) {
        const run = resolveRunForOwner(ownerUserId, {
          run_id: action.run_id,
          run_number: action.run_number,
          workflow_id: targetId,
        });
        lastRun = run ? summarizeRunForAgent(run) : null;
      }
      const report = checkGoal({ goal, def: target, lastRun });
      results.push({ action: op, ok: report.verdict === 'certified', report, goal });
      continue;
    }

    if (op === 'until_certified' || op === 'certify_workflow') {
      const targetId = action.workflow_id || currentId;
      const { startCertifyJob, executeUntilCertified, formatCertifyReply } = await import(
        './agent-workflow-certify.js'
      );
      const asyncJob = action.async === true || action.background === true;
      if (asyncJob) {
        const started = startCertifyJob({
          ownerUserId,
          workflowId: targetId,
          message: action.message || action.input || action.intent || '',
          goal: action.goal || null,
          actor,
          async: true,
          maxAttempts: action.max_attempts || action.maxAttempts || null,
        });
        results.push({
          action: 'until_certified',
          ok: true,
          async: true,
          job: started,
          reply: formatCertifyReply({
            status: started.status,
            id: started.job_id,
            goal: { intent: { summary: started.goal_summary } },
            workflow_id: started.workflow_id,
            attempt: started.attempt,
            max_attempts: started.max_attempts,
            report: { input_requests: started.input_requests },
          }),
        });
        continue;
      }
      if (!targetId && op === 'certify_workflow') {
        throw new Error('certify_workflow requires a workflow in context');
      }
      const outcome = await executeUntilCertified({
        ownerUserId,
        workflowId: targetId,
        actor,
        message: action.message || action.input || '',
        goal: action.goal || null,
        maxAttempts: action.max_attempts || action.maxAttempts || null,
        applyMakerFixes: action.apply_maker_fixes !== false,
      });
      currentId = outcome.workflow_id || currentId;
      def = currentId ? store.getDefinition(currentId, ownerUserId) : def;
      results.push({
        action: 'until_certified',
        ok: outcome.success,
        success: outcome.success,
        verdict: outcome.verdict,
        attempts: outcome.attempts,
        report: outcome.report,
        goal: outcome.goal,
        last_run: outcome.last_run,
        input_requests: outcome.input_requests || [],
        workflow_id: currentId,
        reply: formatCertifyReply(outcome),
      });
      continue;
    }

    if (op === 'stop_listen') {
      const run = resolveRunForOwner(ownerUserId, {
        run_id: action.run_id,
        run_number: action.run_number,
        workflow_id: action.workflow_id || currentId,
      });
      if (!run) throw new Error('Run not found');
      const nodeId = action.node_id || action.nodeId;
      if (!nodeId) throw new Error('stop_listen requires node_id');
      await stopSseListen(run.id, nodeId, ownerUserId, { actor });
      results.push({ action: op, ok: true, run_id: run.id, node_id: nodeId });
      continue;
    }

    if (op === 'delete_workflow') {
      const target = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.workflow_id || currentId,
        workflow_name: action.workflow_name || action.name,
      });
      if (!target) throw new Error('Workflow not found');
      deleteDefinitionWithCleanup(target.id, ownerUserId, actor);
      if (currentId === target.id) {
        currentId = null;
        def = null;
      }
      results.push({ action: op, ok: true, workflow_id: target.id, deleted: true });
      continue;
    }

    if (op === 'publish' || op === 'publish_workflow') {
      const target = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.workflow_id || currentId,
        workflow_name: action.workflow_name || action.name,
      });
      if (!target) throw new Error('Workflow not found');
      currentId = target.id;
      def = store.publishDefinition(currentId, ownerUserId, actor);
      refreshAgentWorkflowSchedules();
      results.push({ action: 'publish', ok: true, status: def.status, workflow_id: currentId, name: def.name });
      continue;
    }

    if (op === 'publish_a2a' || op === 'publish_as_a2a') {
      const target = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.workflow_id || currentId,
        workflow_name: action.workflow_name || action.name,
      });
      if (!target) throw new Error('Workflow not found');
      currentId = target.id;
      def = store.getDefinition(currentId, ownerUserId);
      if (def.status !== 'published') {
        def = store.publishDefinition(currentId, ownerUserId, actor);
        refreshAgentWorkflowSchedules();
      }
      const pub = publishWorkflowAsA2A(
        ownerUserId,
        currentId,
        {
          name: action.agent_name || action.name || def.name,
          description: action.description || def.description || '',
          skill_id: action.skill_id || 'default',
          visibility: action.visibility || 'public',
        },
        actor
      );
      try {
        setA2AAccessPolicy(pub.id, ownerUserId, action.access_policy || 'allow_all');
      } catch (e) {
        console.warn('[workflow-builder] A2A access policy:', e.message);
      }
      results.push({
        action: 'publish_a2a',
        ok: true,
        workflow_id: currentId,
        publish_id: pub.id,
        card_url: pub.card_url,
        endpoint_url: pub.endpoint_url,
        name: pub.name || def.name,
      });
      continue;
    }

    if (op === 'unpublish_a2a') {
      const target = resolveWorkflowForTrigger(ownerUserId, {
        workflow_id: action.workflow_id || currentId,
        workflow_name: action.workflow_name || action.name,
      });
      if (!target) throw new Error('Workflow not found');
      unpublishWorkflowA2A(ownerUserId, target.id, actor, {
        publish_id: action.publish_id || action.publishId,
      });
      results.push({ action: 'unpublish_a2a', ok: true, workflow_id: target.id });
      continue;
    }

    if (!currentId || !def) throw new Error('No workflow in context — use create_workflow or open_workflow first');

    const graph = normalizeWorkflowGraph(def.draft_graph);

    if (op === 'add_node') {
      const type = action.node_type || action.type;
      if (!type || type === 'create_workflow') throw new Error('add_node requires node_type');
      const node = buildDefaultNode(type, {
        nodeId: action.node_id || action.id || nextNodeId(graph, type),
        label: action.label,
        position: action.position,
        data: action.data || {},
      });
      if (action.agent_id) {
        node.data.agentId = action.agent_id;
        node.data.agentName = action.agent_name || action.agent_id;
      }
      if (action.tool_name || action.toolName) {
        node.data.toolName = action.tool_name || action.toolName;
      }
      if (action.tool_payload || action.toolPayload) {
        node.data.toolPayload = action.tool_payload || action.toolPayload;
      }
      if (action.prompt) node.data.prompt = action.prompt;
      if (action.system_prompt) node.data.taskConfig = { ...node.data.taskConfig, systemPrompt: action.system_prompt };
      if (action.task_config) {
        node.data.taskConfig = { ...node.data.taskConfig, ...action.task_config };
        if (type === 'brain') {
          node.data.taskConfig = normalizeBrainTaskConfig(node.data.taskConfig, defaultBrainConfig());
        }
      }
      if (type === 'connector') {
        const appId = action.app_id || action.appId || node.data.taskConfig?.appId;
        const appName = action.app_name || action.appName || node.data.taskConfig?.appName;
        const actionId = action.action_id || action.actionId || node.data.taskConfig?.actionId;
        node.data.taskConfig = {
          ...node.data.taskConfig,
          ...(appId ? { appId } : {}),
          ...(appName ? { appName } : {}),
          ...(actionId ? { actionId } : {}),
        };
      }
      let connectFrom = action.connect_from;
      if (!connectFrom && graph.nodes.length && /(?:add|wire|insert|include|attach|fix)\b/i.test(opts.message || '')) {
        connectFrom = pickConnectFromNodeId(graph);
      }
      if (connectFrom) {
        const edge = {
          id: nextEdgeId(graph),
          source: connectFrom,
          target: node.id,
          sourceHandle: action.source_handle,
        };
        graph.edges.push(edge);
      }
      graph.nodes.push(node);
      def = store.updateDraft(currentId, ownerUserId, { graph }, actor);
      results.push({ action: op, ok: true, node_id: node.id, type: node.type });
      continue;
    }

    if (op === 'update_node') {
      const nodeId = action.node_id || action.id;
      const idx = graph.nodes.findIndex((n) => n.id === nodeId);
      if (idx < 0) throw new Error(`Node not found: ${nodeId}`);
      const node = graph.nodes[idx];
      if (action.label) node.data.label = action.label;
      if (action.data) node.data = { ...node.data, ...action.data };
      if (action.prompt) node.data.prompt = action.prompt;
      if (action.agent_id) {
        node.data.agentId = action.agent_id;
        node.data.agentName = action.agent_name || action.agent_id;
      }
      if (action.input_bindings) node.data.inputBindings = action.input_bindings;
      if (action.task_config) {
        node.data.taskConfig = { ...node.data.taskConfig, ...action.task_config };
        if (node.type === 'brain') {
          node.data.taskConfig = normalizeBrainTaskConfig(node.data.taskConfig, defaultBrainConfig());
        }
      }
      graph.nodes[idx] = node;
      def = store.updateDraft(currentId, ownerUserId, { graph }, actor);
      results.push({ action: op, ok: true, node_id: nodeId });
      continue;
    }

    if (op === 'delete_node') {
      const nodeId = action.node_id || action.id;
      graph.nodes = graph.nodes.filter((n) => n.id !== nodeId);
      graph.edges = graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      def = store.updateDraft(currentId, ownerUserId, { graph }, actor);
      results.push({ action: op, ok: true, node_id: nodeId });
      continue;
    }

    if (op === 'add_edge' || op === 'connect') {
      const source = action.source || action.from;
      const target = action.target || action.to;
      if (!source || !target) throw new Error('add_edge requires source and target');
      const edge = {
        id: action.edge_id || nextEdgeId(graph),
        source,
        target,
        sourceHandle: action.source_handle || action.sourceHandle,
        targetHandle: action.target_handle || action.targetHandle,
      };
      graph.edges.push(edge);
      def = store.updateDraft(currentId, ownerUserId, { graph }, actor);
      results.push({ action: op, ok: true, edge_id: edge.id, source, target });
      continue;
    }

    if (op === 'delete_edge') {
      const edgeId = action.edge_id;
      if (edgeId) {
        graph.edges = graph.edges.filter((e) => e.id !== edgeId);
      } else if (action.source && action.target) {
        graph.edges = graph.edges.filter((e) => !(e.source === action.source && e.target === action.target));
      } else throw new Error('delete_edge requires edge_id or source+target');
      def = store.updateDraft(currentId, ownerUserId, { graph }, actor);
      results.push({ action: op, ok: true });
      continue;
    }

    if (op === 'set_metadata' || op === 'update_metadata') {
      const patch = {};
      if (action.name) patch.name = action.name;
      if (action.description != null) patch.description = action.description;
      if (action.chat_phrase != null || action.chat_trigger_phrase != null) {
        patch.chat_trigger_phrase = action.chat_phrase ?? action.chat_trigger_phrase;
      }
      if (action.trigger_modes) patch.trigger_modes = action.trigger_modes;
      if (action.schedule_cron != null) patch.schedule_cron = action.schedule_cron;
      def = store.updateDraft(currentId, ownerUserId, patch, actor);
      results.push({ action: op, ok: true, ...patch });
      continue;
    }

    throw new Error(`Unknown action: ${op}`);
    } catch (err) {
      results.push({ action: op, ok: false, error: err.message });
    }
  }

  def = currentId ? store.getDefinition(currentId, ownerUserId) : def;
  let keysRequired = [];
  let keysSummary = '';
  if (def?.draft_graph) {
    const sanitized = sanitizeWorkflowGraphSecrets(def.draft_graph);
    keysRequired = sanitized.keys;
    if (sanitized.stripped.length) {
      def = store.updateDraft(currentId, ownerUserId, { graph: sanitized.graph }, actor);
      console.info('[workflow-builder] stripped secret literals from graph; bind API Keys instead', {
        workflow_id: currentId,
        stripped: sanitized.stripped.map((s) => s.field),
        keys: keysRequired,
      });
    }
    keysRequired = collectRequiredVaultKeys(def.draft_graph || sanitized.graph);
    keysSummary = formatVaultKeysSummary(keysRequired, {
      ollamaUsed: graphUsesOllama(def.draft_graph),
      strippedCount: sanitized.stripped.length,
    });
    if (sanitized.stripped.length) {
      results.push({
        action: 'sanitize_secrets',
        ok: true,
        stripped: sanitized.stripped.length,
        keys_required: keysRequired,
      });
    }
  }
  return {
    workflow_id: currentId,
    workflow: def,
    draft_graph: def?.draft_graph,
    graph_summary: summarizeGraphForAgent(def?.draft_graph),
    results,
    has_errors: results.some((r) => r.ok === false),
    keys_required: keysRequired,
    keys_summary: keysSummary,
  };
}

export function getWorkflowDraftForAgent(ownerUserId, workflowId) {
  const def = store.getDefinition(workflowId, ownerUserId);
  if (!def) throw new Error('Workflow not found');
  return {
    workflow_id: def.id,
    name: def.name,
    description: def.description,
    status: def.status,
    paused: !!def.paused,
    trigger_modes: def.trigger_modes,
    chat_trigger_phrase: def.chat_trigger_phrase,
    schedule_cron: def.schedule_cron,
    graph_summary: summarizeGraphForAgent(def.draft_graph),
    draft_graph: def.draft_graph,
  };
}

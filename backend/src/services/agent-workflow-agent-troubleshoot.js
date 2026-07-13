/**
 * Deterministic workflow graph troubleshooting for the Workflow Builder agent.
 * Detects common broken-graph issues and emits fix actions (no LLM required).
 */
import * as store from './agent-workflow-store.js';
import { resolveWorkflowForTrigger } from './agent-workflow-chat-tools.js';
import { extractWorkflowReferenceFromMessage } from './agent-workflow-agent-describe.js';
import { validateWorkflowForPublish } from './agent-workflow-builder-catalog.js';

export function parseTroubleshootIntent(message) {
  const t = String(message || '').trim();
  if (!t) return null;
  const asks =
    /(?:troubleshoot|repair|fix|debug|heal)\s+(?:(?:the|this|my)\s+)?workflow/i.test(t) ||
    /(?:fix|repair)\s+(?:(?:the|this)\s+)?(?:broken|issue|problem|error)/i.test(t) ||
    /(?:what(?:'s| is)\s+wrong|why\s+(?:is|does|did).*(?:broken|fail|error))/i.test(t) ||
    /(?:diagnose|find\s+(?:and\s+)?fix)\s+(?:issues?|problems?)/i.test(t);
  if (!asks) return null;

  const ref = extractWorkflowReferenceFromMessage(t);
  const quoted = t.match(/["'`]([^"'`]+)["'`]/);
  return {
    workflow_query: quoted?.[1] || ref.name || ref.workflow_id || null,
    workflow_id: ref.workflow_id || null,
    apply_fixes: /(?:fix|repair|heal|apply)\b/i.test(t) && !/\bonly\s+(?:report|list|show)\b/i.test(t),
  };
}

function resolveDef(ownerUserId, intent, workflowId) {
  if (intent?.workflow_id) {
    const byId = store.getDefinition(intent.workflow_id, ownerUserId);
    if (byId) return byId;
  }
  if (intent?.workflow_query) {
    const byName = resolveWorkflowForTrigger(ownerUserId, {
      workflow_id: intent.workflow_query,
      workflow_name: intent.workflow_query,
      message: intent.workflow_query,
    });
    if (byName) return byName;
  }
  if (workflowId) return store.getDefinition(workflowId, ownerUserId);
  return null;
}

/**
 * Analyze graph for common structural issues.
 * @returns {{ issues: Array, fixActions: Array }}
 */
export function diagnoseWorkflowGraph(def) {
  const graph = def?.draft_graph || { nodes: [], edges: [] };
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const issues = [];
  const fixActions = [];

  const trigger = nodes.find((n) => n.type === 'trigger');
  if (!trigger) {
    issues.push({
      severity: 'error',
      code: 'missing_trigger',
      message: 'No trigger node — workflow cannot start.',
    });
    fixActions.push({
      action: 'add_node',
      node_type: 'trigger',
      node_id: 'trigger-1',
      label: 'Start',
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map();
  const incoming = new Map();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source).push(e);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target).push(e);
  }

  // Broken edges referencing missing nodes
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      issues.push({
        severity: 'error',
        code: 'dangling_edge',
        message: `Edge ${e.id || `${e.source}->${e.target}`} references a missing node.`,
        edge_id: e.id,
      });
      if (e.id) {
        fixActions.push({ action: 'delete_edge', edge_id: e.id });
      }
    }
  }

  // Non-trigger nodes with no incoming edge (orphans)
  for (const n of nodes) {
    if (n.type === 'trigger') continue;
    if (!(incoming.get(n.id) || []).length) {
      issues.push({
        severity: 'error',
        code: 'orphan_node',
        message: `Node "${n.data?.label || n.id}" (${n.id}) has no incoming edge.`,
        node_id: n.id,
      });
      if (trigger) {
        fixActions.push({
          action: 'add_edge',
          source: trigger.id,
          target: n.id,
        });
      }
    }
  }

  // Agent nodes missing agentId
  for (const n of nodes) {
    if (n.type !== 'agent') continue;
    const agentId = n.data?.agentId || n.data?.agent_id;
    if (!agentId) {
      issues.push({
        severity: 'error',
        code: 'missing_agent_id',
        message: `Agent node "${n.data?.label || n.id}" has no agent_id.`,
        node_id: n.id,
      });
    }
  }

  // MCP tool missing server/tool
  for (const n of nodes) {
    if (n.type !== 'mcp_tool') continue;
    const cfg = n.data?.taskConfig || {};
    if (!cfg.mcpServerId && !cfg.mcp_server_id) {
      issues.push({
        severity: 'error',
        code: 'missing_mcp_server',
        message: `MCP node "${n.data?.label || n.id}" has no mcpServerId.`,
        node_id: n.id,
      });
    }
    const kind = (cfg.mcpInvokeKind || 'tool').toLowerCase();
    if (kind === 'tool' && !(cfg.toolName || cfg.tool_name)) {
      issues.push({
        severity: 'error',
        code: 'missing_mcp_tool',
        message: `MCP node "${n.data?.label || n.id}" has no toolName.`,
        node_id: n.id,
      });
    }
  }

  // Custom script missing id
  for (const n of nodes) {
    if (n.type !== 'custom_script') continue;
    const cfg = n.data?.taskConfig || {};
    if (!(cfg.customScriptId || cfg.scriptId)) {
      issues.push({
        severity: 'error',
        code: 'missing_script_id',
        message: `Custom script node "${n.data?.label || n.id}" has no customScriptId.`,
        node_id: n.id,
      });
    }
  }

  // Linear chain broken: trigger has no outgoing
  if (trigger && !(outgoing.get(trigger.id) || []).length && nodes.length > 1) {
    issues.push({
      severity: 'error',
      code: 'trigger_disconnected',
      message: 'Trigger has no outgoing edges — nothing will run after start.',
      node_id: trigger.id,
    });
  }

  // Publish validation errors
  const publishErrors = validateWorkflowForPublish(graph) || [];
  for (const err of publishErrors) {
    const msg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
    if (!issues.some((i) => i.message === msg)) {
      issues.push({ severity: 'warn', code: 'publish_validation', message: msg });
    }
  }

  return { issues, fixActions, node_count: nodes.length, edge_count: edges.length };
}

export function formatTroubleshootReply(def, diagnosis, { applied = false } = {}) {
  const { issues, fixActions } = diagnosis;
  if (!issues.length) {
    return `**${def.name}** (id: \`${def.id}\`) looks structurally healthy (${diagnosis.node_count} nodes, ${diagnosis.edge_count} edges). No automatic fixes needed.`;
  }
  const lines = [
    `## Troubleshoot: ${def.name}`,
    `- Status: ${def.status}${def.paused ? ' (PAUSED)' : ''}`,
    `- Found **${issues.length}** issue(s)`,
    '',
    '**Issues:**',
  ];
  for (const i of issues) {
    lines.push(`- [${i.severity}] ${i.message}${i.node_id ? ` (\`${i.node_id}\`)` : ''}`);
  }
  if (fixActions.length) {
    lines.push('', applied ? '**Applied fixes:**' : '**Suggested fixes:**');
    for (const a of fixActions) {
      lines.push(`- \`${a.action}\`${a.node_id ? ` → ${a.node_id}` : ''}${a.source ? ` ${a.source}→${a.target}` : ''}`);
    }
  }
  if (applied) {
    lines.push('', '_Fixes applied to the draft graph. Re-publish when ready._');
  } else {
    lines.push('', 'Say **"fix this workflow"** to apply suggested structural repairs.');
  }
  return lines.join('\n');
}

/**
 * Deterministic troubleshoot response — optionally returns actions for applyWorkflowBuilderActions.
 */
export function tryTroubleshootWorkflowResponse(ownerUserId, workflowId, message) {
  const intent = parseTroubleshootIntent(message);
  if (!intent) return null;

  const def = resolveDef(ownerUserId, intent, workflowId);
  if (!def) {
    return {
      reply: `No workflow matched for troubleshooting${intent.workflow_query ? ` ("${intent.workflow_query}")` : ''}. Open a workflow or name it explicitly.`,
      workflow_id: workflowId,
      actions: [],
    };
  }

  const diagnosis = diagnoseWorkflowGraph(def);
  const actions = intent.apply_fixes ? diagnosis.fixActions : [];

  return {
    reply: formatTroubleshootReply(def, diagnosis, { applied: false }),
    workflow_id: def.id,
    workflow: def,
    actions,
    diagnosis,
    modelUsed: null,
  };
}

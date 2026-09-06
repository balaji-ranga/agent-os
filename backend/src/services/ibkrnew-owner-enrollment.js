import { createHash } from 'node:crypto';
import { getDb } from '../db/schema.js';
import {
  createDefinition,
  deleteDefinition,
  getDefinition,
  publishDefinition,
  updateDraft,
} from './agent-workflow-store.js';
import { createFullAgent } from './create-full-agent.js';
import {
  getIbkrNewAgentTemplateBlueprints,
  getIbkrNewWorkflowBlueprints,
} from './ibkrnew-blueprints.js';
import { ensureIbkrNewDefaults } from './ibkrnew-event-trader.js';
import { syncOrgContextForCeo } from './org-context.js';
import { setAgentToolGrants, syncAllowlistsFile } from './openclaw-agent-tools.js';
import { ensureTenantOpenClawAgent, forcePushTemplateDocs } from './openclaw-tenant.js';
import { getUiNavHidden, setUiNavHidden } from './ui-nav-prefs.js';
import { grantUserAgent } from './users.js';

const FEATURE_NAV_IDS = new Set([
  'ibkrnew0',
  'ibkrnew0-strategy',
  'ibkrnew0-summary',
  'ibkrnew0-live',
]);

function ownerSuffix(ownerUserId) {
  return createHash('sha256').update(String(ownerUserId)).digest('hex').slice(0, 10);
}

function logicalAgentId(templateBaseId, ownerUserId) {
  const base = String(templateBaseId)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${base}-${ownerSuffix(ownerUserId)}`;
}

function logicalWorkflowId(workflowId, ownerUserId) {
  return `${String(workflowId || '').trim()}-${ownerSuffix(ownerUserId)}`;
}

function workflowStageLabel(workflowId) {
  return String(workflowId || '')
    .replace(/^IBKRNew/, '')
    .replace(/Workflow$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

function consolidatedWorkflowGraph(workflows, agentsByName) {
  const subscriptions = [...new Set(workflows.flatMap((workflow) => workflow.subscriptions))];
  const nodes = [
    {
      id: 'trigger',
      type: 'trigger',
      position: { x: 40, y: 180 },
      data: {
        label: `IBKRNew event intake (${subscriptions.length})`,
        triggerModes: ['event'],
        subscriptions,
        outputs: [
          { id: 'text', label: 'Canonical event payload' },
          { id: 'trigger_input', label: 'Canonical event payload' },
        ],
      },
    },
  ];
  const edges = [];
  let previousNodeId = 'trigger';
  for (const [index, workflow] of workflows.entries()) {
    const agent = agentsByName.get(workflow.agent_name);
    if (!agent) throw new Error(`IBKRNew workflow agent missing: ${workflow.agent_name}`);
    const nodeId = `stage-${index + 1}`;
    nodes.push({
      id: nodeId,
      type: 'agent',
      position: { x: 300 + index * 260, y: 180 },
      data: {
        label: `${index + 1}. ${workflowStageLabel(workflow.workflow_id)}`,
        agentId: agent.id,
        agentName: agent.name,
        subscriptions: [...workflow.subscriptions],
        prompt:
          `${workflow.responsibility} Review the upstream IBKRNew event-stage payload and return a concise ` +
          'structured assessment only. Do not submit, modify, or cancel broker orders. The deterministic ' +
          'IBKRNew event engine remains the sole authority for policy checks and broker commands.',
        inputBindings: [
          {
            id: 'prompt',
            mode: 'dynamic',
            sourceNodeId: previousNodeId,
            sourceOutputKey: 'text',
            value: '',
          },
        ],
        outputs: [{ id: 'text', label: 'Stage assessment' }],
        taskConfig: { timeoutMs: 300000, timeoutAction: 'fail' },
      },
    });
    edges.push({ id: `edge-${index + 1}`, source: previousNodeId, target: nodeId });
    previousNodeId = nodeId;
  }
  return {
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function ensureVisibleWorkflowDefinition(ownerUserId, workflows, agentsByName) {
  const workflowId = 'IBKRNewEventDrivenTradingWorkflow';
  const definitionId = logicalWorkflowId(workflowId, ownerUserId);
  const actor = { id: 'system', name: 'IBKRNew owner enrollment' };
  const patch = {
    name: workflowId,
    description:
      'One connected, event-only operational workflow covering market observation, strategy planning, ' +
      'risk checking, execution, position monitoring and trading supervision. The canvas exposes the ' +
      'assigned agents and event contracts; broker execution remains in the fail-closed IBKRNew event engine.',
    graph: consolidatedWorkflowGraph(workflows, agentsByName),
    trigger_modes: ['event'],
    variables: {
      ibkrnew_managed: true,
      ibkrnew_workflow_id: workflowId,
      ibkrnew_stage_count: workflows.length,
      ibkrnew_stages: workflows.map((workflow) => ({
        workflow_id: workflow.workflow_id,
        agent_id: agentsByName.get(workflow.agent_name)?.id,
        agent_name: workflow.agent_name,
        subscriptions: [...workflow.subscriptions],
      })),
      ibkrnew_subscriptions: [...new Set(workflows.flatMap((workflow) => workflow.subscriptions))],
      ibkrnew_execution_owner: 'ibkrnew_event_engine',
    },
  };
  const existing = getDefinition(definitionId);
  if (existing && existing.owner_user_id !== ownerUserId) {
    throw new Error(`IBKRNew workflow id collision: ${definitionId}`);
  }
  if (existing) updateDraft(definitionId, ownerUserId, patch, actor);
  else createDefinition({ ...patch, id: definitionId, ownerUserId, actor });
  const published = publishDefinition(definitionId, ownerUserId, actor);
  return {
    id: published.id,
    name: published.name,
    status: published.status,
    trigger_modes: published.trigger_modes,
    stage_count: workflows.length,
    node_count: published.published_graph.nodes.length,
    edge_count: published.published_graph.edges.length,
  };
}

function removeLegacyWorkflowProjections(ownerUserId, workflows) {
  const actor = { id: 'system', name: 'IBKRNew owner enrollment migration' };
  let removed = 0;
  for (const workflow of workflows) {
    const definitionId = logicalWorkflowId(workflow.workflow_id, ownerUserId);
    const existing = getDefinition(definitionId, ownerUserId);
    if (
      existing?.variables?.ibkrnew_managed === true &&
      existing.variables.ibkrnew_execution_owner === 'ibkrnew_event_engine' &&
      existing.variables.ibkrnew_workflow_id === workflow.workflow_id
    ) {
      if (deleteDefinition(definitionId, ownerUserId, actor)) removed += 1;
    }
  }
  return removed;
}

function findOwnerCoo(db, ownerUserId) {
  return db.prepare(
    `SELECT a.id
       FROM agents a
       JOIN user_agents ua ON ua.agent_id = a.id
      WHERE ua.user_id = ? AND ua.enabled = 1 AND a.is_coo = 1
      ORDER BY a.id
      LIMIT 1`
  ).get(ownerUserId)?.id || null;
}

function assertEligibleOwner(db, ownerUserId) {
  const owner = db.prepare(
    `SELECT id, name, role, enabled FROM platform_users WHERE id = ?`
  ).get(ownerUserId);
  if (!owner) throw Object.assign(new Error('Owner user was not found'), { status: 404 });
  if (owner.role !== 'ceo') throw Object.assign(new Error('IBKRNew enrollment requires a CEO owner'), { status: 400 });
  if (!owner.enabled) throw Object.assign(new Error('IBKRNew enrollment requires an enabled owner'), { status: 400 });
  return owner;
}

/**
 * Idempotently enable the complete IBKRNew0 paper feature for one CEO owner.
 * The operation does not create a bridge token, store an IBKR account number,
 * enable paper order submission, or enable live trading.
 */
export async function enrollIbkrNewOwner(ownerUserId) {
  const ownerId = String(ownerUserId || '').trim();
  if (!ownerId) throw Object.assign(new Error('owner_user_id is required'), { status: 400 });

  const db = getDb();
  const owner = assertEligibleOwner(db, ownerId);
  const configs = ensureIbkrNewDefaults(ownerId);

  db.prepare(`UPDATE ibkrnew_reaction_registry SET enabled = 1 WHERE owner_user_id = ?`).run(ownerId);

  const workflows = getIbkrNewWorkflowBlueprints();
  const workflowsByAgent = new Map(workflows.map((workflow) => [workflow.agent_name, workflow]));
  const templates = getIbkrNewAgentTemplateBlueprints();
  const cooId = findOwnerCoo(db, ownerId);
  const provisioned = [];
  const agentsByName = new Map();

  for (const template of templates) {
    const workflow = workflowsByAgent.get(template.agent_name);
    let agent = db.prepare(
      `SELECT * FROM agents
        WHERE owner_user_id = ? AND (template_base_id = ? OR name = ?)
        ORDER BY CASE WHEN template_base_id = ? THEN 0 ELSE 1 END, id
        LIMIT 1`
    ).get(ownerId, template.template_base_id, template.agent_name, template.template_base_id);

    let created = false;
    if (!agent) {
      agent = await createFullAgent({
        id: logicalAgentId(template.template_base_id, ownerId),
        name: template.agent_name,
        role: workflow?.responsibility || 'IBKRNew event-driven trading specialist',
        department: 'Trading',
        parent_id: cooId,
        ownerUserId: ownerId,
        tools: [],
        source_kind: 'ibkrnew',
        source_publish_id: 'IBKRNew0',
        template_base_id: template.template_base_id,
        workspace_template: template.workspace_template,
      });
      created = true;
    } else {
      grantUserAgent(ownerId, agent.id);
    }

    const ensured = ensureTenantOpenClawAgent(agent, ownerId);
    setAgentToolGrants(agent, []);
    forcePushTemplateDocs(template.template_base_id, ensured.workspacePath, { forceIdentity: true });
    agentsByName.set(template.agent_name, agent);
    provisioned.push({
      id: agent.id,
      name: agent.name,
      created,
      template_base_id: template.template_base_id,
      openclaw_agent_id: ensured.openclawAgentId,
    });
  }
  const workflowDefinition = ensureVisibleWorkflowDefinition(ownerId, workflows, agentsByName);
  const removedLegacyWorkflows = removeLegacyWorkflowProjections(ownerId, workflows);

  syncAllowlistsFile();
  await syncOrgContextForCeo(ownerId);

  const visibleNav = getUiNavHidden(ownerId).filter((id) => !FEATURE_NAV_IDS.has(id));
  setUiNavHidden(ownerId, visibleNav);

  const configKinds = Object.keys(configs).sort();
  const reactionCount = db.prepare(
    `SELECT COUNT(*) count FROM ibkrnew_reaction_registry WHERE owner_user_id = ? AND enabled = 1`
  ).get(ownerId).count;
  const grantCount = db.prepare(
    `SELECT COUNT(*) count
       FROM user_agents ua
       JOIN agents a ON a.id = ua.agent_id
      WHERE ua.user_id = ? AND ua.enabled = 1 AND a.owner_user_id = ? AND a.source_kind = 'ibkrnew'`
  ).get(ownerId, ownerId).count;
  const visibleWorkflowCount =
    workflowDefinition.status === 'published' && workflowDefinition.trigger_modes.includes('event') ? 1 : 0;

  if (
    configKinds.length !== 5 ||
    reactionCount !== 6 ||
    grantCount !== 6 ||
    provisioned.length !== 6 ||
    visibleWorkflowCount !== 1
  ) {
    throw new Error('IBKRNew enrollment verification failed');
  }

  return {
    owner: { id: owner.id, name: owner.name },
    feature: 'IBKRNew0',
    environment: 'paper',
    config_kinds: configKinds,
    enabled_workflows: visibleWorkflowCount,
    enabled_event_reactions: reactionCount,
    visible_workflows: visibleWorkflowCount,
    workflow_definition: workflowDefinition,
    removed_legacy_workflows: removedLegacyWorkflows,
    enabled_agents: grantCount,
    agents: provisioned,
    navigation_visible: true,
    bridge_created: false,
    execution_enabled: false,
    live_trading_enabled: false,
  };
}

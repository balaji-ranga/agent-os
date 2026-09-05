/**
 * Semantic maker/checker gate for goal plans.
 *
 * The existing intent classifier supplies a candidate, but it is not trusted as
 * an executable plan. A maker creates a typed dependency graph from the full
 * goal and live tenant catalog; an independent model judges completeness and
 * may repair it. Deterministic validation then fails closed on invalid IDs,
 * dependencies, or data/artifact/decision hand-offs.
 */
import { chatCompletions } from '../config/llm.js';
import { getDb } from '../db/schema.js';
import {
  listOrchestratorToolsForGoalPlan,
  listWorkflowCatalogForGoalPlan,
  listSpecialtyAgentsForGoalPlan,
} from './goal-plan-intent.js';
import { listHumanWorkCandidates } from './work-assignment-policy.js';
import { getPlatformTimeoutMs } from './platform-timeout-settings.js';
import { validateWorkflowInput } from './workflow-input-schema.js';

const STEP_TYPES = new Set([
  'workflow_trigger',
  'agent_tool',
  'specialty_task',
  'human_task',
  'agent_continue',
  'notify_ceo',
]);
const IO_KINDS = new Set(['data', 'artifact', 'decision']);
const OPERATION_MODES = new Set(['query', 'analyze', 'create', 'modify', 'delete', 'communicate', 'coordinate']);
const DELIVERABLE_KINDS = new Set(['status_report', 'data', 'artifact', 'external_action', 'approval', 'record_created']);

function normalizeOperationMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ({ read: 'query', search: 'query', report: 'analyze', summarise: 'analyze', summarize: 'analyze', synthesize: 'analyze', synthesise: 'analyze', consolidate: 'analyze', compile: 'analyze', write: 'create', update: 'modify', notify: 'communicate', notify_ceo: 'communicate' })[mode] || mode || null;
}

function normalizeStepOperationMode(type, value) {
  // A workflow step coordinates an already-published executable graph. The
  // graph owns its internal create/modify/delete semantics and policy gates.
  // Do not spend maker rounds debating synonyms such as "trigger".
  if (type === 'workflow_trigger') return 'coordinate';
  return normalizeOperationMode(value);
}

function normalizeDeliverableKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return ({ report: 'status_report', summary: 'status_report', notification: 'status_report', message: 'status_report', dataset: 'data', json: 'data', record: 'record_created', action: 'external_action' })[kind] || kind || null;
}

function isStatusHistoryContract(raw = {}, spec = {}) {
  const operationMode = normalizeOperationMode(raw.operation_mode || spec.operation_mode);
  if (!['query', 'analyze'].includes(operationMode)) return false;
  const contractText = [raw.label, raw.objective, raw.subject, raw.message, spec.label, spec.objective, spec.subject, spec.message]
    .filter(Boolean).join(' ').toLowerCase();
  return /\b(?:status(?:\s+update|\s+report)?|activity(?:\s+history|\s+report)?|work\s+history|progress\s+report|what\s+.+\s+(?:worked\s+on|completed|did))\b/.test(contractText);
}

function clip(value, max = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced.trim()); } catch {}
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  return null;
}

function normalizeIo(items, { input = false } = {}) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 16).map((item) => {
    const row = typeof item === 'string' ? { key: item } : (item && typeof item === 'object' ? item : {});
    const kind = IO_KINDS.has(String(row.kind || '').toLowerCase()) ? String(row.kind).toLowerCase() : 'data';
    const out = {
      key: String(row.key || row.name || '').trim().slice(0, 100),
      kind,
      required: row.required !== false,
    };
    if (input) out.source_step_key = String(row.source_step_key || row.source_step || '').trim().slice(0, 80) || null;
    return out;
  }).filter((x) => x.key);
}

function normalizeTypedSteps(rawSteps) {
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps.slice(0, 16).map((raw, index) => {
    const spec = raw?.spec && typeof raw.spec === 'object' ? { ...raw.spec } : {};
    const requestedType = String(raw?.type || raw?.step_type || '').trim().toLowerCase();
    const requestedTool = String(raw?.tool_name || spec.tool_name || '').trim();
    const type = requestedType === 'agent_tool' && requestedTool === 'notify_ceo'
      ? 'notify_ceo'
      : requestedType;
    const semanticDeliverable = isStatusHistoryContract(raw, spec)
      ? 'status_report'
      : normalizeDeliverableKind(raw?.deliverable_kind || spec.deliverable_kind);
    const messageValue = raw?.message ?? spec.message;
    const normalizedMessage = messageValue && typeof messageValue === 'object'
      ? JSON.stringify(messageValue)
      : String(messageValue || '').trim();
    const toolName = String(raw?.tool_name || spec.tool_name || '').trim();
    const workflowId = String(raw?.workflow_id || spec.workflow_id || '').trim();
    const phrase = String(raw?.phrase || spec.phrase || '').trim();
    const agentId = String(raw?.agent_id || spec.agent_id || '').trim();
    const userId = String(raw?.user_id || spec.user_id || '').trim();
    return {
      type,
      label: String(raw?.label || spec.label || type || `Step ${index + 1}`).trim().slice(0, 180),
      key: String(raw?.key || spec.step_key || `step_${index + 1}`).trim().slice(0, 80),
      depends_on: Array.isArray(raw?.depends_on || spec.depends_on)
        ? [...new Set((raw.depends_on || spec.depends_on).map((x) => String(x ?? '').trim()).filter(Boolean))]
        : [],
      required_inputs: normalizeIo(raw?.required_inputs || spec.required_inputs, { input: true }),
      produces: normalizeIo(raw?.produces || spec.produces),
      spec: {
        ...spec,
        quality_checked: true,
        objective: String(raw?.objective || spec.objective || '').trim().slice(0, 1000) || null,
        operation_mode: normalizeStepOperationMode(type, raw?.operation_mode || spec.operation_mode),
        subject: String(raw?.subject || spec.subject || '').trim().slice(0, 500) || null,
        deliverable_kind: semanticDeliverable,
        ...(toolName ? { tool_name: toolName } : {}),
        ...(workflowId ? { workflow_id: workflowId } : {}),
        ...(phrase ? { phrase } : {}),
        ...(agentId ? { agent_id: agentId } : {}),
        ...(userId ? { user_id: userId } : {}),
        ...(normalizedMessage ? { message: normalizedMessage } : {}),
        selection_rationale: String(raw?.selection_rationale || spec.selection_rationale || '').trim().slice(0, 600) || null,
      },
    };
  });
}

export function repairCheckerExecutorAvailability(steps, catalog) {
  if ((catalog.humans || []).length) return steps;
  return steps.map((step) => {
    if (step.type !== 'human_task') return step;
    return {
      ...step,
      type: 'agent_continue',
      label: step.label || 'Clarify required goal input',
      spec: {
        ...step.spec,
        user_id: undefined,
        selection_rationale: 'No human employee is available in this company; the originating orchestrator must obtain the missing input from the CEO.',
      },
    };
  });
}

export function safeGoalClarificationPlan() {
  return normalizeTypedSteps([
    {
      key: 'clarify_goal_scope',
      type: 'agent_continue',
      label: 'Clarify required goal scope',
      depends_on: [],
      required_inputs: [],
      produces: [{ key: 'clarified_goal_scope', kind: 'data', required: true }],
      spec: {
        message: '[NEEDS_CLARIFICATION] Ask the CEO for the missing target, expected outcome, and constraints. Do not execute tools, delegate work, or claim completion until scope is supplied.',
        selection_rationale: 'The maker and independent checker could not derive a safe executable outcome from the supplied goal.',
      },
    },
    {
      key: 'report_clarification',
      type: 'notify_ceo',
      label: 'Request goal clarification',
      depends_on: ['clarify_goal_scope'],
      required_inputs: [{ key: 'clarified_goal_scope', kind: 'data', source_step_key: 'clarify_goal_scope', required: true }],
      produces: [],
      spec: { selection_rationale: 'Return the clarification request to the CEO instead of executing an invented plan.' },
    },
  ]);
}

export function validateTypedGoalPlan(steps, catalog) {
  const errors = [];
  if (!Array.isArray(steps) || !steps.length) return { ok: false, errors: ['Plan has no steps'] };
  const keys = new Set();
  const produced = new Map();
  const tools = new Set((catalog.tools || []).map((x) => x.name));
  const workflows = new Set((catalog.workflows || []).map((x) => x.id));
  const agents = new Set((catalog.agents || []).map((x) => String(x.id).toLowerCase()));
  const humans = new Set((catalog.humans || []).map((x) => String(x.id)));
  let notifyAt = -1;
  let notifyCount = 0;
  const dependencies = new Map();

  const ancestorsOf = (stepKey, found = new Set()) => {
    for (const dependency of dependencies.get(stepKey) || []) {
      if (found.has(dependency)) continue;
      found.add(dependency);
      ancestorsOf(dependency, found);
    }
    return found;
  };

  steps.forEach((step, index) => {
    if (!STEP_TYPES.has(step.type)) errors.push(`Step ${index + 1} has unsupported type ${step.type || '(empty)'}`);
    if (!step.key || keys.has(step.key)) errors.push(`Step ${index + 1} has a missing or duplicate key`);
    for (const dep of step.depends_on || []) {
      if (!keys.has(dep)) errors.push(`Step ${step.key || index + 1} depends on non-prior step ${dep}`);
    }
    dependencies.set(step.key, [...(step.depends_on || [])]);
    const ancestors = ancestorsOf(step.key);
    for (const req of step.required_inputs || []) {
      if (req.source_step_key && !keys.has(req.source_step_key)) errors.push(`Step ${step.key} input ${req.key} has invalid source ${req.source_step_key}`);
      if (req.source_step_key && keys.has(req.source_step_key) && !ancestors.has(req.source_step_key)) {
        errors.push(`Step ${step.key} input ${req.key} comes from ${req.source_step_key}, but that source is not in its dependency graph`);
      }
      const source = req.source_step_key ? produced.get(req.source_step_key) : null;
      if (req.required && req.source_step_key && !source?.has(`${req.kind}:${req.key}`)) {
        errors.push(`Step ${step.key} requires ${req.kind}:${req.key}, but ${req.source_step_key} does not declare it`);
      }
    }
    if (step.type === 'agent_tool' && !tools.has(String(step.spec?.tool_name || ''))) {
      const name = String(step.spec?.tool_name || '(missing)');
      const owners = (catalog.agents || []).filter(agent => (agent.capabilities || []).some(capability => capability.name === name)).map(agent => agent.id);
      errors.push(`Step ${step.key}: agent_tool ${name} is NOT in current_executor_tools. ${owners.length ? `It belongs to specialist(s) ${owners.join(', ')}. Replace this with specialty_task, spec.agent_id set to the capable specialist, and spec.message describing this action and required inputs; remove spec.tool_name.` : 'Select an exact current_executor_tools name or a capable specialist with specialty_task. Never borrow an agent capability as a direct tool.'}`);
    }
    if (step.type === 'workflow_trigger' && !workflows.has(String(step.spec?.workflow_id || ''))) errors.push(`Step ${step.key} uses an unavailable workflow`);
    if (step.type === 'workflow_trigger') {
      const workflow = (catalog.workflows || []).find((item) => String(item.id) === String(step.spec?.workflow_id || ''));
      if (workflow?.input_schema) {
        try {
          validateWorkflowInput(workflow.input_schema, step.spec?.message || '', { trigger: 'goal_plan' });
        } catch (error) {
          errors.push(`Step ${step.key} workflow input is invalid: ${error.message}`);
        }
      }
      if (step.spec?.operation_mode !== 'coordinate') {
        errors.push(`Step ${step.key} workflow_trigger operation_mode must be coordinate`);
      }
      if (!String(step.spec?.message || '').trim() || ['{}', '[]', '[object Object]'].includes(String(step.spec?.message || '').trim())) {
        errors.push(`Step ${step.key} workflow_trigger must provide a concrete workflow input message`);
      }
    }
    if (step.type === 'specialty_task' && !agents.has(String(step.spec?.agent_id || '').toLowerCase())) {
      const id=String(step.spec?.agent_id || '(missing)');
      const parents=(catalog.agents||[]).filter(agent=>(agent.reportees||[]).some(report=>report.id===id)).map(agent=>agent.id);
      errors.push(`Step ${step.key}: specialty_task agent_id=${id} is not a direct reportee. ${parents.length ? `Delegate to ${parents.join(', ')} and instruct that orchestrator to delegate internally to ${id}, return its result and preserve the trace.` : `Allowed direct reportees: ${[...agents].join(', ')}. Use agent_continue for the originating orchestrator's own synthesis, or notify_ceo for final delivery.`}`);
    }
    if (step.type === 'specialty_task' && !String(step.spec?.message || '').trim()) errors.push(`Specialty step ${step.key} has no bounded work instruction`);
    if (step.type === 'specialty_task') {
      const delegatedText = String(step.spec?.message || '').toLowerCase();
      const delegatedWorkflow = (catalog.workflows || []).find((workflow) =>
        delegatedText.includes(String(workflow.id || '').toLowerCase())
      );
      if (delegatedWorkflow) {
        errors.push(`Step ${step.key} assigns published workflow ${delegatedWorkflow.id} to a specialist; use workflow_trigger with that workflow_id instead`);
      }
    }
    if (step.spec?.operation_mode && !OPERATION_MODES.has(step.spec.operation_mode)) {
      errors.push(`Step ${step.key} has unsupported operation_mode ${step.spec.operation_mode}`);
    }
    if (step.spec?.deliverable_kind && !DELIVERABLE_KINDS.has(step.spec.deliverable_kind)) {
      errors.push(`Step ${step.key} has unsupported deliverable_kind ${step.spec.deliverable_kind}`);
    }
    if (step.type === 'human_task' && !humans.has(String(step.spec?.user_id || ''))) errors.push(`Step ${step.key}: human_task user_id=${String(step.spec?.user_id || '(missing)')} is not a catalog human. Allowed human IDs: ${[...humans].join(', ') || '(none)'}. An orchestrator synthesis is agent_continue; a report delivered to the CEO is notify_ceo, not human_task. A mention of humans inside requested content does not assign work to a human.`);
    if (step.type === 'human_task' && !String(step.spec?.message || '').trim()) errors.push(`Human step ${step.key} has no specific work or decision`);
    if (step.type === 'notify_ceo') { notifyAt = index; notifyCount += 1; }
    const outputKeys = new Set();
    for (const output of step.produces || []) {
      const identity = `${output.kind}:${output.key}`;
      if (outputKeys.has(identity)) errors.push(`Step ${step.key} declares duplicate output ${identity}`);
      outputKeys.add(identity);
    }
    keys.add(step.key);
    produced.set(step.key, new Set((step.produces || []).map((x) => `${x.kind}:${x.key}`)));
  });
  if (notifyAt >= 0 && notifyAt !== steps.length - 1) errors.push('notify_ceo must be the terminal step');
  if (notifyCount > 1) errors.push('Plan must not contain multiple notify_ceo steps');
  if (notifyAt === steps.length - 1) {
    const terminal = steps[notifyAt];
    if (!(terminal.depends_on || []).length && !(terminal.required_inputs || []).length) {
      errors.push('notify_ceo must be bound to completed plan outcomes');
    }
  }
  if (steps.length > 1) {
    const terminal = steps.at(-1);
    const terminalLineage = ancestorsOf(terminal.key);
    for (const input of terminal.required_inputs || []) {
      if (input.source_step_key) terminalLineage.add(input.source_step_key);
    }
    for (const step of steps.slice(0, -1)) {
      if (!terminalLineage.has(step.key)) errors.push(`Step ${step.key} is orphaned from the terminal outcome`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function extractPlanSteps(text) {
  const parsed = parseJsonObject(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.steps)) return parsed.steps;
  if (Array.isArray(parsed?.plan?.steps)) return parsed.plan.steps;
  if (Array.isArray(parsed?.goal_plan?.steps)) return parsed.goal_plan.steps;
  if (Array.isArray(parsed?.revised_steps)) return parsed.revised_steps;
  return [];
}

export function validateCandidateGoalPlan(candidateSteps, catalog) {
  const normalized = normalizeTypedSteps(candidateSteps);
  const keyed = normalized.map((step, index) => ({
    ...step,
    depends_on: (step.depends_on || []).map((dependency) => {
      const numeric = Number(dependency);
      return Number.isInteger(numeric) && numeric >= 0 && numeric < normalized.length
        ? normalized[numeric].key
        : dependency;
    }),
    produces: step.produces?.length || step.type === 'notify_ceo'
      ? step.produces
      : [{
          key: `${step.key}_output`,
          kind: step.type === 'human_task'
            ? 'decision'
            : executorCanProduceArtifact(step, catalog)
              ? 'artifact'
              : 'data',
          required: true,
        }],
  }));
  // Candidate plans are a fail-safe used only when the maker cannot return a
  // valid graph. Preserve explicit dependencies, but turn otherwise unbound
  // catalog steps into a conservative sequential chain. That guarantees every
  // downstream executor receives the previous typed result (including an
  // attachment for a human decision) instead of running as an orphan branch.
  const sequenced = keyed.map((step, index) => {
    if (index === 0 || step.type === 'notify_ceo' || step.depends_on?.length) return step;
    return { ...step, depends_on: [keyed[index - 1].key] };
  });
  // Catalog routing can produce parallel requirement branches. Deterministically
  // join every unfinished branch into the terminal step so no resolved tool,
  // workflow, specialist, or human outcome is silently orphaned.
  const joined = sequenced.map((step) => ({ ...step }));
  if (joined.length > 1) {
    const prior = joined.slice(0, -1);
    const consumedBeforeTerminal = new Set(prior.flatMap((step) => step.depends_on || []));
    const leaves = prior.filter((step) => !consumedBeforeTerminal.has(step.key)).map((step) => step.key);
    const terminal = joined.at(-1);
    terminal.depends_on = [...new Set([...(terminal.depends_on || []), ...leaves])];
  }
  const byKey = new Map(joined.map((step) => [step.key, step]));
  const connected = joined.map((step) => {
    if (step.required_inputs?.length || !step.depends_on?.length) return step;
    const requiredInputs = step.depends_on.flatMap((dependency) =>
      (byKey.get(dependency)?.produces || []).map((output) => ({
        key: output.key,
        kind: output.kind,
        source_step_key: dependency,
        required: output.required !== false,
      }))
    );
    return { ...step, required_inputs: requiredInputs };
  });
  const steps = normalizeExecutorOutputKinds(connected, catalog);
  return { steps, validation: validateTypedGoalPlan(steps, catalog) };
}

export function validateSeedRequirementCoverage(planSteps, seedSteps) {
  const identity = (step) => {
    if (step.type === 'workflow_trigger') return `workflow:${step.spec?.workflow_id || ''}`;
    if (step.type === 'agent_tool') return `tool:${step.spec?.tool_name || ''}`;
    if (step.type === 'specialty_task') return `agent:${String(step.spec?.agent_id || '').toLowerCase()}`;
    if (step.type === 'human_task') return `human:${step.spec?.user_id || ''}`;
    return null;
  };
  const available = new Map();
  for (const step of planSteps || []) {
    const key = identity(step);
    if (key) available.set(key, (available.get(key) || 0) + 1);
  }
  const errors = [];
  for (const step of seedSteps || []) {
    const key = identity(step);
    if (!key) continue;
    const count = available.get(key) || 0;
    if (count > 0) available.set(key, count - 1);
    else errors.push(`Plan omitted catalog-resolved requirement ${key}`);
  }
  return { ok: errors.length === 0, errors };
}

const CATALOG_RELEVANCE_STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'and', 'any', 'are', 'around',
  'before', 'being', 'between', 'both', 'but', 'can', 'could', 'each', 'every', 'for',
  'from', 'get', 'give', 'has', 'have', 'how', 'include', 'including', 'into', 'its',
  'last', 'make', 'must', 'need', 'not', 'only', 'our', 'outcome', 'provide', 'report',
  'should', 'some', 'than', 'that', 'the', 'their', 'them', 'then', 'these', 'this',
  'those', 'through', 'use', 'used', 'using', 'want', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'with', 'without', 'would', 'your',
]);

// This is an operation vocabulary, not a business-domain routing table. It lets
// lexical catalog retrieval understand equivalent instructions without encoding
// tenant-specific agents or examples (for example, "search" and "discover").
const CATALOG_OPERATION_EQUIVALENTS = {
  search: ['discover', 'find', 'lookup', 'research'],
  discover: ['search', 'find', 'lookup', 'research'],
  find: ['search', 'discover', 'lookup', 'research'],
  research: ['search', 'discover', 'find'],
  create: ['add', 'build', 'generate', 'save'],
  add: ['create', 'save'],
  draft: ['compose', 'write'],
  summarize: ['summary', 'report', 'review'],
  status: ['activity', 'history', 'progress'],
};

function relevanceTokens(value, { expandOperations = false } = {}) {
  const raw = String(value || '').toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
  const tokens = new Set(raw.filter((token) => !CATALOG_RELEVANCE_STOPWORDS.has(token)));
  if (expandOperations) {
    for (const token of [...tokens]) {
      for (const equivalent of CATALOG_OPERATION_EQUIVALENTS[token] || []) tokens.add(equivalent);
    }
  }
  return tokens;
}

function relevanceScore(value, wanted) {
  const tokens = relevanceTokens(value);
  let score = 0;
  for (const token of wanted) if (tokens.has(token)) score += token.includes('_') ? 5 : 1;
  return score;
}

function projectCatalogForPrompt(catalog, prompt = '', candidateSteps = []) {
  const wanted = relevanceTokens(prompt, { expandOperations: true });
  const selected = new Set((candidateSteps || []).flatMap((step) => [
    step?.spec?.agent_id,
    step?.spec?.tool_name,
    step?.spec?.workflow_id,
  ]).filter(Boolean).map(String));
  const ranked = (items, text, identity, limit) => items
    .map((item, index) => ({ item, index, score: relevanceScore(text(item), wanted) + (selected.has(String(identity(item))) ? 1000 : 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item);
  const agents = (catalog.agents || [])
    .map((agent, index) => ({
      agent,
      index,
      score:
        relevanceScore(`${agent.id} ${agent.name} ${agent.role}`, wanted) * 12 +
        relevanceScore((agent.connector_actions || []).map(action => `${action.action_id} ${action.description || ''}`).join(' '), wanted) * 3 +
        relevanceScore((agent.capabilities || []).map(capability => `${capability.name} ${capability.purpose || ''}`).join(' '), wanted),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .map(({ agent }) => agent)
    .map((agent) => ({
      ...agent,
      capabilities: ranked(agent.capabilities || [], (capability) => `${capability.name} ${capability.purpose || ''}`, (capability) => capability.name, 20),
    }));
  return {
    ...catalog,
    tools: ranked(catalog.tools || [], (tool) => `${tool.name} ${tool.display_name || ''} ${tool.purpose || ''}`, (tool) => tool.name, 24),
    workflows: ranked(catalog.workflows || [], (workflow) => `${workflow.id} ${workflow.name || ''} ${workflow.description || ''} ${workflow.chat_trigger_phrase || ''}`, (workflow) => workflow.id, 12),
    agents,
    humans: ranked(catalog.humans || [], (human) => `${human.id} ${human.name} ${human.department || ''} ${human.role_title || ''} ${human.specialty || ''} ${human.purpose || ''}`, (human) => human.id, 20),
  };
}

export function catalogPrompt(catalog, { prompt = '', candidateSteps = [] } = {}) {
  const projected = projectCatalogForPrompt(catalog, prompt, candidateSteps);
  // Workspace rosters include grandchildren. They are context for an internal
  // handoff, not selectable executors for the originating orchestrator.
  const nestedIds=new Set(projected.agents.flatMap(a=>(a.reportees||[]).map(r=>r.id)));
  return JSON.stringify({
    current_executor: projected.current_executor,
    current_executor_tools: projected.tools.map((x) => ({ name: x.name, purpose: x.purpose })),
    execution_rules: 'agent_tool may use ONLY current_executor_tools. agents[].capabilities describe work owned by THAT specialist: use specialty_task with spec.agent_id and spec.message to request it. Capabilities are not additional direct tools. A workflow is only the behavior explicitly described in its catalog entry.',
    workflows: projected.workflows,
    capability_definitions: Object.fromEntries(projected.agents.flatMap(x=>x.capabilities||[]).map(c=>[c.name,clip(c.purpose||'',240)])),
    agent_directory: (catalog.agents || []).map((x) => ({ id: x.id, name: x.name, role: clip(x.role || '', 160) })),
    agents: projected.agents.filter(x=>!nestedIds.has(x.id)).map((x) => ({ id: x.id, name: x.name, role: x.role, capabilities: x.capabilities.map(c=>c.name), connector_actions: x.connector_actions, reportees: x.reportees })),
    humans: projected.humans.map((x) => ({ id: x.id, name: x.name, department: x.department, role_title: x.role_title, specialty: x.specialty, purpose: x.purpose })),
  });
}

function checkerPlanPrompt(plan) {
  return clip((plan || []).map((step) => ({
    key: step.key,
    type: step.type,
    label: step.label,
    depends_on: step.depends_on,
    required_inputs: step.required_inputs,
    produces: step.produces,
    executor: step.spec?.tool_name || step.spec?.workflow_id || step.spec?.agent_id || step.spec?.user_id || null,
    work: step.spec?.message || null,
    objective: step.spec?.objective || null,
    operation_mode: step.spec?.operation_mode || null,
    subject: step.spec?.subject || null,
    deliverable_kind: step.spec?.deliverable_kind || null,
    rationale: step.spec?.selection_rationale || null,
  })), 10000);
}

const ARTIFACT_CAPABILITY_RE = /\b(artifact|attachment|file|pdf|document|download|image|video|audio|spreadsheet|csv|xlsx|docx|pptx|media|url)\b/i;

function executorCanProduceArtifact(step, catalog) {
  if (step.type === 'agent_tool') {
    const tool = (catalog.tools || []).find((x) => x.name === step.spec?.tool_name);
    return ARTIFACT_CAPABILITY_RE.test(`${tool?.display_name || ''} ${tool?.purpose || ''}`);
  }
  if (step.type === 'workflow_trigger') {
    const workflow = (catalog.workflows || []).find((x) => String(x.id) === String(step.spec?.workflow_id));
    return ARTIFACT_CAPABILITY_RE.test(`${workflow?.name || ''} ${workflow?.description || ''}`);
  }
  if (step.type === 'specialty_task' || step.type === 'agent_continue') {
    return ARTIFACT_CAPABILITY_RE.test(`${step.label || ''} ${step.spec?.message || ''}`);
  }
  return false;
}

/**
 * Models sometimes label ordinary JSON/status output as an artifact. Runtime is
 * deliberately stricter and requires a real URL/file reference. Reconcile the
 * contract with the selected executor before validation, and update every
 * downstream edge by semantic key/source rather than by prompt keywords.
 */
export function normalizeExecutorOutputKinds(steps, catalog) {
  const kindBySourceAndKey = new Map();
  const normalized = (steps || []).map((step) => {
    const canArtifact = executorCanProduceArtifact(step, catalog);
    const produces = (step.produces || []).map((output) => {
      const next = output.kind === 'artifact' && !canArtifact
        ? { ...output, kind: 'data' }
        : { ...output };
      kindBySourceAndKey.set(`${step.key}:${next.key}`, next.kind);
      return next;
    });
    let spec = { ...(step.spec || {}) };
    if (step.type === 'specialty_task' && spec.deliverable_kind === 'status_report') {
      const evidenceContract = 'Call agent_work_history for the requested period and return its evidence_id, counts, relevant completed, failed, and blocked records; do not repeat the historical work. ';
      if (!String(spec.message || '').includes('agent_work_history')) {
        spec.message = clip(`${evidenceContract}${clip(String(spec.message || '').trim(), 500)}`, 700);
      }
    }
    if (step.type === 'notify_ceo') {
      spec.objective ||= 'Deliver the complete consolidated goal outcome to the CEO';
      spec.operation_mode ||= 'communicate';
      spec.subject ||= 'complete goal outcome';
      spec.deliverable_kind ||= 'status_report';
      const evidenceContract = 'Consolidate every required prior-step outcome according to the original goal, including each evidence_id, counts, relevant records, and failed or blocked outcomes. ';
      if (!String(spec.message || '').includes('Consolidate every required prior-step outcome')) {
        spec.message = clip(`${evidenceContract}${clip(String(spec.message || '').trim(), 550)}`, 700);
      }
    }
    return { ...step, spec, produces };
  });
  const kindAligned = normalized.map((step) => ({
    ...step,
    required_inputs: (step.required_inputs || []).map((input) => {
      const actual = input.source_step_key
        ? kindBySourceAndKey.get(`${input.source_step_key}:${input.key}`)
        : null;
      return actual && actual !== input.kind ? { ...input, kind: actual } : input;
    }),
  }));
  const byKey = new Map(kindAligned.map((step) => [step.key, step]));
  const ancestorKeys = (step, found = new Set()) => {
    for (const key of step.depends_on || []) {
      if (found.has(key)) continue;
      found.add(key);
      const source = byKey.get(key);
      if (source) ancestorKeys(source, found);
    }
    return found;
  };
  return kindAligned.map((step) => {
    const requiredInputs = [...(step.required_inputs || [])];
    const seen = new Set(requiredInputs.map((input) => `${input.source_step_key || ''}:${input.key}:${input.kind}`));
    for (const sourceKey of ancestorKeys(step)) {
      const source = byKey.get(sourceKey);
      for (const output of source?.produces || []) {
        if (output.required === false) continue;
        const identity = `${sourceKey}:${output.key}:${output.kind}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        requiredInputs.push({
          key: output.key,
          kind: output.kind,
          required: true,
          source_step_key: sourceKey,
        });
      }
    }
    return { ...step, required_inputs: requiredInputs.slice(0, 32) };
  });
}

const PLAN_SCHEMA = `Return one concise JSON object with a steps array of at most 8 steps. Do not output prose. Keep every spec.message under 700 characters. Every step has key (unique string), type, label, depends_on (prior step keys), required_inputs, produces, spec.
Every executable step spec also includes objective (the bounded outcome), operation_mode (query|analyze|create|modify|delete|communicate|coordinate), subject (what is queried or acted upon), and deliverable_kind (status_report|data|artifact|external_action|approval|record_created). These are semantic guardrails; they do not replace the executor fields below. status_report means a human-readable summary of activity, history, progress, outcomes, blockers or current state. data means a factual dataset consumed as machine input and MUST NOT be used for a requested status/history/activity summary. A request to report or summarize prior work is a query/analyze status_report, even when the report truthfully describes failed, blocked, denied, or incomplete historical work. Never convert such a reporting request into re-execution of the historical operation. A mutation is allowed only when the original goal requests it.
Choose EXACTLY ONE of these mutually exclusive execution shapes:
1. type=agent_tool: spec={tool_name: EXACT name from current_executor_tools ONLY, message: bounded instruction, selection_rationale: reason}. NEVER put another agent's capability here.
2. type=specialty_task: spec={agent_id: EXACT id from agents, message: full specialist assignment including which of ITS capabilities/connector_actions to use, selection_rationale: reason}. Do NOT add tool_name.
3. type=workflow_trigger: spec={workflow_id: EXACT catalog id, phrase: catalog trigger phrase, message: full workflow input, selection_rationale: reason}. Its operation_mode is ALWAYS coordinate because the published workflow owns its internal side effects. Populate every required field from workflows[].input_schema in message and require the workflow run id plus its declared business result/read-back evidence.
4. type=human_task: spec={user_id: EXACT human id, message: requested human decision, selection_rationale: reason}. Use only for an actual assigned human action, NOT a CEO report or humans mentioned in content being written.
5. type=agent_continue: spec={message: synthesis or clarification task for the originating orchestrator, selection_rationale: reason}.
6. type=notify_ceo: spec={message: consolidated outcome report, selection_rationale: reason}; last step only, depends on all deliverables. Every goal plan MUST end with notify_ceo unless the original goal explicitly forbids notify_ceo.
Each required_inputs item: {key: semantic_name,kind: data OR artifact OR decision,source_step_key: prior step key,required:true}. Each produces item: {key: semantic_name,kind: data OR artifact OR decision,required:true}. Use one actual kind, never a pipe-separated string. Reference the same output key and kind downstream. No dangling dependencies. The runtime supplies every specialist the original goal verbatim next to the step instruction. Make the step a faithful bounded subset: never contradict, broaden, or remove an original constraint; repeat details only where needed to remove ambiguity.
Dependency example (identifiers are illustrative, NEVER catalog IDs): step key "read_context" produces [{key:"context",kind:"data",required:true}]. Its consumer uses depends_on:["read_context"] and required_inputs:[{key:"context",kind:"data",source_step_key:"read_context",required:true}]. source_step_key is the PRODUCER STEP KEY, never a tool name or output name. key is exactly the producer's output key, never a renamed alias.
Nested delegation example: current executor -> direct-report orchestrator -> that orchestrator's reportee is ONE specialty_task assigned to the direct-report orchestrator. Its message contains the entire internal sequence: delegate the subassignment to the named reportee, wait for and consume its returned output, perform the remaining requested actions with its own granted tools, verify completion, return all requested deliverables and the delegation trace. Do not split that internal chain into top-level tasks or borrow its tools. Preceding current-executor reads and final delivery remain separate steps.`;

async function buildCatalog(ownerUserId, orchestratorAgentId) {
  return {
    current_executor: getDb().prepare('SELECT id,name,role,is_coo,is_orchestrator FROM agents WHERE id=?').get(orchestratorAgentId) || null,
    tools: listOrchestratorToolsForGoalPlan(ownerUserId, orchestratorAgentId),
    workflows: listWorkflowCatalogForGoalPlan(ownerUserId),
    agents: (await listSpecialtyAgentsForGoalPlan(ownerUserId, orchestratorAgentId)).map(agent => ({...agent,
      capabilities: getDb().prepare('SELECT g.tool_name AS name,m.purpose FROM agent_tool_grants g LEFT JOIN content_tools_meta m ON m.name=g.tool_name WHERE g.agent_id=? AND COALESCE(m.enabled,1)=1 ORDER BY g.tool_name').all(agent.id),
      connector_actions: getDb().prepare('SELECT g.action_id,r.description,r.action_family FROM agent_connector_action_grants g JOIN connector_action_registry r ON r.action_id=g.action_id WHERE g.agent_id=? ORDER BY g.action_id').all(agent.id),
      reportees: getDb().prepare('SELECT a.id,a.name,a.role FROM agents a JOIN user_agents ua ON ua.agent_id=a.id AND ua.user_id=? AND ua.enabled=1 WHERE a.parent_id=? ORDER BY a.name').all(ownerUserId,agent.id),
    })),
    humans: listHumanWorkCandidates(ownerUserId),
  };
}

/** A rejection is actionable only when the checker returns the complete
 * corrected contract it was explicitly asked to produce. */
export function isCompleteCheckerVerdict(verdict) {
  if (!verdict || typeof verdict.approved !== 'boolean') return false;
  if (!Array.isArray(verdict.revised_steps)) return false;
  return verdict.approved === true
    ? verdict.revised_steps.length === 0
    : verdict.revised_steps.length > 0;
}

/** Deterministic, owner-scoped validation for a CEO-edited planning proposal. */
function validateTerminalDelivery(steps, prompt = '') {
  const explicitOptOut = /\b(?:do not|don't|never|must not)\s+(?:call|use|send|invoke)?\s*notify[_\s-]?ceo\b/i.test(String(prompt || ''));
  if (explicitOptOut) return [];
  return steps.at(-1)?.type === 'notify_ceo'
    ? []
    : ['Plan must end with notify_ceo so the originating orchestrator delivers the consolidated goal outcome'];
}

export async function validateGoalPlanDraft({ ownerUserId, orchestratorAgentId, prompt = '', steps }) {
  const catalog = await buildCatalog(ownerUserId, orchestratorAgentId);
  const normalized = normalizeExecutorOutputKinds(
    repairCheckerExecutorAvailability(normalizeTypedSteps(steps), catalog),
    catalog
  );
  const validation = validateTypedGoalPlan(normalized, catalog);
  const errors = [...validation.errors, ...validateTerminalDelivery(normalized, prompt)];
  return { steps: normalized, ok: errors.length === 0, errors };
}

export function isExecutableCheckerVerdict(verdict, catalog) {
  if (!isCompleteCheckerVerdict(verdict)) return false;
  if (verdict.approved === true) return true;
  const revision = normalizeExecutorOutputKinds(
    repairCheckerExecutorAvailability(normalizeTypedSteps(verdict.revised_steps), catalog),
    catalog
  );
  return validateTypedGoalPlan(revision, catalog).ok;
}

async function reportPlanProgress(onProgress, progress) {
  if (typeof onProgress !== 'function') return;
  try {
    await onProgress(progress);
  } catch (error) {
    // Visibility must never become a new execution dependency.
    console.warn('[goal-plan-quality] progress callback failed', error?.message || error);
  }
}

export async function qualityAssureGoalPlan({ ownerUserId, orchestratorAgentId, prompt, candidateSteps, onProgress = null }) {
  const catalog = await buildCatalog(ownerUserId, orchestratorAgentId);
  const seed = validateCandidateGoalPlan(candidateSteps, catalog);
  const promptCatalog = JSON.parse(catalogPrompt(catalog, { prompt, candidateSteps: seed.steps }));
  const { runGoalPlanRounds, buildGoalRequirements } = await import('./goal-plan-rounds.js');
  const options = { ownerUserId, temperature: 0, responseFormat: 'json_object', thinkingMode: 'disabled', timeoutMs: getPlatformTimeoutMs('goal_plan_llm') };
  return runGoalPlanRounds({
    prompt,
    normalize: content => normalizeExecutorOutputKinds(normalizeTypedSteps(extractPlanSteps(content)), catalog),
    validate: steps => {
      const structural = validateTypedGoalPlan(steps, catalog);
      const errors = [...structural.errors, ...validateTerminalDelivery(steps, prompt)];
      return { ok: errors.length === 0, errors };
    },
    onProgress: progress => reportPlanProgress(onProgress, progress),
    make: ({ attempt, previous, errors }) => chatCompletions({
      ...options, toolName: 'goal_plan_maker', endpointPreference: 'primary', maxTokens: 4000,
      messages: [
        { role: 'system', content: `You create the smallest COMPLETE executable company goal plan. Cover every requested discovery, verification, data write, draft, handoff, constraint and final delivery. A plan that is valid JSON but omits an outcome is invalid. Every explicitly named identifier, receipt, evidence item or result in the original goal must appear in the responsible step's produces contract and be consumed by the terminal report. Select executors by their declared capabilities, not shared words. The advisory candidate may be irrelevant: discard it when it does not cover the original goal. Each specialist gets a bounded assignment and consumes prior step outputs. Preserve nested orchestrator delegation inside its work contract. Carry source provenance and verified facts through discovery to writes. Never invent contact data or substitute unrelated retrieved records. Drafting is not sending. An LLM response alone is not evidence of a successful external action: require returned record/artifact IDs and verification. Preserve the original goal's speech act: asking for status/history/reporting does not authorize repeating the work being reported, and asking to act must not be reduced to reporting. For deliverable_kind=status_report, assign the relevant specialist a query/analyze operation that calls its agent_work_history capability and returns the evidence_id, counts and relevant records; never ask it to repeat the historical work. Preserve every explicit time range, entity, location, quantity and no-send/no-delete constraint in the bounded instruction that owns it. Use only live catalog IDs. ${PLAN_SCHEMA}` },
        { role: 'user', content: JSON.stringify({ original_goal: prompt, original_requirements: buildGoalRequirements(prompt), live_catalog: promptCatalog, advisory_candidate: seed.steps, round: attempt, previous_attempt: previous ? { steps: previous.steps, checker_response: previous.checker_response } : null, corrections_required: errors, repair_contract: 'If previous_attempt exists, edit that plan minimally, retaining every already-correct assignment, dependency, instruction and outcome. Apply ALL corrections together. The deterministic schema and enumerated values in the system message override any conflicting checker suggestion. Never rebuild a shorter plan that drops previous obligations. Before returning, check EVERY original requirement against the final instructions, including nested delegation, use of returned outputs, export and reporting if requested. Keep stable step keys when retaining a step. Include specific tool/action names from the selected specialist capability list in its message and require it to return evidence of completion. Capabilities are exact name strings; descriptions are in capability_definitions.' }) },
        { role: 'user', content: `Before emitting JSON, enforce this scope: top-level specialty_task.agent_id must be one of ${promptCatalog.agents.map(a=>a.id).join(', ')}. A reportee nested inside one of these agents is NOT a top-level target. If a request describes internal delegation followed by more work by the same manager, put the entire sequence in that manager's ONE spec.message, not extra steps. Direct agent_tool names must be one of ${promptCatalog.current_executor_tools.map(t=>t.name).join(', ')}. Each source_step_key must name a step.key you actually emitted. Return the complete corrected JSON, preserving the original goal above.` },
      ],
    }),
    check: ({ steps, attempt, validationErrors, priorCorrectionChecklist, previousVerdict }) => chatCompletions({
      ...options, toolName: 'goal_plan_checker', endpointPreference: 'secondary', maxTokens: 2600,
      messages: [
        { role: 'system', content: `Validate the proposed FUTURE plan against the original goal and live catalog. You are a bounded correctness checker, NOT a brainstorming reviewer. Return a short JSON verdict under 1200 words, with at most 6 DISTINCT blocking issues; never repeat an issue. Do not return revised_steps or a replacement plan.
NON-NEGOTIABLE RUNTIME FACT: a specialty_task assigned to a direct-report orchestrator automatically returns that orchestrator's response to the current executor. When its message names a catalog reportee and explicitly requires delegating to it, waiting for and consuming its result, completing the remaining work, and returning outputs plus trace, this IS the executable nested delegation. Mark it covered. Never demand a top-level step for that reportee, a separate callback/report-to-current-executor step, or a communication tool that does not exist.
NON-NEGOTIABLE CONTEXT FACT: the runtime sends the complete original goal verbatim to every specialty executor as REFERENCE-ONLY context alongside its bounded step and prior-step inputs. The bounded step is the only executable assignment. Do not reject a faithful step merely because it does not repeat wording already present in the original goal. Reject only a real contradiction, unrequested action, ambiguity that changes execution, missing executor/output/dependency, or a step that narrows away a requested outcome.
NON-NEGOTIABLE WORKFLOW FACT: workflow_trigger always has operation_mode=coordinate. Validate its message against workflows[].input_schema and execution_contract, never invent another operation_mode for that step.
If the original goal explicitly requests a published workflow by name or id, the plan MUST use workflow_trigger with that exact catalog workflow_id. Never approve a specialty_task whose message tells an agent to run that published workflow.
NON-NEGOTIABLE EVIDENCE FACT: a status_report specialty step is executable when the selected agent has agent_work_history and the step instructs it to call that capability and return its evidence snapshot. The outcome validator—not the plan—checks that evidence. Do not request execution receipts during planning.
Check coverage of requested deliverables, constraints, ordering, capable executors, nested delegation and final delivery. Compare every step's objective, operation_mode, subject, deliverable_kind and message to the original goal. Reject semantic drift: a query/status/history request must not rerun or mutate the underlying system, and a requested action must not be reduced to a report. A specialist assignment can perform several operations and verify its own result INSIDE one step; do not demand separate nodes for every check. Execution automatically handles authentication, action approvals, retries and error escalation: do not invent additional approvals, connector-preflight steps or human tasks unless the original goal requires them. Do not demand future receipts now; bounded instructions to obtain and return evidence are sufficient at planning time.
For every identifier, receipt, evidence item or result explicitly named in an original requirement, verify that the responsible step declares it in produces and the terminal delivery consumes it. Reject the plan if one is absent or hidden behind a vague generic output.
RUNTIME RESPONSIBILITY BOUNDARY: do not require plan steps, branches or prose for generic error handling, missing-output handling, retry behavior, escalation, authentication or connector preflight; the executor owns them. A notify_ceo step has operation_mode=communicate even when its payload is a report. Do not require a presentation format, sections or fields absent from the original goal. Every blocking issue must name an original requirement_id, an actual step_key, and the exact original-goal, catalog or deterministic-schema fact it violates. If no such fact exists, approve the plan.
Capability truth is in agents[].capabilities (exact name strings, descriptions in capability_definitions) AND agents[].connector_actions, and nested delegation targets are in reportees. Read these before alleging unavailable capabilities. Never claim a capability is absent when its exact name appears in that executor's list. Naming a capable agent with an unambiguous operation is sufficient; explicit tool naming is helpful but not mandatory. current_executor_tools are ONLY for direct agent_tool steps. Agents use their own capabilities inside specialty_task. A workflow supplies only its explicitly described behavior. Missing contact information may be reported/omitted rather than fabricated; do not invent a requirement to drop otherwise valid records or consult a human.
Nested handoffs are represented by a specialty_task to the direct-report ORCHESTRATOR whose message instructs it to delegate to its reportee and consume the returned result. That is a valid executable contract: do NOT demand a separate top-level step targeting that grandchild. The originating executor is current_executor; its own tool reads are agent_tool, its synthesis is agent_continue and its final delivery is notify_ceo. Include supplied deterministic_errors AND any missing semantic requirements in the same bounded correction response so the maker can fix both together.
One combined orchestrator assignment OR multiple dependent assignments to that SAME direct-report orchestrator are both valid. Do not reject a plan merely for splitting its work: verify the narrative/result is passed to the following step and used there. Each specialty_task returns its declared output to the originating orchestrator via the runtime callback. No extra report-back step is required if that output feeds the originating orchestrator's synthesis/final report. Never demand an extra callback step and then reject it for splitting work.
Return {"approved":true,"issues":[],"coverage":[{"requirement_id":"r1","covered":true,"step_keys":["actual step key"]}],"step_checks":[{"step_key":"actual step key","instruction_preserves_goal":true,"operation_mode_correct":true,"deliverable_kind_correct":true,"no_unrequested_action":true}]}. Include exactly one step_checks entry for EVERY proposed step. A missing objective, operation_mode, subject or deliverable_kind makes its corresponding semantic check false. Set a boolean false and add a concrete correction issue whenever that semantic property is wrong; never approve while any is false. Cover EVERY supplied original_requirements ID. Each ID may contain several requested outcomes; covered=true only if ALL are addressed by its mapped steps. Labels may be paraphrased, IDs must be exact. If a real blocking gap exists, approved=false and each issue is {"requirement_id":"r1","step_key":"actual step key","grounding":"exact original-goal, catalog, or deterministic-schema fact violated","message":"specific grounded problem","correction":"exact minimal change"}. Do not reject for stylistic preference, speculative policy or extra optional features. Never approve missing requested outcomes.` },
        { role: 'user', content: JSON.stringify({
          original_goal: prompt,
          original_requirements: buildGoalRequirements(prompt),
          live_catalog: promptCatalog,
          proposed_plan: steps,
          deterministic_errors: validationErrors,
          prior_correction_checklist: priorCorrectionChecklist || [],
          previous_checker_verdict: previousVerdict,
          round: attempt,
          correction_audit_rule: 'When prior_correction_checklist is non-empty, verify every prior item against the new proposal. Approve only when every item is resolved. If an item remains, return one grounded issue for it; do not silently replace it with unrelated advice.',
        }) },
      ],
    }),
  });
}

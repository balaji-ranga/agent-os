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

const STEP_TYPES = new Set([
  'workflow_trigger',
  'agent_tool',
  'specialty_task',
  'human_task',
  'agent_continue',
  'notify_ceo',
]);
const IO_KINDS = new Set(['data', 'artifact', 'decision']);

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
    const type = String(raw?.type || raw?.step_type || '').trim().toLowerCase();
    const spec = raw?.spec && typeof raw.spec === 'object' ? { ...raw.spec } : {};
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
        ...(raw?.tool_name ? { tool_name: raw.tool_name } : {}),
        ...(raw?.workflow_id ? { workflow_id: raw.workflow_id } : {}),
        ...(raw?.phrase ? { phrase: raw.phrase } : {}),
        ...(raw?.agent_id ? { agent_id: raw.agent_id } : {}),
        ...(raw?.user_id ? { user_id: raw.user_id } : {}),
        ...(raw?.message ? { message: raw.message } : {}),
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
    if (step.type === 'specialty_task' && !agents.has(String(step.spec?.agent_id || '').toLowerCase())) {
      const id=String(step.spec?.agent_id || '(missing)');
      const parents=(catalog.agents||[]).filter(agent=>(agent.reportees||[]).some(report=>report.id===id)).map(agent=>agent.id);
      errors.push(`Step ${step.key}: specialty_task agent_id=${id} is not a direct reportee. ${parents.length ? `Delegate to ${parents.join(', ')} and instruct that orchestrator to delegate internally to ${id}, return its result and preserve the trace.` : `Allowed direct reportees: ${[...agents].join(', ')}. Use agent_continue for the originating orchestrator's own synthesis, or notify_ceo for final delivery.`}`);
    }
    if (step.type === 'specialty_task' && !String(step.spec?.message || '').trim()) errors.push(`Specialty step ${step.key} has no bounded work instruction`);
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

export function catalogPrompt(catalog) {
  // Workspace rosters include grandchildren. They are context for an internal
  // handoff, not selectable executors for the originating orchestrator.
  const nestedIds=new Set(catalog.agents.flatMap(a=>(a.reportees||[]).map(r=>r.id)));
  return JSON.stringify({
    current_executor: catalog.current_executor,
    current_executor_tools: catalog.tools.map((x) => ({ name: x.name, purpose: x.purpose })),
    execution_rules: 'agent_tool may use ONLY current_executor_tools. agents[].capabilities describe work owned by THAT specialist: use specialty_task with spec.agent_id and spec.message to request it. Capabilities are not additional direct tools. A workflow is only the behavior explicitly described in its catalog entry.',
    workflows: catalog.workflows,
    capability_definitions: Object.fromEntries(catalog.agents.flatMap(x=>x.capabilities||[]).map(c=>[c.name,clip(c.purpose||'',240)])),
    agents: catalog.agents.filter(x=>!nestedIds.has(x.id)).map((x) => ({ id: x.id, name: x.name, role: x.role, capabilities: x.capabilities.map(c=>c.name), connector_actions: x.connector_actions, reportees: x.reportees })),
    humans: catalog.humans.map((x) => ({ id: x.id, name: x.name, department: x.department, role_title: x.role_title, specialty: x.specialty, purpose: x.purpose })),
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
    return { ...step, produces };
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

const PLAN_SCHEMA = `Return JSON object with a steps array. Every step has key (unique string), type, label, depends_on (prior step keys), required_inputs, produces, spec.
Choose EXACTLY ONE of these mutually exclusive execution shapes:
1. type=agent_tool: spec={tool_name: EXACT name from current_executor_tools ONLY, message: bounded instruction, selection_rationale: reason}. NEVER put another agent's capability here.
2. type=specialty_task: spec={agent_id: EXACT id from agents, message: full specialist assignment including which of ITS capabilities/connector_actions to use, selection_rationale: reason}. Do NOT add tool_name.
3. type=workflow_trigger: spec={workflow_id: EXACT catalog id, phrase: catalog trigger phrase, message: full workflow input, selection_rationale: reason}.
4. type=human_task: spec={user_id: EXACT human id, message: requested human decision, selection_rationale: reason}. Use only for an actual assigned human action, NOT a CEO report or humans mentioned in content being written.
5. type=agent_continue: spec={message: synthesis or clarification task for the originating orchestrator, selection_rationale: reason}.
6. type=notify_ceo: spec={message: consolidated outcome report, selection_rationale: reason}; last step only, depends on all deliverables.
Each required_inputs item: {key: semantic_name,kind: data OR artifact OR decision,source_step_key: prior step key,required:true}. Each produces item: {key: semantic_name,kind: data OR artifact OR decision,required:true}. Use one actual kind, never a pipe-separated string. Reference the same output key and kind downstream. No dangling dependencies. Include all original constraints verbatim in the relevant specialist instructions.
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
  const { runGoalPlanRounds, buildGoalRequirements } = await import('./goal-plan-rounds.js');
  const options = { ownerUserId, temperature: 0, responseFormat: 'json_object', thinkingMode: 'disabled', timeoutMs: getPlatformTimeoutMs('goal_plan_llm') };
  return runGoalPlanRounds({
    prompt,
    normalize: content => normalizeExecutorOutputKinds(normalizeTypedSteps(extractPlanSteps(content)), catalog),
    validate: steps => validateTypedGoalPlan(steps, catalog),
    onProgress: progress => reportPlanProgress(onProgress, progress),
    make: ({ attempt, previous, errors }) => chatCompletions({
      ...options, toolName: 'goal_plan_maker', endpointPreference: 'primary', maxTokens: 6500,
      messages: [
        { role: 'system', content: `You create the smallest COMPLETE executable company goal plan. Cover every requested discovery, verification, data write, draft, handoff, constraint and final delivery. A plan that is valid JSON but omits an outcome is invalid. Select executors by their declared capabilities, not shared words. The advisory candidate may be irrelevant: discard it when it does not cover the original goal. Each specialist gets a bounded assignment and consumes prior step outputs. Preserve nested orchestrator delegation inside its work contract. Carry source provenance and verified facts through discovery to writes. Never invent contact data or substitute unrelated retrieved records. Drafting is not sending. An LLM response alone is not evidence of a successful external action: require returned record/artifact IDs and verification. Use only live catalog IDs. ${PLAN_SCHEMA}` },
        { role: 'user', content: JSON.stringify({ original_goal: prompt, original_requirements: buildGoalRequirements(prompt), live_catalog: JSON.parse(catalogPrompt(catalog)), advisory_candidate: seed.steps, round: attempt, previous_attempt: previous, corrections_required: errors, repair_contract: 'If previous_attempt exists, edit that plan minimally, retaining every already-correct assignment, dependency, instruction and outcome. Apply ALL corrections together. Never rebuild a shorter plan that drops previous obligations. Before returning, check EVERY original requirement against the final instructions, including nested delegation, use of returned outputs, export and reporting if requested. Keep stable step keys when retaining a step. Include specific tool/action names from the selected specialist capability list in its message and require it to return evidence of completion. Capabilities are exact name strings; descriptions are in capability_definitions.' }) },
        { role: 'user', content: `Before emitting JSON, enforce this scope: top-level specialty_task.agent_id must be one of ${JSON.parse(catalogPrompt(catalog)).agents.map(a=>a.id).join(', ')}. A reportee nested inside one of these agents is NOT a top-level target. If a request describes internal delegation followed by more work by the same manager, put the entire sequence in that manager's ONE spec.message, not extra steps. Direct agent_tool names must be one of ${catalog.tools.map(t=>t.name).join(', ')}. Each source_step_key must name a step.key you actually emitted. Return the complete corrected JSON, preserving the original goal above.` },
      ],
    }),
    check: ({ steps, attempt, validationErrors }) => chatCompletions({
      ...options, toolName: 'goal_plan_checker', endpointPreference: 'secondary', maxTokens: 2600,
      messages: [
        { role: 'system', content: `Validate the proposed FUTURE plan against the original goal and live catalog. You are a bounded correctness checker, NOT a brainstorming reviewer. Return a short JSON verdict under 1200 words, with at most 6 DISTINCT blocking issues; never repeat an issue. Do not return revised_steps or a replacement plan.
Check coverage of requested deliverables, constraints, ordering, capable executors, nested delegation and final delivery. A specialist assignment can perform several operations and verify its own result INSIDE one step; do not demand separate nodes for every check. Execution automatically handles authentication, action approvals, retries and error escalation: do not invent additional approvals, connector-preflight steps or human tasks unless the original goal requires them. Do not demand future receipts now; bounded instructions to obtain and return evidence are sufficient at planning time.
Capability truth is in agents[].capabilities (exact name strings, descriptions in capability_definitions) AND agents[].connector_actions, and nested delegation targets are in reportees. Read these before alleging unavailable capabilities. Never claim a capability is absent when its exact name appears in that executor's list. Naming a capable agent with an unambiguous operation is sufficient; explicit tool naming is helpful but not mandatory. current_executor_tools are ONLY for direct agent_tool steps. Agents use their own capabilities inside specialty_task. A workflow supplies only its explicitly described behavior. Missing contact information may be reported/omitted rather than fabricated; do not invent a requirement to drop otherwise valid records or consult a human.
Nested handoffs are represented by a specialty_task to the direct-report ORCHESTRATOR whose message instructs it to delegate to its reportee and consume the returned result. That is a valid executable contract: do NOT demand a separate top-level step targeting that grandchild. The originating executor is current_executor; its own tool reads are agent_tool, its synthesis is agent_continue and its final delivery is notify_ceo. Include supplied deterministic_errors AND any missing semantic requirements in the same bounded correction response so the maker can fix both together.
One combined orchestrator assignment OR multiple dependent assignments to that SAME direct-report orchestrator are both valid. Do not reject a plan merely for splitting its work: verify the narrative/result is passed to the following step and used there. Each specialty_task returns its declared output to the originating orchestrator via the runtime callback. No extra report-back step is required if that output feeds the originating orchestrator's synthesis/final report. Never demand an extra callback step and then reject it for splitting work.
Return {"approved":true,"issues":[],"coverage":[{"requirement_id":"r1","covered":true,"step_keys":["actual step key"]}]}. Cover EVERY supplied original_requirements ID. Each ID may contain several requested outcomes; covered=true only if ALL are addressed by its mapped steps. Labels may be paraphrased, IDs must be exact. If a real blocking gap exists, approved=false and each issue is {"message":"specific problem grounded in the original goal or catalog","correction":"exact change the maker should make"}. Do not reject for stylistic preference, speculative policy or extra optional features. Never approve missing requested outcomes.` },
        { role: 'user', content: JSON.stringify({ original_goal: prompt, original_requirements: buildGoalRequirements(prompt), live_catalog: JSON.parse(catalogPrompt(catalog)), proposed_plan: steps, deterministic_errors: validationErrors, round: attempt }) },
      ],
    }),
  });
}

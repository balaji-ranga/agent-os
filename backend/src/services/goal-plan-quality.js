/**
 * Semantic maker/checker gate for goal plans.
 *
 * The existing intent classifier supplies a candidate, but it is not trusted as
 * an executable plan. A maker creates a typed dependency graph from the full
 * goal and live tenant catalog; an independent model judges completeness and
 * may repair it. Deterministic validation then fails closed on invalid IDs,
 * dependencies, or data/artifact/decision hand-offs.
 */
import { chatCompletions, getLlmConfig, isLocalOllama } from '../config/llm.js';
import {
  listOrchestratorToolsForGoalPlan,
  listWorkflowCatalogForGoalPlan,
  listSpecialtyAgentsForGoalPlan,
} from './goal-plan-intent.js';
import { listHumanWorkCandidates } from './work-assignment-policy.js';

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
    if (step.type === 'agent_tool' && !tools.has(String(step.spec?.tool_name || ''))) errors.push(`Step ${step.key} uses an unavailable tool`);
    if (step.type === 'workflow_trigger' && !workflows.has(String(step.spec?.workflow_id || ''))) errors.push(`Step ${step.key} uses an unavailable workflow`);
    if (step.type === 'specialty_task' && !agents.has(String(step.spec?.agent_id || '').toLowerCase())) errors.push(`Step ${step.key} uses an unavailable agent`);
    if (step.type === 'specialty_task' && !String(step.spec?.message || '').trim()) errors.push(`Specialty step ${step.key} has no bounded work instruction`);
    if (step.type === 'human_task' && !humans.has(String(step.spec?.user_id || ''))) errors.push(`Step ${step.key} uses an unavailable human`);
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

function catalogPrompt(catalog) {
  return clip({
    tools: catalog.tools.map((x) => ({ name: x.name, purpose: x.purpose })),
    workflows: catalog.workflows,
    agents: catalog.agents.map((x) => ({ id: x.id, name: x.name, role: x.role })),
    humans: catalog.humans.map((x) => ({ id: x.id, name: x.name, department: x.department, role_title: x.role_title, specialty: x.specialty, purpose: x.purpose })),
  }, 18000);
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

const PLAN_SCHEMA = `Return JSON only: {"steps":[{"key":"stable_key","type":"workflow_trigger|agent_tool|specialty_task|human_task|agent_continue|notify_ceo","label":"clear outcome","depends_on":["prior_key"],"required_inputs":[{"key":"semantic_name","kind":"data|artifact|decision","source_step_key":"prior_key","required":true}],"produces":[{"key":"semantic_name","kind":"data|artifact|decision","required":true}],"spec":{"workflow_id":"catalog id","phrase":"catalog phrase","tool_name":"catalog name","agent_id":"catalog id","user_id":"catalog id","message":"specific bounded work or decision","selection_rationale":"why this executor is capable"}}]}. Omit executor fields that do not apply.`;

async function buildCatalog(ownerUserId, orchestratorAgentId) {
  return {
    tools: listOrchestratorToolsForGoalPlan(ownerUserId, orchestratorAgentId),
    workflows: listWorkflowCatalogForGoalPlan(ownerUserId),
    agents: await listSpecialtyAgentsForGoalPlan(ownerUserId, orchestratorAgentId),
    humans: listHumanWorkCandidates(ownerUserId),
  };
}

function checkerPreference(ownerUserId, makerResult) {
  const cfg = getLlmConfig(ownerUserId);
  if (makerResult?.localModel || isLocalOllama(cfg.primary?.baseUrl)) return 'platform_primary';
  // If the maker had to fail over to the configured secondary, do not use the
  // same model as its own checker. Keep maker/checker independence with Ollama.
  try {
    const secondaryHost = new URL(String(cfg.secondary?.baseUrl || '')).hostname.toLowerCase();
    if (secondaryHost && secondaryHost === String(makerResult?.endpointHost || '').toLowerCase()) return 'ollama';
  } catch {}
  return cfg.secondary?.baseUrl && cfg.secondary?.model ? 'secondary' : 'ollama';
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

export async function qualityAssureGoalPlan({ ownerUserId, orchestratorAgentId, prompt, candidateSteps, checkerEndpointPreference = null, onProgress = null }) {
  const catalog = await buildCatalog(ownerUserId, orchestratorAgentId);
  // The catalog router is deterministic and may already have produced a fully
  // executable contract. Keep that validated contract as a recovery point so
  // repeated maker hallucinations cannot erase known-good workflows/tools.
  const seed = validateCandidateGoalPlan(candidateSteps, catalog);
  let maker;
  let made = [];
  let madeValidation = { ok: false, errors: ['Maker has not run'] };
  let rejectedPlan = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await reportPlanProgress(onProgress, {
      phase: 'maker',
      label: attempt === 1 ? 'Building executable plan' : 'Correcting maker plan',
      detail: `Maker round ${attempt} of 3`,
      attempt,
      max_attempts: 3,
    });
    maker = await chatCompletions({
      ownerUserId,
      toolName: 'goal_plan_maker',
      maxTokens: 3200,
      temperature: 0,
      responseFormat: 'json_object',
      thinkingMode: 'disabled',
      messages: [
        { role: 'system', content: `You are the maker for an executable company goal plan. Translate the complete goal into the smallest complete ordered dependency graph. Cover every requested prerequisite, output, constraint, human decision, and terminal delivery. Use only exact live catalog IDs. A named human receives only the specific work/decision intended for that human, never the whole goal when preparation is needed. A dependent action must consume the prior data/artifact/decision. Ordinary JSON, status, profile, list, and analysis results are data, not artifacts. Declare artifact only when the selected executor actually returns a file, attachment, media, document, or downloadable URL. Never invent completed evidence or artifacts. ${PLAN_SCHEMA}` },
        { role: 'user', content: `ORIGINAL GOAL:\n${clip(prompt, 9000)}\n\nLIVE CATALOG:\n${catalogPrompt(catalog)}\n\nUNTRUSTED CANDIDATE (use only as a hint):\n${clip(candidateSteps, 10000)}${attempt > 1 ? `\n\nPREVIOUS INVALID PLAN:\n${clip(rejectedPlan, 10000)}\n\nDETERMINISTIC ERRORS TO REPAIR:\n${madeValidation.errors.join('; ')}` : ''}` },
      ],
    });
    rejectedPlan = parseJsonObject(maker.content)?.steps || [];
    made = normalizeExecutorOutputKinds(normalizeTypedSteps(rejectedPlan), catalog);
    madeValidation = validateTypedGoalPlan(made, catalog);
    if (madeValidation.ok && seed.validation.ok) {
      const coverage = validateSeedRequirementCoverage(made, seed.steps);
      if (!coverage.ok) madeValidation = coverage;
    }
    if (madeValidation.ok) break;
    await reportPlanProgress(onProgress, {
      phase: 'maker_retry',
      label: 'Maker plan needs correction',
      detail: `Validation found ${madeValidation.errors.length} contract issue${madeValidation.errors.length === 1 ? '' : 's'}`,
      attempt,
      max_attempts: 3,
    });
    console.warn('[goal-plan-quality] maker contract retry', { attempt, errors: madeValidation.errors.slice(0, 12) });
  }
  if (!madeValidation.ok) {
    if (seed.validation.ok) {
      console.warn('[goal-plan-quality] maker could not produce a valid executable contract; retaining validated catalog plan', {
        errors: madeValidation.errors.slice(0, 12),
      });
      made = seed.steps;
      madeValidation = seed.validation;
    } else {
      console.warn('[goal-plan-quality] maker and catalog plan were invalid; using safe clarification plan', {
        maker_errors: madeValidation.errors.slice(0, 12),
        catalog_errors: seed.validation.errors.slice(0, 12),
      });
      made = safeGoalClarificationPlan();
      madeValidation = validateTypedGoalPlan(made, catalog);
    }
    if (!madeValidation.ok) {
      throw new Error(`Goal-plan fail-safe contract is invalid: ${madeValidation.errors.join('; ')}`);
    }
  }

  const requestedChecker = ['ollama', 'secondary', 'platform_primary'].includes(String(checkerEndpointPreference || ''))
    ? String(checkerEndpointPreference)
    : null;
  const preference = requestedChecker || checkerPreference(ownerUserId, maker);
  await reportPlanProgress(onProgress, {
    phase: 'checker',
    label: 'Validating plan independently',
    detail: 'Checker is reviewing coverage, dependencies, and executor fit',
  });
  const checkerRequestFor = (plan, endpointPreference) => ({
    ownerUserId,
    toolName: 'goal_plan_checker',
    endpointPreference,
    // Reasoning-capable passive models may consume an internal preamble before
    // emitting the small JSON verdict. Keep enough output room so a valid
    // configured secondary is not mistaken for a malformed response.
    maxTokens: 5000,
    temperature: 0,
    responseFormat: 'json_object',
    thinkingMode: 'disabled',
    messages: [
      { role: 'system', content: `You are a static plan-quality API, not a conversational assistant and not a runtime monitor. Judge the proposed future execution design; do not claim that declared future inputs or outputs are currently missing or failed. Reject if the design omits a requested outcome or prerequisite, assigns work that does not fit the declared executor, gives a human the whole goal instead of a bounded decision, runs an action before its required data/artifact/decision exists, violates a stated constraint, or only reports status instead of delivering the requested outcome. Cross-functional hand-offs are expected: different dependent steps may and often should have different executors, and a human decision followed by an automated action necessarily crosses executors. Never reject merely because executor IDs differ when typed dependencies carry the output to the next step. The deterministic gate has already verified that executor IDs exist. Output exactly one JSON object and no reasoning: {"approved":true|false,"issues":[{"code":"short_code","step_key":"key or empty","message":"specific design defect"}],"revised_steps":[]}. When approved, revised_steps must be empty. When rejected, revised_steps must be the complete corrected plan using this schema and exact IDs from the supplied plan; do not invent another executor. ${PLAN_SCHEMA}` },
      { role: 'user', content: `ORIGINAL GOAL:\n${clip(prompt, 7000)}\n\nTYPED PLAN CONTRACT:\n${checkerPlanPrompt(plan)}` },
    ],
  });
  let check;
  let checkerEndpoint = preference;
  let checkerDegraded = false;
  const acceptDeterministicContract = (error, attemptedEndpoint) => {
    checkerDegraded = true;
    checkerEndpoint = 'deterministic_contract';
    console.warn('[goal-plan-quality] independent checker unavailable; retaining deterministically valid maker contract', {
      attempted_endpoint: attemptedEndpoint,
      error: String(error?.message || error || 'checker unavailable').slice(0, 500),
    });
    return {
      content: JSON.stringify({ approved: true, issues: [], revised_steps: [] }),
      modelUsed: 'deterministic_contract',
    };
  };
  try {
    check = await chatCompletions(checkerRequestFor(made, preference));
  } catch (error) {
    if (preference === 'secondary') {
      checkerEndpoint = 'ollama';
      await reportPlanProgress(onProgress, {
        phase: 'checker_fallback',
        label: 'Retrying plan validation',
        detail: 'The independent checker is using its configured fallback',
      });
      try {
        check = await chatCompletions(checkerRequestFor(made, 'ollama'));
      } catch (fallbackError) {
        check = acceptDeterministicContract(fallbackError, 'ollama');
      }
    } else {
      check = acceptDeterministicContract(error, preference);
    }
  }
  let verdict = parseJsonObject(check.content) || {};
  if (typeof verdict.approved !== 'boolean' && preference === 'secondary' && checkerEndpoint !== 'ollama') {
    checkerEndpoint = 'ollama';
    try {
      check = await chatCompletions(checkerRequestFor(made, 'ollama'));
    } catch (fallbackError) {
      check = acceptDeterministicContract(fallbackError, 'ollama');
    }
    verdict = parseJsonObject(check.content) || {};
  }

  let selected = made;
  let selectedValidation = madeValidation;
  let acceptedCheckerRevision = false;
  if (verdict.approved !== true) {
    const checkerRevision = normalizeExecutorOutputKinds(repairCheckerExecutorAvailability(
      normalizeTypedSteps(verdict.revised_steps),
      catalog
    ), catalog);
    const checkerRevisionValidation = validateTypedGoalPlan(checkerRevision, catalog);
    if (checkerRevisionValidation.ok) {
      selected = checkerRevision;
      selectedValidation = checkerRevisionValidation;
      acceptedCheckerRevision = true;
    }
  }
  if (verdict.approved !== true && !acceptedCheckerRevision) {
    // If the checker's proposed correction is not a valid typed contract,
    // repair remains the maker's responsibility.
    await reportPlanProgress(onProgress, {
      phase: 'maker_repair',
      label: 'Repairing plan after review',
      detail: 'Maker is applying checker feedback',
    });
    const repair = await chatCompletions({
      ownerUserId,
      toolName: 'goal_plan_maker',
      maxTokens: 3200,
      temperature: 0,
      responseFormat: 'json_object',
      thinkingMode: 'disabled',
      messages: [
        { role: 'system', content: `You are the plan maker repairing a plan after an independent review. Resolve every checker issue without dropping correct work or stated constraints. Return JSON only as {"steps":[...]}. The steps must be complete, ordered, use only exact live catalog IDs, and pass this schema. Do not explain. ${PLAN_SCHEMA}` },
        { role: 'user', content: `ORIGINAL GOAL:\n${clip(prompt, 9000)}\n\nLIVE CATALOG:\n${catalogPrompt(catalog)}\n\nMAKER PLAN:\n${clip(made, 12000)}\n\nCHECKER ISSUES:\n${clip(verdict.issues || [{ code: 'invalid_verdict', message: 'Checker did not return a valid approval decision.' }], 6000)}` },
      ],
    });
    const repairedJson = parseJsonObject(repair.content) || {};
    selected = normalizeExecutorOutputKinds(repairCheckerExecutorAvailability(
      normalizeTypedSteps(repairedJson.steps || repairedJson.revised_steps),
      catalog
    ), catalog);
    selectedValidation = validateTypedGoalPlan(selected, catalog);
    if (!selectedValidation.ok) {
      const contractRepair = await chatCompletions({
        ownerUserId,
        toolName: 'goal_plan_maker',
        maxTokens: 3200,
        temperature: 0,
        responseFormat: 'json_object',
        thinkingMode: 'disabled',
        messages: [
          { role: 'system', content: `Repair only the typed dependency-contract defects reported by the deterministic validator while preserving the complete original goal, constraints, and bounded human decision. Every required input key/kind must exactly match a declared output key/kind on its prior source step. Return JSON only as {"steps":[...]}. Use only exact live catalog IDs. ${PLAN_SCHEMA}` },
          { role: 'user', content: `ORIGINAL GOAL:\n${clip(prompt, 9000)}\n\nLIVE CATALOG:\n${catalogPrompt(catalog)}\n\nPLAN WITH CONTRACT DEFECTS:\n${clip(selected, 12000)}\n\nDETERMINISTIC CONTRACT ERRORS:\n${selectedValidation.errors.join('; ')}` },
        ],
      });
      const contractJson = parseJsonObject(contractRepair.content) || {};
      selected = normalizeExecutorOutputKinds(repairCheckerExecutorAvailability(
        normalizeTypedSteps(contractJson.steps || contractJson.revised_steps),
        catalog
      ), catalog);
      selectedValidation = validateTypedGoalPlan(selected, catalog);
    }
    if (selectedValidation.ok) {
      await reportPlanProgress(onProgress, {
        phase: 'final_checker',
        label: 'Running final plan validation',
        detail: 'Checker is validating the repaired plan',
      });
      let finalCheck;
      try {
        finalCheck = await chatCompletions(checkerRequestFor(selected, checkerEndpoint));
      } catch (error) {
        if (checkerEndpoint === 'secondary') {
          checkerEndpoint = 'ollama';
          try {
            finalCheck = await chatCompletions(checkerRequestFor(selected, 'ollama'));
          } catch (fallbackError) {
            finalCheck = acceptDeterministicContract(fallbackError, 'ollama');
          }
        } else {
          finalCheck = acceptDeterministicContract(error, checkerEndpoint);
        }
      }
      const finalVerdict = parseJsonObject(finalCheck.content) || {};
      check = finalCheck;
      verdict = finalVerdict;
      if (finalVerdict.approved !== true) {
        selectedValidation = {
          ok: false,
          errors: ['Independent checker rejected the repaired plan'],
        };
      }
    }
  }
  if (!selectedValidation.ok) {
    const judgeIssues = Array.isArray(verdict.issues) ? verdict.issues.map((x) => x?.message).filter(Boolean) : [];
    if (madeValidation.ok) {
      // A checker rejection is actionable only when it supplies (or leads the
      // maker to) another executable contract. Do not let a stochastic judge
      // erase a deterministically valid plan with an invalid/empty revision.
      console.warn('[goal-plan-quality] checker correction unusable; retaining deterministically valid maker plan', {
        issues: [...judgeIssues, ...selectedValidation.errors].slice(0, 12),
      });
      selected = made;
      selectedValidation = madeValidation;
    } else {
      console.warn('[goal-plan-quality] checker could not repair; using safe clarification plan', {
        issues: [...judgeIssues, ...selectedValidation.errors].slice(0, 12),
      });
      selected = safeGoalClarificationPlan();
      selectedValidation = validateTypedGoalPlan(selected, catalog);
    }
    if (!selectedValidation.ok) {
      throw new Error(`Goal-plan checker rejected the plan without a valid repair: ${[...judgeIssues, ...selectedValidation.errors].join('; ')}`);
    }
  }
  await reportPlanProgress(onProgress, {
    phase: 'complete',
    label: 'Plan validated',
    detail: `${selected.length} executable step${selected.length === 1 ? '' : 's'} ready`,
    status: 'completed',
  });
  return {
    steps: selected,
    quality: {
      maker_model: maker.modelUsed,
      checker_model: check.modelUsed,
      checker_endpoint: checkerEndpoint,
      checker_degraded: checkerDegraded,
      checker_approved_maker: !checkerDegraded && verdict.approved === true,
      issues: Array.isArray(verdict.issues) ? verdict.issues.slice(0, 20) : [],
    },
  };
}

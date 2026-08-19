/**
 * Generic goal-plan runtime: typed DAG validation, recovery decisions, retrospective.
 * Reuses existing step types / capabilities — no vertical-specific tools.
 */
import { classifyToolFailure } from './tool-failure-class.js';
import { getCapability, resolveCapabilityExecutor } from './business-capabilities.js';
import { inferRiskForTool } from './action-policy.js';

export const EXECUTABLE_STEP_TYPES = Object.freeze([
  'workflow_trigger',
  'agent_tool',
  'specialty_task',
  'notify_ceo',
  'agent_continue',
]);

export const DECISION_ACTIONS = Object.freeze([
  'continue',
  'retry',
  'switch_executor',
  're-plan',
  'escalate',
  'stop',
  'complete',
]);

export function enrichPlanSteps(steps) {
  const list = Array.isArray(steps) ? steps : [];
  return list.map((raw, i) => {
    const type = String(raw.type || raw.step_type || '').toLowerCase();
    const spec = raw.spec && typeof raw.spec === 'object' ? { ...raw.spec } : {};
    const toolName = raw.tool_name || spec.tool_name || null;
    const capId = raw.capability_id || spec.capability_id || null;
    const cap = capId ? getCapability(capId) : null;
    const risk = raw.risk_tier || spec.risk_tier || (toolName ? inferRiskForTool(toolName).risk_tier : cap?.risk_tier || 'R0');
    const fallback = raw.fallback_tool || spec.fallback_tool || cap?.fallback_tool || null;
    const executor =
      type === 'workflow_trigger'
        ? 'workflow:' + String(raw.phrase || spec.phrase || 'run')
        : type === 'agent_tool'
          ? 'tool:' + String(toolName || 'unknown')
          : type === 'specialty_task'
            ? 'agent:' + String(raw.agent_id || spec.agent_id || 'specialty')
            : type === 'notify_ceo'
              ? 'human:ceo_notify'
              : 'agent:continue';
    const mode = type === 'notify_ceo' ? 'human' : type === 'workflow_trigger' ? 'workflow' : 'tool_or_agent';
    const extra = {
      capability_id: capId,
      risk_tier: risk,
      fallback_tool: fallback,
      assigned_executor: executor,
      execution_mode: raw.execution_mode || spec.execution_mode || mode,
      expected_evidence: raw.expected_evidence || spec.expected_evidence || cap?.expected_evidence || 'step_result',
      timeout_ms: Number(raw.timeout_ms || spec.timeout_ms || 120000),
      retry_policy: raw.retry_policy || spec.retry_policy || { max: 2, backoff_ms: 400 },
      retry_count: Number(spec.retry_count || 0),
      failed_providers: Array.isArray(spec.failed_providers) ? spec.failed_providers : [],
    };
    return {
      ...raw,
      type,
      label: raw.label || type,
      ...extra,
      depends_on: i === 0 ? [] : [i - 1],
      status: raw.status || 'pending',
      spec: { ...spec, ...extra, tool_name: toolName || spec.tool_name || null },
    };
  });
}

export function validateExecutablePlan(steps) {
  const enriched = enrichPlanSteps(steps);
  const errors = [];
  if (!enriched.length) errors.push('plan has no steps');
  for (let i = 0; i < enriched.length; i += 1) {
    const s = enriched[i];
    if (!EXECUTABLE_STEP_TYPES.includes(s.type)) errors.push(`step ${i}: unknown type ${s.type}`);
    if (!String(s.label || '').trim()) errors.push(`step ${i}: missing label`);
    if (s.type === 'agent_tool' && !String(s.tool_name || s.spec?.tool_name || '').trim()) {
      errors.push(`step ${i}: agent_tool missing tool_name`);
    }
    if (s.type === 'workflow_trigger' && !String(s.phrase || s.spec?.phrase || '').trim()) {
      errors.push(`step ${i}: workflow_trigger missing phrase`);
    }
    if (s.type === 'specialty_task' && !String(s.agent_id || s.spec?.agent_id || '').trim()) {
      errors.push(`step ${i}: specialty_task missing agent_id`);
    }
    if (!s.assigned_executor) errors.push(`step ${i}: missing executor`);
    if (!Array.isArray(s.depends_on)) errors.push(`step ${i}: missing dependencies`);
  }
  const executable = enriched.filter((s) => s.type !== 'notify_ceo');
  if (!executable.length && enriched.length) {
    // notify-only is still executable (exception notify)
  }
  return {
    ok: errors.length === 0 && enriched.length >= 1,
    errors,
    steps: enriched,
  };
}

/**
 * Observer → Decision. Recoverable failures retry then switch executor; otherwise escalate with a reason.
 * Never returns an empty action (no silent abandon).
 */
export function decideFromObservation({
  observation = {},
  failure = null,
  retryCount = 0,
  fallbackAvailable = false,
  failed = false,
  goalComplete = false,
} = {}) {
  if (goalComplete) {
    return { action: 'complete', reason: 'all_steps_terminal', ceo_required: false };
  }
  const classified =
    failure && failure.failure_class
      ? failure
      : failed
        ? classifyToolFailure({ message: observation.reason || observation.error || 'step failed' }, observation)
        : null;
  const retries = Number(retryCount || 0);
  const max = Number(classified?.bounded_retries || 2);

  if (classified && classified.failure_class === 'policy_denial') {
    return { action: 'escalate', reason: 'policy_denial', ceo_required: true, failure_class: classified.failure_class };
  }
  if (classified && classified.failure_class === 'auth') {
    return { action: 'escalate', reason: 'auth_failure', ceo_required: true, failure_class: classified.failure_class };
  }
  if (failed || classified) {
    if (classified?.retryable && retries < max) {
      return {
        action: 'retry',
        reason: classified.failure_class || 'transient',
        ceo_required: false,
        failure_class: classified.failure_class,
      };
    }
    if (fallbackAvailable && (classified?.retryable || classified?.fallback_tool || failed)) {
      return {
        action: 'switch_executor',
        reason: classified?.failure_class || 'primary_executor_failed',
        ceo_required: false,
        failure_class: classified?.failure_class || null,
      };
    }
    return {
      action: 'escalate',
      reason: classified?.failure_class || observation.reason || 'unrecoverable',
      ceo_required: true,
      failure_class: classified?.failure_class || null,
    };
  }

  const cls = String(observation.class || '').toLowerCase();
  if (cls === 'accepted' || cls === 'activity') {
    return { action: 'continue', reason: cls || 'advance', ceo_required: false };
  }
  if (cls === 'unknown' || cls === 'rejected') {
    return { action: 'continue', reason: cls, ceo_required: false, kpi_increment: false };
  }
  return { action: 'continue', reason: 'advance', ceo_required: false };
}

export function nextExecutorForStep(step, failedProviderIds = []) {
  const capId = step?.capability_id || step?.spec?.capability_id;
  if (capId) {
    const hit = resolveCapabilityExecutor(capId, { failedProviderIds });
    if (hit) return hit;
  }
  const fallback = step?.fallback_tool || step?.spec?.fallback_tool;
  if (fallback) return { id: fallback, kind: 'tool', tool_name: fallback, workflow_phrase: null };
  return null;
}

export function buildRetrospective({
  outcome = {},
  steps = [],
  events = [],
  status = 'completed',
  error = null,
  startedAt = null,
  completedAt = null,
} = {}) {
  const target = outcome.target != null ? Number(outcome.target) : null;
  const current = Number(outcome.current_value || 0);
  const achieved = status === 'completed' && (target == null || current >= target);
  const interventions = (events || []).filter((e) =>
    /re_plan|decision|policy_decision|escalate/i.test(String(e.event_type || e.payload?.action || ''))
  ).length;
  const evidence = (steps || [])
    .filter((s) => s.result || s.result_json)
    .map((s) => ({
      step_id: s.id,
      label: s.label,
      observation: s.result?.observation || null,
    }));
  const started = startedAt ? Date.parse(startedAt) : null;
  const ended = completedAt ? Date.parse(completedAt) : Date.now();
  const elapsed_ms = started && ended && ended >= started ? ended - started : 0;
  return {
    kpi_achieved: !!achieved,
    kpi: outcome.kpi || null,
    current_value: current,
    target,
    cost_usd: Number(outcome.spend_usd || 0),
    elapsed_ms,
    interventions,
    trace: (events || []).map((e) => e.event_type).filter(Boolean),
    evidence_count: evidence.length,
    evidence,
    error: error ? String(error).slice(0, 500) : null,
    status,
    summary: achieved
      ? 'KPI met or no numeric target; evidence recorded.'
      : status === 'failed'
        ? `Stopped: ${error || 'failed'}`
        : 'Completed with explained shortfall or open target.',
  };
}

/** 30 generic management intents for planner coverage. No customer-specific copy. */
export const MANAGEMENT_GOAL_BENCHMARK = Object.freeze([
  'Find 10 qualified leads for our B2B service this week.',
  'Add verified prospects to CRM after qualification. Never invent contact data.',
  'Prepare personalised outreach ready for my approval.',
  'Notify me only for exceptions or final approvals.',
  'Run CRM maker checker',
  'Run ERP maker checker for order to cash',
  'Create a sales invoice for the last order',
  'Record payment against the invoice',
  'Search the web for competitor pricing and summarize findings.',
  'Discover businesses near downtown for outreach.',
  'Create an internal Kanban task to follow up with the prospect.',
  'Summarize this URL https://example.com/about and notify the CEO.',
  'Draft an email but do not send without approval.',
  'Qualify verified records only. Never invent contact data.',
  'Collect 15 invoices this week and keep me informed of exceptions.',
  'Weekly status check and notify the CEO.',
  'Source qualified prospects and add only verified prospects to CRM.',
  'Browser research if web search is unavailable, then notify me.',
  'Find qualified leads. Exclude healthcare from now on. Keep spend under $50.',
  'Create CRM lead for a verified company in the pipeline.',
  'Qualified lead to CRM to approval to outreach: find leads, add verified to CRM, prepare outreach ready for my approval.',
  'Send the outreach after CEO approval.',
  'Move the Kanban card to done after the follow-up is written.',
  'Use company knowledge to answer policy questions, then notify the CEO.',
  'Over the next 5 business days, create 40 genuinely qualified prospects, add only verified prospects to CRM, prepare personalised outreach, and get at least 10 ready for my approval. Never invent contact data. Do not send any external message without approval. Keep total AI/tool spend under $75.',
  'Research the market then create CRM company then notify the CEO.',
  'How are tasks going? Run a weekly status check.',
  'Create a Kanban task for the CEO exception and notify the CEO.',
  'Enrich company from summarize this URL then add verified prospects to CRM.',
  'Find qualified leads, keep spend under $40, notify me only for exceptions.',
]);

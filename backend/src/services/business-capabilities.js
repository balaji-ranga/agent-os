/**
 * Thin business-capability map above existing tools/workflows.
 * COO requests capabilities; resolution picks a native tool or published workflow phrase.
 * Not a new runtime — aliases only. Patterns are generic (any vertical).
 */

export const BUSINESS_CAPABILITIES = Object.freeze([
  {
    id: 'find_lead',
    label: 'Find Lead',
    risk_tier: 'R0',
    tool_name: 'business_discover',
    workflow_phrase: null,
    patterns: [
      /find (?:qualified )?(?:leads?|prospects?|companies|customers)/i,
      /source (?:qualified )?(?:leads?|prospects?)/i,
      /discover (?:businesses|companies|leads)/i,
      /create \d+ (?:genuinely )?qualified prospects/i,
    ],
  },
  {
    id: 'qualify',
    label: 'Qualify',
    risk_tier: 'R0',
    tool_name: null,
    workflow_phrase: null,
    observer: true,
    patterns: [/qualif(?:y|ication)|never invent|verified (?:prospects?|leads?|records?)/i],
  },
  {
    id: 'upsert_crm',
    label: 'Create CRM Lead',
    risk_tier: 'R1',
    tool_name: 'crm_create_lead',
    workflow_phrase: 'run crm maker checker',
    patterns: [
      /add (?:only )?(?:verified )?(?:prospects?|leads?|companies) to crm/i,
      /upsert (?:to )?crm/i,
      /create crm (?:lead|company|person)/i,
      /\bcrm\b.{0,40}\b(lead|prospect|compan)/i,
    ],
  },
  {
    id: 'draft_outreach',
    label: 'Draft Outreach',
    risk_tier: 'R1',
    tool_name: 'kanban_create_task',
    workflow_phrase: null,
    patterns: [
      /prepare (?:personalised|personalized)?\s*outreach/i,
      /outreach drafts?/i,
      /ready for (?:my )?approval/i,
      /draft (?:an )?(?:email|outreach|message)/i,
    ],
  },
  {
    id: 'send_approved_outreach',
    label: 'Send Approved Outreach',
    risk_tier: 'R2',
    tool_name: 'email_send',
    workflow_phrase: null,
    patterns: [/send (?:the )?(?:outreach|email|message)(?! without)/i],
  },
  {
    id: 'notify_ceo',
    label: 'Notify CEO',
    risk_tier: 'R0',
    tool_name: 'notify_ceo',
    workflow_phrase: null,
    patterns: [/notify me only for exceptions|notify the ceo|final approvals/i],
  },
]);

export function resolveCapabilitiesFromPrompt(prompt) {
  const text = String(prompt || '');
  const hits = [];
  for (const cap of BUSINESS_CAPABILITIES) {
    const idx = firstMatchIndex(text, cap.patterns);
    if (idx < 0) continue;
    hits.push({ ...cap, _order: idx });
  }
  hits.sort((a, b) => a._order - b._order);
  return hits.map(({ _order, patterns, ...rest }) => rest);
}

export function capabilityStepsForPlan(prompt) {
  return resolveCapabilitiesFromPrompt(prompt)
    .filter((c) => c.tool_name || c.workflow_phrase)
    .map((c) => {
      if (c.workflow_phrase && c.id === 'upsert_crm') {
        return {
          type: 'workflow_trigger',
          label: c.label,
          phrase: c.workflow_phrase,
          phase: 'crm_phase',
          capability_id: c.id,
        };
      }
      if (c.tool_name === 'notify_ceo') {
        return { type: 'notify_ceo', label: c.label, capability_id: c.id };
      }
      return {
        type: 'agent_tool',
        label: c.label,
        tool_name: c.tool_name,
        capability_id: c.id,
        args: {},
      };
    });
}

export function mergeCapabilitySteps(existing, prompt) {
  const cap = capabilityStepsForPlan(prompt);
  if (!cap.length) return Array.isArray(existing) ? existing : [];
  const out = Array.isArray(existing) ? [...existing] : [];
  const hasWfPhrase = (phrase) =>
    out.some(
      (s) =>
        (s.type === 'workflow_trigger' || s.step_type === 'workflow_trigger') &&
        String(s.phrase || s.spec?.phrase || '').toLowerCase() === String(phrase || '').toLowerCase()
    );
  const hasTool = (name) =>
    out.some((s) => String(s.tool_name || s.spec?.tool_name || '').toLowerCase() === String(name || '').toLowerCase());
  const hasNotify = out.some((s) => (s.type || s.step_type) === 'notify_ceo');
  for (const step of cap) {
    if (step.type === 'workflow_trigger' && hasWfPhrase(step.phrase)) continue;
    if (step.type === 'notify_ceo' && hasNotify) continue;
    if (step.type === 'agent_tool' && hasTool(step.tool_name)) continue;
    out.push(step);
  }
  return out;
}

function firstMatchIndex(text, patterns) {
  let best = -1;
  for (const re of patterns || []) {
    const m = text.match(re);
    if (!m || m.index == null) continue;
    if (best < 0 || m.index < best) best = m.index;
  }
  return best;
}

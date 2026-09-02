/**
 * Thin business-capability map above existing tools/workflows.
 * COO requests capabilities; resolution picks a native tool or published workflow phrase.
 * Not a new runtime — aliases only. Patterns are generic (any vertical).
 */

function cap({
  id,
  label,
  risk_tier,
  tool_name = null,
  workflow_phrase = null,
  fallback_tool = null,
  providers = null,
  inputs = ['intent'],
  outputs = ['result'],
  expected_evidence = 'step_result',
  observer = false,
  executor_scope = 'granted_agent',
  patterns,
}) {
  const providerList =
    providers ||
    [
      tool_name ? { id: tool_name, kind: 'tool', tool_name, workflow_phrase: null } : null,
      workflow_phrase
        ? { id: workflow_phrase, kind: 'workflow', tool_name: null, workflow_phrase }
        : null,
      fallback_tool
        ? { id: fallback_tool, kind: 'tool', tool_name: fallback_tool, workflow_phrase: null }
        : null,
    ].filter(Boolean);
  return {
    id,
    label,
    risk_tier,
    tool_name: tool_name || providerList.find((p) => p.tool_name)?.tool_name || null,
    workflow_phrase:
      workflow_phrase || providerList.find((p) => p.workflow_phrase)?.workflow_phrase || null,
    fallback_tool: fallback_tool || providerList[1]?.tool_name || null,
    providers: providerList,
    inputs,
    outputs,
    expected_evidence,
    observer,
    executor_scope,
    patterns,
  };
}

export const BUSINESS_CAPABILITIES = Object.freeze([
  cap({
    id: 'find_lead',
    label: 'Find Lead',
    risk_tier: 'R0',
    tool_name: 'business_discover',
    fallback_tool: 'browse_task_start',
    inputs: ['intent', 'geo_or_icp'],
    outputs: ['candidates'],
    expected_evidence: 'source_urls_or_places',
    patterns: [
      /find (?:qualified )?(?:leads?|prospects?|companies|customers)/i,
      /source (?:qualified )?(?:leads?|prospects?)/i,
      /discover (?:businesses|companies|leads)/i,
      /create \d+ (?:genuinely )?qualified prospects/i,
    ],
  }),
  cap({
    id: 'web_research',
    label: 'Web Research',
    risk_tier: 'R0',
    tool_name: 'brave_web_search',
    fallback_tool: 'browse_task_start',
    inputs: ['query'],
    outputs: ['snippets'],
    expected_evidence: 'search_hits',
    patterns: [
      /search the web/i,
      /web search/i,
      /competitor pricing/i,
      /research (?:the )?(?:market|topic|web)/i,
    ],
  }),
  cap({
    id: 'enrich_company',
    label: 'Enrich Company',
    risk_tier: 'R0',
    tool_name: 'summarize_url',
    fallback_tool: 'browse_task_start',
    inputs: ['url_or_name'],
    outputs: ['summary'],
    expected_evidence: 'page_summary',
    patterns: [/summarize (?:this |the )?url/i, /enrich (?:the )?compan/i, /browser research/i],
  }),
  cap({
    id: 'qualify',
    label: 'Qualify',
    risk_tier: 'R0',
    observer: true,
    expected_evidence: 'verification_status',
    patterns: [/qualif(?:y|ication)|never invent|verified (?:prospects?|leads?|records?)/i],
  }),
  cap({
    id: 'upsert_crm',
    label: 'Create CRM Lead',
    risk_tier: 'R1',
    tool_name: 'crm_create_lead',
    workflow_phrase: 'run crm maker checker',
    inputs: ['verified_record'],
    outputs: ['crm_id'],
    expected_evidence: 'crm_object_id',
    patterns: [
      /add (?:only )?(?:verified )?(?:prospects?|leads?|companies) to crm/i,
      /upsert (?:to )?crm/i,
      /create crm (?:lead|company|person)/i,
      /\bcrm\b.{0,40}\b(lead|prospect|compan)/i,
    ],
  }),
  cap({
    id: 'draft_outreach',
    label: 'Draft Outreach',
    risk_tier: 'R1',
    tool_name: 'kanban_create_task',
    inputs: ['prospect'],
    outputs: ['draft_task'],
    expected_evidence: 'kanban_task_id',
    patterns: [
      /prepare (?:personalised|personalized)?\s*outreach/i,
      /outreach drafts?/i,
      /ready for (?:my )?approval/i,
      /draft (?:an )?(?:email|outreach|message)/i,
    ],
  }),
  cap({
    id: 'send_approved_outreach',
    label: 'Send Approved Outreach',
    risk_tier: 'R2',
    tool_name: 'email_send',
    inputs: ['draft', 'ceo_approved'],
    outputs: ['send_receipt'],
    expected_evidence: 'policy_allow',
    patterns: [
      /send (?:the )?(?:outreach|email|message)(?! without)/i,
      /send the outreach after ceo approval/i,
    ],
  }),
  cap({
    id: 'send_email',
    label: 'Send Email',
    risk_tier: 'R2',
    tool_name: 'email_send',
    inputs: ['recipient', 'subject', 'body_or_artifact'],
    outputs: ['send_receipt'],
    expected_evidence: 'message_id_or_send_receipt',
    patterns: [
      /\b(?:send|deliver|email|mail)\b[\s\S]{0,80}\b(?:email|mail|digest|report|summary|update)\b/i,
      /\b(?:daily|weekly|monthly)\b[\s\S]{0,60}\b(?:digest|report|status\s+update)\b[\s\S]{0,60}\b(?:email|mail)\b/i,
      /\b(?:email|mail)\b[\s\S]{0,60}\b(?:daily|weekly|monthly|digest|report|status\s+update)\b/i,
    ],
  }),
  cap({
    id: 'create_invoice',
    label: 'Create Invoice',
    risk_tier: 'R1',
    tool_name: 'erp_create_sales_invoice',
    workflow_phrase: 'run erp maker checker',
    inputs: ['order_or_customer'],
    outputs: ['draft_invoice'],
    expected_evidence: 'erp_docname',
    patterns: [
      /create (?:a )?sales invoice/i,
      /raise (?:an )?invoice/i,
      /collect \d+ invoices/i,
      /invoice for the last order/i,
    ],
  }),
  cap({
    id: 'record_payment',
    label: 'Record Payment',
    risk_tier: 'R1',
    tool_name: 'erp_create_payment_entry',
    workflow_phrase: 'run erp maker checker',
    inputs: ['invoice_ref'],
    outputs: ['payment_entry'],
    expected_evidence: 'erp_docname',
    patterns: [/record payment/i, /payment against the invoice/i, /mark invoice paid/i],
  }),
  cap({
    id: 'create_internal_task',
    label: 'Create Internal Task',
    risk_tier: 'R1',
    tool_name: 'kanban_create_task',
    inputs: ['title'],
    outputs: ['task_id'],
    expected_evidence: 'kanban_task_id',
    patterns: [
      /create an internal kanban task/i,
      /kanban task to follow up/i,
      /create a (?:kanban )?task/i,
    ],
  }),
  cap({
    id: 'move_kanban',
    label: 'Move Kanban Card',
    risk_tier: 'R1',
    tool_name: 'kanban_move_status',
    inputs: ['task_id', 'new_status'],
    outputs: ['status'],
    expected_evidence: 'kanban_status',
    patterns: [/move the kanban card/i, /mark (?:the )?card (?:as )?done/i, /kanban .{0,20}done/i],
  }),
  cap({
    id: 'status_digest',
    label: 'Status Digest',
    risk_tier: 'R0',
    tool_name: 'status_checker',
    inputs: ['scope'],
    outputs: ['digest'],
    expected_evidence: 'status_html',
    executor_scope: 'orchestrator_only',
    patterns: [
      /weekly status check/i,
      /status checker/i,
      /how are tasks going/i,
      /org status (?:update|digest)/i,
      /\b(?:daily|weekly|monthly)\b[\s\S]{0,50}\b(?:company|org(?:anisation|anization)?|team|agent|task|goal|workflow)?\s*status\b[\s\S]{0,40}\b(?:digest|report|update|summary|email)\b/i,
      /\bstatus\b[\s\S]{0,35}\b(?:digest|report|summary)\b/i,
    ],
  }),
  cap({
    id: 'search_knowledge',
    label: 'Search Knowledge',
    risk_tier: 'R0',
    tool_name: 'master_data_rag',
    fallback_tool: 'learnings_summary',
    inputs: ['query'],
    outputs: ['passages'],
    expected_evidence: 'doc_hits',
    patterns: [
      /company knowledge/i,
      /search (?:our |the )?knowledge/i,
      /master data rag/i,
      /answer policy questions/i,
    ],
  }),
  cap({
    id: 'notify_ceo',
    label: 'Notify CEO',
    risk_tier: 'R0',
    tool_name: 'notify_ceo',
    inputs: ['message'],
    outputs: ['notification_id'],
    expected_evidence: 'notify_receipt',
    patterns: [/notify me only for exceptions|notify the ceo|final approvals/i],
  }),
]);

export function getCapability(id) {
  return BUSINESS_CAPABILITIES.find((c) => c.id === String(id || '').trim()) || null;
}

export function resolveCapabilitiesFromPrompt(prompt) {
  const text = String(prompt || '');
  const hits = [];
  for (const cap of BUSINESS_CAPABILITIES) {
    // A requested draft is an internal artifact, not an instruction to send it.
    if (
      cap.id === 'send_email' &&
      /\b(?:draft|prepare|write|compose)\b[\s\S]{0,50}\b(?:email|mail)\b/i.test(text) &&
      !/\b(?:send|deliver|mail\s+it|email\s+it)\b/i.test(text)
    ) continue;
    const idx = firstRequestedMatchIndex(text, cap.patterns);
    if (idx < 0) continue;
    hits.push({ ...cap, _order: idx });
  }
  hits.sort((a, b) => a._order - b._order);
  return hits.map(({ _order, patterns, ...rest }) => rest);
}

/**
 * Next executor for a capability after some providers failed.
 * Goal-level capability id stays the same (provider substitution).
 */
export function resolveCapabilityExecutor(capabilityId, { failedProviderIds = [] } = {}) {
  const cap = getCapability(capabilityId);
  if (!cap) return null;
  const failed = new Set((failedProviderIds || []).map(String));
  const next = (cap.providers || []).find((p) => p.id && !failed.has(p.id) && !failed.has(p.tool_name || ''));
  return next || null;
}

export function capabilityStepsForPlan(prompt) {
  return resolveCapabilitiesFromPrompt(prompt)
    .filter((c) => c.tool_name || c.workflow_phrase)
    .map((c) => {
      if (c.workflow_phrase && (c.id === 'upsert_crm' || c.id === 'create_invoice' || c.id === 'record_payment')) {
        if (c.id === 'upsert_crm' || /maker checker/i.test(c.workflow_phrase)) {
          return {
            type: 'workflow_trigger',
            label: c.label,
            phrase: c.workflow_phrase,
            phase: c.id === 'upsert_crm' ? 'crm_phase' : 'erp_phase',
            capability_id: c.id,
            risk_tier: c.risk_tier,
            fallback_tool: c.fallback_tool || c.tool_name,
            expected_evidence: c.expected_evidence,
          };
        }
      }
      if (c.tool_name === 'notify_ceo') {
        return { type: 'notify_ceo', label: c.label, capability_id: c.id, risk_tier: c.risk_tier };
      }
      const fallback = (c.providers || []).find((p) => p.tool_name && p.tool_name !== c.tool_name);
      return {
        type: 'agent_tool',
        label: c.label,
        tool_name: c.tool_name,
        capability_id: c.id,
        risk_tier: c.risk_tier,
        fallback_tool: fallback?.tool_name || c.fallback_tool || null,
        expected_evidence: c.expected_evidence,
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
  const hasCap = (id) =>
    out.some((s) => String(s.capability_id || s.spec?.capability_id || '') === String(id || ''));
  for (const step of cap) {
    if (step.capability_id && hasCap(step.capability_id)) continue;
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

// Capability patterns describe possible actions, but a prohibition is a
// constraint rather than a request. Evaluate every pattern occurrence inside
// its punctuation-bounded clause and select the first non-negated occurrence.
// This applies uniformly to all capabilities; it is not tied to a product,
// tool, or vertical.
function firstRequestedMatchIndex(text, patterns) {
  let best = -1;
  for (const pattern of patterns || []) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    for (const match of String(text || '').matchAll(re)) {
      if (match.index == null) continue;
      const clauseStart = Math.max(
        String(text).lastIndexOf('.', match.index - 1),
        String(text).lastIndexOf(';', match.index - 1),
        String(text).lastIndexOf('\n', match.index - 1)
      ) + 1;
      const prefix = String(text).slice(clauseStart, match.index + match[0].length);
      if (/\b(?:do\s+not|don't|never|must\s+not|without)\b/i.test(prefix)) continue;
      if (best < 0 || match.index < best) best = match.index;
    }
  }
  return best;
}

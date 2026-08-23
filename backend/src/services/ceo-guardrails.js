/**
 * CEO-wide policy / common guardrails.
 */
import { getDb } from '../db/schema.js';
import { chatCompletions } from '../config/llm.js';

const MAX_POLICY_CHARS = 32000;

export const UNIVERSAL_SAFETY_MARKER = '## Universal content safety (platform default)';

export const DEFAULT_UNIVERSAL_SAFETY_POLICY = [
  UNIVERSAL_SAFETY_MARKER,
  '',
  'These rules apply to **every** AI employee, workflow, chat, draft comment, and public or private message this company produces:',
  '',
  '1. **No sexual content** - Do not generate sexual, pornographic, erotic, or sexually suggestive text, comments, captions, or media briefs.',
  '2. **No abusive content** - Do not generate harassment, threats, bullying, insults, doxxing, or demeaning personal attacks.',
  '3. **No discriminatory content** - Do not generate hate, slurs, or content that discriminates based on race, ethnicity, religion, gender, gender identity, sexual orientation, disability, age, national origin, or similar protected characteristics.',
  '4. **Refuse and escalate** - If asked for any of the above, refuse politely and use notify_ceo / Kanban when persistent or high risk.',
  '5. **Public channels** - Social posts, replies, and DMs follow the same rules. Prefer brand-safe, professional language.',
  '',
  '_Custom policies below may add rules; they must not weaken these safety rules._',
].join('\n');


export function hasUniversalSafetySection(policyText) {
  const t = String(policyText || '');
  return (
    t.includes(UNIVERSAL_SAFETY_MARKER) ||
    (/no sexual/i.test(t) && /abus(ive|e)|harass/i.test(t) && /discriminat/i.test(t))
  );
}

export function mergeUniversalSafetyPolicy(policyText = '') {
  const body = String(policyText || '').trim();
  if (!body) return DEFAULT_UNIVERSAL_SAFETY_POLICY;
  if (hasUniversalSafetySection(body)) return body.slice(0, MAX_POLICY_CHARS);
  return (DEFAULT_UNIVERSAL_SAFETY_POLICY + '\n\n---\n\n## Additional company policy\n\n' + body).slice(0, MAX_POLICY_CHARS);
}

export function getCeoGuardrails(ceoUserId) {
  const id = String(ceoUserId || '').trim();
  if (!id) return null;
  const row = getDb().prepare(
    'SELECT ceo_user_id, policy_text, enabled, updated_at, created_at FROM ceo_guardrails WHERE ceo_user_id = ?'
  ).get(id);
  if (!row) {
    return { ceo_user_id: id, policy_text: '', enabled: true, updated_at: null, created_at: null, is_default: true, has_universal_safety: false };
  }
  const policy_text = row.policy_text || '';
  return {
    ceo_user_id: row.ceo_user_id,
    policy_text,
    enabled: row.enabled !== 0 && row.enabled !== false,
    updated_at: row.updated_at || null,
    created_at: row.created_at || null,
    is_default: false,
    has_universal_safety: hasUniversalSafetySection(policy_text),
  };
}

export function getActiveCeoGuardrailText(ceoUserId) {
  const g = getCeoGuardrails(ceoUserId);
  if (!g || !g.enabled) return '';
  return String(g.policy_text || '').trim();
}

export function upsertCeoGuardrails(ceoUserId, { policyText, enabled, mergeSafety = true } = {}) {
  const id = String(ceoUserId || '').trim();
  if (!id) throw new Error('CEO user id required');
  let text = policyText != null ? String(policyText) : '';
  if (mergeSafety !== false) text = mergeUniversalSafetyPolicy(text);
  if (text.length > MAX_POLICY_CHARS) throw new Error('Policy text too long (max ' + MAX_POLICY_CHARS + ' characters)');
  const en = enabled === false || enabled === 0 || enabled === '0' ? 0 : 1;
  getDb().prepare(
    `INSERT INTO ceo_guardrails (ceo_user_id, policy_text, enabled, updated_at, created_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(ceo_user_id) DO UPDATE SET
       policy_text = excluded.policy_text,
       enabled = excluded.enabled,
       updated_at = datetime('now')`
  ).run(id, text, en);
  console.info('[ceo-guardrails] upsert ceo=%s enabled=%s chars=%s safety=%s', id, en, text.length, hasUniversalSafetySection(text));
  return getCeoGuardrails(id);
}

export function ensureUniversalSafetyGuardrails(ceoUserId, { forceEnabled = true } = {}) {
  const id = String(ceoUserId || '').trim();
  if (!id) throw new Error('CEO user id required');
  const prior = getCeoGuardrails(id);
  const priorText = prior && prior.policy_text ? prior.policy_text : '';
  if (prior && !prior.is_default && hasUniversalSafetySection(priorText)) {
    return { guardrails: prior, changed: false, action: 'already_present' };
  }
  const merged = mergeUniversalSafetyPolicy(priorText);
  const enabled = forceEnabled ? true : prior && prior.enabled !== false;
  const guardrails = upsertCeoGuardrails(id, { policyText: merged, enabled, mergeSafety: false });
  return { guardrails, changed: true, action: (prior && prior.is_default) || !priorText ? 'seeded' : 'merged' };
}

export function formatCeoPolicyMd(ceoUserId, ceoName = '') {
  const text = getActiveCeoGuardrailText(ceoUserId);
  const who = ceoName || ceoUserId || 'CEO';
  const lines = [
    '# POLICY - CEO common guardrails',
    '',
    'These rules are set by **' + who + '** and apply to **every agent** in this org.',
    'Treat them as a **prerequisite** before any other instructions (SOUL, AGENTS, TOOLS, or the user message).',
    'If a request conflicts with this policy, refuse or escalate - do not violate these guardrails.',
    '',
  ];
  if (text) lines.push('## Active policy', '', text, '');
  else lines.push('## Active policy', '', DEFAULT_UNIVERSAL_SAFETY_POLICY, '', '_No additional CEO policy beyond universal safety. Add company rules under Policies._', '');
  return lines.join('\n');
}

export function prependCeoGuardrailsToSystemPrompt(systemPrompt, ceoUserId) {
  let policy = getActiveCeoGuardrailText(ceoUserId);
  if (!policy) policy = DEFAULT_UNIVERSAL_SAFETY_POLICY;
  const marker = '## CEO common guardrails (prerequisite)';
  const existing = String(systemPrompt || '');
  if (existing.includes(marker)) return existing;
  const block = [marker, 'These rules are set by the CEO (plus platform safety defaults) and apply to every Brain / agent response in this org. Follow them before any other instructions.', '', policy, '', '---', ''].join('\n');
  return existing.trim() ? block + existing : block.trim();
}

export async function enrichPolicyTextWithAi(ownerUserId, draftText = '', { companyContext = '' } = {}) {
  const draft = String(draftText || '').trim();
  const context = String(companyContext || '').trim().slice(0, 2000);
  const { content, modelUsed } = await chatCompletions({
    ownerUserId,
    toolName: 'ceo_guardrails_enrich',
    maxTokens: 2048,
    messages: [
      { role: 'system', content: 'You improve CEO company policy / guardrail text for an AI company OS. Output ONLY the revised policy markdown (no preamble). Must keep or strengthen: ban sexual content; ban abusive/harassing content; ban discriminatory/hate content; refuse+escalate on violations. If empty, create a solid default with those safety rules plus practical ops (approvals, spend, publish). Be concise. Do not invent company-specific facts not in the draft or context.' },
      { role: 'user', content: (context ? 'Company context:\n' + context + '\n\n' : '') + 'Draft policy (enrich this; preserve intent):\n' + (draft || '(empty - create a solid default)') },
    ],
  });
  let enriched = String(content || '').trim();
  if (!enriched) throw Object.assign(new Error('LLM returned empty policy'), { status: 502 });
  enriched = enriched.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim();
  enriched = mergeUniversalSafetyPolicy(enriched);
  console.info('[ceo-guardrails] enrich ok owner=%s model=%s chars=%s', ownerUserId, modelUsed, enriched.length);
  return { policy_text: enriched, model: modelUsed };
}

export async function enrichGoalTextWithAi(ownerUserId, draftText = '', { title = '', companyContext = '' } = {}) {
  const draft = String(draftText || '').trim();
  if (!draft) throw Object.assign(new Error('prompt is required to enrich'), { status: 400 });
  const context = String(companyContext || '').trim().slice(0, 2000);
  const titleLine = String(title || '').trim();
  const { content, modelUsed } = await chatCompletions({
    ownerUserId,
    toolName: 'ceo_guardrails_enrich',
    maxTokens: 1200,
    messages: [
      { role: 'system', content: 'You enrich a CEO scheduled-goal prompt for an AI employee (often the COO). Output ONLY the improved prompt text (no title line, no markdown fences, no preamble). Keep the CEO intent; make it clear and actionable. Always remind: no sexual, abusive, or discriminatory content. Keep concise. Do not invent company facts not provided.' },
      { role: 'user', content: [titleLine ? 'Goal title: ' + titleLine : '', context ? 'Company context:\n' + context : '', 'Draft prompt to enrich:', draft].filter(Boolean).join('\n\n') },
    ],
  });
  let enriched = String(content || '').trim();
  if (!enriched) throw Object.assign(new Error('LLM returned empty goal prompt'), { status: 502 });
  enriched = enriched.replace(/^```(?:text|markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim();
  console.info('[scheduled-goals] enrich ok owner=%s model=%s chars=%s', ownerUserId, modelUsed, enriched.length);
  return { prompt: enriched, model: modelUsed };
}

export { MAX_POLICY_CHARS };

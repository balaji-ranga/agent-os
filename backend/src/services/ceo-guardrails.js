/**
 * CEO-wide policy / common guardrails — set once, applied to all agents + Brain nodes.
 */
import { getDb } from '../db/schema.js';

const MAX_POLICY_CHARS = 32_000;

export function getCeoGuardrails(ceoUserId) {
  const id = String(ceoUserId || '').trim();
  if (!id) return null;
  const row = getDb()
    .prepare(
      `SELECT ceo_user_id, policy_text, enabled, updated_at, created_at
       FROM ceo_guardrails WHERE ceo_user_id = ?`
    )
    .get(id);
  if (!row) {
    return {
      ceo_user_id: id,
      policy_text: '',
      enabled: true,
      updated_at: null,
      created_at: null,
      is_default: true,
    };
  }
  return {
    ceo_user_id: row.ceo_user_id,
    policy_text: row.policy_text || '',
    enabled: row.enabled !== 0 && row.enabled !== false,
    updated_at: row.updated_at || null,
    created_at: row.created_at || null,
    is_default: false,
  };
}

/** Active policy text for injection (empty if disabled / blank). */
export function getActiveCeoGuardrailText(ceoUserId) {
  const g = getCeoGuardrails(ceoUserId);
  if (!g?.enabled) return '';
  return String(g.policy_text || '').trim();
}

export function upsertCeoGuardrails(ceoUserId, { policyText, enabled } = {}) {
  const id = String(ceoUserId || '').trim();
  if (!id) throw new Error('CEO user id required');
  let text = policyText != null ? String(policyText) : '';
  if (text.length > MAX_POLICY_CHARS) {
    throw new Error(`Policy text too long (max ${MAX_POLICY_CHARS} characters)`);
  }
  const en = enabled === false || enabled === 0 || enabled === '0' ? 0 : 1;
  getDb()
    .prepare(
      `INSERT INTO ceo_guardrails (ceo_user_id, policy_text, enabled, updated_at, created_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(ceo_user_id) DO UPDATE SET
         policy_text = excluded.policy_text,
         enabled = excluded.enabled,
         updated_at = datetime('now')`
    )
    .run(id, text, en);
  return getCeoGuardrails(id);
}

/** Markdown written to every tenant workspace as POLICY.md */
export function formatCeoPolicyMd(ceoUserId, ceoName = '') {
  const text = getActiveCeoGuardrailText(ceoUserId);
  const who = ceoName || ceoUserId || 'CEO';
  const lines = [
    '# POLICY — CEO common guardrails',
    '',
    `These rules are set by **${who}** and apply to **every agent** in this org.`,
    'Treat them as a **prerequisite** before any other instructions (SOUL, AGENTS, TOOLS, or the user message).',
    'If a request conflicts with this policy, refuse or escalate — do not violate these guardrails.',
    '',
  ];
  if (text) {
    lines.push('## Active policy', '', text, '');
  } else {
    lines.push(
      '## Active policy',
      '',
      '_No custom CEO policy is configured yet. Follow platform defaults and your SOUL.md._',
      ''
    );
  }
  return lines.join('\n');
}

/**
 * Prepend CEO guardrails to a Brain (or other) system prompt.
 * Idempotent if the same block is already present.
 */
export function prependCeoGuardrailsToSystemPrompt(systemPrompt, ceoUserId) {
  const policy = getActiveCeoGuardrailText(ceoUserId);
  if (!policy) return systemPrompt || '';
  const marker = '## CEO common guardrails (prerequisite)';
  const existing = String(systemPrompt || '');
  if (existing.includes(marker)) return existing;
  const block = [
    marker,
    'These rules are set by the CEO and apply to every Brain / agent response in this org. Follow them before any other instructions.',
    '',
    policy,
    '',
    '---',
    '',
  ].join('\n');
  return existing.trim() ? `${block}${existing}` : block.trim();
}

export { MAX_POLICY_CHARS };

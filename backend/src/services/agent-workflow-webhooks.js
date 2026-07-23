import { timingSafeEqual } from 'crypto';
import { getPublicBaseUrl } from '../config/public-url.js';
import { getDb } from '../db/schema.js';
import * as store from './agent-workflow-store.js';
import { startAgentWorkflowRun } from './agent-workflow-runner.js';
import { isUserEnabled } from './user-enabled.js';

function db() {
  return getDb();
}

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyHookSecret(definitionId, providedSecret) {
  const row = db().prepare('SELECT webhook_secret, trigger_modes, owner_user_id FROM agent_workflow_definitions WHERE id = ?').get(definitionId);
  if (!row) return { ok: false, error: 'Workflow not found' };
  const modes = String(row.trigger_modes || '')
    .split(',')
    .map((s) => s.trim());
  if (!modes.includes('event')) return { ok: false, error: 'Event trigger is disabled for this workflow' };
  if (!row.webhook_secret) return { ok: false, error: 'Webhook secret not configured — re-save triggers with event mode enabled' };
  if (!secretsMatch(providedSecret, row.webhook_secret)) {
    return { ok: false, error: 'Invalid hook secret' };
  }
  return { ok: true, ownerUserId: row.owner_user_id };
}

export async function triggerWorkflowFromHook(definitionId, payload = {}, { actor = null } = {}) {
  const row = db().prepare('SELECT owner_user_id, status, paused FROM agent_workflow_definitions WHERE id = ?').get(definitionId);
  if (!row) throw new Error('Workflow not found');
  if (row.paused) throw new Error('Workflow is paused');
  if (!isUserEnabled(row.owner_user_id)) {
    throw new Error('Owner account is disabled — event triggers are stopped');
  }
  // Pass object through so optional input_schema can validate structured JSON.
  const input = typeof payload === 'string' ? payload : payload ?? {};
  return startAgentWorkflowRun(definitionId, row.owner_user_id, {
    trigger: 'event',
    input,
    actor: actor || { id: 'event-hook', name: 'Event hook', type: 'system' },
  });
}

export function hookUrlForDefinition(definitionId, baseUrl) {
  const base = String(baseUrl || getPublicBaseUrl()).replace(/\/$/, '');
  return `${base}/api/agent-workflows/hooks/${definitionId}`;
}

export function getHookInfo(definitionId, ownerUserId) {
  const def = store.getDefinition(definitionId, ownerUserId);
  if (!def) return null;
  const secret = def.trigger_modes?.includes('event') ? store.ensureWebhookSecret(definitionId) : def.webhook_secret || null;
  return {
    hook_url: hookUrlForDefinition(definitionId),
    email_inbound_url: emailInboundUrlForDefinition(definitionId),
    webhook_secret: secret,
    trigger_modes: def.trigger_modes,
    event_enabled: !!def.trigger_modes?.includes('event'),
  };
}

export function emailInboundUrlForDefinition(definitionId, baseUrl) {
  const base = String(baseUrl || getPublicBaseUrl()).replace(/\/$/, '');
  return `${base}/api/integrations/email-inbound/${definitionId}`;
}

/**
 * Enable event trigger + ensure webhook secret; return hook registration info.
 * Owner-scoped — caller must pass entitled ownerUserId.
 */
export function registerEventHook(definitionId, ownerUserId, actor = null) {
  const def = store.getDefinition(definitionId, ownerUserId);
  if (!def) return null;

  const modes = new Set(def.trigger_modes || ['manual']);
  modes.add('event');
  if (!modes.has('manual')) modes.add('manual');

  const updated = store.updateTriggers(
    definitionId,
    ownerUserId,
    { trigger_modes: [...modes] },
    actor || { id: ownerUserId, name: 'hook-register', type: 'user' }
  );
  if (!updated) return null;

  const secret = store.ensureWebhookSecret(definitionId);
  store.appendAudit(definitionId, {
    action: 'hook_registered',
    summary: 'Event webhook registered',
    changedBy: actor?.id || ownerUserId,
    changedByName: actor?.name || 'user',
    diff: { hook_url: hookUrlForDefinition(definitionId) },
  });

  return {
    ...getHookInfo(definitionId, ownerUserId),
    webhook_secret: secret,
    registered: true,
  };
}

/**
 * Normalize common inbound-email provider payloads into a workflow event body.
 * Email receive is delivered as an HTTP webhook (SendGrid/Mailgun/generic JSON) — not IMAP.
 */
export function normalizeEmailInboundPayload(body = {}, headers = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const from =
    b.from ||
    b.sender ||
    b.From ||
    b.envelope?.from ||
    (Array.isArray(b.from) ? b.from[0] : null) ||
    '';
  const to = b.to || b.To || b.recipient || b.envelope?.to || '';
  const subject = b.subject || b.Subject || '';
  const text =
    b.text ||
    b['body-plain'] ||
    b.plain ||
    b.stripped_text ||
    b.textBody ||
    (typeof b.body === 'string' ? b.body : '') ||
    '';
  const html = b.html || b['body-html'] || b.stripped_html || b.htmlBody || '';
  return {
    event_type: 'email.received',
    from: String(from || ''),
    to: String(to || ''),
    subject: String(subject || ''),
    text: String(text || ''),
    html: String(html || ''),
    message_id: String(b.messageId || b['Message-Id'] || b['message-id'] || headers['message-id'] || ''),
    raw: b,
    received_at: new Date().toISOString(),
  };
}

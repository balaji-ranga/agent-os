/**
 * Generic outbound announce to a CEO's bound agent channels (WhatsApp / Slack).
 * Used by scheduled-goal outcome fan-out — not a new content tool and not a goal-plan step.
 * Unpaired / missing DM target: skip + log; never fail the originating goal.
 */
import { getDb } from '../db/schema.js';
import { getUserById } from './users.js';
import { openclawAdminRpc } from '../gateway/openclaw-admin-rpc.js';
import { channelBindingIds } from './openclaw-channels-config.js';
import {
  listAgentChannels,
  isWhatsAppSessionPaired,
} from './ceo-agent-channels.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';

export const CHANNEL_DELIVER_OPTIONS = ['web', 'whatsapp', 'slack'];
const MAX_TEXT_CHARS = 3500;
const SEND_METHODS = ['send', 'message.send'];
const UNKNOWN_RPC_METHOD =
  /unknown method|not (found|allowed|supported)|invalid method|is not supported/i;

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

/** Always includes web. Accepts array, JSON string, comma list, or also_whatsapp flags. */
export function normalizeDeliverTo(raw, extras = {}) {
  const set = new Set(['web']);
  const add = (v) => {
    const s = String(v || '').trim().toLowerCase();
    if (!s || s === 'web') return;
    if (s === 'wa' || s === 'whats-app') set.add('whatsapp');
    else if (CHANNEL_DELIVER_OPTIONS.includes(s)) set.add(s);
  };
  if (Array.isArray(raw)) raw.forEach(add);
  else if (typeof raw === 'string' && raw.trim()) {
    const t = raw.trim();
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) parsed.forEach(add);
      else t.split(/[\s,;]+/).forEach(add);
    } catch {
      t.split(/[\s,;]+/).forEach(add);
    }
  }
  const truthy = (v) => v === true || v === 1 || String(v).toLowerCase() === 'true';
  const falsy = (v) => v === false || v === 0 || String(v).toLowerCase() === 'false';
  if (truthy(extras.also_whatsapp) || truthy(extras.deliver_whatsapp) || truthy(extras.whatsapp)) {
    set.add('whatsapp');
  }
  if (truthy(extras.also_slack) || truthy(extras.deliver_slack) || truthy(extras.slack)) {
    set.add('slack');
  }
  if (falsy(extras.also_whatsapp) || falsy(extras.deliver_whatsapp)) set.delete('whatsapp');
  if (falsy(extras.also_slack) || falsy(extras.deliver_slack)) set.delete('slack');
  return ['web', ...CHANNEL_DELIVER_OPTIONS.filter((c) => c !== 'web' && set.has(c))];
}

export function deliverToIncludes(deliverTo, channel) {
  const list = Array.isArray(deliverTo) ? deliverTo : normalizeDeliverTo(deliverTo);
  return list.includes(String(channel || '').toLowerCase());
}

export function splitMediaLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const mediaLines = [];
  const rest = [];
  for (const line of lines) {
    const m = String(line || '').trim().match(/^MEDIA:\s*(.+)$/i);
    if (m) mediaLines.push(`MEDIA:${m[1].trim()}`);
    else rest.push(line);
  }
  return { body: rest.join('\n').trim(), mediaLines };
}

export function resolveAgentDisplayName(ownerUserId, agentId) {
  const id = String(agentId || '').trim();
  if (!id) return 'AI employee';
  const db = getDb();
  const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(id);
  const name = String(agent?.name || '').trim();
  return name || id || 'AI employee';
}

/** First line `From: {name}` on the text body; MEDIA: lines stay alone. Idempotent. */
export function prefixFromAgentName(text, agentName) {
  const name = String(agentName || '').trim() || 'AI employee';
  const header = `From: ${name}`;
  const { body, mediaLines } = splitMediaLines(text);
  const first = (body.split('\n').find((l) => String(l).trim()) || '').trim();
  const prefixed = /^From:\s+/i.test(first) ? body : [header, '', body].join('\n').trim();
  const clipped = prefixed.length > MAX_TEXT_CHARS ? `${prefixed.slice(0, MAX_TEXT_CHARS)}…` : prefixed;
  const media = mediaLines.length ? `\n\n${mediaLines.join('\n')}` : '';
  return `${clipped}${media}`.trim();
}

function normalizeWhatsAppTarget(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (/@g\.us$/i.test(s) || /@newsletter$/i.test(s)) return '';
  s = s.replace(/^whatsapp:/i, '').replace(/@s\.whatsapp\.net$/i, '').replace(/@c\.us$/i, '');
  s = s.replace(/[\s()-]/g, '');
  if (/^\d{8,15}$/.test(s)) return `+${s}`;
  if (/^\+\d{8,15}$/.test(s)) return s;
  return '';
}

function firstAllowFromTarget(config, channel) {
  const list = Array.isArray(config?.allowFrom) ? config.allowFrom : [];
  for (const item of list) {
    if (channel === 'whatsapp') {
      const t = normalizeWhatsAppTarget(item);
      if (t) return t;
    } else {
      const t = String(item || '').trim();
      if (t) return t;
    }
  }
  return '';
}

function ceoMobileTarget(ownerUserId) {
  try {
    const user = getUserById(ownerUserId);
    return normalizeWhatsAppTarget(user?.mobile || '');
  } catch {
    return '';
  }
}

function findBoundChannel(ownerUserId, agentId, channel) {
  const list = listAgentChannels(ownerUserId, { agentId }) || [];
  return list.find((c) => String(c.channel || '').toLowerCase() === String(channel).toLowerCase()) || null;
}

function channelReadyForOutbound(row, ownerUserId, agentId, channel) {
  if (!row) return { ok: false, reason: 'no_channel' };
  const status = String(row.status || '').toLowerCase();
  if (status === 'disabled' || status === 'draft') {
    return { ok: false, reason: `status_${status}` };
  }
  if (channel === 'whatsapp') {
    let paired = false;
    try {
      paired = isWhatsAppSessionPaired(ownerUserId, agentId);
    } catch (e) {
      return { ok: false, reason: e?.message || 'pair_check_failed' };
    }
    if (!paired && status !== 'enabled') {
      return { ok: false, reason: 'unpaired' };
    }
    if (!paired) return { ok: false, reason: 'unpaired' };
  }
  if (status === 'pairing' && channel !== 'whatsapp') {
    return { ok: false, reason: 'status_pairing' };
  }
  return { ok: true };
}

/**
 * Resolve outbound target for an agent's bound channel.
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, to?: string, accountId?: string, channelRow?: object }}
 */
export function resolveAgentChannelTarget(ownerUserId, agentId, channel) {
  const ch = String(channel || '').toLowerCase();
  if (ch !== 'whatsapp' && ch !== 'slack') {
    return { ok: false, skipped: true, reason: 'unsupported_channel' };
  }
  const row = findBoundChannel(ownerUserId, agentId, ch);
  const ready = channelReadyForOutbound(row, ownerUserId, agentId, ch);
  if (!ready.ok) return { ok: false, skipped: true, reason: ready.reason };
  let to = firstAllowFromTarget(row.config || {}, ch);
  if (!to && ch === 'whatsapp') to = ceoMobileTarget(ownerUserId);
  if (!to) {
    return { ok: false, skipped: true, reason: 'no_dm_target' };
  }
  const agent = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return { ok: false, skipped: true, reason: 'no_agent' };
  let accountId;
  try {
    accountId = channelBindingIds(ownerUserId, agent).accountId;
  } catch (e) {
    return { ok: false, skipped: true, reason: e?.message || 'account_id' };
  }
  return { ok: true, to, accountId, channelRow: row };
}

function gatewayUrlAndToken() {
  const base = String(process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789').replace(/\/$/, '');
  const token =
    process.env.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_PASSWORD || '';
  return { base, token };
}

/** OpenClaw admin HTTP RPC does not expose send — use the native `message` tool. */
async function sendViaMessageTool({ channel, to, accountId, message, mediaUrls, idempotencyKey }) {
  const { base, token } = gatewayUrlAndToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const args = {
    action: 'send',
    channel,
    accountId,
    to,
    text: message,
    message,
    idempotencyKey: String(idempotencyKey || '').slice(0, 200) || undefined,
  };
  if (Array.isArray(mediaUrls) && mediaUrls.length) {
    args.media = mediaUrls[0];
    args.mediaUrls = mediaUrls;
  }
  const res = await fetch(`${base}/tools/invoke`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool: 'message', agentId: accountId, args }),
    signal: AbortSignal.timeout(45000),
  });
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: raw };
  }
  if (!res.ok) {
    const errMsg = data?.error?.message || data?.error || data?.message || raw || res.statusText;
    throw new Error(`tools.invoke message: ${errMsg}`);
  }
  const status = String(data?.result?.status || data?.status || '').toLowerCase();
  if (status === 'error' || status === 'failed') {
    throw new Error(data?.result?.message || data?.message || 'message tool failed');
  }
  return { ok: true, method: 'tools.invoke:message', result: data?.result || data };
}

async function sendViaOpenClaw({ channel, to, accountId, message, mediaUrls, idempotencyKey }) {
  try {
    return await sendViaMessageTool({ channel, to, accountId, message, mediaUrls, idempotencyKey });
  } catch (e) {
    console.warn('[channel-announce] message tool failed: %s', e?.message || e);
  }
  const params = {
    to,
    message,
    channel,
    accountId,
    idempotencyKey: String(idempotencyKey || '').slice(0, 200) || undefined,
  };
  if (Array.isArray(mediaUrls) && mediaUrls.length) {
    params.mediaUrls = mediaUrls;
    params.mediaUrl = mediaUrls[0];
  }
  let lastErr = null;
  for (const method of SEND_METHODS) {
    try {
      const data = await openclawAdminRpc(method, params, { timeoutMs: 45000 });
      return { ok: true, method, result: data?.payload || data };
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const unknown = UNKNOWN_RPC_METHOD.test(msg);
      console.warn('[channel-announce] send method=%s failed: %s', method, msg);
      if (!unknown) break;
    }
  }
  throw lastErr || new Error('channel send failed');
}

/**
 * Announce already-produced text on one bound channel. Never throws.
 */
export async function announceOnAgentChannel({
  ownerUserId,
  agentId,
  channel,
  text,
  idempotencyKey,
} = {}) {
  const ch = String(channel || '').toLowerCase();
  try {
    const resolved = resolveAgentChannelTarget(ownerUserId, agentId, ch);
    if (!resolved.ok) {
      console.info('[channel-announce] skip', {
        owner: ownerUserId,
        agent: agentId,
        channel: ch,
        reason: resolved.reason,
      });
      return { ok: true, skipped: true, reason: resolved.reason, channel: ch };
    }
    const agentName = resolveAgentDisplayName(ownerUserId, agentId);
    const prefixed = prefixFromAgentName(text, agentName);
    const { body, mediaLines } = splitMediaLines(prefixed);
    const mediaUrls = mediaLines
      .map((line) => String(line).replace(/^MEDIA:/i, '').trim())
      .filter((p) => p && !/^https?:\/\//i.test(p));
    try {
      ensureTenantOpenClawAgent(
        getDb().prepare('SELECT * FROM agents WHERE id = ?').get(agentId),
        ownerUserId
      );
    } catch (_) {}
    const sent = await sendViaOpenClaw({
      channel: ch,
      to: resolved.to,
      accountId: resolved.accountId,
      message: body,
      mediaUrls,
      idempotencyKey,
    });
    console.info('[channel-announce] sent', {
      owner: ownerUserId,
      agent: agentId,
      channel: ch,
      method: sent.method,
      to: String(resolved.to).replace(/\d(?=\d{4})/g, '•'),
    });
    return { ok: true, channel: ch, method: sent.method, to_set: true };
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn('[channel-announce] failed', {
      owner: ownerUserId,
      agent: agentId,
      channel: ch,
      err: msg,
    });
    return { ok: false, skipped: true, reason: 'send_failed', error: msg, channel: ch };
  }
}

export function loadScheduledGoalDeliverTo(ownerUserId, scheduledGoalId) {
  const id = String(scheduledGoalId || '').trim();
  const owner = String(ownerUserId || '').trim();
  if (!id || !owner) return ['web'];
  const row = getDb()
    .prepare('SELECT deliver_to FROM scheduled_goals WHERE id = ? AND owner_user_id = ?')
    .get(id, owner);
  if (!row) return ['web'];
  return normalizeDeliverTo(row.deliver_to);
}

/**
 * Fan-out a finished scheduled-goal (or bound goal-plan) outcome.
 * Web is already written by the caller. WhatsApp/Slack are opt-in on deliver_to.
 */
export async function deliverScheduledGoalOutcome({
  ownerUserId,
  agentId,
  deliverTo = null,
  scheduledGoalId = null,
  text,
  sourceKey,
} = {}) {
  const targets = deliverTo
    ? normalizeDeliverTo(deliverTo)
    : loadScheduledGoalDeliverTo(ownerUserId, scheduledGoalId);
  const channels = targets.filter((c) => c !== 'web');
  if (!channels.length) {
    return { ok: true, skipped: true, reason: 'web_only', deliver_to: targets };
  }
  const body = String(text || '').trim();
  if (!body) {
    console.info('[channel-announce] skip empty body', { owner: ownerUserId, agent: agentId });
    return { ok: true, skipped: true, reason: 'empty_body', deliver_to: targets };
  }
  const results = [];
  for (const channel of channels) {
    results.push(
      await announceOnAgentChannel({
        ownerUserId,
        agentId,
        channel,
        text: body,
        idempotencyKey: sourceKey ? `${sourceKey}:${channel}` : undefined,
      })
    );
  }
  return { ok: true, deliver_to: targets, results };
}

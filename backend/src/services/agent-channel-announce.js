/**
 * Generic outbound announce to a CEO's bound agent channels (WhatsApp / Slack).
 * Used by scheduled-goal outcome fan-out — not a new content tool and not a goal-plan step.
 * Unpaired / missing DM target: skip + log; never fail the originating goal.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, extname, join, normalize, sep } from 'path';
import { getDb } from '../db/schema.js';
import { getUserById } from './users.js';
import { openclawAdminRpc } from '../gateway/openclaw-admin-rpc.js';
import { channelBindingIds } from './openclaw-channels-config.js';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import {
  listAgentChannels,
  isWhatsAppSessionPaired,
} from './ceo-agent-channels.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import { getCeoGeneratedMediaDir } from './content-explorer.js';
import { toWhatsAppSafeAudio } from './audio-convert.js';

export const CHANNEL_DELIVER_OPTIONS = ['web', 'whatsapp', 'slack'];
const MAX_TEXT_CHARS = 3500;
/** Stay under OpenClaw `/tools/invoke` ~2MB JSON body after base64. */
const MAX_MEDIA_BUFFER_BYTES = 1_200_000;
const SEND_METHODS = ['send', 'message.send'];
const UNKNOWN_RPC_METHOD =
  /unknown method|not (found|allowed|supported)|invalid method|is not supported/i;
const AUDIO_EXT = /\.(ogg|opus|mp3|m4a|wav|aac)$/i;
const VOICE_EXT = /\.(ogg|opus)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const WHATSAPP_VOICE_MIME = 'audio/ogg; codecs=opus';
/** MEDIA: absolute/sandbox path, including markdown `(MEDIA:/…)` and inline prose. */
const MEDIA_PATH_RE = /MEDIA:\s*((?:\/|sandbox:)[^\s)\]"'<>]+)/gi;
const RECENT_AUDIO_MAX_AGE_MS = 3 * 60 * 1000;
const RECENT_AUDIO_LIMIT = 4;

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
  const src = String(text || '');
  const mediaLines = [];
  const seen = new Set();
  const add = (raw) => {
    let p = String(raw || '').trim().replace(/^MEDIA:\s*/i, '');
    p = p.replace(/[)\].,;]+$/g, '');
    if (!p) return;
    const line = `MEDIA:${p}`;
    if (seen.has(line)) return;
    seen.add(line);
    mediaLines.push(line);
  };
  for (const line of src.split(/\r?\n/)) {
    const m = String(line || '').trim().match(/^MEDIA:\s*(.+)$/i);
    if (m) add(m[1]);
  }
  MEDIA_PATH_RE.lastIndex = 0;
  let m;
  while ((m = MEDIA_PATH_RE.exec(src))) add(m[1]);
  const body = src
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*MEDIA:\s*/i.test(line)) return '';
      return String(line || '')
        .replace(MEDIA_PATH_RE, '')
        .replace(/\[[^\]]*\]\(\s*\)/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .trimEnd();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { body, mediaLines };
}

/** Recent TTS/audio under this CEO's generated media dir (scheduled-goal copy fallback). */
export function recentOwnerGeneratedAudioLines(
  ownerUserId,
  { maxAgeMs = RECENT_AUDIO_MAX_AGE_MS, limit = RECENT_AUDIO_LIMIT } = {}
) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  let dir;
  try {
    dir = getCeoGeneratedMediaDir(owner);
  } catch {
    return [];
  }
  if (!dir || !existsSync(dir)) return [];
  const now = Date.now();
  const files = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!AUDIO_EXT.test(name)) continue;
      const abs = join(dir, name);
      try {
        const st = statSync(abs);
        if (!st.isFile() || st.size <= 0) continue;
        if (now - st.mtimeMs > maxAgeMs) continue;
        files.push({ abs, mtime: st.mtimeMs });
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    return [];
  }
  files.sort((a, b) => a.mtime - b.mtime);
  return files.slice(-Math.max(1, limit)).map((f) => `MEDIA:${f.abs}`);
}

export function mediaKindFromPath(filePath) {
  const name = basename(String(filePath || ''));
  if (AUDIO_EXT.test(name)) return 'audio';
  if (IMAGE_EXT.test(name)) return 'image';
  if (VIDEO_EXT.test(name)) return 'video';
  return 'file';
}

export function mimeTypeForMediaPath(filePath) {
  const name = basename(String(filePath || '')).toLowerCase();
  if (name.endsWith('.ogg') || name.endsWith('.opus')) return WHATSAPP_VOICE_MIME;
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.m4a')) return 'audio/mp4';
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.aac')) return 'audio/aac';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.mov')) return 'video/quicktime';
  return 'application/octet-stream';
}

function isWhatsAppVoicePath(filePath) {
  return VOICE_EXT.test(basename(String(filePath || '')));
}

/** Only AgentSystem media store paths — never arbitrary disk from agent text. */
export function resolveAnnounceMediaFile(mediaLine) {
  const raw = String(mediaLine || '').replace(/^MEDIA:\s*/i, '').trim();
  if (!raw || /^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return null;
  const abs = normalize(raw);
  const root = normalize(getOpenClawMediaDir());
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (abs !== root && !abs.startsWith(rootPrefix)) return null;
  if (!existsSync(abs)) return null;
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size <= 0) return null;
    const kind = mediaKindFromPath(abs);
    return {
      path: abs,
      bytes: st.size,
      kind,
      filename: basename(abs),
      mimeType: mimeTypeForMediaPath(abs),
      asVoice: kind === 'audio' && isWhatsAppVoicePath(abs),
    };
  } catch {
    return null;
  }
}

async function ensureWhatsAppAudioFile(file) {
  if (!file || file.kind !== 'audio') return file;
  if (file.asVoice && String(file.mimeType || '').includes('codecs=opus')) return file;
  const ext = extname(file.filename || file.path || '').replace(/^\./, '') || 'wav';
  try {
    const input = file.bufferBase64
      ? Buffer.from(file.bufferBase64, 'base64')
      : readFileSync(file.path);
    const safe = await toWhatsAppSafeAudio(input, ext);
    const filename = String(file.filename || 'speech-tts.ogg').replace(/\.[^.]+$/, '.ogg');
    return {
      ...file,
      filename,
      mimeType: WHATSAPP_VOICE_MIME,
      asVoice: true,
      bytes: safe.buffer.length,
      bufferBase64: safe.buffer.toString('base64'),
    };
  } catch (e) {
    console.warn('[channel-announce] opus convert failed', {
      filename: file.filename,
      err: e?.message || e,
    });
    return { ...file, asVoice: false };
  }
}

function packMediaForSend(file) {
  if (!file) return null;
  const packed = {
    path: file.path,
    filename: file.filename,
    mimeType: file.mimeType,
    kind: file.kind,
    asVoice: !!file.asVoice,
    bytes: file.bytes,
  };
  if (file.bufferBase64) {
    packed.bufferBase64 = file.bufferBase64;
  } else if (file.bytes <= MAX_MEDIA_BUFFER_BYTES) {
    packed.bufferBase64 = readFileSync(file.path).toString('base64');
  }
  return packed;
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
async function sendViaMessageTool({ channel, to, accountId, message, mediaFile, idempotencyKey }) {
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
  if (mediaFile?.bufferBase64) {
    // Buffer-only: if `media` is also set, OpenClaw deletes the buffer and the file never attaches.
    args.buffer = mediaFile.bufferBase64;
    args.filename = mediaFile.filename;
    args.mimeType = mediaFile.mimeType;
    args.contentType = mediaFile.mimeType;
    if (mediaFile.asVoice) {
      args.asVoice = true;
      args.audioAsVoice = true;
      args.ptt = true;
      // Empty caption: WhatsApp PTT ignores captions; "[[audio]]" showed as a broken bubble.
    }
  } else if (mediaFile?.path) {
    args.media = mediaFile.path;
    args.filename = mediaFile.filename;
    args.mimeType = mediaFile.mimeType;
    args.contentType = mediaFile.mimeType;
    args.attachments = [
      {
        type: mediaFile.kind || 'file',
        media: mediaFile.path,
        name: mediaFile.filename,
        mimeType: mediaFile.mimeType,
      },
    ];
    if (mediaFile.asVoice) {
      args.asVoice = true;
      args.audioAsVoice = true;
    }
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

async function sendViaOpenClaw({ channel, to, accountId, message, mediaFile, idempotencyKey }) {
  try {
    return await sendViaMessageTool({ channel, to, accountId, message, mediaFile, idempotencyKey });
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
  if (mediaFile?.path) {
    params.mediaUrls = [mediaFile.path];
    params.mediaUrl = mediaFile.path;
    params.media = mediaFile.path;
  }
  if (mediaFile?.asVoice) params.asVoice = true;
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
    const split = splitMediaLines(prefixed);
    let mediaLines = split.mediaLines;
    const body = split.body;
    if (ch === 'whatsapp' && !mediaLines.length) {
      const recent = recentOwnerGeneratedAudioLines(ownerUserId);
      if (recent.length) {
        mediaLines = recent;
        console.info('[channel-announce] using recent generated audio', {
          owner: ownerUserId,
          agent: agentId,
          count: recent.length,
        });
      }
    }
    const mediaFiles = mediaLines.map(resolveAnnounceMediaFile).filter(Boolean);
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
      idempotencyKey,
    });
    let mediaSent = 0;
    for (const file of mediaFiles) {
      try {
        const ready =
          ch === 'whatsapp' && file.kind === 'audio' ? await ensureWhatsAppAudioFile(file) : file;
        const packed = packMediaForSend(ready);
        await sendViaOpenClaw({
          channel: ch,
          to: resolved.to,
          accountId: resolved.accountId,
          message: '',
          mediaFile: packed,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:m${mediaSent}` : undefined,
        });
        mediaSent += 1;
        console.info('[channel-announce] media sent', {
          owner: ownerUserId,
          agent: agentId,
          channel: ch,
          kind: file.kind,
          filename: packed.filename || file.filename,
          as_voice: packed.asVoice,
          bytes: packed.bytes || file.bytes,
          mime: packed.mimeType,
          via: packed.bufferBase64 ? 'buffer' : 'path',
        });
      } catch (mediaErr) {
        console.warn('[channel-announce] media send failed', {
          owner: ownerUserId,
          agent: agentId,
          channel: ch,
          filename: file.filename,
          err: mediaErr?.message || mediaErr,
        });
      }
    }
    if (mediaLines.length && !mediaFiles.length) {
      console.warn('[channel-announce] MEDIA lines present but no local file attached', {
        owner: ownerUserId,
        agent: agentId,
        channel: ch,
        media_lines: mediaLines.length,
      });
    }
    console.info('[channel-announce] sent', {
      owner: ownerUserId,
      agent: agentId,
      channel: ch,
      method: sent.method,
      media_sent: mediaSent,
      to: String(resolved.to).replace(/\d(?=\d{4})/g, '•'),
    });
    return { ok: true, channel: ch, method: sent.method, to_set: true, media_sent: mediaSent };
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

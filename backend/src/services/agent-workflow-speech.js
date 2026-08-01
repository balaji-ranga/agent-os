/**
 * Free local STT (Whisper / Speaches) and TTS (Piper) for workflow nodes and chat.
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { basename, extname, isAbsolute, relative, resolve } from 'path';
import { createMediaArtifact, parseMediaRef, readMediaArtifactBuffer } from './ceo-media-artifacts.js';
import { renderWorkflowTemplates } from './agent-workflow-io.js';
import { extractSpokenAvatarReply } from './avatar-speak-text.js';
import { persistGeneratedOpenClawMedia } from './media-url.js';
import { getOpenClawDir } from '../config/openclaw-paths.js';
import { resolveWorkflowFsRoots } from '../lib/workflow-fs-roots.js';
import {
  convertAudioBuffer,
  normalizeAudioFormat,
  toWhatsAppSafeAudio,
  audioExtensionForFormat,
  extractAudioTrackForStt,
} from './audio-convert.js';

function workflowFsRoots() {
  const roots = resolveWorkflowFsRoots(process.env.WORKFLOW_FS_ROOTS);
  if (!roots.length) roots.push(resolve(process.cwd(), 'tmp', 'workflow-fs'));
  // Always allow OpenClaw media staging (WhatsApp inbound downloads)
  const mediaRoot = resolve(getOpenClawDir(), 'media');
  if (!roots.some((r) => r === mediaRoot)) roots.push(mediaRoot);
  return roots;
}

/** Bare OpenClaw inbound filename (e.g. uuid.ogg from WhatsApp media staging). */
function resolveBareOpenClawInboundMedia(nameOrPath) {
  const n = basename(String(nameOrPath || '').trim());
  if (!/^[A-Za-z0-9._-]{8,180}\.[A-Za-z0-9]{1,8}$/.test(n)) return null;
  if (String(nameOrPath || '').includes('/') || String(nameOrPath || '').includes('\\')) return null;
  const abs = resolve(getOpenClawDir(), 'media', 'inbound', n);
  try {
    if (existsSync(abs) && statSync(abs).isFile()) return assertPathInWorkflowRoots(abs);
  } catch {
    return null;
  }
  return null;
}

function assertPathInWorkflowRoots(targetPath) {
  const abs = resolve(String(targetPath || ''));
  for (const root of workflowFsRoots()) {
    const rel = relative(root, abs);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return abs;
  }
  throw Object.assign(new Error(`STT path not allowed outside WORKFLOW_FS_ROOTS: ${abs}`), { status: 400 });
}

function sanitizeOwnerPart(value) {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9_.-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown'
  );
}

/** Extract inbound/attachments/<file> from chat text or a bare path. */
function extractInboundRelativePath(value) {
  const s = String(value || '');
  // Greedy filename match so UUID-style names with multiple dots
  // (e.g. wa-…-.bd3dec7c-fe93-….mp4) are not truncated at the first ".hex".
  const re = /(?:workspace\/)?inbound\/attachments\/([^\s"'<>\/]+\.[A-Za-z0-9]{1,8})(?=$|[\s"'<>)\]},;!?])/gi;
  let best = null;
  let m;
  while ((m = re.exec(s)) !== null) {
    const rel = `inbound/attachments/${m[1]}`.replace(/^workspace\//i, '');
    const cleaned = rel.replace(/[.,;:!?)]+$/g, '');
    if (cleaned.toLowerCase().endsWith('/attachments')) continue;
    best = cleaned;
  }
  return best;
}

function resolveInboundFsPath(ownerUserId, relativeOrAbs) {
  const raw = String(relativeOrAbs || '').trim();
  if (!raw) return null;
  if (isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    const abs = assertPathInWorkflowRoots(raw);
    if (existsSync(abs) && !statSync(abs).isFile()) {
      throw Object.assign(new Error(`STT path is not a file: ${abs}`), { status: 400 });
    }
    return abs;
  }
  const relative = extractInboundRelativePath(raw);
  if (!relative) return null;
  const ceo = sanitizeOwnerPart(ownerUserId);
  const roots = workflowFsRoots();
  const candidates = [];
  for (const root of roots) {
    candidates.push(resolve(root, ceo, relative));
    if (/openclaw|tenants/i.test(String(root))) {
      candidates.push(resolve(root, ceo, 'workspace', relative));
    }
  }
  for (const abs of candidates) {
    try {
      const allowed = assertPathInWorkflowRoots(abs);
      if (existsSync(allowed) && statSync(allowed).isFile()) return allowed;
    } catch {
      /* try next */
    }
  }
  try {
    return assertPathInWorkflowRoots(candidates[0]);
  } catch {
    return null;
  }
}

function looksLikeFsPath(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (s.startsWith('MEDIA:') || s.startsWith('artifact:')) return false;
  if (extractInboundRelativePath(s)) return true;
  // Artifact ids are short tokens without path separators
  if (s.length <= 128 && !s.includes('/') && !s.includes('\\')) return false;
  return s.includes('/') || s.includes('\\') || /^[a-zA-Z]:[\\/]/.test(s);
}

function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  const map = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    webm: 'audio/webm',
    flac: 'audio/flac',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
  };
  return map[e] || 'application/octet-stream';
}

const DEFAULT_STT_MODEL = 'whisper-1';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const STT_PATH = '/v1/audio/transcriptions';

function resolveSpeechSttUrl() {
  const raw = String(process.env.SPEECH_STT_URL || '').trim();
  if (!raw) {
    throw Object.assign(
      new Error('SPEECH_STT_URL not configured. Start optional-voice profile (whisper service).'),
      { status: 503 }
    );
  }
  if (raw.includes('/audio/transcriptions')) return raw;
  const base = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  return base + STT_PATH;
}

function resolveSpeechTtsUrl() {
  const raw = String(process.env.SPEECH_TTS_URL || '').trim();
  if (!raw) {
    throw Object.assign(
      new Error('SPEECH_TTS_URL not configured. Start optional-voice profile (piper service).'),
      { status: 503 }
    );
  }
  return raw;
}

function resolveTimeoutMs(nodeConfig = {}) {
  const n = Number(nodeConfig.timeoutMs);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function audioExtensionForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('ogg')) return 'ogg';
  return 'wav';
}

export async function transcribeAudioBuffer(buffer, filename, mimeType, nodeConfig = {}) {
  const sttUrl = resolveSpeechSttUrl();
  const timeoutMs = resolveTimeoutMs(nodeConfig);
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType || 'audio/webm' });
  form.append('file', blob, filename || 'audio.webm');
  form.append('model', String(nodeConfig.modelId || nodeConfig.model || DEFAULT_STT_MODEL));
  const language = String(nodeConfig.language || '').trim();
  if (language) form.append('language', language);

  const res = await fetch(sttUrl, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const textBody = await res.text();
  if (!res.ok) {
    console.warn('[speech] STT upstream error', { status: res.status, detail: textBody.slice(0, 200) });
    throw Object.assign(new Error('Speech STT ' + res.status + ': ' + textBody.slice(0, 400)), { status: 502 });
  }
  let parsed = {};
  try {
    parsed = JSON.parse(textBody);
  } catch {
    parsed = { text: textBody };
  }
  const transcript = String(parsed.text || parsed.transcript || '').trim();
  console.info('[speech] STT ok', { chars: transcript.length });
  return { transcript, result: parsed };
}

export async function synthesizeSpeechText(text, nodeConfig = {}) {
  const ttsUrl = resolveSpeechTtsUrl();
  const timeoutMs = resolveTimeoutMs(nodeConfig);
  const payload = { text: String(text || '').trim() };
  const voice = String(nodeConfig.voice || nodeConfig.voiceId || '').trim();
  if (voice) payload.voice = voice;
  const lengthScale = nodeConfig.lengthScale ?? nodeConfig.length_scale;
  if (lengthScale != null && lengthScale !== '') payload.length_scale = Number(lengthScale);

  const res = await fetch(ttsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn('[speech] TTS upstream error', { status: res.status, detail: errText.slice(0, 200) });
    throw Object.assign(new Error('Speech TTS ' + res.status + ': ' + errText.slice(0, 400)), { status: 502 });
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = String(res.headers.get('content-type') || 'audio/wav').split(';')[0].trim();
  console.info('[speech] TTS ok', { bytes: buffer.length });
  return { buffer, mime };
}

export async function executeSpeechSttTask(resolvedInputs, nodeConfig = {}, context = null) {
  const owner = context?.owner_user_id || context?.actor?.id;
  if (!owner) throw new Error('Speech STT node requires workflow owner');

  const audioRaw = resolvedInputs.audio ?? resolvedInputs.media ?? resolvedInputs.path ?? resolvedInputs.text;
  let buffer = null;
  let filename = 'audio.webm';
  let mimeType = 'audio/webm';
  let source = 'artifact';

  const inboundAbs =
    typeof audioRaw === 'string' ? resolveInboundFsPath(owner, audioRaw) : null;
  const ref =
    parseMediaRef(audioRaw) ||
    (typeof audioRaw === 'string' && !looksLikeFsPath(audioRaw) && !inboundAbs && String(audioRaw).trim()
      ? { artifactId: String(audioRaw).trim() }
      : null);
  const bareInbound =
    typeof audioRaw === 'string' && !inboundAbs ? resolveBareOpenClawInboundMedia(audioRaw) : null;

  if (ref?.artifactId) {
    const got = readMediaArtifactBuffer(owner, ref.artifactId);
    if (!got) {
      // WhatsApp often surfaces only the OpenClaw inbound basename (uuid.ogg), not artifact:.
      if (bareInbound) {
        buffer = readFileSync(bareInbound);
        filename = basename(bareInbound);
        mimeType = mimeFromExt(extname(bareInbound));
        source = 'filesystem';
        console.info('[speech] STT bare openclaw inbound', {
          owner: sanitizeOwnerPart(owner),
          abs: bareInbound,
          filename,
        });
      } else {
        throw new Error('Audio artifact not found: ' + ref.artifactId);
      }
    } else {
      buffer = got.buffer;
      filename = got.row.filename || filename;
      mimeType = got.row.mime_type || mimeType;
    }
  } else if (inboundAbs || bareInbound || (typeof audioRaw === 'string' && looksLikeFsPath(audioRaw))) {
    const abs = inboundAbs || bareInbound || assertPathInWorkflowRoots(String(audioRaw).trim());
    if (!existsSync(abs)) throw new Error('Audio/video file not found: ' + abs);
    buffer = readFileSync(abs);
    filename = basename(abs);
    mimeType = mimeFromExt(extname(abs));
    source = 'filesystem';
    console.info('[speech] STT filesystem path', { owner: sanitizeOwnerPart(owner), abs, filename });
  } else {
    throw new Error('Speech STT requires audio media ref, artifactId, or WORKFLOW_FS_ROOTS path');
  }

  const ext = extname(filename).replace(/^\./, '') || 'bin';
  const needsExtract = !['wav', 'mp3', 'm4a', 'ogg', 'webm', 'flac'].includes(ext.toLowerCase()) ||
    String(mimeType).startsWith('video/');
  if (needsExtract || ext.toLowerCase() !== 'wav') {
    try {
      const extracted = await extractAudioTrackForStt(buffer, ext);
      buffer = extracted.buffer;
      filename = `${basename(filename, extname(filename)) || 'audio'}.wav`;
      mimeType = extracted.mime || 'audio/wav';
      console.info('[speech] STT extracted audio track', { owner, source, ext, bytes: buffer.length });
    } catch (e) {
      console.warn('[speech] STT extract skipped', { error: e?.message || String(e), ext });
    }
  }

  const { transcript, result } = await transcribeAudioBuffer(buffer, filename, mimeType, nodeConfig);
  return {
    ok: true,
    mode: 'stt',
    text: transcript,
    result,
    source,
  };
}

export async function executeSpeechTtsTask(resolvedInputs, nodeConfig = {}, context = null) {
  const owner = context?.owner_user_id || context?.actor?.id;
  if (!owner) throw new Error('Speech TTS node requires workflow owner');

  const render = (v) =>
    context && v != null && typeof v === 'string' ? renderWorkflowTemplates(v, context) : v;

  let text = resolvedInputs.text ?? resolvedInputs.prompt ?? '';
  if (typeof text === 'object') text = JSON.stringify(text);
  text = String(render(String(text || ''))).trim();
  const speakCleanRaw = nodeConfig.speakClean ?? nodeConfig.speak_clean ?? true;
  const speakClean = speakCleanRaw !== false && speakCleanRaw !== 'false';
  if (speakClean) {
    const cleaned = extractSpokenAvatarReply(text);
    if (cleaned && cleaned !== text) {
      console.info('[speech] cleaned speak text', {
        owner,
        beforeChars: text.length,
        afterChars: cleaned.length,
      });
      text = cleaned;
    }
  }
  if (!text) throw new Error('Speech TTS requires text input');

  const { buffer, mime } = await synthesizeSpeechText(text, nodeConfig);
  const ext = audioExtensionForMime(mime);
  const { ref } = createMediaArtifact(owner, {
    buffer,
    filename: 'speech-tts.' + ext,
    mimeType: mime,
    kind: 'audio',
    meta: { source: 'speech_tts', voice: nodeConfig.voice || nodeConfig.voiceId || null },
  });
  return {
    ok: true,
    mode: 'tts',
    text,
    audio: ref,
    result: { audio: ref },
  };
}

export async function createSpeechTtsArtifact(ownerUserId, text, opts = {}) {
  const { buffer: piperBuf, mime: piperMime } = await synthesizeSpeechText(text, opts);
  const piperExt = audioExtensionForMime(piperMime);
  const requested = normalizeAudioFormat(opts.format || opts.audio_format || opts.output_format || 'wav');

  let outBuf = piperBuf;
  let outMime = piperMime;
  let outExt = piperExt;
  let outFormat = 'wav';
  if (requested !== 'wav' || piperExt !== 'wav') {
    try {
      const converted = await convertAudioBuffer(piperBuf, requested, { inputExt: piperExt });
      outBuf = converted.buffer;
      outMime = converted.mime;
      outExt = converted.ext;
      outFormat = converted.format;
    } catch (e) {
      console.warn('[speech] format convert failed; keeping piper output', {
        requested,
        error: e?.message || String(e),
      });
      outFormat = piperExt;
    }
  } else {
    outFormat = 'wav';
  }

  const { ref } = createMediaArtifact(ownerUserId, {
    buffer: outBuf,
    filename: 'speech-tts.' + outExt,
    mimeType: outMime,
    kind: 'audio',
    meta: { source: 'speech_tts_api', format: outFormat },
  });

  // WhatsApp rejects WAV often ("Media failed"). Prefer OGG/Opus (or mp3) for MEDIA: paste.
  let channel = null;
  try {
    let channelBuf = outBuf;
    let channelExt = outExt;
    let channelFormat = outFormat;
    const whatsappSafe = ['ogg', 'opus', 'mp3', 'm4a'].includes(outFormat);
    if (!whatsappSafe) {
      const safe = await toWhatsAppSafeAudio(piperBuf, piperExt);
      channelBuf = safe.buffer;
      channelExt = safe.ext;
      channelFormat = safe.format;
    }
    channel = persistGeneratedOpenClawMedia(channelBuf, `speech-tts.${channelExt}`, 'generated', ownerUserId);
    channel.delivery_format = channelFormat;
  } catch (e) {
    console.warn('[speech] openclaw dual-write failed', { error: e?.message || String(e) });
  }

  return {
    ...ref,
    mimeType: outMime,
    format: outFormat,
    ...(channel
      ? {
          media_uri: channel.media_uri,
          paste_exactly: channel.paste_exactly,
          public_url: channel.public_url,
          relative_url: channel.relative_url,
          local_path: channel.local_path,
          web_markdown: channel.web_markdown,
          delivery_format: channel.delivery_format || channelExt,
          delivery_hint:
            'Paste paste_exactly (MEDIA:/abs/path) on its own line so WhatsApp attaches audio. Channel file is OGG/Opus or MP3 (WAV often fails on WhatsApp). Dashboard plays relative_url / MEDIA: inline.',
          url: channel.media_uri,
          artifact_url: ref.url,
        }
      : {}),
  };
}

/**
 * Free local STT (Whisper / Speaches) and TTS (Piper) for workflow nodes and chat.
 */
import { createMediaArtifact, parseMediaRef, readMediaArtifactBuffer } from './ceo-media-artifacts.js';
import { renderWorkflowTemplates } from './agent-workflow-io.js';
import { extractSpokenAvatarReply } from './avatar-speak-text.js';

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

  const audioRaw = resolvedInputs.audio ?? resolvedInputs.media;
  const ref = parseMediaRef(audioRaw) || (typeof audioRaw === 'string' ? { artifactId: audioRaw } : null);
  if (!ref?.artifactId) throw new Error('Speech STT requires audio media ref or artifactId');
  const got = readMediaArtifactBuffer(owner, ref.artifactId);
  if (!got) throw new Error('Audio artifact not found: ' + ref.artifactId);

  const { transcript, result } = await transcribeAudioBuffer(
    got.buffer,
    got.row.filename || 'audio.webm',
    got.row.mime_type || 'audio/webm',
    nodeConfig
  );
  return {
    ok: true,
    mode: 'stt',
    text: transcript,
    result,
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
  const { buffer, mime } = await synthesizeSpeechText(text, opts);
  const ext = audioExtensionForMime(mime);
  const { ref } = createMediaArtifact(ownerUserId, {
    buffer,
    filename: 'speech-tts.' + ext,
    mimeType: mime,
    kind: 'audio',
    meta: { source: 'speech_tts_api' },
  });
  return ref;
}

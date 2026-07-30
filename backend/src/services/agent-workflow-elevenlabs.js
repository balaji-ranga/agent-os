/**
 * ElevenLabs TTS / STT for workflow nodes.
 */
import { tryResolveUserApiKey } from './user-api-keys.js';
import { createMediaArtifact, parseMediaRef, readMediaArtifactBuffer } from './ceo-media-artifacts.js';
import { renderWorkflowTemplates } from './agent-workflow-io.js';
import { extractSpokenAvatarReply } from './avatar-speak-text.js';

const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';
/** Flash is ~low-latency; override via node taskConfig.modelId if quality matters more. */
const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';
const DEFAULT_TTS_OUTPUT_FORMAT = 'mp3_22050_32';
const DEFAULT_STT_MODEL = 'scribe_v2';

function resolveElevenLabsApiKey(ownerUserId, nodeConfig = {}) {
  const refName = String(nodeConfig.apiKeyRef || nodeConfig.api_key_ref || 'ElevenLabs').trim();
  if (refName) {
    const fromVault = tryResolveUserApiKey(ownerUserId, refName);
    if (fromVault?.value) return fromVault.value;
  }
  const envKey = String(process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY || '').trim();
  if (envKey) return envKey;
  throw Object.assign(
    new Error(
      'ElevenLabs API key missing. Add vault key "ElevenLabs" (or set apiKeyRef) or set ELEVENLABS_API_KEY.'
    ),
    { status: 400 }
  );
}

/**
 * @param {Record<string, any>} resolvedInputs
 * @param {object} nodeConfig
 * @param {object} context
 */
export async function executeElevenLabsTask(resolvedInputs, nodeConfig = {}, context = null) {
  const owner = context?.owner_user_id || context?.actor?.id;
  if (!owner) throw new Error('ElevenLabs node requires workflow owner');
  const mode = String(nodeConfig.mode || 'tts').toLowerCase();
  const apiKey = resolveElevenLabsApiKey(owner, nodeConfig);
  const timeoutMs = Number(nodeConfig.timeoutMs || 5 * 60 * 1000);
  const render = (v) =>
    context && v != null && typeof v === 'string' ? renderWorkflowTemplates(v, context) : v;

  if (mode === 'stt') {
    const audioRaw = resolvedInputs.audio ?? resolvedInputs.media;
    const ref = parseMediaRef(audioRaw) || (typeof audioRaw === 'string' ? { artifactId: audioRaw } : null);
    if (!ref?.artifactId) throw new Error('STT requires audio media ref or artifactId');
    const got = readMediaArtifactBuffer(owner, ref.artifactId);
    if (!got) throw new Error(`Audio artifact not found: ${ref.artifactId}`);

    const form = new FormData();
    const blob = new Blob([got.buffer], { type: got.row.mime_type || 'audio/mpeg' });
    form.append('file', blob, got.row.filename || 'audio.mp3');
    form.append('model_id', String(nodeConfig.modelId || nodeConfig.sttModelId || DEFAULT_STT_MODEL));

    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const textBody = await res.text();
    if (!res.ok) {
      throw new Error(`ElevenLabs STT ${res.status}: ${textBody.slice(0, 400)}`);
    }
    let parsed = {};
    try {
      parsed = JSON.parse(textBody);
    } catch {
      parsed = { text: textBody };
    }
    const transcript = String(parsed.text || parsed.transcript || '').trim();
    console.info('[elevenlabs] STT ok', { owner, chars: transcript.length });
    return {
      ok: true,
      mode: 'stt',
      text: transcript,
      result: parsed,
    };
  }

  // TTS
  let text = resolvedInputs.text ?? resolvedInputs.prompt ?? '';
  if (typeof text === 'object') text = JSON.stringify(text);
  text = String(render(String(text || ''))).trim();
  const speakClean = nodeConfig.speakClean !== false && nodeConfig.speak_clean !== false;
  if (speakClean) {
    const cleaned = extractSpokenAvatarReply(text);
    if (cleaned && cleaned !== text) {
      console.info('[elevenlabs] cleaned agent speak text', {
        owner,
        beforeChars: text.length,
        afterChars: cleaned.length,
      });
      text = cleaned;
    }
  }
  if (!text) throw new Error('TTS requires text input');

  const voiceId = String(render(nodeConfig.voiceId || DEFAULT_VOICE) || DEFAULT_VOICE).trim();
  const modelId = String(nodeConfig.modelId || DEFAULT_TTS_MODEL).trim();
  const outputFormat = String(nodeConfig.outputFormat || DEFAULT_TTS_OUTPUT_FORMAT).trim();

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS ${res.status}: ${errText.slice(0, 400)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = String(res.headers.get('content-type') || 'audio/mpeg').split(';')[0].trim();
  const { ref } = createMediaArtifact(owner, {
    buffer,
    filename: `elevenlabs-tts.${mime.includes('wav') ? 'wav' : 'mp3'}`,
    mimeType: mime,
    kind: 'audio',
    meta: { voiceId, modelId, source: 'elevenlabs_tts' },
  });
  console.info('[elevenlabs] TTS ok', { owner, bytes: buffer.length, voiceId });
  return {
    ok: true,
    mode: 'tts',
    text,
    audio: ref,
    result: { voiceId, modelId, audio: ref },
  };
}

/**
 * Agent content tools for free local STT (Whisper) and TTS (Piper).
 * Same upstreams as workflow speech_* nodes and /api/speech/*.
 */
import { parseMediaRef, readMediaArtifactBuffer } from './ceo-media-artifacts.js';
import { extractSpokenAvatarReply } from './avatar-speak-text.js';
import {
  createSpeechTtsArtifact,
  transcribeAudioBuffer,
} from './agent-workflow-speech.js';
import { toAbsoluteMediaUrl } from './media-url.js';

/**
 * @param {object} body
 * @param {string} ownerUserId
 */
export async function executeSpeechTtsTool(body = {}, ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('Could not resolve CEO user for this session');
    err.status = 403;
    throw err;
  }
  let text = String(body.text || body.prompt || '').trim();
  if (!text) {
    const err = new Error('text required');
    err.status = 400;
    throw err;
  }
  const speakCleanRaw = body.speak_clean ?? body.speakClean ?? true;
  const speakClean = speakCleanRaw !== false && speakCleanRaw !== 'false';
  if (speakClean) {
    const cleaned = extractSpokenAvatarReply(text);
    if (cleaned && cleaned !== text) text = cleaned;
  }
  const audio = await createSpeechTtsArtifact(owner, text, {
    voice: body.voice || body.voice_id || body.voiceId,
    lengthScale: body.length_scale ?? body.lengthScale,
    format: body.format || body.audio_format || body.output_format || 'wav',
  });
  const url = audio?.url || null;
  const artifactUrl = audio?.artifact_url || audio?.url || null;
  console.info('[speech-tools] speech_tts ok owner=%s chars=%s has_media_uri=%s', owner, text.length, Boolean(audio?.media_uri));
  return {
    ok: true,
    mode: 'tts',
    text,
    audio,
    url,
    media_uri: audio?.media_uri || null,
    paste_exactly: audio?.paste_exactly || audio?.media_uri || null,
    public_url: audio?.public_url || null,
    relative_url: audio?.relative_url || null,
    web_markdown: audio?.web_markdown || null,
    delivery_hint:
      audio?.delivery_hint ||
      'Paste paste_exactly (MEDIA:/abs/path) on its own line so WhatsApp attaches the audio. Dashboard chat plays MEDIA: / relative_url inline.',
    absolute_url: audio?.public_url || toAbsoluteMediaUrl(artifactUrl || url),
    artifact_url: artifactUrl,
    format: audio?.format || body.format || 'wav',
    delivery_format: audio?.delivery_format || null,
    engine: 'piper',
  };
}

/**
 * @param {object} body
 * @param {string} ownerUserId
 */
export async function executeSpeechSttTool(body = {}, ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('Could not resolve CEO user for this session');
    err.status = 403;
    throw err;
  }

  let buffer = null;
  let filename = String(body.filename || 'audio.webm').trim() || 'audio.webm';
  let mimeType = String(body.mime_type || body.mimeType || 'audio/webm').trim() || 'audio/webm';

  const mediaRaw =
    body.media_ref || body.media || body.audio || body.path || body.artifact_id || body.artifactId;
  // Prefer filesystem / MEDIA: / inbound path (WhatsApp OpenClaw staging + workspace mirror)
  try {
    const { executeSpeechSttTask } = await import('./agent-workflow-speech.js');
    if (typeof mediaRaw === 'string' && mediaRaw.trim()) {
      const out = await executeSpeechSttTask(
        { audio: mediaRaw.trim() },
        {
          language: body.language,
          model: body.model || body.model_id || body.modelId,
        },
        { owner_user_id: owner }
      );
      console.info('[speech-tools] speech_stt ok owner=%s chars=%s source=%s', owner, out.text?.length || 0, out.source);
      return {
        ok: true,
        mode: 'stt',
        text: out.text,
        result: out.result,
        source: out.source,
        engine: 'whisper',
      };
    }
  } catch (pathErr) {
    // Fall through to artifact / base64 if path resolution failed
    if (!body.content_base64 && !body.contentBase64 && !body.artifact_id && !body.artifactId) {
      // If it looked like a path/MEDIA, surface the path error
      const s = String(mediaRaw || '');
      if (/MEDIA:|inbound\/attachments|\/.openclaw\/media|\//.test(s)) {
        const err = new Error(pathErr.message || String(pathErr));
        err.status = pathErr.status || 400;
        throw err;
      }
    }
  }

  const ref =
    parseMediaRef(mediaRaw) ||
    (typeof mediaRaw === 'string' && mediaRaw.trim() ? { artifactId: mediaRaw.trim() } : null);
  if (ref?.artifactId) {
    const got = readMediaArtifactBuffer(owner, ref.artifactId);
    if (!got) {
      const err = new Error(`Audio artifact not found: ${ref.artifactId}`);
      err.status = 404;
      throw err;
    }
    buffer = got.buffer;
    filename = got.row.filename || filename;
    mimeType = got.row.mime_type || mimeType;
  } else if (body.content_base64 || body.contentBase64) {
    buffer = Buffer.from(String(body.content_base64 || body.contentBase64), 'base64');
    if (!buffer.length) {
      const err = new Error('empty content_base64');
      err.status = 400;
      throw err;
    }
  } else {
    const err = new Error(
      'Provide MEDIA:/path, inbound/attachments/<file>, artifact_id / media_ref, or content_base64'
    );
    err.status = 400;
    throw err;
  }

  const maxMb = Number(process.env.MEDIA_ARTIFACT_MAX_MB || 40);
  if (buffer.length > maxMb * 1024 * 1024) {
    const err = new Error(`Audio exceeds ${maxMb}MB limit`);
    err.status = 413;
    throw err;
  }

  const { transcript, result } = await transcribeAudioBuffer(buffer, filename, mimeType, {
    language: body.language,
    model: body.model || body.model_id || body.modelId,
  });
  console.info('[speech-tools] speech_stt ok owner=%s chars=%s', owner, transcript.length);
  return {
    ok: true,
    mode: 'stt',
    text: transcript,
    result,
    engine: 'whisper',
  };
}

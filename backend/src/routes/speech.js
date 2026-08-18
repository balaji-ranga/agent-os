/**
 * CEO speech STT/TTS APIs (local Whisper + Piper when optional-voice profile is enabled).
 */
import { Router } from 'express';
import express from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { readMediaArtifactBuffer } from '../services/ceo-media-artifacts.js';
import {
  transcribeAudioBuffer,
  createSpeechTtsArtifact,
} from '../services/agent-workflow-speech.js';

const router = Router();

function ownerOr403(req, res) {
  const ownerUserId = resolveAuthenticatedCeoUserId(req);
  if (!ownerUserId) {
    res.status(403).json({ error: 'CEO context required' });
    return null;
  }
  return ownerUserId;
}

function parseMultipartFile(rawBody, contentType) {
  const boundaryMatch = /boundary=([^;\s]+)/i.exec(contentType || '');
  let boundary = boundaryMatch?.[1] || '';
  boundary = boundary.replace(/^"|"$/g, '');
  if (!boundary) throw Object.assign(new Error('Invalid multipart boundary'), { status: 400 });

  if (!Buffer.isBuffer(rawBody)) {
    throw Object.assign(
      new Error('Audio upload was not read as bytes. Retry the microphone, or send JSON contentBase64.'),
      { status: 400 }
    );
  }
  const body = rawBody;
  if (!body.length) {
    throw Object.assign(new Error('Empty audio upload — speak, then pause after you finish (or click the mic to send).'), {
      status: 400,
    });
  }
  const delim = Buffer.from('--' + boundary);
  const parts = [];
  let start = body.indexOf(delim);
  while (start !== -1) {
    const next = body.indexOf(delim, start + delim.length);
    if (next === -1) break;
    parts.push(body.subarray(start + delim.length, next));
    start = next;
  }

  for (const part of parts) {
    if (part.length < 4) continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString('utf8');
    if (!headers.toLowerCase().includes('content-disposition: form-data')) continue;
    const nameMatch = /name="([^"]+)"/i.exec(headers);
    const filenameMatch = /filename="([^"]*)"/i.exec(headers);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    let content = part.subarray(headerEnd + 4);
    if (content.length >= 2 && content.subarray(-2).equals(Buffer.from('\r\n'))) {
      content = content.subarray(0, content.length - 2);
    }
    if (filenameMatch || fieldName === 'file' || fieldName === 'audio') {
      const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
      return {
        buffer: content,
        filename: filenameMatch?.[1] || 'audio.webm',
        mimeType: typeMatch?.[1]?.trim() || 'application/octet-stream',
      };
    }
  }
  throw Object.assign(new Error('No audio file in multipart body'), { status: 400 });
}

async function resolveSttAudio(owner, req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();

  if (ct.includes('multipart/form-data')) {
    const file = parseMultipartFile(req.body, ct);
    return { buffer: file.buffer, filename: file.filename, mimeType: file.mimeType };
  }

  const body =
    Buffer.isBuffer(req.body) && req.body.length
      ? JSON.parse(req.body.toString('utf8'))
      : req.body || {};

  if (body.artifactId) {
    const got = readMediaArtifactBuffer(owner, body.artifactId);
    if (!got) throw Object.assign(new Error('Artifact not found: ' + body.artifactId), { status: 404 });
    return {
      buffer: got.buffer,
      filename: got.row.filename || 'audio.webm',
      mimeType: got.row.mime_type || 'audio/webm',
    };
  }

  if (body.contentBase64 || body.content_base64) {
    const buffer = Buffer.from(String(body.contentBase64 || body.content_base64), 'base64');
    if (!buffer.length) throw Object.assign(new Error('empty contentBase64'), { status: 400 });
    return {
      buffer,
      filename: body.filename || 'audio.webm',
      mimeType: body.mimeType || body.mime_type || 'audio/webm',
    };
  }

  throw Object.assign(new Error('Provide multipart file, artifactId, or contentBase64'), { status: 400 });
}

router.post(
  '/stt',
  requireAuth,
  requireCeoOrAdmin,
  (req, res, next) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (ct.includes('multipart/form-data')) {
      return express.raw({ type: () => true, limit: '40mb' })(req, res, next);
    }
    if (ct.includes('application/json')) {
      return express.json({ limit: '40mb' })(req, res, next);
    }
    return express.raw({ type: () => true, limit: '40mb' })(req, res, next);
  },
  async (req, res) => {
    try {
      const owner = ownerOr403(req, res);
      if (!owner) return;
      const { buffer, filename, mimeType } = await resolveSttAudio(owner, req);
      console.info('[speech] STT inbound', {
        owner,
        bytes: buffer?.length || 0,
        filename,
        mime: String(mimeType || '').slice(0, 48),
      });
      const maxMb = Number(process.env.MEDIA_ARTIFACT_MAX_MB || 40);
      if (buffer.length > maxMb * 1024 * 1024) {
        return res.status(413).json({ error: 'Audio exceeds ' + maxMb + 'MB limit' });
      }
      const language = req.body?.language;
      const model = req.body?.model;
      const { transcript, result } = await transcribeAudioBuffer(buffer, filename, mimeType, {
        language,
        model,
      });
      res.json({ ok: true, text: transcript, result });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[speech] STT route failed', e?.message || e);
      else console.warn('[speech] STT route rejected', e?.message || e);
      res.status(status).json({ error: e.message || 'STT failed' });
    }
  }
);

router.post('/tts', requireAuth, requireCeoOrAdmin, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    const artifact = await createSpeechTtsArtifact(owner, text, {
      voice: req.body?.voice,
      lengthScale: req.body?.lengthScale,
    });
    res.json({ ok: true, text, audio: artifact, url: artifact.url });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[speech] TTS route failed', e?.message || e);
    else console.warn('[speech] TTS route rejected', e?.message || e);
    res.status(status).json({ error: e.message || 'TTS failed' });
  }
});

export default router;

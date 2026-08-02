/**
 * analyze_image — multimodal vision / OCR for inbound WhatsApp & chat attachments.
 * Uses a vision-capable OpenAI-compatible chat model (see getVisionConfig).
 */
import { extname } from 'path';
import { getVisionConfig } from '../config/tools.js';
import { parseMediaRef, readMediaArtifactBuffer } from './ceo-media-artifacts.js';
import { resolveOwnerMediaBuffer } from './agent-workflow-speech.js';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff']);

const MODE_PROMPTS = {
  describe:
    'Describe this image clearly and thoroughly for a content-creator assistant. Cover subject, setting, colors, composition, and notable details.',
  ocr:
    'Extract ALL readable text from this image (OCR). Preserve line breaks where helpful. If no text is visible, say so. Also give a one-sentence description of the image.',
  review:
    'You are reviewing this image for a content creator (YouTube thumbnail, social graphic, screenshot, or design).\n' +
    'Provide:\n' +
    '1) Brief description\n' +
    '2) OCR — all readable text (or "none")\n' +
    '3) Legibility / contrast notes\n' +
    '4) Click-worthiness / composition feedback (if it looks promotional)\n' +
    '5) Concrete improvement suggestions (2-4 bullets)',
  full:
    'Analyze this image for a CEO content workflow.\n' +
    'Return:\n' +
    '## Description\n…\n' +
    '## OCR text\n… (verbatim; or "none")\n' +
    '## Analysis\n… (layout, brand/style cues, issues)\n' +
    '## Recommendations\n… (short bullets)',
};

function normalizeMode(raw) {
  const m = String(raw || 'full').trim().toLowerCase();
  if (m === 'describe' || m === 'ocr' || m === 'review' || m === 'full') return m;
  if (m === 'analyze' || m === 'analysis') return 'full';
  if (m === 'thumbnail' || m === 'thumb') return 'review';
  return 'full';
}

function imageMimeFromName(filename, fallback) {
  const ext = extname(String(filename || '')).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
  };
  if (map[ext]) return map[ext];
  const fb = String(fallback || '').trim().toLowerCase();
  if (fb.startsWith('image/')) return fb.split(';')[0].trim();
  return 'image/jpeg';
}

function assertIsImage(filename, mimeType) {
  const ext = extname(String(filename || '')).toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (IMAGE_EXTS.has(ext) || mime.startsWith('image/')) return;
  const err = new Error(
    `analyze_image expects an image file (jpg/png/gif/webp). Got filename=${filename || '?'} mime=${mimeType || '?'}. Use speech_stt for audio/video.`
  );
  err.status = 400;
  throw err;
}

function extractOcrHint(text) {
  const s = String(text || '');
  const ocrBlock = s.match(/##\s*OCR\s*text\s*\n([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (ocrBlock) return String(ocrBlock[1] || '').trim();
  const ocrLine = s.match(/(?:^|\n)\s*OCR(?:\s*text)?\s*[:—-]\s*([\s\S]*?)(?=\n\s*\d\)|\n\s*##|\n*$)/i);
  if (ocrLine) return String(ocrLine[1] || '').trim();
  return null;
}

/**
 * @param {object} body
 * @param {string} ownerUserId
 */
export async function executeAnalyzeImageTool(body = {}, ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('Could not resolve CEO user for this session');
    err.status = 403;
    throw err;
  }

  const cfg = getVisionConfig(owner);
  if (cfg.error || !cfg.apiKey || !cfg.baseUrl) {
    const err = new Error(cfg.error || 'Image analysis not configured');
    err.status = 503;
    err.code = cfg.error_code || 'vision_not_configured';
    throw err;
  }

  const mode = normalizeMode(body.mode || body.analysis_mode || body.analysisMode);
  const userPrompt = String(body.prompt || body.question || body.instruction || '').trim();
  const systemPrompt = MODE_PROMPTS[mode] || MODE_PROMPTS.full;
  const finalPrompt = userPrompt
    ? `${systemPrompt}\n\nAdditional instructions from the user:\n${userPrompt}`
    : systemPrompt;

  let buffer = null;
  let filename = String(body.filename || 'image.jpg').trim() || 'image.jpg';
  let mimeType = String(body.mime_type || body.mimeType || 'image/jpeg').trim() || 'image/jpeg';
  let source = 'base64';

  const mediaRaw =
    body.path ||
    body.image ||
    body.media ||
    body.media_ref ||
    body.relative_path ||
    body.relativePath ||
    body.artifact_id ||
    body.artifactId;

  if (typeof mediaRaw === 'string' && mediaRaw.trim()) {
    try {
      const got = resolveOwnerMediaBuffer(owner, mediaRaw.trim(), {
        defaultFilename: filename,
        defaultMime: mimeType,
        kindLabel: 'Image',
      });
      buffer = got.buffer;
      filename = got.filename || filename;
      mimeType = got.mimeType || mimeType;
      source = got.source;
    } catch (pathErr) {
      if (!body.content_base64 && !body.contentBase64) {
        const err = new Error(pathErr.message || String(pathErr));
        err.status = pathErr.status || 400;
        throw err;
      }
    }
  }

  if (!buffer) {
    const ref = parseMediaRef(mediaRaw);
    if (ref?.artifactId) {
      const got = readMediaArtifactBuffer(owner, ref.artifactId);
      if (!got) {
        const err = new Error(`Image artifact not found: ${ref.artifactId}`);
        err.status = 404;
        throw err;
      }
      buffer = got.buffer;
      filename = got.row.filename || filename;
      mimeType = got.row.mime_type || mimeType;
      source = 'artifact';
    } else if (body.content_base64 || body.contentBase64) {
      buffer = Buffer.from(String(body.content_base64 || body.contentBase64), 'base64');
      if (!buffer.length) {
        const err = new Error('empty content_base64');
        err.status = 400;
        throw err;
      }
      source = 'base64';
    } else {
      const err = new Error(
        'Provide MEDIA:/path, inbound/attachments/<file>, relative_path, artifact_id, or content_base64'
      );
      err.status = 400;
      throw err;
    }
  }

  assertIsImage(filename, mimeType);
  mimeType = imageMimeFromName(filename, mimeType);

  const maxBytes = (cfg.maxBytesMb || 15) * 1024 * 1024;
  if (buffer.length > maxBytes) {
    const err = new Error(`Image exceeds ${cfg.maxBytesMb}MB limit`);
    err.status = 413;
    throw err;
  }

  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
  const chatUrl = `${String(cfg.baseUrl).replace(/\/$/, '')}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  const payload = {
    model: cfg.model,
    max_tokens: cfg.maxTokens || 1200,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: finalPrompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  let res;
  try {
    res = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(cfg.timeoutMs || 90000),
    });
  } catch (e) {
    console.warn('[vision-tools] analyze_image upstream fetch failed', e?.message || e);
    const err = new Error(`Vision upstream unreachable: ${e?.message || e}`);
    err.status = 502;
    throw err;
  }

  const textBody = await res.text();
  if (!res.ok) {
    console.warn('[vision-tools] analyze_image upstream error', {
      status: res.status,
      detail: textBody.slice(0, 240),
      model: cfg.model,
      source: cfg.source,
    });
    const err = new Error(`Vision API ${res.status}: ${textBody.slice(0, 400)}`);
    err.status = 502;
    throw err;
  }

  let parsed = {};
  try {
    parsed = JSON.parse(textBody);
  } catch {
    parsed = {};
  }
  const content = String(parsed?.choices?.[0]?.message?.content || '').trim();
  if (!content) {
    const err = new Error('Vision API returned empty content');
    err.status = 502;
    throw err;
  }

  const ocrText = mode === 'ocr' ? content : extractOcrHint(content);

  console.info('[vision-tools] analyze_image ok', {
    owner: owner.slice(0, 12),
    chars: content.length,
    mode,
    model: cfg.model,
    source,
    filename,
    bytes: buffer.length,
  });

  return {
    ok: true,
    mode,
    description: content,
    text: content,
    ocr_text: ocrText,
    filename,
    mime_type: mimeType,
    source,
    model: cfg.model,
    engine: 'vision_llm',
    using_byok: !!cfg.using_byok,
  };
}

/**
 * Workflow node entry — same path resolution as speech_stt.
 */
export async function executeAnalyzeImageTask(resolvedInputs, nodeConfig = {}, context = null) {
  const owner = context?.owner_user_id || context?.actor?.id;
  if (!owner) throw new Error('analyze_image node requires workflow owner');
  const media =
    resolvedInputs.image ??
    resolvedInputs.path ??
    resolvedInputs.media ??
    resolvedInputs.audio ??
    resolvedInputs.text;
  return executeAnalyzeImageTool(
    {
      path: media,
      prompt: resolvedInputs.prompt || nodeConfig.prompt,
      mode: resolvedInputs.mode || nodeConfig.mode || 'full',
      model: nodeConfig.model,
    },
    owner
  );
}

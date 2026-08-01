/**
 * Resolve OpenClaw virtual media URLs for browser/API-served assets.
 * sandbox:/media/browser/uuid.png → /api/media/openclaw/browser/uuid.png
 * sandbox:/api/media/openclaw/generated/uuid.png → /api/media/openclaw/generated/uuid.png
 */
export function resolveMediaSrc(src) {
  if (!src || typeof src !== 'string') return src;
  let trimmed = src.trim();

  // Strip MEDIA: and map OpenClaw container FS paths → API.
  if (/^MEDIA:\s*/i.test(trimmed)) {
    trimmed = trimmed.replace(/^MEDIA:\s*/i, '');
  }
  const ocFs = trimmed.match(/(?:^|\/)\.openclaw\/media\/(.+)$/i);
  if (ocFs) {
    return `/api/media/openclaw/${ocFs[1]}`;
  }

  if (trimmed.startsWith('sandbox:/api/media/')) {
    return trimmed.slice('sandbox:'.length);
  }
  if (trimmed.startsWith('sandbox:api/media/')) {
    return `/${trimmed.slice('sandbox:'.length)}`;
  }
  if (trimmed.startsWith('sandbox:/media/')) {
    return `/api/media/openclaw/${trimmed.slice('sandbox:/media/'.length)}`;
  }
  if (trimmed.startsWith('sandbox:media/')) {
    return `/api/media/openclaw/${trimmed.slice('sandbox:media/'.length)}`;
  }
  // CEO media artifacts live under /api/media/artifacts (not openclaw).
  if (trimmed.startsWith('/media/artifacts/')) {
    return `/api${trimmed}`;
  }
  if (trimmed.startsWith('/media/')) {
    return `/api/media/openclaw/${trimmed.slice('/media/'.length)}`;
  }
  return trimmed;
}

/**
 * Normalize agent-emitted media URLs before fetch.
 * Handles ". png" spaces, "ai/api/media/..." prefixes, trailing punctuation.
 */
export function normalizeMediaUrl(src) {
  if (!src || typeof src !== 'string') return src;
  let s = src.trim();
  if (!s) return s;
  // Agents sometimes prefix MEDIA: before the path
  s = s.replace(/^MEDIA:\s*/i, '');
  // ". png" / ".  jpg" → ".png"
  s = s.replace(/\.\s+(png|jpe?g|gif|webp|mp4|webm)\b/gi, '.$1');
  s = s.replace(/[)\].,;:'"]+$/g, '');
  // Pull out api/media path even when prefixed (e.g. "ai/api/media/...")
  const m = s.match(/(?:https?:\/\/[^\s]+)|(?:\/?api\/media\/[^\s]+)/i);
  if (m) s = m[0];
  if (/^api\/media\//i.test(s)) s = `/${s}`;
  else if (!/^https?:\/\//i.test(s) && /api\/media\//i.test(s)) {
    const idx = s.toLowerCase().indexOf('api/media/');
    s = `/${s.slice(idx)}`;
  }
  return resolveMediaSrc(s);
}

/** Collect media URLs from free text (markdown links, bare paths, messy agent replies). */
export function extractMediaUrlsFromText(text) {
  const s = String(text || '');
  const out = [];
  const push = (raw) => {
    const url = normalizeMediaUrl(raw);
    if (!url) return;
    const looks =
      /^https?:\/\//i.test(url) ||
      /^\/api\/media\//i.test(url) ||
      /\.(png|jpe?g|gif|webp|mp4|webm)(\?|$)/i.test(url);
    if (!looks) return;
    if (!out.includes(url)) out.push(url);
  };
  for (const m of s.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) push(m[1]);
  for (const m of s.matchAll(/\[[^\]]*\]\(([^)]*api\/media\/[^)]+)\)/gi)) push(m[1]);
  for (const m of s.matchAll(/\[[^\]]*\]\((MEDIA:[^)]+)\)/gi)) push(m[1]);
  for (const m of s.matchAll(
    /(?:https?:\/\/[^\s)\]"'<>]+)|(?:\/?api\/media\/[^\s)\]"'<>]*?\.(?:\s*)(?:png|jpe?g|gif|webp|mp4|webm|wav|mp3|m4a|ogg|opus))/gi
  )) {
    push(m[0]);
  }
  return out;
}

export function isResolvableMediaUrl(url) {
  if (!url) return false;
  const raw = String(url);
  const n = normalizeMediaUrl(url) || url;
  return (
    n.startsWith('data:') ||
    n.startsWith('http://') ||
    n.startsWith('https://') ||
    n.startsWith('/api/media/') ||
    n.startsWith('sandbox:/api/media/') ||
    n.startsWith('sandbox:api/media/') ||
    n.startsWith('sandbox:/media/') ||
    n.startsWith('sandbox:media/') ||
    n.startsWith('/media/') ||
    /^MEDIA:/i.test(raw) ||
    /\.openclaw\/media\//i.test(raw) ||
    /api\/media\//i.test(raw)
  );
}

const imageExt = /\.(png|jpe?g|gif|webp|bmp|svg)(\?[^\s"'<>]*)?$/i;
const videoExt = /\.(mp4|webm|ogv)(\?[^\s"'<>]*)?$/i;
const audioExt = /\.(wav|mp3|m4a|aac|opus|flac|ogg)(\?[^\s"'<>]*)?$/i;
const imageInPath = /\.(png|jpe?g|gif|webp|bmp|svg)([\?&]|$)/i;

/** Classify media for inline chat render (artifact downloads often omit extensions). */
export function guessChatMediaType(url) {
  const raw = String(url || '').trim();
  const resolved = resolveMediaSrc(raw) || raw;
  if (/^data:audio\//i.test(raw)) return 'audio';
  if (/^data:video\//i.test(raw)) return 'video';
  if (/^data:image\//i.test(raw) || /^data:/i.test(raw)) return 'image';
  if (audioExt.test(resolved) || audioExt.test(raw)) return 'audio';
  if (videoExt.test(resolved) || videoExt.test(raw)) return 'video';
  if (imageExt.test(resolved) || imageExt.test(raw) || imageInPath.test(resolved)) return 'image';
  if (/\/api\/media\/artifacts\//i.test(resolved) || /\/media\/artifacts\//i.test(raw)) {
    if (/speech|audio|tts|\.wav|\.mp3|\.m4a|\.ogg|\.opus/i.test(raw + resolved)) return 'audio';
    if (/video|\.mp4|\.webm/i.test(raw + resolved)) return 'video';
    return 'audio';
  }
  if (/\/api\/media\/openclaw\//i.test(resolved) && /speech|tts|audio/i.test(resolved)) return 'audio';
  return 'image';
}

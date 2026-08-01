/**
 * Absolute + channel-delivery helpers for generated media.
 *
 * Dashboard chat: relative /api/media/... (Bearer) or MEDIA:/local path (rewritten in UI).
 * WhatsApp: must attach from local disk (MEDIA:/abs/path) — never a world-open HTTPS URL.
 * Auth-gated https://.../api/media/... without a session will show "Media failed" on WhatsApp.
 *
 * Signed ?exp=&sig= public fetch is OFF by default (MEDIA_PUBLIC_SIGNED=1 to re-enable).
 */
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getPublicBaseUrl } from '../config/public-url.js';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import { registerOpenClawMediaOwnership } from './openclaw-media-ownership.js';
import { sanitizeContentOwnerPart } from './content-explorer.js';

const DEFAULT_PUBLIC_TTL_SEC = 7 * 24 * 60 * 60;

/** When true, allow GET /api/media/openclaw/...?exp=&sig= without Bearer (legacy). Default off. */
export function isMediaPublicSignedEnabled() {
  return String(process.env.MEDIA_PUBLIC_SIGNED || '').trim() === '1';
}

function mediaSigningSecret() {
  return (
    process.env.MEDIA_SIGNING_SECRET ||
    process.env.TOOLS_API_KEY ||
    process.env.JWT_SECRET ||
    process.env.AGENT_OS_INTERNAL_TOKEN ||
    'agent-os-media-dev'
  );
}

/** Normalize tool/agent media paths to a browser/API path under /api/media. */
export function normalizeMediaApiPath(pathOrUrl) {
  let p = String(pathOrUrl || '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      p = `${u.pathname}${u.search || ''}`;
    } catch {
      return p;
    }
  }
  p = p.replace(/^MEDIA:\s*/i, '');
  if (p.startsWith('sandbox:/api/media/')) p = p.slice('sandbox:'.length);
  else if (p.startsWith('sandbox:/media/')) {
    p = `/api/media/openclaw/${p.slice('sandbox:/media/'.length)}`;
  } else if (p.startsWith('/media/artifacts/')) {
    p = `/api${p}`;
  } else if (p.startsWith('/media/')) {
    p = `/api/media/openclaw/${p.slice('/media/'.length)}`;
  } else if (!p.startsWith('/') && !/^api\/media\//i.test(p)) {
    p = `/${p}`;
  }
  return p;
}

export function toAbsoluteMediaUrl(pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = normalizeMediaApiPath(raw);
  if (!path) return null;
  const base = String(getPublicBaseUrl() || '').replace(/\/$/, '');
  if (!base) return path;
  return base + (path.startsWith('/') ? path : '/' + path);
}

/**
 * HMAC for optional public media fetch (WhatsApp / OpenClaw HTTP media resolver).
 * Disabled unless MEDIA_PUBLIC_SIGNED=1.
 * @param {string} relativeUnderOpenclaw e.g. generated/uuid.png
 */
export function signMediaPublic(relativeUnderOpenclaw, ttlSec = DEFAULT_PUBLIC_TTL_SEC) {
  if (!isMediaPublicSignedEnabled()) return null;
  const rel = String(relativeUnderOpenclaw || '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');
  if (!rel || rel.includes('..')) return null;
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSec) || DEFAULT_PUBLIC_TTL_SEC);
  const payload = `${rel}:${exp}`;
  const sig = createHmac('sha256', mediaSigningSecret()).update(payload).digest('base64url');
  return { rel, exp, sig };
}

export function verifyMediaPublicSig(relativeUnderOpenclaw, exp, sig) {
  if (!isMediaPublicSignedEnabled()) return false;
  const rel = String(relativeUnderOpenclaw || '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');
  const expN = Number(exp);
  const got = String(sig || '');
  if (!rel || rel.includes('..') || !Number.isFinite(expN) || !got) return false;
  if (expN < Math.floor(Date.now() / 1000)) return false;
  const expect = createHmac('sha256', mediaSigningSecret()).update(`${rel}:${expN}`).digest('base64url');
  try {
    const a = Buffer.from(expect);
    const b = Buffer.from(got);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Absolute HTTPS URL with ?exp=&sig= — only when MEDIA_PUBLIC_SIGNED=1.
 * Prefer MEDIA: attach for WhatsApp; do not expose by default.
 */
export function toSignedPublicMediaUrl(relativeApiPath, ttlSec = DEFAULT_PUBLIC_TTL_SEC) {
  if (!isMediaPublicSignedEnabled()) return null;
  const apiPath = normalizeMediaApiPath(relativeApiPath);
  const m = apiPath.match(/^\/api\/media\/openclaw\/(.*)$/);
  if (!m) return toAbsoluteMediaUrl(apiPath);
  const signed = signMediaPublic(m[1], ttlSec);
  if (!signed) return toAbsoluteMediaUrl(apiPath);
  const base = String(getPublicBaseUrl() || '').replace(/\/$/, '');
  const path = `/api/media/openclaw/${signed.rel}?exp=${signed.exp}&sig=${encodeURIComponent(signed.sig)}`;
  return base ? `${base}${path}` : path;
}

/**
 * Enrich a persisted OpenClaw-generated file for chat + WhatsApp delivery.
 * @param {string} filename e.g. uuid.png
 * @param {string} [subdir='generated']
 */
/** Dashboard-friendly markdown for chat (audio/video play inline; images as markdown image). */
function webMarkdownForMedia(relative_url) {
  const rel = String(relative_url || '').trim();
  if (!rel) return '';
  if (/\.(wav|mp3|m4a|aac|opus|flac|ogg)(\?|$)/i.test(rel)) return `[🔊 Audio](${rel})`;
  if (/\.(mp4|webm|ogv)(\?|$)/i.test(rel)) return `[🎬 Video](${rel})`;
  return `![generated](${rel})`;
}


export function enrichGeneratedOpenClawMedia(filename, subdir = 'generated') {
  // filename may be "uuid.ext" or "{ceo}/uuid.ext" for per-owner layouts.
  const name = String(filename || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!name || name.includes('..') || name.split('/').some((p) => !p || p === '.' || p === '..')) {
    throw new Error('invalid media filename');
  }
  const local_path = join(getOpenClawMediaDir(subdir), ...name.split('/'));
  const relative_url = '/api/media/openclaw/' + subdir + '/' + name;
  const media_uri = 'MEDIA:' + local_path;
  const public_url = toSignedPublicMediaUrl(relative_url);
  return {
    url: media_uri,
    media_uri,
    local_path,
    relative_url,
    absolute_url: toAbsoluteMediaUrl(relative_url),
    public_url: public_url || null,
    paste_exactly: media_uri,
    web_markdown: webMarkdownForMedia(relative_url),
    delivery_hint:
      'Paste paste_exactly (MEDIA:/abs/path) on its own line so WhatsApp attaches the file. Dashboard chat renders MEDIA: and /api/media paths inline with auth. Do NOT paste public HTTPS media links.',
  };
}

/**
 * Write bytes under ~/.openclaw/media/<subdir>/ for WhatsApp MEDIA: attach + dashboard /api/media.
 * @param {Buffer} buffer
 * @param {string} [filenameHint]
 * @param {string} [subdir='generated']
 */
export function persistGeneratedOpenClawMedia(buffer, filenameHint = 'media.bin', subdir = 'generated', ownerUserId = null) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('media buffer required');
  }
  const hint = String(filenameHint || 'media.bin').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const extMatch = hint.match(/(\.[a-z0-9]{1,8})$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : '.bin';
  const leaf = `${randomUUID()}${ext}`;
  const ownerPart = ownerUserId ? sanitizeContentOwnerPart(ownerUserId) : null;
  const filename = ownerPart ? `${ownerPart}/${leaf}` : leaf;
  const dir = ownerPart ? getOpenClawMediaDir(subdir, ownerPart) : getOpenClawMediaDir(subdir);
  mkdirSync(dir, { recursive: true });
  const local_path = join(dir, leaf);
  writeFileSync(local_path, buffer);
  if (process.env.MEDIA_URL_QUIET !== '1') {
    console.info('[media-url] persisted openclaw media', {
      subdir,
      filename,
      bytes: buffer.length,
      owner: ownerUserId || null,
      public_signed: isMediaPublicSignedEnabled(),
    });
  }
  const enriched = enrichGeneratedOpenClawMedia(filename, subdir);
  if (ownerUserId) {
    try {
      registerOpenClawMediaOwnership(subdir + '/' + filename, ownerUserId, {
        source: 'persistGeneratedOpenClawMedia',
        bytes: buffer.length,
      });
    } catch (e) {
      console.warn('[media-url] ownership register failed', e?.message || e);
    }
  } else {
    console.warn('[media-url] persisted without ownerUserId', { subdir, filename });
  }
  return enriched;
}

/** Enrich any /api/media/... result; optional local_path for channel attach. */
export function enrichMediaResult(relativeOrAbsoluteUrl, localPath = null) {
  const relative_url =
    normalizeMediaApiPath(relativeOrAbsoluteUrl) || String(relativeOrAbsoluteUrl || '').trim();
  const public_url = toSignedPublicMediaUrl(relative_url);
  const out = {
    url: localPath ? 'MEDIA:' + localPath : relative_url,
    relative_url,
    absolute_url: toAbsoluteMediaUrl(relative_url),
    public_url: public_url || null,
  };
  if (localPath) {
    out.local_path = localPath;
    out.media_uri = 'MEDIA:' + localPath;
    out.paste_exactly = out.media_uri;
    out.web_markdown = webMarkdownForMedia(relative_url);
    out.delivery_hint =
      'Paste paste_exactly (MEDIA: line) for WhatsApp attachment. Dashboard renders MEDIA: and relative_url with auth.';
  }
  return out;
}
/**
 * Serve OpenClaw media files (browser screenshots, generated images/audio/video) from ~/.openclaw/media/
 * Auth: GET /api/media/openclaw/... (Bearer) — default; not world-public.
 * Optional legacy: GET ...?exp=&sig= only when MEDIA_PUBLIC_SIGNED=1 (off by default).
 * WhatsApp delivery uses MEDIA:/abs/path attach on the shared volume, not public HTTPS.
 */
import { Router } from 'express';
import { basename, join, normalize } from 'path';
import { closeSync, createReadStream, existsSync, openSync, readSync } from 'fs';
import { stat } from 'fs/promises';
import { requireAuth } from '../middleware/auth.js';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import { isMediaPublicSignedEnabled, verifyMediaPublicSig } from '../services/media-url.js';
import { canAccessOpenClawMedia } from '../services/openclaw-media-ownership.js';
import { guessMimeFromFilename } from '../services/master-data-extract.js';

const router = Router();
const MEDIA_ROOT = getOpenClawMediaDir();

function readFileHead(filePath, n = 16) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(n);
    const got = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd != null) closeSync(fd);
  }
}

/** Path extname (not lastIndexOf on the full path — ".openclaw" must not win). */
export function resolveOpenClawMediaMime(filePath) {
  const name = basename(String(filePath || ''));
  let mime = guessMimeFromFilename(name);
  if (mime && mime !== 'application/octet-stream') return mime;
  const head = readFileHead(filePath, 16);
  if (head.length >= 5 && head.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  return mime || 'application/octet-stream';
}

function contentDispositionFilename(filePath, mime) {
  let name = basename(String(filePath || 'file')) || 'file';
  if (mime === 'application/pdf' && !/\.pdf$/i.test(name)) name = `${name}.pdf`;
  if (mime === 'text/html' && !/\.html?$/i.test(name)) name = `${name}.html`;
  if (mime === 'image/svg+xml' && !/\.svg$/i.test(name)) name = `${name}.svg`;
  return name.replace(/["\\\r\n]/g, '_');
}

function safeMediaPath(relativePath) {
  const cleaned = String(relativePath || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!cleaned || cleaned.includes('..')) return null;
  const abs = normalize(join(MEDIA_ROOT, cleaned));
  const rootNorm = normalize(MEDIA_ROOT);
  if (!abs.startsWith(rootNorm)) return null;
  return abs;
}

async function streamMediaFile(rel, res) {
  if (!rel) return res.status(404).json({ error: 'Media path required' });
  const filePath = safeMediaPath(rel);
  if (!filePath || !existsSync(filePath)) {
    return res.status(404).json({ error: 'Media not found' });
  }
  const st = await stat(filePath);
  if (!st.isFile()) return res.status(404).json({ error: 'Not a file' });
  const mime = resolveOpenClawMediaMime(filePath);
  const filename = contentDispositionFilename(filePath, mime);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', st.size);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  createReadStream(filePath).pipe(res);
}

/** Optional signed public fetch — disabled unless MEDIA_PUBLIC_SIGNED=1.
 * When disabled, ignore ?exp=&sig= and require Bearer (so old chat links still play). */
router.use(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const exp = req.query?.exp;
  const sig = req.query?.sig;
  if (exp == null || sig == null || String(sig).trim() === '') return next();
  if (!isMediaPublicSignedEnabled()) {
    // Fall through to requireAuth — do not serve anonymously.
    return next();
  }
  const rel = decodeURIComponent(String(req.path || '').replace(/^\//, ''));
  if (!verifyMediaPublicSig(rel, exp, sig)) {
    return res.status(401).json({ error: 'Invalid or expired media signature' });
  }
  try {
    await streamMediaFile(rel, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.use(requireAuth);

router.use(async (req, res) => {
  try {
    const rel = decodeURIComponent(req.path.replace(/^\//, ''));
    const filePath = safeMediaPath(rel);
    if (!filePath || !existsSync(filePath)) {
      return res.status(404).json({ error: 'Media not found' });
    }
    const access = canAccessOpenClawMedia(rel, req.authUser);
    if (!access.ok) {
      console.warn('[media] openclaw deny', {
        user: req.authUser?.id || null,
        role: req.authUser?.role || null,
        rel,
        reason: access.reason,
      });
      return res.status(403).json({ error: 'Media access denied', reason: access.reason });
    }
    await streamMediaFile(rel, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

/**
 * Serve OpenClaw media files (browser screenshots, generated images/audio/video) from ~/.openclaw/media/
 * Auth: GET /api/media/openclaw/... (Bearer) — default; not world-public.
 * Optional legacy: GET ...?exp=&sig= only when MEDIA_PUBLIC_SIGNED=1 (off by default).
 * WhatsApp delivery uses MEDIA:/abs/path attach on the shared volume, not public HTTPS.
 */
import { Router } from 'express';
import { join, normalize } from 'path';
import { existsSync, createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { requireAuth } from '../middleware/auth.js';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import { isMediaPublicSignedEnabled, verifyMediaPublicSig } from '../services/media-url.js';
import { canAccessOpenClawMedia } from '../services/openclaw-media-ownership.js';

const router = Router();
const MEDIA_ROOT = getOpenClawMediaDir();

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
};

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
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
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

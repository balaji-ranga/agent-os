/**
 * CEO media artifact download / upload APIs.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  createMediaArtifact,
  getMediaArtifact,
  listMediaArtifacts,
  deleteMediaArtifact,
  readMediaArtifactBuffer,
  toMediaRef,
} from '../services/ceo-media-artifacts.js';

const router = Router();

function ownerOr403(req, res) {
  const ownerUserId = resolveAuthenticatedCeoUserId(req);
  if (!ownerUserId) {
    res.status(403).json({ error: 'CEO context required' });
    return null;
  }
  return ownerUserId;
}

router.get('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const kind = req.query.kind ? String(req.query.kind) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json({ artifacts: listMediaArtifacts(owner, { kind, limit }) });
  } catch (e) {
    console.error('[media] list failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'List failed' });
  }
});

router.post('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const { filename, mimeType, kind, contentBase64, durationMs, meta } = req.body || {};
    if (!contentBase64) {
      return res.status(400).json({ error: 'contentBase64 required' });
    }
    const buffer = Buffer.from(String(contentBase64), 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'empty content' });
    const maxMb = Number(process.env.MEDIA_ARTIFACT_MAX_MB || 40);
    if (buffer.length > maxMb * 1024 * 1024) {
      return res.status(413).json({ error: `File exceeds ${maxMb}MB limit` });
    }
    const { ref } = createMediaArtifact(owner, {
      buffer,
      filename: filename || 'upload.bin',
      mimeType: mimeType || 'application/octet-stream',
      kind,
      durationMs,
      meta,
    });
    res.status(201).json({ artifact: ref });
  } catch (e) {
    console.error('[media] upload failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Upload failed' });
  }
});

router.get('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const row = getMediaArtifact(owner, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ artifact: toMediaRef(row) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Get failed' });
  }
});

router.get('/:id/download', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const got = readMediaArtifactBuffer(owner, req.params.id);
    if (!got) return res.status(404).json({ error: 'Not found' });
    const { row, buffer } = got;
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${String(row.filename || 'file').replace(/"/g, '')}"`
    );
    res.send(buffer);
  } catch (e) {
    console.error('[media] download failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Download failed' });
  }
});

router.delete('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const ok = deleteMediaArtifact(owner, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Delete failed' });
  }
});

export default router;

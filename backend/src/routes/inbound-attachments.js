/**
 * CEO workspace inbound attachments API.
 */
import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import { basename } from 'path';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  saveInboundAttachment,
  listInboundAttachments,
  ensureInboundAttachmentsDirs,
  resolveInboundRelativePath,
} from '../services/inbound-attachments.js';
import {
  isMediaAttachment,
  isRagIndexable,
  guessMimeFromFilename,
} from '../services/master-data-extract.js';

const router = Router();
router.use(requireAuth);
router.use(requireCeoOrAdmin);

function ownerOr403(req, res) {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || req.query || {});
    if (!owner) {
      res.status(403).json({ error: 'CEO context required' });
      return null;
    }
    return owner;
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message || 'CEO context required' });
    return null;
  }
}

router.get('/inbound-attachments', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    ensureInboundAttachmentsDirs(owner);
    const items = listInboundAttachments(owner).map((f) => {
      const mime = guessMimeFromFilename(f.filename);
      return {
        ...f,
        mime_guess: mime,
        rag_indexable: isRagIndexable(mime, f.filename),
        is_media: isMediaAttachment(mime, f.filename),
      };
    });
    res.json({ items, folder: 'inbound/attachments' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/inbound-attachments', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const b64 = req.body?.contentBase64 || req.body?.content_base64;
    if (!b64) return res.status(400).json({ error: 'contentBase64 required' });
    const buffer = Buffer.from(String(b64), 'base64');
    const out = saveInboundAttachment(owner, {
      buffer,
      filename: req.body?.filename || 'upload.bin',
      mimeType: req.body?.mimeType || req.body?.mime_type,
    });
    res.status(201).json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** Download one inbound file (CEO-scoped). Query: relative_path=inbound/attachments/… */
router.get('/inbound-attachments/download', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const rel = String(req.query.relative_path || req.query.path || '').trim();
    const abs = resolveInboundRelativePath(owner, rel);
    if (!abs || !existsSync(abs)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const st = statSync(abs);
    const name = basename(abs);
    const mime = guessMimeFromFilename(name);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', st.size);
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
    createReadStream(abs).pipe(res);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;

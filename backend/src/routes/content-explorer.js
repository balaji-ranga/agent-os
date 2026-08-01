/**
 * Content Explorer API — list/download/hard-delete this CEO's uploaded + generated media.
 */
import { Router } from 'express';
import { createReadStream, existsSync } from 'fs';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  listContentExplorer,
  resolveContentExplorerDownload,
  deleteContentExplorerItems,
} from '../services/content-explorer.js';

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

/** GET /api/workspace/content-explorer?source=all|uploaded|generated */
router.get('/content-explorer', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const source = String(req.query?.source || 'all').toLowerCase();
    const out = listContentExplorer(owner, { source });
    res.json(out);
  } catch (e) {
    console.warn('[content-explorer] list failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to list content' });
  }
});

/** GET /api/workspace/content-explorer/download?kind=uploaded|generated&path=… */
router.get('/content-explorer/download', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const file = resolveContentExplorerDownload(owner, {
      kind: req.query?.kind,
      path: req.query?.path,
    });
    if (!existsSync(file.absolute_path)) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Type', file.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${file.filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    createReadStream(file.absolute_path).pipe(res);
  } catch (e) {
    console.warn('[content-explorer] download failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Download failed' });
  }
});

/**
 * POST /api/workspace/content-explorer/delete
 * Body: { items: [{ kind|source, path|relative_path }], all?: boolean, source?: all|uploaded|generated }
 * Hard-deletes from disk (no recycle bin).
 */
router.post('/content-explorer/delete', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const out = deleteContentExplorerItems(owner, {
      items: req.body?.items,
      all: !!req.body?.all,
      source: req.body?.source,
    });
    res.json(out);
  } catch (e) {
    console.warn('[content-explorer] delete failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Delete failed' });
  }
});

export default router;

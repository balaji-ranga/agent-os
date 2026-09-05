/**
 * Admin-only platform document APIs (OpenSearch PLATFORM_OWNER_ID).
 * Files under master-data/__platform__/docs/.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  PLATFORM_OWNER_ID,
  ensurePlatformHelpInOpenSearch,
  listDocuments as osListDocuments,
  getDocument as osGetDocument,
} from '../services/opensearch/index.js';
import {
  uploadDocument,
  getDocumentFile,
  reindexDocument,
  reindexAllDocuments,
  deleteDocument,
  ragDocuments,
} from '../services/master-data.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const page = await osListDocuments(PLATFORM_OWNER_ID, { excludeProtected: false, limit, offset });
    res.json({ ...page, owner_user_id: PLATFORM_OWNER_ID });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code || undefined });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, filename, mimeType, mime_type, contentBase64, content_base64, tags } =
      req.body || {};
    const document = await uploadDocument(PLATFORM_OWNER_ID, {
      title,
      filename: filename || 'document.txt',
      mimeType: mime_type || mimeType,
      contentBase64: content_base64 || contentBase64,
      tags: Array.isArray(tags) ? tags : ['platform-help'],
      source: 'platform',
      uploaded_by_type: 'admin',
      uploaded_by_id: req.authUser?.id || 'admin',
    });
    res.status(201).json({ document });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code || undefined });
  }
});

// Static paths before /:id
router.post('/reindex-all', async (req, res) => {
  try {
    const result = await reindexAllDocuments(PLATFORM_OWNER_ID);
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code || undefined });
  }
});

router.post('/rag', async (req, res) => {
  try {
    const { query, top_k, topK, document_id, documentId, summarize } = req.body || {};
    const result = await ragDocuments(PLATFORM_OWNER_ID, {
      query,
      topK: top_k || topK,
      documentId: document_id || documentId,
      summarize: summarize === undefined ? true : summarize,
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code || undefined });
  }
});

router.post('/seed-help', async (req, res) => {
  try {
    const result = await ensurePlatformHelpInOpenSearch();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code || undefined });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const document = await osGetDocument(PLATFORM_OWNER_ID, req.params.id);
    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json({ document });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code || undefined });
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const file = await getDocumentFile(PLATFORM_OWNER_ID, req.params.id);
    res.setHeader('Content-Type', file.meta.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(file.meta.filename).replace(/"/g, '')}"`
    );
    res.send(file.buffer);
  } catch (e) {
    res.status(e.status || 404).json({ error: e.message, code: e.code || undefined });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    res.json(await deleteDocument(PLATFORM_OWNER_ID, req.params.id, { force: true }));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code || undefined });
  }
});

router.post('/:id/reindex', async (req, res) => {
  try {
    const document = await reindexDocument(PLATFORM_OWNER_ID, req.params.id);
    res.json({ document });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code || undefined });
  }
});

export default router;

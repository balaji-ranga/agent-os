/**
 * Master data APIs — strict CEO tenancy (resolveAuthenticatedCeoUserId).
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import * as md from '../services/master-data.js';

const router = Router();

function ownerOr403(req, res) {
  const ownerUserId = resolveAuthenticatedCeoUserId(req);
  if (!ownerUserId) {
    res.status(403).json({ error: 'CEO context required' });
    return null;
  }
  return ownerUserId;
}

router.get('/tables', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json({ tables: md.listTables(owner) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/tables', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const { name, description, columns } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const table = md.createTable(owner, { name, description, columns });
    res.status(201).json({ table });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/tables/:tableId', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const description =
      req.body?.description != null
        ? req.body.description
        : req.body?.purpose != null
          ? req.body.purpose
          : undefined;
    if (description === undefined) {
      return res.status(400).json({ error: 'description (purpose) required' });
    }
    const table = md.updateTableMeta(owner, req.params.tableId, { description });
    res.json({ table });
  } catch (e) {
    const status = e.message === 'Table not found' ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.get('/tables/:tableId', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const table = md.getTable(owner, req.params.tableId);
    if (!table) return res.status(404).json({ error: 'Table not found' });
    const limit = req.query.limit != null ? Number(req.query.limit) : md.MASTER_DATA_PAGE_SIZE;
    const offset = req.query.offset != null ? Number(req.query.offset) : 0;
    const data = md.listRows(owner, req.params.tableId, { limit, offset });
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/tables/:tableId/rows', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const data = req.body?.data ?? req.body?.row ?? req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ error: 'row data object required' });
    }
    // Avoid treating wrapper keys as column values when body is the whole payload
    const rowData =
      req.body?.data != null || req.body?.row != null
        ? data
        : Object.fromEntries(
            Object.entries(req.body || {}).filter(([k]) => !['tableId', 'table_id'].includes(k))
          );
    const result = md.insertRow(owner, req.params.tableId, rowData);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/tables/:tableId/rows/:rowId', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const data = req.body?.data ?? req.body?.row ?? req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ error: 'row data object required' });
    }
    const rowData =
      req.body?.data != null || req.body?.row != null
        ? data
        : Object.fromEntries(
            Object.entries(req.body || {}).filter(([k]) => !['tableId', 'table_id', 'id'].includes(k))
          );
    const result = md.updateRow(owner, req.params.tableId, req.params.rowId, rowData);
    res.json(result);
  } catch (e) {
    const status = e.message === 'Row not found' || e.message === 'Table not found' ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.delete('/tables/:tableId/rows/:rowId', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(md.deleteRow(owner, req.params.tableId, req.params.rowId));
  } catch (e) {
    const status = e.message === 'Row not found' || e.message === 'Table not found' ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.delete('/tables/:tableId', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(md.deleteTable(owner, req.params.tableId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/tables/import-csv', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const { name, description, csv, csvText, table_id, tableId } = req.body || {};
    const text = csvText ?? csv;
    if (!text) return res.status(400).json({ error: 'csv / csvText required' });
    const result = md.importCsv(owner, {
      name,
      description,
      csvText: text,
      tableId: table_id || tableId || null,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/tables/:tableId/query', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const { query, column, equals, limit, offset } = req.body || {};
    const result = md.queryTable(owner, {
      tableId: req.params.tableId,
      query,
      column,
      equals,
      limit,
      offset,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/documents', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json({ documents: md.listDocuments(owner) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/documents', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const { title, filename, mime_type, mimeType, content_base64, contentBase64, content_text, contentText } =
      req.body || {};
    const doc = await md.uploadDocument(owner, {
      title,
      filename: filename || 'document.txt',
      mimeType: mime_type || mimeType,
      contentBase64: content_base64 || contentBase64,
      contentText: content_text ?? contentText,
    });
    res.status(201).json({ document: doc });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/documents/reindex-all', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const result = await md.reindexAllDocuments(owner);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/documents/:documentId/reindex', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const document = await md.reindexDocument(owner, req.params.documentId);
    res.json({ document });
  } catch (e) {
    const status = /not found|missing/i.test(e.message || '') ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.get('/documents/:documentId', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const document = md.getDocument(owner, req.params.documentId);
    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json({ document });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/documents/:documentId/download', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const file = md.getDocumentFile(owner, req.params.documentId);
    res.setHeader('Content-Type', file.meta.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(file.meta.filename).replace(/"/g, '')}"`
    );
    res.send(file.buffer);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

router.delete('/documents/:documentId', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(md.deleteDocument(owner, req.params.documentId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/rag', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const { query, top_k, topK, document_id, documentId, summarize } = req.body || {};
    const result = await md.ragDocuments(owner, {
      query,
      topK: top_k || topK,
      documentId: document_id || documentId,
      summarize,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Unified query used by UI tests and tools. */
router.post('/query', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const result = await md.runMasterDataQuery(owner, req.body?.config || req.body || {}, req.body?.input || req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;

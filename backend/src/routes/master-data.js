/**
 * Master data APIs — strict CEO tenancy (resolveAuthenticatedCeoUserId).
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import * as md from '../services/master-data.js';
import { knowledgeStore } from '../services/knowledge-store.js';
import {manageKnowledgeRecords} from '../services/knowledge-record-management.js';
import { connectedKnowledge, browseKnowledge } from '../services/knowledge-runtime.js';
import { answerConnectedKnowledge } from '../services/knowledge-answer.js';
import { knowledgeSearch } from '../services/knowledge-search.js';
import { knowledgePages } from '../services/knowledge-result-pages.js';
import { listKnowledgeAdvice, suggestKnowledgeMapping, decideKnowledgeAdvice } from '../services/knowledge-mapping-advice.js';
import { resolveKnowledgeAgent } from '../services/knowledge-agent-access.js';
import { assertKnowledgeSourceAccess, knowledgeConnectionRef } from '../services/knowledge-source-adapters.js';
import {
  previewCompanySetupKnowledge,
  reseedCompanySetupKnowledge,
  listIndustryBlueprintsForOwner,
  COMPANY_KNOWLEDGE_OVERWRITE_CONFIRM,
} from '../services/company-setup.js';

const router = Router();

router.use('/knowledge', requireAuth, requireCeoOrAdmin, (req,res,next) => {
  if(process.env.KNOWLEDGE_SYNC_ENABLED !== '1') return res.status(503).json({error:'Knowledge sources are not enabled on this server'});
  next();
});
function knowledgeRoute(handler) {
  return async(req,res)=>{try{const owner=ownerOr403(req,res);if(!owner)return;res.json(await handler(owner,req));}
    catch(error){res.status(error.status||400).json({error:error.message});}};
}
router.get('/knowledge/sources',knowledgeRoute(owner=>({sources:knowledgeStore().list(owner)})));
router.post('/knowledge/records/manage',knowledgeRoute((owner,req)=>manageKnowledgeRecords(owner,req.body)));
router.get('/knowledge/sources/:id/exclusions',knowledgeRoute((owner,req)=>{
  const rows=knowledgeStore().exclusions(owner,req.params.id,String(req.query.after||''));
  return {items:rows.slice(0,100),next:rows.length>100?rows[99].object_id:null};
}));
router.get('/knowledge/agents/:id/access',knowledgeRoute((owner,req)=>{
  const id=resolveKnowledgeAgent(owner,req.params.id),store=knowledgeStore();
  return {sources:store.list(owner),source_ids:store.agentSources(owner,id)};
}));
router.put('/knowledge/agents/:id/access',knowledgeRoute((owner,req)=>{
  const id=resolveKnowledgeAgent(owner,req.params.id);
  return {source_ids:knowledgeStore().setAgentSources(owner,id,req.body.source_ids)};
}));
router.post('/knowledge/sources',knowledgeRoute(async(owner,req)=>{
  const input={...req.body,connection_ref:await knowledgeConnectionRef(owner,req.body?.kind)};
  await assertKnowledgeSourceAccess(owner,input);
  return {source:knowledgeStore().save(owner,input)};
}));
router.patch('/knowledge/sources/:id',knowledgeRoute(async(owner,req)=>{
  const store=knowledgeStore();const prior=store.get(owner,req.params.id);
  if(!prior)throw Object.assign(new Error('Source not found'),{status:404});
  const input={...prior,...req.body,connection_ref:await knowledgeConnectionRef(owner,prior.kind)};await assertKnowledgeSourceAccess(owner,input);
  return {source:store.save(owner,input,req.params.id)};
}));
router.post('/knowledge/sources/:id/sync',knowledgeRoute((owner,req)=>({job:knowledgeStore().enqueue(owner,req.params.id)})));
router.post('/knowledge/sources/:id/enabled',knowledgeRoute((owner,req)=>({source:knowledgeStore().setEnabled(owner,req.params.id,req.body.enabled)})));
router.delete('/knowledge/sources/:id',knowledgeRoute((owner,req)=>({removed:knowledgeStore().remove(owner,req.params.id)})));
router.get('/knowledge/sources/:id/history',knowledgeRoute((owner,req)=>req.query.paginate==='1'?knowledgeStore().historyPage(owner,req.params.id,{after:req.query.after,limit:req.query.limit}):({jobs:knowledgeStore().history(owner,req.params.id)})));
router.get('/knowledge/jobs/:id/records',knowledgeRoute((owner,req)=>knowledgeStore().recordPage(owner,req.params.id,{after:req.query.after,limit:req.query.limit})));
router.get('/knowledge/sources/:id/records',knowledgeRoute((owner,req)=>browseKnowledge(owner,req.params.id,req.query.after||null,{query:req.query.q||'',limit:req.query.limit,compact:req.query.compact==='1'})));
router.get('/knowledge/mappings',knowledgeRoute((owner,req)=>req.query.paginate==='1'?knowledgeStore().relationshipPage(owner,{after:req.query.after,query:req.query.q,limit:req.query.limit}):({mappings:knowledgeStore().mappings(owner)})));
router.post('/knowledge/mappings',knowledgeRoute((owner,req)=>({mapping:knowledgeStore().addMapping(owner,req.body)})));
router.delete('/knowledge/mappings/:id',knowledgeRoute((owner,req)=>({removed:knowledgeStore().removeMapping(owner,req.params.id)})));
router.post('/knowledge/search',knowledgeRoute(async(owner,req)=>{
  const result=await(req.body.summarize===true?answerConnectedKnowledge(owner,req.body):connectedKnowledge(owner,req.body));
  return req.body.paginate===true?knowledgePages.create(owner,result,knowledgeStore().list(owner)):result;
}));
router.post('/knowledge/search/page',knowledgeRoute((owner,req)=>knowledgePages.read(owner,req.body,(o,id)=>knowledgeStore().get(o,id),assertKnowledgeSourceAccess)));
router.get('/knowledge/sources/:id/fields',knowledgeRoute(async(owner,req)=>{
  const source=knowledgeStore().get(owner,req.params.id);
  if(!source?.enabled||!source.revision||!source.collections.includes(req.query.collection))throw new Error('Select an indexed source and collection');
  await assertKnowledgeSourceAccess(owner,source);
  const fields=await knowledgeSearch().fields(owner,source,req.query.collection);
  const latest=knowledgeStore().get(owner,source.id);
  await assertKnowledgeSourceAccess(owner,latest);
  if(!latest?.enabled||latest.revision!==source.revision)throw new Error('Source changed; refresh the fields');
  return {fields};
}));
router.get('/knowledge/field-rules',knowledgeRoute((owner,req)=>knowledgeStore().relationshipPage(owner,{kind:'rules',after:req.query.after,query:req.query.q,limit:req.query.limit})));
async function saveFieldRule(owner,req){
  const store=knowledgeStore();
  for(const side of ['from','to']){
    const source=store.get(owner,req.body[`${side}_source`]);
    if(!source?.enabled||!source.revision||!source.collections.includes(req.body[`${side}_collection`]))throw new Error('Select an indexed collection');
    await assertKnowledgeSourceAccess(owner,source);
    const fields=await knowledgeSearch().fields(owner,source,req.body[`${side}_collection`]);
    if(!fields.includes(req.body[`${side}_field`]))throw new Error('Selected field is not indexed; synchronize source first');
  }
  return {rule:store.saveFieldRule(owner,req.body,req.params.id||null)};
}
router.post('/knowledge/field-rules',knowledgeRoute(saveFieldRule));
router.put('/knowledge/field-rules/:id',knowledgeRoute(saveFieldRule));
router.delete('/knowledge/field-rules/:id',knowledgeRoute((owner,req)=>({removed:knowledgeStore().removeFieldRule(owner,req.params.id)})));
router.get('/knowledge/mapping-advice',knowledgeRoute((owner,req)=>listKnowledgeAdvice(owner,{after:req.query.after,limit:req.query.limit})));
router.post('/knowledge/mapping-advice',knowledgeRoute((owner,req)=>suggestKnowledgeMapping(owner,req.body)));
router.post('/knowledge/mapping-advice/:id/decision',knowledgeRoute((owner,req)=>decideKnowledgeAdvice(owner,req.params.id,req.body.decision)));

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

/**
 * Company Setup knowledge pack status for this CEO (which tables exist / would be seeded).
 * GET /api/master-data/company-setup-knowledge?industry_id=&blueprint_id=
 */
router.get('/company-setup-knowledge', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const industry_id = req.query.industry_id ? String(req.query.industry_id) : undefined;
    const blueprint_id = req.query.blueprint_id ? String(req.query.blueprint_id) : undefined;
    const preview = previewCompanySetupKnowledge(owner, { industry_id, blueprint_id });
    const industryOpts = listIndustryBlueprintsForOwner(owner, industry_id || preview.industry_id);
    res.json({
      ...preview,
      industries: industryOpts,
      overwrite_confirm_phrase: COMPANY_KNOWLEDGE_OVERWRITE_CONFIRM,
    });
  } catch (e) {
    console.warn('[master-data] company-setup-knowledge preview failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to load company knowledge status' });
  }
});

/**
 * Reseed company-setup knowledge tables for this CEO.
 * If any target tables exist, body.confirm must be OVERWRITE_COMPANY_KNOWLEDGE.
 * POST /api/master-data/company-setup-knowledge/reseed
 */
router.post('/company-setup-knowledge/reseed', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const body = req.body || {};
    const result = await reseedCompanySetupKnowledge(owner, {
      industry_id: body.industry_id,
      blueprint_id: body.blueprint_id,
      confirm: body.confirm,
      confirm_overwrite: body.confirm_overwrite,
      seed_sops: body.seed_sops,
    });
    res.json(result);
  } catch (e) {
    console.warn('[master-data] company-setup-knowledge reseed failed', e?.message || e);
    const status = e.status || 500;
    res.status(status).json({
      error: e.message || 'Failed to reseed company knowledge',
      preview: e.preview || undefined,
      overwrite_confirm_phrase: COMPANY_KNOWLEDGE_OVERWRITE_CONFIRM,
    });
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

router.get('/documents', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const page = await md.listDocuments(owner, { limit, offset });
    if (Array.isArray(page)) {
      res.json({ documents: page, total: page.length, limit, offset, has_more: false });
    } else {
      res.json(page);
    }
  } catch (e) {
    const status = e.status || (e.code === 'OPENSEARCH_UNAVAILABLE' ? 503 : 400);
    res.status(status).json({ error: e.message, code: e.code || undefined });
  }
});

router.post('/documents', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const {
      title,
      filename,
      mime_type,
      mimeType,
      content_base64,
      contentBase64,
      content_text,
      contentText,
      tags,
      source,
      uploaded_by_type,
      uploadedByType,
      uploaded_by_id,
      uploadedById,
    } = req.body || {};
    const doc = await md.uploadDocument(owner, {
      title,
      filename: filename || 'document.txt',
      mimeType: mime_type || mimeType,
      contentBase64: content_base64 || contentBase64,
      contentText: content_text ?? contentText,
      tags,
      source,
      uploaded_by_type: uploaded_by_type || uploadedByType,
      uploaded_by_id: uploaded_by_id || uploadedById,
    });
    res.status(201).json({ document: doc });
  } catch (e) {
    const status = e.status || (e.code === 'OPENSEARCH_UNAVAILABLE' ? 503 : 400);
    res.status(status).json({ error: e.message, code: e.code || undefined });
  }
});

/**
 * Index a workspace inbound attachment into this CEO's OpenSearch RAG indices
 * (same as Documents upload). Body: { relative_path, title? }.
 */
router.post('/documents/from-inbound', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const { indexDocumentForAgent } = await import('../services/master-data-tools.js');
    const out = await indexDocumentForAgent(owner, {
      relative_path: req.body?.relative_path || req.body?.relativePath || req.body?.path,
      title: req.body?.title,
      filename: req.body?.filename,
      mime_type: req.body?.mime_type || req.body?.mimeType,
      tags: req.body?.tags,
      agent_id: 'ceo-ui',
    });
    res.status(201).json(out);
  } catch (e) {
    const status = e.status || (e.code === 'OPENSEARCH_UNAVAILABLE' ? 503 : 400);
    res.status(status).json({ error: e.message, code: e.code || undefined });
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

/**
 * Delete all user-uploaded documents (DB + disk). Platform Help / User Guide are retained.
 * POST body unused — owner always from session / admin impersonation.
 */
router.post('/documents/purge-all', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const result = await md.purgeAllUserDocuments(owner);
    res.json(result);
  } catch (e) {
    const status = e.status || (e.code === 'OPENSEARCH_UNAVAILABLE' ? 503 : 400);
    res.status(status).json({ error: e.message, code: e.code || undefined });
  }
});

router.post('/documents/:documentId/reindex', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const document = await md.reindexDocument(owner, req.params.documentId);
    res.json({ document });
  } catch (e) {
    const status =
      e.status ||
      (e.code === 'OPENSEARCH_UNAVAILABLE' ? 503 : /not found|missing/i.test(e.message || '') ? 404 : 400);
    res.status(status).json({ error: e.message, code: e.code || undefined });
  }
});

router.put('/documents/:documentId/tags', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const document = await md.updateDocumentTags(owner, req.params.documentId, req.body?.tags);
    res.json({ document });
  } catch (e) {
    const status = e.status || (e.code === 'OPENSEARCH_UNAVAILABLE' ? 503 : /not found/i.test(e.message || '') ? 404 : 400);
    res.status(status).json({ error: e.message, code: e.code || undefined });
  }
});

router.get('/documents/:documentId', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const document = await md.getDocument(owner, req.params.documentId);
    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json({ document });
  } catch (e) {
    const status = e.status || (e.code === 'OPENSEARCH_UNAVAILABLE' ? 503 : 400);
    res.status(status).json({ error: e.message, code: e.code || undefined });
  }
});

router.get('/documents/:documentId/download', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const file = await md.getDocumentFile(owner, req.params.documentId);
    res.setHeader('Content-Type', file.meta.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(file.meta.filename).replace(/"/g, '')}"`
    );
    res.send(file.buffer);
  } catch (e) {
    const status = e.status || (e.code === 'OPENSEARCH_UNAVAILABLE' ? 503 : 404);
    res.status(status).json({ error: e.message, code: e.code || undefined });
  }
});

router.delete('/documents/:documentId', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(await md.deleteDocument(owner, req.params.documentId));
  } catch (e) {
    const status =
      e.status ||
      (e.code === 'PROTECTED_DOCUMENT' ? 403 : e.code === 'OPENSEARCH_UNAVAILABLE' ? 503 : 400);
    res.status(status).json({ error: e.message, code: e.code || undefined });
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
      // CEO-initiated search is low volume and expects an answer, so the summary
      // stays on here unless explicitly disabled. Agent tool calls opt in instead.
      summarize: summarize === undefined ? true : summarize,
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

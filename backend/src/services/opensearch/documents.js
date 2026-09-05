/**
 * Document store over OpenSearch (meta + chunks). File bytes stay on disk elsewhere.
 */
import { opensearchBulk, opensearchRequest } from './client.js';
import { embedTexts } from './embeddings.js';
import {
  embeddingDims,
  ensureOwnerIndices,
  metaIndexName,
  searchIndexName,
} from './indices.js';
import { isProtectedPlatformDocument } from '../master-data-protected-docs.js';

const PARALLEL_INDEX_LIMIT = 50;

/**
 * Split text into overlapping chunks for RAG.
 * @param {string} text
 * @param {number} [size=900]
 * @param {number} [overlap=120]
 * @returns {string[]}
 */
export function chunkText(text, size = 900, overlap = 120) {
  const t = String(text || '');
  const chunkSize = Math.max(100, Number(size) || 900);
  const ov = Math.max(0, Math.min(Number(overlap) || 120, chunkSize - 1));
  if (!t) return [];
  const chunks = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(t.length, i + chunkSize);
    chunks.push(t.slice(i, end));
    if (end >= t.length) break;
    i = end - ov;
  }
  return chunks;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t || '').trim()).filter(Boolean))];
}

/**
 * Map an OpenSearch meta hit to the API shape used by the old SQLite mapDoc.
 * @param {object} hit
 */
export function mapMetaHit(hit) {
  if (!hit) return null;
  const src = hit._source || hit;
  const id = src.document_id || hit._id || null;
  if (!id) return null;
  const uploadedAt = src.uploaded_at || null;
  const mapped = {
    id,
    owner_user_id: src.owner_user_id || null,
    title: src.title || '',
    filename: src.filename || '',
    mime_type: src.mime_type || 'application/octet-stream',
    size_bytes: Number(src.size_bytes) || 0,
    text_excerpt: src.text_excerpt || '',
    chunk_count: Number(src.chunk_count) || 0,
    created_at: uploadedAt,
    updated_at: src.updated_at || uploadedAt,
    storage_path: src.storage_path || '',
    source: src.source || 'upload',
    tags: normalizeTags(src.tags),
    uploaded_by_type: src.uploaded_by_type || null,
    uploaded_by_id: src.uploaded_by_id || null,
    content_sha256: src.content_sha256 || null,
  };
  mapped.is_protected = isProtectedPlatformDocument(mapped);
  return mapped;
}

async function deleteSearchChunks(ownerUserId, documentId) {
  const index = searchIndexName(ownerUserId);
  try {
    await opensearchRequest(
      'POST',
      `/${index}/_delete_by_query?refresh=true&conflicts=proceed`,
      {
        query: {
          bool: {
            filter: [
              { term: { owner_user_id: String(ownerUserId) } },
              { term: { document_id: String(documentId) } },
            ],
          },
        },
      },
      { timeoutMs: 60000 }
    );
  } catch (e) {
    if (e?.status === 404) return;
    throw e;
  }
}

async function indexChunksParallel(index, docs) {
  await Promise.all(
    docs.map((doc) =>
      opensearchRequest('PUT', `/${index}/_doc/${encodeURIComponent(doc.id)}?refresh=false`, doc.body, {
        timeoutMs: 30000,
      })
    )
  );
}

async function indexChunksBulk(index, docs) {
  const lines = [];
  for (const doc of docs) {
    lines.push(JSON.stringify({ index: { _index: index, _id: doc.id } }));
    lines.push(JSON.stringify(doc.body));
  }
  await opensearchBulk(lines.join('\n') + '\n', { timeoutMs: 120000 });
}

/**
 * Index (or replace) a document's meta + search chunks.
 */
export async function indexDocument({
  ownerUserId,
  documentId,
  title,
  filename,
  mimeType,
  sizeBytes,
  storagePath,
  text,
  source,
  uploadedByType,
  uploadedById,
  tags,
  contentSha256,
} = {}) {
  const owner = String(ownerUserId || '').trim();
  const docId = String(documentId || '').trim();
  if (!owner) throw new Error('ownerUserId required');
  if (!docId) throw new Error('documentId required');

  await ensureOwnerIndices(owner);

  const now = new Date().toISOString();
  const textStr = String(text || '');
  const chunks = chunkText(textStr);
  const excerpt = textStr.slice(0, 500);
  const tagList = normalizeTags(tags);
  const dims = embeddingDims();

  let existingUploadedAt = now;
  try {
    const prev = await getDocument(owner, docId);
    if (prev?.created_at) existingUploadedAt = prev.created_at;
  } catch (_) {
    /* new doc */
  }

  const metaBody = {
    document_id: docId,
    owner_user_id: owner,
    title: String(title || filename || 'Document'),
    filename: String(filename || 'document.txt'),
    mime_type: String(mimeType || 'application/octet-stream'),
    size_bytes: Number(sizeBytes) || 0,
    source: String(source || 'upload'),
    uploaded_by_type: uploadedByType != null ? String(uploadedByType) : null,
    uploaded_by_id: uploadedById != null ? String(uploadedById) : null,
    tags: tagList,
    storage_path: String(storagePath || ''),
    text_excerpt: excerpt,
    chunk_count: chunks.length,
    content_sha256: contentSha256 ? String(contentSha256) : null,
    uploaded_at: existingUploadedAt,
    updated_at: now,
  };

  const metaIndex = metaIndexName(owner);
  await opensearchRequest(
    'PUT',
    `/${metaIndex}/_doc/${encodeURIComponent(docId)}?refresh=true`,
    metaBody,
    { timeoutMs: 30000 }
  );

  await deleteSearchChunks(owner, docId);

  if (chunks.length) {
    const vectors = await embedTexts(chunks);
    const searchIndex = searchIndexName(owner);
    const docs = chunks.map((content, i) => {
      const emb = vectors[i];
      const body = {
        document_id: docId,
        owner_user_id: owner,
        chunk_index: i,
        title: metaBody.title,
        filename: metaBody.filename,
        content,
        tags: tagList,
        uploaded_at: existingUploadedAt,
      };
      if (Array.isArray(emb) && emb.length === dims) {
        body.embedding = emb;
      }
      return { id: `${docId}_${i}`, body };
    });

    if (docs.length < PARALLEL_INDEX_LIMIT) {
      await indexChunksParallel(searchIndex, docs);
    } else {
      await indexChunksBulk(searchIndex, docs);
    }
    try {
      await opensearchRequest('POST', `/${searchIndex}/_refresh`, null, { timeoutMs: 30000 });
    } catch (_) {
      /* non-fatal */
    }
  }

  return mapMetaHit({ _id: docId, _source: metaBody });
}

export async function updateDocumentTags(ownerUserId, documentId, tags) {
  const owner = String(ownerUserId || '').trim();
  const docId = String(documentId || '').trim();
  const tagList = normalizeTags(tags);
  await ensureOwnerIndices(owner);

  const metaIndex = metaIndexName(owner);
  const searchIndex = searchIndexName(owner);
  const now = new Date().toISOString();

  await opensearchRequest(
    'POST',
    `/${metaIndex}/_update/${encodeURIComponent(docId)}?refresh=true`,
    {
      doc: {
        tags: tagList,
        updated_at: now,
      },
    },
    { timeoutMs: 30000 }
  );

  try {
    await opensearchRequest(
      'POST',
      `/${searchIndex}/_update_by_query?conflicts=proceed&refresh=true`,
      {
        query: {
          bool: {
            filter: [
              { term: { owner_user_id: owner } },
              { term: { document_id: docId } },
            ],
          },
        },
        script: {
          lang: 'painless',
          source: 'ctx._source.tags = params.tags;',
          params: { tags: tagList },
        },
      },
      { timeoutMs: 60000 }
    );
  } catch (e) {
    if (e?.status !== 404) throw e;
  }

  return getDocument(owner, docId);
}

/**
 * @param {string} ownerUserId
 * @param {{ excludeProtected?: boolean }} [opts]
 */
export async function listDocuments(ownerUserId, { excludeProtected = false, limit = null, offset = 0 } = {}) {
  const owner = String(ownerUserId || '').trim();
  await ensureOwnerIndices(owner);
  const metaIndex = metaIndexName(owner);
  const size = limit != null ? Math.min(Math.max(Number(limit) || 50, 1), 200) : 500;
  const from = Math.max(Number(offset) || 0, 0);
  let json;
  try {
    json = await opensearchRequest(
      'POST',
      `/${metaIndex}/_search`,
      {
        size,
        from,
        track_total_hits: true,
        sort: [{ uploaded_at: { order: 'desc', unmapped_type: 'date' } }],
        query: {
          bool: {
            filter: [{ term: { owner_user_id: owner } }],
          },
        },
      },
      { timeoutMs: 30000 }
    );
  } catch (e) {
    if (e?.status === 404) {
      return limit != null ? { documents: [], total: 0, limit: size, offset: from, has_more: false } : [];
    }
    throw e;
  }
  const hits = json?.hits?.hits || [];
  let docs = hits.map(mapMetaHit).filter(Boolean);
  if (excludeProtected) {
    docs = docs.filter((d) => !isProtectedPlatformDocument(d));
  }
  if (limit == null) return docs;
  const totalRaw = json?.hits?.total;
  const total = typeof totalRaw === 'object' ? Number(totalRaw.value || 0) : Number(totalRaw || docs.length);
  return {
    documents: docs,
    total,
    limit: size,
    offset: from,
    has_more: from + docs.length < total,
  };
}

export async function getDocument(ownerUserId, documentId) {
  const owner = String(ownerUserId || '').trim();
  const docId = String(documentId || '').trim();
  await ensureOwnerIndices(owner);
  const metaIndex = metaIndexName(owner);
  try {
    const json = await opensearchRequest(
      'GET',
      `/${metaIndex}/_doc/${encodeURIComponent(docId)}`,
      null,
      { timeoutMs: 15000 }
    );
    if (!json || json.found === false) return null;
    return mapMetaHit({ _id: json._id, _source: json._source });
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export async function deleteDocumentIndex(ownerUserId, documentId) {
  const owner = String(ownerUserId || '').trim();
  const docId = String(documentId || '').trim();
  await ensureOwnerIndices(owner);
  const metaIndex = metaIndexName(owner);

  try {
    await opensearchRequest(
      'DELETE',
      `/${metaIndex}/_doc/${encodeURIComponent(docId)}?refresh=true`,
      null,
      { timeoutMs: 15000 }
    );
  } catch (e) {
    if (e?.status !== 404) throw e;
  }

  await deleteSearchChunks(owner, docId);
  return { ok: true, id: docId };
}

/**
 * Hybrid BM25 + optional knn search over chunks.
 * @param {string} ownerUserId
 * @param {{ query: string, topK?: number, documentId?: string }} opts
 */
export async function searchDocuments(ownerUserId, { query, topK = 8, documentId } = {}) {
  const owner = String(ownerUserId || '').trim();
  const q = String(query || '').trim();
  const k = Math.max(1, Math.min(Number(topK) || 8, 50));
  await ensureOwnerIndices(owner);
  const searchIndex = searchIndexName(owner);

  const filters = [{ term: { owner_user_id: owner } }];
  if (documentId) {
    filters.push({ term: { document_id: String(documentId) } });
  }

  const should = [];
  if (q) {
    should.push({
      multi_match: {
        query: q,
        fields: ['content^2', 'title', 'filename', 'tags^1.5'],
      },
    });
    if (q.length >= 3 && q.length <= 80 && !/\s/.test(q) && /^[\p{L}\p{N}_.@+-]+$/u.test(q)) {
      for (const [field, boost] of [['content', 2], ['title', 1.5], ['filename', 1.5], ['tags', 1.25]]) {
        should.push({ prefix: { [field]: { value: q.toLowerCase(), case_insensitive: true, boost } } });
      }
    }
  }

  let usedKnn = false;
  if (q) {
    const [vec] = await embedTexts([q]);
    const dims = embeddingDims();
    if (Array.isArray(vec) && vec.length === dims) {
      usedKnn = true;
      should.push({
        knn: {
          embedding: {
            vector: vec,
            k,
          },
        },
      });
    }
  }

  const body = {
    size: k,
    query: {
      bool: {
        filter: filters,
        should: should.length ? should : [{ match_all: {} }],
        minimum_should_match: should.length ? 1 : 0,
      },
    },
  };

  let json;
  try {
    json = await opensearchRequest('POST', `/${searchIndex}/_search`, body, { timeoutMs: 30000 });
  } catch (e) {
    if (e?.status === 404) {
      return { chunks: [], usedKnn: false, query: q };
    }
    throw e;
  }

  const chunks = (json?.hits?.hits || []).map((hit) => {
    const src = hit._source || {};
    return {
      document_id: src.document_id,
      owner_user_id: src.owner_user_id,
      chunk_index: src.chunk_index,
      title: src.title || '',
      filename: src.filename || '',
      content: src.content || '',
      tags: normalizeTags(src.tags),
      score: hit._score,
    };
  });

  return { chunks, usedKnn, query: q };
}

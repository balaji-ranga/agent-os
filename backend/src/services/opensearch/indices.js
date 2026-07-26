/**
 * Per-owner OpenSearch index names and mappings for Master Data RAG.
 */
import { createHash } from 'crypto';
import { opensearchRequest } from './client.js';

export const PLATFORM_OWNER_ID = '__platform__';

/** @param {string} ownerUserId */
export function ownerFingerprint(ownerUserId) {
  return createHash('sha256')
    .update(String(ownerUserId || ''), 'utf8')
    .digest('hex')
    .slice(0, 12);
}

/** @param {string} ownerUserId */
export function isPlatformOwner(ownerUserId) {
  return String(ownerUserId || '') === PLATFORM_OWNER_ID;
}

/** Stable short key used in index names. */
export function indexOwnerKey(ownerUserId) {
  if (isPlatformOwner(ownerUserId)) return 'platform';
  return ownerFingerprint(ownerUserId);
}

export function metaIndexName(ownerUserId) {
  return `aos-docs-meta-${indexOwnerKey(ownerUserId)}`;
}

export function searchIndexName(ownerUserId) {
  return `aos-docs-search-${indexOwnerKey(ownerUserId)}`;
}

export function embeddingDims() {
  const n = Number(process.env.OPENSEARCH_EMBEDDING_DIMS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1536;
}

async function indexExists(name) {
  try {
    await opensearchRequest('HEAD', `/${name}`, null, { timeoutMs: 10000 });
    return true;
  } catch (e) {
    if (e?.status === 404) return false;
    if (e?.code === 'OPENSEARCH_ERROR' && /not.?found|index_not_found/i.test(String(e.message))) {
      return false;
    }
    throw e;
  }
}

function metaMapping() {
  return {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
    mappings: {
      properties: {
        document_id: { type: 'keyword' },
        owner_user_id: { type: 'keyword' },
        title: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 512 } } },
        filename: { type: 'keyword' },
        mime_type: { type: 'keyword' },
        size_bytes: { type: 'long' },
        source: { type: 'keyword' },
        uploaded_by_type: { type: 'keyword' },
        uploaded_by_id: { type: 'keyword' },
        tags: { type: 'keyword' },
        storage_path: { type: 'keyword', index: false },
        text_excerpt: { type: 'text' },
        chunk_count: { type: 'integer' },
        content_sha256: { type: 'keyword' },
        uploaded_at: { type: 'date' },
        updated_at: { type: 'date' },
      },
    },
  };
}

function searchMapping(dims) {
  return {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
      index: {
        knn: true,
      },
    },
    mappings: {
      properties: {
        document_id: { type: 'keyword' },
        owner_user_id: { type: 'keyword' },
        chunk_index: { type: 'integer' },
        title: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 512 } } },
        filename: { type: 'keyword' },
        content: { type: 'text' },
        tags: { type: 'keyword' },
        uploaded_at: { type: 'date' },
        embedding: {
          type: 'knn_vector',
          dimension: dims,
          method: {
            name: 'hnsw',
            space_type: 'cosinesimil',
            engine: 'nmslib',
          },
        },
      },
    },
  };
}

async function createIndexIfMissing(name, body) {
  if (await indexExists(name)) return { name, created: false };
  try {
    await opensearchRequest('PUT', `/${name}`, body, { timeoutMs: 60000 });
    console.info('[opensearch] created index %s', name);
    return { name, created: true };
  } catch (e) {
    if (
      e?.status === 400 &&
      /resource_already_exists|already_exists/i.test(String(e.message || ''))
    ) {
      return { name, created: false };
    }
    throw e;
  }
}

/**
 * Ensure meta + search indices exist for an owner (idempotent).
 * @param {string} ownerUserId
 */
export async function ensureOwnerIndices(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('ownerUserId required');
  const dims = embeddingDims();
  const meta = await createIndexIfMissing(metaIndexName(owner), metaMapping());
  const search = await createIndexIfMissing(searchIndexName(owner), searchMapping(dims));
  return { meta, search, dims };
}

export async function ensurePlatformIndices() {
  return ensureOwnerIndices(PLATFORM_OWNER_ID);
}

/**
 * Delete meta + search indices for an owner (best-effort; ignores missing).
 * @param {string} ownerUserId
 */
export async function deleteOwnerIndices(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('ownerUserId required');
  const names = [metaIndexName(owner), searchIndexName(owner)];
  const results = [];
  for (const name of names) {
    try {
      await opensearchRequest('DELETE', `/${name}`, null, { timeoutMs: 60000 });
      console.info('[opensearch] deleted index %s', name);
      results.push({ name, deleted: true });
    } catch (e) {
      if (e?.status === 404) {
        results.push({ name, deleted: false });
        continue;
      }
      throw e;
    }
  }
  return results;
}

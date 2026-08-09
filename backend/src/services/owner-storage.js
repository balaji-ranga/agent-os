/**
 * Estimate storage consumed by one CEO (DB payloads + files + OpenSearch RAG indices).
 * Owner-scoped only; never aggregates other tenants or platform-global indices.
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/schema.js';
import { getOpenClawDir } from '../config/openclaw-paths.js';
import { masterDataDocsDir } from './master-data.js';
import { mediaStorageBytes } from './ceo-media-artifacts.js';
import { avatarStorageBytes } from './ceo-avatars.js';
import { vrSceneStorageBytes } from './ceo-vr-scenes.js';
import { generatedMediaStorageBytes } from './content-explorer.js';
import { getInboundAttachmentsDir } from './inbound-attachments.js';

function sanitizeIdPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function dataDir() {
  return process.env.AGENT_OS_DATA_DIR || join(process.cwd(), 'data');
}

function dirSizeBytes(root) {
  if (!root || !existsSync(root)) return 0;
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = join(cur, ent.name);
      try {
        if (ent.isDirectory()) stack.push(p);
        else total += statSync(p).size || 0;
      } catch {
        /* skip */
      }
    }
  }
  return total;
}

function fileSizeBytes(path) {
  try {
    if (!path || !existsSync(path)) return 0;
    return statSync(path).size || 0;
  } catch {
    return 0;
  }
}

/**
 * Per-owner OpenSearch meta + search index store sizes (primary shards).
 * Fail-open: missing indices / OpenSearch down → 0 with note (does not break Efficiency).
 *
 * @param {string} ownerUserId
 * @returns {Promise<{
 *   meta_bytes: number,
 *   search_bytes: number,
 *   total_bytes: number,
 *   meta_index: string|null,
 *   search_index: string|null,
 *   ok: boolean,
 *   error: string|null
 * }>}
 */
export async function estimateOwnerOpenSearchBytes(ownerUserId) {
  const empty = {
    meta_bytes: 0,
    search_bytes: 0,
    total_bytes: 0,
    meta_index: null,
    search_index: null,
    ok: false,
    error: null,
  };
  const owner = String(ownerUserId || '').trim();
  if (!owner) return { ...empty, error: 'owner_required' };

  try {
    const { isOpenSearchConfigured, opensearchRequest } = await import('./opensearch/client.js');
    if (!isOpenSearchConfigured()) {
      return { ...empty, error: 'opensearch_disabled' };
    }
    const { metaIndexName, searchIndexName } = await import('./opensearch/indices.js');
    const metaIndex = metaIndexName(owner);
    const searchIndex = searchIndexName(owner);
    empty.meta_index = metaIndex;
    empty.search_index = searchIndex;

    const parseIndexBytes = (statsBody, name) => {
      const idx = statsBody?.indices?.[name];
      if (!idx) return 0;
      const b = Number(idx?.primaries?.store?.size_in_bytes ?? idx?.total?.store?.size_in_bytes);
      return Number.isFinite(b) && b > 0 ? b : 0;
    };

    let meta_bytes = 0;
    let search_bytes = 0;
    try {
      // Index names are fingerprint alphanumerics; query both in one call when possible.
      const stats = await opensearchRequest(
        'GET',
        `/${metaIndex},${searchIndex}/_stats/store`,
        null,
        { timeoutMs: 8000, allowStatuses: [404] }
      );
      if (stats?.indices) {
        meta_bytes = parseIndexBytes(stats, metaIndex);
        search_bytes = parseIndexBytes(stats, searchIndex);
      }
    } catch {
      /* fall through to per-index */
    }

    if (!meta_bytes && !search_bytes) {
      for (const [role, name] of [
        ['meta', metaIndex],
        ['search', searchIndex],
      ]) {
        try {
          const one = await opensearchRequest('GET', `/${name}/_stats/store`, null, {
            timeoutMs: 5000,
            allowStatuses: [404],
          });
          const b = parseIndexBytes(one, name);
          if (role === 'meta') meta_bytes = b;
          else search_bytes = b;
        } catch {
          /* ignore per-index */
        }
      }
    }

    const total_bytes = meta_bytes + search_bytes;
    return {
      meta_bytes,
      search_bytes,
      total_bytes,
      meta_index: metaIndex,
      search_index: searchIndex,
      ok: true,
      error: total_bytes > 0 ? null : 'indices_missing_or_empty',
    };
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn('[owner-storage] opensearch stats failed owner=%s: %s', owner, msg);
    return {
      ...empty,
      error: msg.slice(0, 200),
    };
  }
}

/** Display rows for Efficiency UI (stable keys). */
export const STORAGE_BREAKDOWN_LABELS = [
  { key: 'chat_turns_bytes', label: 'Chat history' },
  { key: 'standup_messages_bytes', label: 'Standup messages' },
  { key: 'workflow_runs_bytes', label: 'Workflow run payloads' },
  { key: 'master_data_bytes', label: 'Master Data documents (files)' },
  { key: 'opensearch_meta_bytes', label: 'Master Data RAG — meta index (OpenSearch)' },
  { key: 'opensearch_search_bytes', label: 'Master Data RAG — search/vectors (OpenSearch)' },
  { key: 'media_artifacts_bytes', label: 'Media artifacts' },
  { key: 'generated_media_bytes', label: 'Generated content (Content Explorer)' },
  { key: 'inbound_attachments_bytes', label: 'Inbound attachments (also in OpenClaw tenant)' },
  { key: 'avatars_bytes', label: 'Avatars' },
  { key: 'vr_scenes_bytes', label: 'VR / published scenes' },
  { key: 'ceo_db_bytes', label: 'CEO tenant SQLite' },
  { key: 'openclaw_tenant_bytes', label: 'OpenClaw tenant workspace' },
];

/**
 * @param {string} ownerUserId
 * @returns {Promise<{
 *   total_bytes: number,
 *   total_mb: number,
 *   breakdown: object,
 *   components: Array<{key:string,label:string,bytes:number,mb:number}>,
 *   notes: string[]
 * }>}
 */
export async function estimateOwnerStorage(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const db = getDb();
  const breakdown = {
    chat_turns_bytes: 0,
    standup_messages_bytes: 0,
    workflow_runs_bytes: 0,
    master_data_docs_bytes: 0,
    master_data_files_bytes: 0,
    media_artifacts_bytes: 0,
    inbound_attachments_bytes: 0,
    generated_media_bytes: 0,
    avatars_bytes: 0,
    vr_scenes_bytes: 0,
    ceo_db_bytes: 0,
    openclaw_tenant_bytes: 0,
    opensearch_meta_bytes: 0,
    opensearch_search_bytes: 0,
    opensearch_rag_bytes: 0,
  };
  const notes = [];

  try {
    breakdown.chat_turns_bytes =
      Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(LENGTH(COALESCE(content, ''))), 0) AS b
             FROM chat_turns WHERE owner_user_id = ?`
          )
          .get(owner)?.b
      ) || 0;
  } catch (_) {}

  try {
    breakdown.standup_messages_bytes =
      Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(LENGTH(COALESCE(content, ''))), 0) AS b
             FROM standup_messages
             WHERE standup_id IN (SELECT id FROM standups WHERE owner_user_id = ?)`
          )
          .get(owner)?.b
      ) || 0;
  } catch (_) {}

  try {
    breakdown.workflow_runs_bytes =
      Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(
               LENGTH(COALESCE(context_json, '')) + LENGTH(COALESCE(error_message, ''))
             ), 0) AS b
             FROM agent_workflow_runs WHERE owner_user_id = ?`
          )
          .get(owner)?.b
      ) || 0;
  } catch (_) {}

  try {
    breakdown.master_data_docs_bytes =
      Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(COALESCE(size_bytes, 0)), 0) AS b
             FROM master_data_documents WHERE owner_user_id = ?`
          )
          .get(owner)?.b
      ) || 0;
  } catch (_) {}

  try {
    breakdown.master_data_files_bytes = dirSizeBytes(masterDataDocsDir(owner));
  } catch (_) {}

  try {
    breakdown.media_artifacts_bytes = mediaStorageBytes(owner);
  } catch (_) {}

  try {
    // Inbound is under tenants/{ceo}/… so also counted in openclaw_tenant_bytes;
    // keep an explicit breakdown for Efficiency clarity (not double-summed in total).
    breakdown.inbound_attachments_bytes = dirSizeBytes(getInboundAttachmentsDir(owner));
  } catch (_) {}

  try {
    breakdown.generated_media_bytes = generatedMediaStorageBytes(owner);
  } catch (_) {}

  try {
    breakdown.avatars_bytes = avatarStorageBytes(owner);
  } catch (_) {}

  try {
    breakdown.vr_scenes_bytes = vrSceneStorageBytes(owner);
  } catch (_) {}

  try {
    breakdown.ceo_db_bytes = fileSizeBytes(join(dataDir(), 'tenants', sanitizeIdPart(owner), 'ceo.db'));
  } catch (_) {}

  try {
    breakdown.openclaw_tenant_bytes = dirSizeBytes(
      join(getOpenClawDir(), 'tenants', sanitizeIdPart(owner))
    );
  } catch (_) {}

  const osStats = await estimateOwnerOpenSearchBytes(owner);
  breakdown.opensearch_meta_bytes = osStats.meta_bytes || 0;
  breakdown.opensearch_search_bytes = osStats.search_bytes || 0;
  breakdown.opensearch_rag_bytes = osStats.total_bytes || 0;
  if (osStats.meta_index) breakdown.opensearch_meta_index = osStats.meta_index;
  if (osStats.search_index) breakdown.opensearch_search_index = osStats.search_index;
  if (osStats.error === 'opensearch_disabled') {
    notes.push('OpenSearch disabled — RAG index size not included.');
  } else if (osStats.error && !osStats.total_bytes) {
    notes.push(`OpenSearch RAG size unavailable: ${osStats.error}`);
  } else if (osStats.ok) {
    notes.push(
      'RAG includes this tenant’s meta + search OpenSearch indices (chunks and embedding vectors).'
    );
  }

  const masterData = Math.max(breakdown.master_data_docs_bytes, breakdown.master_data_files_bytes);
  breakdown.master_data_bytes = masterData;

  // Tenant tree already includes inbound/attachments; do not double-count inbound.
  // Master Data source files + OpenSearch index are both real disk/cost → sum both.
  const total =
    breakdown.chat_turns_bytes +
    breakdown.standup_messages_bytes +
    breakdown.workflow_runs_bytes +
    masterData +
    breakdown.opensearch_rag_bytes +
    breakdown.media_artifacts_bytes +
    breakdown.generated_media_bytes +
    breakdown.avatars_bytes +
    breakdown.vr_scenes_bytes +
    breakdown.ceo_db_bytes +
    breakdown.openclaw_tenant_bytes;

  const components = STORAGE_BREAKDOWN_LABELS.map(({ key, label }) => {
    const bytes = Number(breakdown[key]) || 0;
    return {
      key,
      label,
      bytes,
      mb: Math.round((bytes / (1024 * 1024)) * 1000) / 1000,
    };
  });

  return {
    ok: true,
    owner_user_id: owner,
    total_bytes: total,
    total_mb: Math.round((total / (1024 * 1024)) * 100) / 100,
    breakdown: {
      ...breakdown,
      master_data_bytes: masterData,
    },
    components,
    notes,
    as_of: new Date().toISOString(),
  };
}

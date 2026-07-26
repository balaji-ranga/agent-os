/**
 * Owner-scoped Master Data + RAG helpers for agent content tools.
 * Agents may list tables (with purpose), CRUD rows, list docs, and RAG —
 * never create/alter/drop tables or change columns.
 *
 * Platform Help agent routes list/RAG to PLATFORM_OWNER_ID OpenSearch indices.
 */
import * as md from './master-data.js';
import { parseTenantOpenClawAgentId } from './openclaw-tenant.js';
import { PLATFORM_OWNER_ID } from './opensearch/index.js';

const FORBIDDEN_SCHEMA_ACTIONS = new Set([
  'create_table',
  'drop_table',
  'delete_table',
  'alter_table',
  'add_column',
  'drop_column',
  'rename_table',
  'rename_column',
]);

export function assertNoSchemaMutation(action) {
  const a = String(action || '').trim().toLowerCase();
  if (FORBIDDEN_SCHEMA_ACTIONS.has(a)) {
    throw new Error(
      'Schema changes are not allowed via agent tools (no create/alter/drop table). Use Master Data UI for table setup.'
    );
  }
}

/**
 * True when the caller is the Platform Help agent (base id platformhelp).
 * @param {string|null|undefined} agentIdOrSource
 */
export function isPlatformHelpAgent(agentIdOrSource) {
  const raw = String(agentIdOrSource || '').trim().toLowerCase();
  if (!raw) return false;
  if (raw === 'platformhelp') return true;
  if (/platformhelp$/.test(raw)) return true;
  const parsed = parseTenantOpenClawAgentId(raw);
  if (parsed?.baseOpenClawId === 'platformhelp') return true;
  return false;
}

/**
 * Resolve OpenSearch owner for document list/RAG.
 * Platform Help agent → PLATFORM_OWNER_ID; otherwise CEO owner.
 */
export function resolveDocumentOwnerUserId(ceoOwnerUserId, { agentId = null, source = null } = {}) {
  const hint = agentId || source || '';
  if (isPlatformHelpAgent(hint)) return PLATFORM_OWNER_ID;
  return String(ceoOwnerUserId || '').trim();
}

export function listTablesForAgent(ownerUserId) {
  const tables = md.listTables(ownerUserId);
  return {
    ok: true,
    count: tables.length,
    tables: tables.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description || '',
      purpose: t.description || '',
      columns: t.columns || [],
      row_count: t.row_count || 0,
      source: t.source,
      updated_at: t.updated_at,
    })),
    next_step:
      'REQUIRED before answering the user: choose the table whose purpose best matches their question, then call master_data_list_rows with that table_name or table_id. Do not answer with this catalog alone.',
    note:
      'DISCOVERY ONLY. Next: pick the table whose purpose best matches the user question, then call master_data_list_rows with that table_name/table_id. ' +
      'Do not answer with only this catalog. For document/PDF questions use master_data_rag. Schema alter/drop is not allowed.',
  };
}

export function listRowsForAgent(ownerUserId, params = {}) {
  const table = md.resolveTable(ownerUserId, {
    tableId: params.table_id || params.tableId || null,
    tableName: params.table_name || params.tableName || params.name || null,
  });
  const query = params.query || params.q || params.keyword || '';
  const column = params.column || params.filter_column || null;
  const equals = params.equals != null ? params.equals : params.filter_equals ?? params.value ?? null;
  const limit = params.limit;
  const offset = params.offset;

  if (query || column) {
    const result = md.queryTable(ownerUserId, {
      tableId: table.id,
      query,
      column,
      equals,
      limit,
      offset,
    });
    return {
      ok: true,
      table: {
        id: table.id,
        name: table.name,
        description: table.description || '',
        columns: table.columns,
      },
      ...result,
      rows: result.rows,
    };
  }

  const result = md.listRows(ownerUserId, table.id, { limit, offset });
  return {
    ok: true,
    table: {
      id: table.id,
      name: table.name,
      description: table.description || '',
      columns: table.columns,
    },
    rows: result.rows,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    text: (result.rows || [])
      .slice(0, 20)
      .map((m, i) => `${i + 1}. ${JSON.stringify(m.data)}`)
      .join('\n'),
  };
}

export function insertRowForAgent(ownerUserId, params = {}) {
  const table = md.resolveTable(ownerUserId, {
    tableId: params.table_id || params.tableId || null,
    tableName: params.table_name || params.tableName || params.name || null,
  });
  const data = params.data || params.row || params.values || null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('data object required (column → value)');
  }
  const result = md.insertRow(ownerUserId, table.id, data);
  return { ok: true, ...result };
}

export function updateRowForAgent(ownerUserId, params = {}) {
  const table = md.resolveTable(ownerUserId, {
    tableId: params.table_id || params.tableId || null,
    tableName: params.table_name || params.tableName || params.name || null,
  });
  const rowId = params.row_id ?? params.rowId ?? params.id;
  if (rowId == null) throw new Error('row_id required');
  const data = params.data || params.row || params.values || null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('data object required (column → value)');
  }
  const result = md.updateRow(ownerUserId, table.id, rowId, data);
  return { ok: true, ...result };
}

export function deleteRowForAgent(ownerUserId, params = {}) {
  const table = md.resolveTable(ownerUserId, {
    tableId: params.table_id || params.tableId || null,
    tableName: params.table_name || params.tableName || params.name || null,
  });
  const rowId = params.row_id ?? params.rowId ?? params.id;
  if (rowId == null) throw new Error('row_id required');
  const result = md.deleteRow(ownerUserId, table.id, rowId);
  return { ok: true, ...result };
}

/**
 * @param {string} ownerUserId CEO owner (ignored for platformhelp → PLATFORM_OWNER_ID)
 * @param {{ agentId?: string, source?: string, agent_id?: string }} [opts]
 */
export async function listDocumentsForAgent(ownerUserId, opts = {}) {
  const agentId = opts.agentId || opts.agent_id || opts.source || null;
  const docOwner = resolveDocumentOwnerUserId(ownerUserId, {
    agentId,
    source: opts.source || agentId,
  });
  const documents = await md.listDocuments(docOwner);
  return {
    ok: true,
    count: documents.length,
    owner_user_id: docOwner,
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      filename: d.filename,
      chunk_count: d.chunk_count,
      text_excerpt: (d.text_excerpt || '').slice(0, 240),
      created_at: d.created_at,
      tags: d.tags || [],
      source: d.source || null,
    })),
  };
}

/**
 * @param {string} ownerUserId
 * @param {{ query?, agentId?, source?, agent_id?, top_k?, document_id?, summarize? }} [params]
 */
export async function ragDocumentsForAgent(ownerUserId, params = {}) {
  const query =
    params.query || params.q || params.question || params.prompt || params.message || '';
  if (!String(query).trim()) throw new Error('query required');
  const agentId = params.agentId || params.agent_id || params.source || null;
  const docOwner = resolveDocumentOwnerUserId(ownerUserId, {
    agentId,
    source: params.source || agentId,
  });
  const result = await md.ragDocuments(docOwner, {
    query: String(query).trim(),
    topK: params.top_k ?? params.topK ?? params.limit,
    documentId: params.document_id || params.documentId || null,
    // Opt-in: agents get excerpts by default and must ask for the LLM answer.
    summarize: params.summarize === true || String(params.summarize).toLowerCase() === 'true',
  });
  return { ok: true, ...result };
}

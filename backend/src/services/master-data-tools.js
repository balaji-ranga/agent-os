/**
 * Owner-scoped Master Data + RAG helpers for agent content tools.
 * Agents may list tables (with purpose), CRUD rows, list docs, and RAG —
 * never create/alter/drop tables or change columns.
 */
import * as md from './master-data.js';

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
    note: 'Use table name or id with master_data_list_rows / insert / update / delete. Schema alter/drop is not allowed.',
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

export function listDocumentsForAgent(ownerUserId) {
  const documents = md.listDocuments(ownerUserId);
  return {
    ok: true,
    count: documents.length,
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      filename: d.filename,
      chunk_count: d.chunk_count,
      text_excerpt: (d.text_excerpt || '').slice(0, 240),
      created_at: d.created_at,
    })),
  };
}

export async function ragDocumentsForAgent(ownerUserId, params = {}) {
  const query =
    params.query || params.q || params.question || params.prompt || params.message || '';
  if (!String(query).trim()) throw new Error('query required');
  const result = await md.ragDocuments(ownerUserId, {
    query: String(query).trim(),
    topK: params.top_k ?? params.topK ?? params.limit,
    documentId: params.document_id || params.documentId || null,
    summarize: params.summarize !== false,
  });
  return { ok: true, ...result };
}

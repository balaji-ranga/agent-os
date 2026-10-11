import * as masterData from './master-data.js';
import { opensearchRequest } from './opensearch/client.js';
import { searchIndexName } from './opensearch/indices.js';

// Reuse owner-scoped storage APIs. Index existing extracted document chunks,
// rather than reading entire files into memory or extracting them a second time.
export async function* localKnowledgeRecords(owner, collection, { data = masterData, request = opensearchRequest } = {}) {
  if (collection === 'tables') {
    for (const table of data.listTables(owner)) {
      yield { object_id: `tables/${table.id}`, title: table.name,
        text: `${table.name}\n${table.description || ''}`, fields: { columns: table.columns }, relations: [],
        modified_at: table.updated_at, url: '/master-data' };
      for (let offset = 0;;) {
        const page = data.listRows(owner, table.id, { limit: 100, offset });
        for (const row of page.rows) yield {
          object_id: `tables/${table.id}/rows/${row.id}`, title: `${table.name} — row ${row.id}`,
          text: JSON.stringify(row.data), fields: row.data,
          relations: [{ target: `tables/${table.id}`, relation: 'row_of' }],
          modified_at: row.created_at, url: '/master-data',
        };
        offset += page.rows.length;
        if (offset >= page.total) break;
        if (!page.rows.length) throw new Error('Knowledge table pagination made no progress');
      }
    }
    return;
  }
  if (collection !== 'documents') throw new Error('Unsupported local Knowledge collection');
  for (let offset = 0;; offset += 100) {
    const page = await data.listDocuments(owner, { limit: 100, offset });
    for (const doc of page.documents) {
      const reference = `documents/${doc.id}`;
      yield { object_id: reference, title: doc.title || doc.filename,
        text: `${doc.title || doc.filename}\n${doc.text_excerpt || ''}`, fields: { filename: doc.filename, tags: doc.tags },
        relations: [], modified_at: doc.updated_at, url: '/master-data' };
      let after;
      for (;;) {
        const response = await request('POST', `/${searchIndexName(owner)}/_search`, {
          size: 100, sort: [{ chunk_index: 'asc' }], ...(after ? { search_after: after } : {}),
          query: { bool: { filter: [{ term: { owner_user_id: owner } }, { term: { document_id: doc.id } }] } },
          _source: ['content', 'chunk_index'],
        }, { timeoutMs: 10000 });
        const hits = response?.hits?.hits || [];
        for (const hit of hits) yield {
          object_id: `${reference}/chunks/${hit._source.chunk_index}`, title: doc.title || doc.filename,
          text: hit._source.content || '', fields: { document_id: doc.id, chunk_index: hit._source.chunk_index },
          relations: [{ target: reference, relation: 'passage_of' }],
          modified_at: doc.updated_at, url: '/master-data',
        };
        if (hits.length < 100) break;
        const next = hits.at(-1).sort;
        if (!next || JSON.stringify(next) === JSON.stringify(after)) throw new Error('Knowledge document pagination made no progress');
        after = next;
      }
    }
    if (!page.has_more || offset + 100 >= page.total) break;
  }
}

import { createHash } from 'node:crypto';

// Constructed by trusted server authorization, never by spreading request fields.
// No caller-provided index or OpenSearch DSL is accepted by this interface.
export function knowledgeScope({ embeddingId, audienceIds }) {
  if (typeof embeddingId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(embeddingId) ||
      !Array.isArray(audienceIds) || !audienceIds.length || audienceIds.length > 100 ||
      audienceIds.some(a => typeof a !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(a))) {
    throw new Error('Invalid authorized knowledge scope');
  }
  const index = `adoption-${createHash('sha256').update(embeddingId).digest('hex')}-v1`;
  const audiences = [...new Set(audienceIds)];
  return Object.freeze({
    index,
    search({ query, size = 10, after = null }) {
      if (typeof query !== 'string' || !query.trim() || query.length > 2000 ||
          !Number.isInteger(size) || size < 1 || size > 50 ||
          (after !== null && (typeof after !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(after)))) {
        throw new Error('Invalid search request');
      }
      return {
        index,
        body: {
          size,
          _source: ['embedding_id', 'source_id', 'chunk_id', 'title', 'text', 'revision'],
          sort: [{ chunk_id: 'asc' }],
          ...(after ? { search_after: [after] } : {}),
          query: { bool: {
            filter: [
              { term: { embedding_id: embeddingId } },
              { term: { status: 'ready' } },
              { term: { deleted: false } },
              { terms: { audience_ids: audiences } },
            ],
            must: [{ multi_match: { query, fields: ['title^2', 'text'], type: 'best_fields' } }],
          } },
        },
      };
    },
  });
}

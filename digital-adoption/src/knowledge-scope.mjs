import { createHash } from 'node:crypto';

function rankedTuple(value){return Array.isArray(value)&&value.length===2&&typeof value[0]==='number'&&Number.isFinite(value[0])&&value[0]>=0&&typeof value[1]==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value[1]);}
export function searchCursor(sort){return rankedTuple(sort)?`r1_${Buffer.from(JSON.stringify(sort)).toString('base64url')}`:null;}
function decodeCursor(after){
 if(!after.startsWith('r1_'))return null;
 try{const bytes=Buffer.from(after.slice(3),'base64url');if(bytes.toString('base64url')!==after.slice(3))throw new Error();const value=JSON.parse(bytes.toString('utf8'));if(!rankedTuple(value))throw new Error();return value;}catch{throw new Error('Invalid search cursor');}
}

// Constructed by trusted server authorization, never by spreading request fields.
// No caller-provided index or OpenSearch DSL is accepted by this interface.
export function knowledgeScope({ embeddingId, audienceIds,sourceRevisions }) {
  if (typeof embeddingId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(embeddingId) ||
      !Array.isArray(audienceIds) || !audienceIds.length || audienceIds.length > 100 ||
      audienceIds.some(a => typeof a !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(a))) {
    throw new Error('Invalid authorized knowledge scope');
  }
  const index = `adoption-${createHash('sha256').update(embeddingId).digest('hex')}-v1`;
  const audiences = [...new Set(audienceIds)];
  if(sourceRevisions!==undefined&&(!Array.isArray(sourceRevisions)||sourceRevisions.length>100||sourceRevisions.some(source=>!source||!/^[a-f0-9-]{36}$/.test(source.id)||!/^[a-f0-9]{64}$/.test(source.revision))))throw new Error('Invalid authorized source revisions');
  return Object.freeze({
    index,
    search({ query, size = 10, after = null }) {
      if (typeof query !== 'string' || !query.trim() || query.length > 2000 ||
          !Number.isInteger(size) || size < 1 || size > 50 ||
          (after !== null && (typeof after !== 'string' || !/^[a-zA-Z0-9_-]{1,240}$/.test(after)))) {
        throw new Error('Invalid search request');
      }
      const ranked=after?decodeCursor(after):null,legacy=after!==null&&ranked===null;
      // Standard text analysis can retain a possessive suffix. Preserve the
      // original spelling and also search its plain-name alias, so a named
      // subject is not lost while generic words dominate the relevance score.
      const aliases=[...new Set([...query.matchAll(/([\p{L}\p{N}][\p{L}\p{N}_-]*)['’]s\b/giu)].map(match=>match[1]))];
      const lexicalQuery=aliases.length?query+' '+aliases.join(' '):query;
      return {
        index,
        body: {
          size,
          _source: ['embedding_id', 'source_id', 'chunk_id', 'title', 'text', 'revision', 'locator', 'url'],
          sort: legacy?[{chunk_id:'asc'}]:[{_score:'desc'},{chunk_id:'asc'}],
          ...(after ? { search_after: ranked||[after] } : {}),
          query: { bool: {
            filter: [
              { term: { embedding_id: embeddingId } },
              { term: { status: 'ready' } },
              { term: { deleted: false } },
              { terms: { audience_ids: audiences } },
              ...(sourceRevisions===undefined?[]:sourceRevisions.length?[{bool:{should:sourceRevisions.map(source=>({bool:{filter:[{term:{source_id:source.id}},{term:{revision:source.revision}}]}})),minimum_should_match:1}}]:[{match_none:{}}]),
            ],
            must: [{ multi_match: { query:lexicalQuery, fields: ['title^2','text','title.english^2','text.english'], type: 'most_fields' } }],
          } },
        },
      };
    },
  });
}

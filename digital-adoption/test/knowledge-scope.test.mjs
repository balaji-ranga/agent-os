import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeScope,searchCursor } from '../src/knowledge-scope.mjs';

test('search derives index and immutable entitlement filters from trusted scope', () => {
  const scope = knowledgeScope({ embeddingId: 'A', audienceIds: ['public'] });
  const request = scope.search({ query: 'help', index: '*', embeddingId: 'B', size: 5 });
  assert.match(request.index, /^adoption-[a-f0-9]{64}-v1$/);
  assert.notEqual(request.index, knowledgeScope({ embeddingId: 'a', audienceIds: ['public'] }).index);
  assert.deepEqual(request.body.query.bool.filter, [
    { term: { embedding_id: 'A' } }, { term: { status: 'ready' } },
    { term: { deleted: false } }, { terms: { audience_ids: ['public'] } },
  ]);
  assert.equal(JSON.stringify(request).includes('session_id'), false);
  assert.equal(request.body.size, 5);
  assert.deepEqual(request.body.sort,[{_score:'desc'},{chunk_id:'asc'}]);
  assert.ok(request.body._source.includes('locator'));
});
test('ranked pagination retains score order and accepts only a validated score/id tuple',()=>{
 const scope=knowledgeScope({embeddingId:'A',audienceIds:['public']}),cursor=searchCursor([3.75,'source_chunk_12']);
 assert.deepEqual(scope.search({query:'delivery promise',after:cursor}).body.search_after,[3.75,'source_chunk_12']);
 assert.deepEqual(scope.search({query:'delivery promise',after:cursor}).body.sort,[{_score:'desc'},{chunk_id:'asc'}]);
 for(const value of [[-1,'id'],[Infinity,'id'],[3,{index:'*'}],[3,'id','extra']])assert.equal(searchCursor(value),null);
 for(const value of [{index:'*'},[3,'id','extra'],[3,'../outside']])assert.throws(()=>scope.search({query:'help',after:`r1_${Buffer.from(JSON.stringify(value)).toString('base64url')}`}));
});
test('authoritative source revisions filter stale chunks before ranking and pagination',()=>{
 const source={id:'11111111-1111-4111-8111-111111111111',revision:'a'.repeat(64)},scope=knowledgeScope({embeddingId:'A',audienceIds:['public'],sourceRevisions:[source]});
 const filter=scope.search({query:'customer',sourceRevisions:[]}).body.query.bool.filter.at(-1);
 assert.deepEqual(filter.bool.should[0].bool.filter,[{term:{source_id:source.id}},{term:{revision:source.revision}}]);
 assert.throws(()=>knowledgeScope({embeddingId:'A',audienceIds:['public'],sourceRevisions:[{id:'*',revision:'anything'}]}));
});

test('search bounds input, supports pagination and rejects arbitrary cursor structures', () => {
  const scope = knowledgeScope({ embeddingId: 'A', audienceIds: ['public'] });
  assert.deepEqual(scope.search({ query: 'help', after: 'chunk_12' }).body.search_after, ['chunk_12']);
  for (const args of [{ query: '' }, { query: 'x', size: 10000 }, { query: 'x', after: { index: '*' } }]) {
    assert.throws(() => scope.search(args), /Invalid/);
  }
  assert.throws(() => knowledgeScope({ embeddingId: '*', audienceIds: ['public'] }), /Invalid/);
  assert.throws(() => knowledgeScope({ embeddingId: 'A', audienceIds: [] }), /Invalid/);
});

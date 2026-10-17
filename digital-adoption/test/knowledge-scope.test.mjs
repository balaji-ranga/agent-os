import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeScope } from '../src/knowledge-scope.mjs';

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

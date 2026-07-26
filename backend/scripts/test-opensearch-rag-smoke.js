/**
 * VPS smoke: OpenSearch platform seed + per-user RAG isolation.
 * Run inside backend container: node /tmp/test-opensearch-rag-smoke.js
 */
import {
  waitForOpenSearch,
  ensurePlatformHelpInOpenSearch,
  listDocuments,
  searchDocuments,
  PLATFORM_OWNER_ID,
  deleteDocumentIndex,
} from '../src/services/opensearch/index.js';
import { uploadDocument, ragDocuments, deleteDocument } from '../src/services/master-data.js';

const ping = await waitForOpenSearch({ attempts: 10, delayMs: 1500 });
console.log('ping', JSON.stringify(ping));
if (!ping?.ok) {
  console.error('FAIL: OpenSearch not ready');
  process.exit(1);
}

const help = await ensurePlatformHelpInOpenSearch();
console.log('help', {
  created: help.created,
  updated: help.updated,
  skipped: help.skipped,
  docs: (help.docs || []).length,
});

const docs = await listDocuments(PLATFORM_OWNER_ID, { excludeProtected: false });
console.log('platform_docs', docs.length);
if (!docs.length) {
  console.error('FAIL: no platform docs after seed');
  process.exit(1);
}

const rag = await searchDocuments(PLATFORM_OWNER_ID, {
  query: 'master data OpenSearch documents',
  topK: 3,
});
const ragChunks = rag.chunks || [];
console.log(
  'platform_rag_hits',
  ragChunks.length,
  ragChunks.slice(0, 2).map((h) => ({ title: h.title, score: h.score }))
);
if (!ragChunks.length) {
  console.error('FAIL: platform RAG returned no hits');
  process.exit(1);
}

const testOwner = 'opensearch-e2e-test-user';
const up = await uploadDocument(testOwner, {
  title: 'OS E2E Doc',
  filename: 'e2e.txt',
  contentText:
    'The quick brown fox jumps over the lazy OpenSearch index isolation test document.',
  tags: ['e2e'],
  source: 'test',
});
console.log('upload', up.id, 'chunks', up.chunk_count);

const userRag = await ragDocuments(testOwner, {
  query: 'OpenSearch index isolation',
  topK: 3,
  summarize: false,
});
console.log('user_rag_hits', userRag.hit_count);
if (!userRag.hit_count) {
  console.error('FAIL: user RAG returned no hits');
  process.exit(1);
}

const otherList = await listDocuments('other-user-should-not-see', { excludeProtected: true });
console.log('other_user_list', otherList.length);
if (otherList.some((d) => d.id === up.id)) {
  console.error('FAIL: cross-user document leak');
  process.exit(1);
}

await deleteDocument(testOwner, up.id, { force: true });
console.log('cleaned_upload', up.id);
console.log('OPENSEARCH_RAG_SMOKE_OK');

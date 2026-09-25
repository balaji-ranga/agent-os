import assert from 'node:assert/strict';
import { buildPlatformHelpEvidencePrompt } from '../src/services/platform-help-chat.js';

const huge = 'x'.repeat(10000);
const built = buildPlatformHelpEvidencePrompt({
  question: `How do I configure OKRs? ${huge}`,
  history: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: huge })),
  rag: { chunks: Array.from({ length: 8 }, (_, index) => ({ document_title: `Document ${index + 1}`, content: huge })) },
});
const serialized = JSON.stringify(built.messages);
assert.equal(built.evidenceTitles.length, 5);
assert(serialized.length < 16000, `bounded Platform Help context too large: ${serialized.length}`);
assert(serialized.includes('Current question'));
assert(serialized.includes('Document 1'));
assert(serialized.includes('Document 5'));
assert(!serialized.includes('Document 6'));
console.log(`PASS Platform Help bounded context chars=${serialized.length}`);

import { initDb } from '../src/db/schema.js';
import { listDocuments, getDocument } from '../src/services/master-data.js';
import { PLATFORM_HELP_TITLE_PREFIX } from '../src/services/ceo-default-master-data.js';

initDb();
const docs = listDocuments('ceo-bala');
const hit = docs.find((d) => String(d.title || '').includes('nodes-reference') || String(d.title || '').includes('Workflow nodes'));
console.log(
  'candidates',
  docs.filter((d) => String(d.title || '').startsWith(PLATFORM_HELP_TITLE_PREFIX)).map((d) => d.title)
);
console.log('picked', hit?.title, hit?.id);
if (hit) {
  const full = getDocument('ceo-bala', hit.id) || hit;
  const t = String(full?.content || full?.text || full?.body || full?.markdown || '');
  console.log('len', t.length);
  console.log('has thinkingMode', t.includes('thinkingMode'));
  console.log('has Thinking mode section', t.includes('Thinking mode (DeepSeek'));
}

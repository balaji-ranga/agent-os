import { initDb, getDb } from '../src/db/schema.js';
initDb();
const rows = getDb()
  .prepare(
    `SELECT d.title, c.content FROM master_data_documents d
     JOIN master_data_doc_chunks c ON c.document_id = d.id
     WHERE d.owner_user_id = ? AND d.title LIKE ?
     LIMIT 20`
  )
  .all('ceo-bala', '%Nodes Reference%');
console.log('rows', rows.length);
let anyThinking = false;
for (const r of rows) {
  const c = String(r.content || '');
  if (c.includes('thinkingMode') || c.includes('Thinking mode (DeepSeek')) {
    anyThinking = true;
    console.log('HIT chunk', c.includes('thinkingMode'), c.includes('Thinking mode (DeepSeek'));
    break;
  }
}
console.log('HELP_CHUNKS_OK', anyThinking);

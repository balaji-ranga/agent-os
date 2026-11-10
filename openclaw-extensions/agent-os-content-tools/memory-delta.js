// Atomic delta reconciliation for derived memory indexes. Called inside the
// native write transaction; authoritative transcript storage is untouched.
export function assertRetentionSnapshot(db,entry){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='flolah_retention_fences'").get())return;
 const fence=db.prepare('SELECT changed_at FROM flolah_retention_fences WHERE session_id=?').get(entry.sessionId);
 if(fence&&(!Number.isFinite(entry.mtimeMs)||entry.mtimeMs<fence.changed_at))throw Error('Session retention changed this memory snapshot; retry with a fresh transcript');
}
export function prepareMemoryDelta({db,path,source,entries,vectorTable,ftsTable,vectorReady,ftsReady}) {
 // Preserve the native degraded-vector rebuild behavior.
 if(!vectorReady)return null;
 for(const name of [vectorTable,ftsTable])if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))throw Error('Invalid memory table identifier');
 // Do not materialize every stored vector JSON in the JS heap. Long histories
 // repeat the same embeddings across many chunks (gigabytes in real indexes).
 const previous=new Set(db.prepare('SELECT id FROM memory_index_chunks WHERE path=? AND source=?').all(path,source).map(r=>r.id));
 if(!previous.size)return null;
 const serialized=new WeakMap(),canonical=new Map();
 const embeddingJson=embedding=>{
  let value=serialized.get(embedding);
  if(value===undefined){const json=JSON.stringify(embedding);value=canonical.get(json);if(value===undefined){value=json;canonical.set(json,value);}serialized.set(embedding,value);}
  return value;
 };
 db.exec('CREATE TEMP TABLE IF NOT EXISTS flolah_memory_desired_ids(id TEXT PRIMARY KEY)');
 db.exec('DELETE FROM flolah_memory_desired_ids');
 const insert=db.prepare('INSERT OR IGNORE INTO flolah_memory_desired_ids VALUES (?)');for(const entry of entries)insert.run(entry.id);
 db.exec('CREATE TEMP TABLE IF NOT EXISTS flolah_memory_embedding_values(key INTEGER PRIMARY KEY,embedding TEXT NOT NULL);CREATE TEMP TABLE IF NOT EXISTS flolah_memory_embedding_refs(id TEXT PRIMARY KEY,key INTEGER NOT NULL);DELETE FROM flolah_memory_embedding_refs;DELETE FROM flolah_memory_embedding_values');
 const insertValue=db.prepare('INSERT INTO flolah_memory_embedding_values VALUES (?,?)'),insertRef=db.prepare('INSERT OR REPLACE INTO flolah_memory_embedding_refs VALUES (?,?)');
 const keys=new Map(),expected=new Map();
 for(const entry of entries){const json=embeddingJson(entry.embedding);let key=keys.get(json);if(key===undefined){key=keys.size;keys.set(json,key);insertValue.run(key,json);}insertRef.run(entry.id,key);expected.set(entry.id,json);}
 const matches=new Set(db.prepare(`SELECT c.id FROM memory_index_chunks c JOIN flolah_memory_embedding_refs r ON r.id=c.id JOIN flolah_memory_embedding_values v ON v.key=r.key WHERE c.path=? AND c.source=? AND c.embedding=v.embedding`).all(path,source).map(r=>r.id));
 const embeddingUnchanged=(id,embedding)=>matches.has(id)&&expected.get(id)===embeddingJson(embedding);
 const stale='SELECT id FROM memory_index_chunks WHERE path=? AND source=? AND id NOT IN (SELECT id FROM flolah_memory_desired_ids)';
 db.prepare(`DELETE FROM ${vectorTable} WHERE id IN (${stale})`).run(path,source);
 if(ftsReady)db.prepare(`DELETE FROM ${ftsTable} WHERE path=? AND source=? AND id NOT IN (SELECT id FROM flolah_memory_desired_ids)`).run(path,source);
 db.prepare(`DELETE FROM memory_index_chunks WHERE id IN (${stale})`).run(path,source);
 const deleteVector=db.prepare(`DELETE FROM ${vectorTable} WHERE id=?`);for(const entry of entries)if(!entry.embedding.length||previous.has(entry.id)&&!embeddingUnchanged(entry.id,entry.embedding))deleteVector.run(entry.id);
 // sqlite-vec point lookups are expensive when repeated for every chunk.
 // Scan IDs once, retaining only this source's existing IDs. Never load vectors.
 const vectorIds=new Set();
 for(const row of db.prepare(`SELECT id FROM ${vectorTable}`).iterate())if(previous.has(row.id))vectorIds.add(row.id);
 const ftsRows=new Map();if(ftsReady)for(const row of db.prepare(`SELECT rowid,id,text,model,start_line,end_line FROM ${ftsTable} WHERE path=? AND source=?`).all(path,source)){
  const rows=ftsRows.get(row.id)||[];rows.push(row);ftsRows.set(row.id,rows);
 }
 // FTS text-column equality scans the whole index. The source snapshot already
 // contains exact rowids, including duplicates; absent IDs need no deletion.
 const ftsDelete=ftsReady?db.prepare(`DELETE FROM ${ftsTable} WHERE rowid=?`):null;
 return {
  embeddingJson,
  embeddingUnchanged,
  vectorUnchanged(id,embedding){return embeddingUnchanged(id,embedding)&&vectorIds.has(id);},
  ftsUnchanged(id,chunk,model){if(!ftsReady)return false;const rows=ftsRows.get(id)||[];const row=rows.length===1?rows[0]:null;if(row&&row.text===chunk.text&&row.model===model&&row.start_line===chunk.startLine&&row.end_line===chunk.endLine)return true;for(const stale of rows)ftsDelete.run(stale.rowid);ftsRows.delete(id);return false;}
 };
}
// Native cache upsert has last-entry-wins semantics for a hash. Preserve that
// result while writing/serializing each unique embedding once per transaction.
export function uniqueMemoryCacheEntries(entries){return [...new Map(entries.map(entry=>[entry.hash,entry])).values()];}

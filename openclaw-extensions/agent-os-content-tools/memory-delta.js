// Atomic delta reconciliation for derived memory indexes. Called inside the
// native write transaction; authoritative transcript storage is untouched.
export function prepareMemoryDelta({db,path,source,entries,vectorTable,ftsTable,vectorReady,ftsReady}) {
 // Preserve the native degraded-vector rebuild behavior.
 if(!vectorReady)return null;
 for(const name of [vectorTable,ftsTable])if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))throw Error('Invalid memory table identifier');
 const previous=new Map(db.prepare('SELECT id,embedding FROM memory_index_chunks WHERE path=? AND source=?').all(path,source).map(r=>[r.id,r.embedding]));
 if(!previous.size)return null;
 db.exec('CREATE TEMP TABLE IF NOT EXISTS flolah_memory_desired_ids(id TEXT PRIMARY KEY)');
 db.exec('DELETE FROM flolah_memory_desired_ids');
 const insert=db.prepare('INSERT OR IGNORE INTO flolah_memory_desired_ids VALUES (?)');for(const entry of entries)insert.run(entry.id);
 const stale='SELECT id FROM memory_index_chunks WHERE path=? AND source=? AND id NOT IN (SELECT id FROM flolah_memory_desired_ids)';
 db.prepare(`DELETE FROM ${vectorTable} WHERE id IN (${stale})`).run(path,source);
 if(ftsReady)db.prepare(`DELETE FROM ${ftsTable} WHERE path=? AND source=? AND id NOT IN (SELECT id FROM flolah_memory_desired_ids)`).run(path,source);
 db.prepare(`DELETE FROM memory_index_chunks WHERE id IN (${stale})`).run(path,source);
 const deleteVector=db.prepare(`DELETE FROM ${vectorTable} WHERE id=?`);for(const entry of entries)if(!entry.embedding.length||previous.has(entry.id)&&previous.get(entry.id)!==JSON.stringify(entry.embedding))deleteVector.run(entry.id);
 const vectorExists=db.prepare(`SELECT id FROM ${vectorTable} WHERE id=? LIMIT 1`);
 const ftsRows=new Map();if(ftsReady)for(const row of db.prepare(`SELECT id,text,model,start_line,end_line FROM ${ftsTable} WHERE path=? AND source=?`).all(path,source))ftsRows.set(row.id,ftsRows.has(row.id)?null:row);
 const ftsDelete=ftsReady?db.prepare(`DELETE FROM ${ftsTable} WHERE id=?`):null;
 return {
  vectorUnchanged(id,embedding){return previous.get(id)===JSON.stringify(embedding)&&!!vectorExists.get(id);},
  ftsUnchanged(id,chunk,model){if(!ftsReady)return false;const row=ftsRows.get(id);if(row&&row.text===chunk.text&&row.model===model&&row.start_line===chunk.startLine&&row.end_line===chunk.endLine)return true;ftsDelete.run(id);return false;}
 };
}

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {prepareMemoryDelta,assertRetentionSnapshot} from '../../openclaw-extensions/agent-os-content-tools/memory-delta.js';
const db=new Database(':memory:');db.exec(`CREATE TABLE memory_index_chunks(id TEXT PRIMARY KEY,path TEXT,source TEXT,embedding TEXT);CREATE TABLE vectors(id TEXT PRIMARY KEY,embedding TEXT);CREATE VIRTUAL TABLE search USING fts5(text,id UNINDEXED,path UNINDEXED,source UNINDEXED,model UNINDEXED,start_line UNINDEXED,end_line UNINDEXED);`);
for(const id of ['keep','change','remove','other','empty']){const path=id==='other'?'other':'room';db.prepare('INSERT INTO memory_index_chunks VALUES (?,?,?,?)').run(id,path,'sessions','[1,2]');db.prepare('INSERT INTO vectors VALUES (?,?)').run(id,'[1,2]');db.prepare('INSERT INTO search VALUES (?,?,?,?,?,?,?)').run('content',id,path,'sessions','model',1,2);}
const entries=[{id:'keep',embedding:[1,2]},{id:'change',embedding:[3,4]},{id:'new',embedding:[1,2]},{id:'empty',embedding:[]}];
const args={db,path:'room',source:'sessions',entries,vectorTable:'vectors',ftsTable:'search',vectorReady:true,ftsReady:true};
db.transaction(()=>{const delta=prepareMemoryDelta(args);assert.equal(delta.vectorUnchanged('keep',[1,2]),true);assert.equal(delta.vectorUnchanged('change',[3,4]),false);assert.equal(delta.ftsUnchanged('keep',{text:'content',startLine:1,endLine:2},'model'),true);assert.equal(delta.ftsUnchanged('change',{text:'updated',startLine:1,endLine:2},'model'),false);assert.equal(db.prepare("SELECT count(*) n FROM vectors WHERE id IN ('remove','change','empty')").get().n,0);assert.equal(db.prepare("SELECT count(*) n FROM search WHERE id IN ('remove','change')").get().n,0);assert.ok(db.prepare("SELECT 1 FROM memory_index_chunks WHERE id='other'").get());})();
const before=db.prepare('SELECT * FROM memory_index_chunks ORDER BY id').all();assert.throws(()=>db.transaction(()=>{prepareMemoryDelta({...args,entries:[]});throw Error('rollback')})(),/rollback/);assert.deepEqual(db.prepare('SELECT * FROM memory_index_chunks ORDER BY id').all(),before);
assert.equal(prepareMemoryDelta({...args,vectorReady:false}),null);
db.exec('CREATE TABLE flolah_retention_fences(session_id TEXT PRIMARY KEY,changed_at INTEGER); INSERT INTO flolah_retention_fences VALUES (\'session\',100)');
assert.throws(()=>assertRetentionSnapshot(db,{sessionId:'session',mtimeMs:99}),/fresh transcript/);
assertRetentionSnapshot(db,{sessionId:'session',mtimeMs:100});
assertRetentionSnapshot(db,{sessionId:'other',mtimeMs:1});
console.log('MEMORY_DELTA_OK: unchanged vectors/FTS, changed/empty embeddings, removed chunks, source isolation, rollback and degraded fallback');db.close();

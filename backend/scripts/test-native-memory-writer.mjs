import {DatabaseSync} from 'node:sqlite';import {createRequire} from 'node:module';import {mkdtempSync,rmSync,readdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const count=Number(process.env.FIXTURE_ROWS||2000),dims=Number(process.env.FIXTURE_DIMS||4);
const root=mkdtempSync(join(tmpdir(),'memory-writer-')),dist='/usr/local/lib/node_modules/openclaw/dist';process.env.OPENCLAW_DIR=root;
const req=createRequire('/usr/local/lib/node_modules/openclaw/package.json');const vec=req('sqlite-vec');
const db=new DatabaseSync(join(root,'test.sqlite'),{allowExtension:true});db.loadExtension(vec.getLoadablePath());
const mod=await import(join(dist,readdirSync(dist).find(f=>/^openclaw-agent-db-maintenance-.*\.js$/.test(f))));Object.values(mod).find(f=>typeof f==='function'&&f.name==='ensureAgentSchema')(db,'fixture',join(root,'test.sqlite'));
db.exec('CREATE VIRTUAL TABLE memory_index_chunks_fts USING fts5(text,id UNINDEXED,path UNINDEXED,source UNINDEXED,model UNINDEXED,start_line UNINDEXED,end_line UNINDEXED)');
db.exec(`CREATE VIRTUAL TABLE memory_index_chunks_vec USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[${dims}])`);
const dreaming=await import(join(dist,readdirSync(dist).find(f=>/^dreaming-state-.*\.js$/.test(f))));Object.values(dreaming).find(f=>typeof f==='function'&&f.name==='configureMemoryCoreDreamingState')(()=>({registerIfAbsent:async()=>true,deleteIf:async()=>true}));
const {MemoryIndexManager}=await import(join(dist,'extensions/memory-core/manager-runtime.js'));const m=Object.create(MemoryIndexManager.prototype);
Object.defineProperty(m,'db',{value:db});Object.defineProperties(m,Object.fromEntries(Object.entries({workspaceDir:root,agentId:'fixture',fts:{enabled:true,available:true},vector:{enabled:true,available:true},cache:{enabled:false},provider:{model:'fixture'},database:{},markVectorRebuildRequired(){throw Error('Unexpected vector degradation')}}).map(([k,v])=>[k,{value:v,writable:true}])));
const chunks=Array.from({length:count},(_,i)=>({startLine:i,endLine:i+1,hash:'hash-'+i,text:'fixture searchable '+i,importance:1,triggers:'',projectKey:null}));const embeddings=chunks.map(()=>Array.from({length:dims},(_,i)=>(i%4+1)/10));const entry={path:'fixture-session',sessionId:'fixture-session',hash:'fixture-v1',mtimeMs:Date.now(),size:1000};
const counts={};const origPrepare=db.prepare.bind(db);db.prepare=(sql,...args)=>{const stmt=origPrepare(sql,...args);if(/DELETE FROM.*fts|INSERT INTO.*fts|INSERT INTO.*vec|DELETE FROM.*vec/.test(sql)){const run=stmt.run.bind(stmt);stmt.run=(...a)=>{const key=sql.split('WHERE')[0].split('(')[0].trim();counts[key]=(counts[key]||0)+1;return run(...a);};}return stmt;};
try{
 let t=performance.now();await m.writeChunks({entry,source:'sessions',chunks},{provider:{model:'fixture'}},embeddings,true);const initial=performance.now()-t;for(const k of Object.keys(counts))delete counts[k];
 t=performance.now();await m.writeChunks({entry,source:'sessions',chunks},{provider:{model:'fixture'}},embeddings,true);const unchanged=performance.now()-t;const unchangedWrites={...counts};
 const next=chunks.slice(1);next.push({...chunks[0],hash:'changed-hash',text:'replacement'});const nextEmb=embeddings.slice(1);nextEmb.push(Array.from({length:dims},(_,i)=>(4-i%4)/10));
 t=performance.now();await m.writeChunks({entry:{...entry,hash:'fixture-v2'},source:'sessions',chunks:next},{provider:{model:'fixture'}},nextEmb,true);const changed=performance.now()-t;
 for(const table of ['memory_index_chunks','memory_index_chunks_vec','memory_index_chunks_fts'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,count,table);
 assert.equal(db.prepare("SELECT count(*) n FROM memory_index_chunks WHERE text='replacement'").get().n,1);
 db.exec('CREATE TABLE flolah_retention_fences(session_id TEXT PRIMARY KEY,changed_at INTEGER)');
 db.prepare('INSERT INTO flolah_retention_fences VALUES(?,?)').run(entry.sessionId,entry.mtimeMs+1);
 await assert.rejects(()=>m.writeChunks({entry,source:'sessions',chunks},{provider:{model:'fixture'}},embeddings,true),/fresh transcript/);
 assert.equal(db.prepare("SELECT count(*) n FROM memory_index_chunks WHERE text='replacement'").get().n,1,'stale indexing snapshot must roll back');
 await m.writeChunks({entry:{...entry,mtimeMs:entry.mtimeMs+1},source:'sessions',chunks:next},{provider:{model:'fixture'}},nextEmb,true);
 console.log(JSON.stringify({initialMs:Math.round(initial),unchangedMs:Math.round(unchanged),changedMs:Math.round(changed),rows:count,dims,unchangedWrites,verified:true}));
}finally{db.close();rmSync(root,{recursive:true,force:true})}


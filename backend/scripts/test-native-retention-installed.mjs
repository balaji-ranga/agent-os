import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {readdirSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {purgeNativeHistory} from '../../openclaw-extensions/agent-os-content-tools/native-retention.js';
const dist='/usr/local/lib/node_modules/openclaw/dist',req=createRequire('/usr/local/lib/node_modules/openclaw/package.json');
const root=mkdtempSync(join(tmpdir(),'retention-native-')),agentRoot=join(root,'agents','fixture');
mkdirSync(join(agentRoot,'agent'),{recursive:true});mkdirSync(join(agentRoot,'sessions'));
const dbPath=join(agentRoot,'agent','openclaw-agent.sqlite');
const db=new DatabaseSync(dbPath,{allowExtension:true});db.loadExtension(req('sqlite-vec').getLoadablePath());
try{
 const mod=await import(join(dist,readdirSync(dist).find(f=>/^openclaw-agent-db-maintenance-.*\.js$/.test(f))));
 Object.values(mod).find(f=>typeof f==='function'&&f.name==='ensureAgentSchema')(db,'fixture',dbPath);
 const now=Date.now(),old=now-100*86400000;
 db.prepare("INSERT OR REPLACE INTO schema_meta(meta_key,role,schema_version,agent_id,created_at,updated_at) VALUES('primary','agent',19,'fixture',?,?)").run(now,now);
 db.exec('CREATE VIRTUAL TABLE memory_index_chunks_vec USING vec0(id TEXT PRIMARY KEY,embedding FLOAT[4])');
 db.exec('CREATE VIRTUAL TABLE memory_index_chunks_fts USING fts5(text,id UNINDEXED,path UNINDEXED,source UNINDEXED,model UNINDEXED,start_line UNINDEXED,end_line UNINDEXED)');
 db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS memory_index_paths_fts USING fts5(path,source UNINDEXED)');
 db.prepare("INSERT INTO session_nodes(session_key,current_session_id,entry_json,entry_valid,updated_at,status) VALUES('agent:fixture:main','current',?,1,?,'done')").run(JSON.stringify({sessionId:'current',updatedAt:now}),now);
 for(const [sid,time]of [['old',old],['current',old],['recent',now]]){
  db.prepare("INSERT INTO session_windows(session_id,session_key,created_at,updated_at,status) VALUES(?,'agent:fixture:main',?,?,'done')").run(sid,time,time);
  db.prepare('INSERT INTO transcript_events VALUES(?,?,?,?)').run(sid,1,JSON.stringify({type:'message',id:'event-'+sid,parentId:null,timestamp:new Date(time).toISOString(),message:{role:'user',content:[{type:'text',text:'private fixture '+sid}],timestamp:time}}),time);
  db.prepare('INSERT INTO transcript_event_identities(session_id,event_id,seq,created_at) VALUES(?,?,1,?)').run(sid,'event-'+sid,time);
  db.prepare('INSERT INTO session_transcript_fts(text,session_id) VALUES(?,?)').run('fixture',sid);
  const path=`sessions/fixture/${sid}.jsonl`;
  db.prepare("INSERT INTO memory_index_chunks(id,path,source,start_line,end_line,hash,model,text,embedding,updated_at) VALUES(?,?,'sessions',1,2,'hash','fixture','fixture','[1,2,3,4]',?)").run(sid,path,time);
  db.prepare('INSERT INTO memory_index_chunks_vec VALUES(?,?)').run(sid,new Uint8Array(new Float32Array([1,2,3,4]).buffer));
  db.prepare("INSERT INTO memory_index_chunks_fts(id,path,source,text) VALUES(?,?,'sessions','fixture')").run(sid,path);
  db.prepare("INSERT INTO memory_index_sources(path,source,hash,mtime,size) VALUES(?,'sessions','hash',?,10)").run(path,time);
 }
 const accessor=await import(join(dist,readdirSync(dist).find(f=>/^session-accessor-[\w-]+\.js$/.test(f))));
 const rewriteRows=Object.values(accessor).find(f=>typeof f==='function'&&f.name==='rewriteTranscriptEventRowsExact');
 const args={agentId:'fixture',cutoffMs:now-90*86400000,batchSize:2,rewriteRows,storePath:join(agentRoot,'sessions','sessions.json')};
 await assert.rejects(()=>purgeNativeHistory(db,{...args,agentId:'outsider'}),/identity mismatch/);
 const preview=await purgeNativeHistory(db,{...args,dryRun:true});assert.equal(preview.redacted_events,2);
 assert.equal(db.prepare('SELECT count(*) n FROM transcript_events').get().n,3);
 // Crash after canonical commit, before derived-index cleanup. Retry must
 // recover even though the committed row no longer matches the age predicate.
 let interrupted=false;
 await assert.rejects(()=>purgeNativeHistory(db,{...args,dryRun:false,rewriteRows:async(...params)=>{
   const value=await rewriteRows(...params);
   if(!interrupted){interrupted=true;throw Error('simulated post-commit interruption');}
   return value;
 }}),/simulated post-commit interruption/);
 assert.equal(db.prepare('SELECT count(*) n FROM flolah_retention_pending_indexes').get().n,1);
 const result=await purgeNativeHistory(db,{...args,dryRun:false});
 assert.equal(db.prepare('SELECT count(*) n FROM flolah_retention_pending_indexes').get().n,0);
 for(const table of ['transcript_events','transcript_event_identities'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,3,table);
 for(const table of ['memory_index_chunks','memory_index_chunks_vec','memory_index_chunks_fts','session_transcript_fts'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,1,table);
 assert.equal(JSON.parse(db.prepare("SELECT event_json FROM transcript_events WHERE session_id='current'").get().event_json).flolahRetentionExpired,true);
 assert.equal(db.prepare('SELECT count(*) n FROM memory_session_tombstones').get().n,0);
 assert.equal(result.deferred_current_sessions,1);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 const again=await purgeNativeHistory(db,{...args,dryRun:false});assert.equal(again.deleted.transcript_events||0,0);
 console.log(JSON.stringify({test:'NATIVE_RETENTION_OK',nativeSchema:19,sqliteVec:true,fts:true,rollbackScope:true,currentPreserved:true,idempotent:true,result}));
}finally{db.close();rmSync(root,{recursive:true,force:true});}

import {setImmediate as yieldTurn} from 'node:timers/promises';
import {redactRetentionEvent} from './retention-redaction.js';

/** Native schema 19: redact expired payloads through the canonical rewrite API.
 * Structural event identities remain to preserve branches and tool-call pairing. */
export async function purgeNativeHistory(db,{agentId,cutoffMs,dryRun=true,batchSize=100,rewriteRows,storePath}) {
  if(!agentId||!Number.isFinite(cutoffMs)||cutoffMs>=Date.now())throw Error('Invalid native retention scope');
  const meta=db.prepare("SELECT agent_id,schema_version FROM schema_meta WHERE role='agent' AND meta_key='primary'").all();
  if(meta.length!==1||meta[0].agent_id!==agentId||meta[0].schema_version!==19)throw Error('Native retention schema/agent identity mismatch');
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000');
  const result={agentId,dry_run:dryRun,deleted:{},deferred_current_sessions:0};
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  const changedPaths=new Set();
  if(!dryRun){
    db.exec('CREATE TABLE IF NOT EXISTS flolah_retention_pending_indexes(session_id TEXT PRIMARY KEY)');
    for(const row of db.prepare('SELECT session_id FROM flolah_retention_pending_indexes').all())changedPaths.add(row.session_id);
  }
  const batchDelete=async(table,where,args=[])=>{
    if(!tables.has(table))return;
    if(dryRun){result.deleted[table]=(result.deleted[table]||0)+db.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get(...args).n;return;}
    let n;
    do{
      n=transaction(()=>db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ?)`).run(...args,batchSize).changes);
      result.deleted[table]=(result.deleted[table]||0)+n;
      await yieldTurn();
    }while(n===batchSize);
  };
  result.deferred_current_sessions=db.prepare(`SELECT count(DISTINCT e.session_id) n FROM transcript_events e
    JOIN session_nodes n ON n.current_session_id=e.session_id WHERE e.created_at<?`).get(cutoffMs).n;
  result.deferred_event_types=db.prepare(`SELECT json_extract(e.event_json,'$.type') type,count(*) n FROM transcript_events e
    JOIN session_nodes n ON n.current_session_id=e.session_id WHERE e.created_at<? GROUP BY 1`).all(cutoffMs);
  const expiredPayload=`created_at<? AND COALESCE(json_extract(event_json,'$.flolahRetentionExpired'),0)=0
    AND json_extract(event_json,'$.type') IN ('message','custom','compaction')`;
  result.redacted_events=0;result.deferred_active_payloads=0;
  for(const session of db.prepare(`SELECT DISTINCT w.session_id,w.session_key FROM session_windows w
    JOIN transcript_events e ON e.session_id=w.session_id WHERE e.${expiredPayload}`).all(cutoffMs)){
    const active=()=>db.prepare(`SELECT 1 FROM session_nodes WHERE current_session_id=? AND
      (status='running' OR json_extract(entry_json,'$.activeWriterRunId') IS NOT NULL)`).get(session.session_id);
    if(active()){result.deferred_active_payloads++;continue;}
    if(dryRun){result.redacted_events+=db.prepare(`SELECT count(*) n FROM transcript_events WHERE session_id=? AND ${expiredPayload}`).get(session.session_id,cutoffMs).n;continue;}
    if(!rewriteRows)throw Error('Canonical native transcript rewrite API required');
    db.exec('CREATE TABLE IF NOT EXISTS flolah_retention_fences(session_id TEXT PRIMARY KEY,changed_at INTEGER NOT NULL)');
    for(;;){
      if(active()){result.deferred_active_payloads++;break;}
      const rows=db.prepare(`SELECT seq,event_json FROM transcript_events WHERE session_id=? AND ${expiredPayload} ORDER BY seq LIMIT ?`).all(session.session_id,cutoffMs,batchSize);
      if(!rows.length)break;
      const expectedGeneration=db.prepare('SELECT generation FROM transcript_rewrite_watermarks WHERE session_id=?').get(session.session_id)?.generation??null;
      const replacements=rows.map(r=>({seq:r.seq,expectedEventJson:r.event_json,event:redactRetentionEvent(JSON.parse(r.event_json))}));
      transaction(()=>{
        db.prepare('INSERT INTO flolah_retention_fences VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET changed_at=excluded.changed_at').run(session.session_id,Date.now());
        db.prepare('INSERT OR IGNORE INTO flolah_retention_pending_indexes(session_id) VALUES(?)').run(session.session_id);
      });
      const rewritten=await rewriteRows({agentId,sessionId:session.session_id,sessionKey:session.session_key,storePath},{expectedGeneration,allowInitialGenerationMaterialization:expectedGeneration===null,rows:replacements});
      if(!rewritten)throw Error('Transcript generation changed during retention; retry required');
      // Fence queued index snapshots from before any redaction batch.
      const stamp=db.prepare('SELECT transcript_updated_at FROM session_windows WHERE session_id=?').get(session.session_id)?.transcript_updated_at;
      if(!Number.isFinite(stamp))throw Error('Native transcript mutation timestamp missing');
      transaction(()=>db.prepare('UPDATE flolah_retention_fences SET changed_at=? WHERE session_id=?').run(stamp,session.session_id));
      result.redacted_events+=rows.length;
      changedPaths.add(session.session_id);
      await yieldTurn();
    }
  }
  // All derived copies of redacted content must go; fresh indexing uses the
  // canonical redacted transcript and is guarded by the mutation timestamp.
  if(!dryRun)for(const sid of changedPaths){
   await batchDelete('session_transcript_fts','session_id=?',[sid]);
   transaction(()=>db.prepare('UPDATE session_transcript_index_state SET needs_rebuild=1 WHERE session_id=?').run(sid));
   for(const path of [`sessions/${agentId}/${sid}.jsonl`,`sessions/${agentId}/${sid}`]){
    transaction(()=>db.prepare("DELETE FROM memory_embedding_cache WHERE hash IN (SELECT hash FROM memory_index_chunks WHERE path=? AND source='sessions')").run(path));
    const ids=db.prepare("SELECT id FROM memory_index_chunks WHERE path=? AND source='sessions'").all(path);
    result.deleted.memory_index_chunks=(result.deleted.memory_index_chunks||0)+ids.length;
    for(let i=0;i<ids.length;i+=batchSize){transaction(()=>{
      for(const {id}of ids.slice(i,i+batchSize)){
        if(tables.has('memory_index_chunks_vec'))db.prepare('DELETE FROM memory_index_chunks_vec WHERE id=?').run(id);
        if(tables.has('memory_index_chunks_fts'))db.prepare('DELETE FROM memory_index_chunks_fts WHERE id=?').run(id);
        db.prepare('DELETE FROM memory_index_chunks WHERE id=?').run(id);
      }
    });await yieldTurn();}
    await batchDelete('memory_index_sources','path=? AND source=?',[path,'sessions']);
    await batchDelete('memory_index_paths_fts','path=? AND source=?',[path,'sessions']);
   }
   transaction(()=>db.prepare('DELETE FROM flolah_retention_pending_indexes WHERE session_id=?').run(sid));
  }
  for(const [table,where]of [
    ['memory_embedding_cache','updated_at<?'],
    ['session_transcript_archives','created_at<?'],
    ['message_tool_run_outcomes','occurred_at<?'],
    ['trajectory_runtime_events','created_at<?'],
    ['acp_parent_stream_events','created_at<?'],
    ['session_goal_operations','expires_at<?'],
    ['cache_entries','updated_at<? AND expires_at IS NOT NULL AND expires_at<'+Date.now()],
    ['session_pending_inputs',"accepted_at<? AND state='cancelled'"],
    ['session_suggestions',"created_at<? AND state IN ('accepted','dismissed') AND dispatch_token IS NULL"],
  ])await batchDelete(table,where,[cutoffMs]);
  // Delivery IDs remain deduplication authority; expire their response bodies.
  if(tables.has('conversation_deliveries')){
    const predicate="updated_at<? AND status IN ('sent','suppressed','rejected','replied') AND (reply_text IS NOT NULL OR (rejection_error IS NOT NULL AND rejection_error<>'Expired under retention'))";
    result.redacted_deliveries=db.prepare(`SELECT count(*) n FROM conversation_deliveries WHERE ${predicate}`).get(cutoffMs).n;
    if(!dryRun){let n;do{n=transaction(()=>db.prepare(`UPDATE conversation_deliveries SET reply_text=NULL,rejection_error=CASE WHEN status='rejected' THEN 'Expired under retention' ELSE NULL END WHERE rowid IN (SELECT rowid FROM conversation_deliveries WHERE ${predicate} LIMIT ?)`).run(cutoffMs,batchSize).changes);await yieldTurn();}while(n===batchSize);}
  }
  // No VACUUM/full checkpoint on a live gateway. WAL pages are reused normally.
  return result;
}

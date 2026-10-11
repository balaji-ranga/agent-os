import { getDb } from '../db/schema.js';

// Metadata only: document bodies and credentials must not enter the job ledger.
export function knowledgeProcessingState(db=getDb(),clock=Date.now){
  db.exec(`CREATE TABLE IF NOT EXISTS knowledge_record_attempts(
    owner TEXT NOT NULL,job_id TEXT NOT NULL,object_id TEXT NOT NULL,
    stage TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 1,error TEXT,updated_at TEXT NOT NULL,
    PRIMARY KEY(owner,job_id,object_id));
    CREATE INDEX IF NOT EXISTS knowledge_record_attempts_page ON knowledge_record_attempts(owner,job_id,object_id);
    CREATE TABLE IF NOT EXISTS knowledge_retry_state(
      owner TEXT NOT NULL,source_id TEXT NOT NULL,failures INTEGER NOT NULL DEFAULT 0,
      retry_at TEXT,PRIMARY KEY(owner,source_id));`);
  return {
    record(job,objectId,stage,error=null){
      if(!['indexing','indexed','failed'].includes(stage))throw new Error('Invalid processing stage');
      db.prepare(`INSERT INTO knowledge_record_attempts VALUES(?,?,?,?,1,?,?)
        ON CONFLICT(owner,job_id,object_id) DO UPDATE SET stage=excluded.stage,error=excluded.error,
        attempts=knowledge_record_attempts.attempts+CASE WHEN excluded.stage='indexing' THEN 1 ELSE 0 END,
        updated_at=excluded.updated_at`).run(job.owner,job.id,String(objectId),stage,error,new Date(clock()).toISOString());
    },
    page(owner,jobId,{after='',limit=25}={}){
      limit=Number(limit);
      if(!Number.isInteger(limit)||limit<1||limit>100||typeof after!=='string'||after.length>2000)throw new Error('Invalid record page');
      const rows=db.prepare('SELECT object_id,stage,attempts,error,updated_at FROM knowledge_record_attempts WHERE owner=? AND job_id=? AND object_id>? ORDER BY object_id LIMIT ?').all(owner,jobId,after,limit+1);
      return {items:rows.slice(0,limit),next:rows.length>limit?rows[limit-1].object_id:null};
    },
    retry(owner,sourceId,error,intervalSeconds,retryAfterMs=0){
      if(!error){db.prepare('DELETE FROM knowledge_retry_state WHERE owner=? AND source_id=?').run(owner,sourceId);return new Date(clock()+intervalSeconds*1000).toISOString();}
      const previous=db.prepare('SELECT failures FROM knowledge_retry_state WHERE owner=? AND source_id=?').get(owner,sourceId);
      const failures=(previous?.failures||0)+1;
      const providerDelay=Number.isFinite(retryAfterMs)?Math.max(0,Math.min(retryAfterMs,30*86400000)):0;
      const retryAt=new Date(clock()+Math.max(providerDelay,Math.min(3600000,30000*2**Math.min(failures-1,7)))).toISOString();
      db.prepare('INSERT INTO knowledge_retry_state VALUES(?,?,?,?) ON CONFLICT(owner,source_id) DO UPDATE SET failures=excluded.failures,retry_at=excluded.retry_at').run(owner,sourceId,failures,retryAt);
      return retryAt;
    },
    getRetry(owner,sourceId){return db.prepare('SELECT failures,retry_at FROM knowledge_retry_state WHERE owner=? AND source_id=?').get(owner,sourceId)||null;},
    cleanup(owner,days=90){
      if(!owner||!Number.isInteger(days)||days<1||days>3650)throw new Error('Valid owner and retention days required');
      const cutoff=new Date(clock()-days*86400000).toISOString();
      return db.transaction(()=>{
        const jobs=db.prepare("SELECT id FROM knowledge_jobs WHERE owner=? AND ended_at<? AND status NOT IN ('queued','running') LIMIT 500").all(owner,cutoff);
        for(const {id} of jobs){db.prepare('DELETE FROM knowledge_record_attempts WHERE owner=? AND job_id=?').run(owner,id);db.prepare('DELETE FROM knowledge_jobs WHERE owner=? AND id=?').run(owner,id);}
        db.prepare('DELETE FROM knowledge_retry_state WHERE owner=? AND source_id NOT IN (SELECT id FROM knowledge_sources WHERE owner=?)').run(owner,owner);
        if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='knowledge_feedback'").get())db.prepare('DELETE FROM knowledge_feedback WHERE owner=? AND created_at<?').run(owner,cutoff);
        if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='knowledge_retrieval_metrics'").get())db.prepare('DELETE FROM knowledge_retrieval_metrics WHERE owner=? AND created_at<?').run(owner,cutoff);
        return {jobs_deleted:jobs.length};
      })();
    },
  };
}

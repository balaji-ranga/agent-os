import {getDb} from '../db/schema.js';
import {knowledgeStore} from './knowledge-store.js';
import {knowledgeSearch} from './knowledge-search.js';
const initialized=new WeakSet();

// Content-free telemetry. Never persist queries, excerpts, credentials or raw errors.
export function knowledgeEfficiency(db=getDb(),clock=Date.now){
  if(!initialized.has(db)){
  knowledgeStore(db);
  db.exec(`CREATE TABLE IF NOT EXISTS knowledge_retrieval_metrics(
    id INTEGER PRIMARY KEY,owner TEXT NOT NULL,agent TEXT NOT NULL,mode TEXT NOT NULL,
    outcome TEXT NOT NULL,records INTEGER NOT NULL,relationships INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,sources TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS knowledge_metrics_owner_time ON knowledge_retrieval_metrics(owner,created_at);
    CREATE INDEX IF NOT EXISTS knowledge_jobs_owner_time ON knowledge_jobs(owner,started_at);
    CREATE INDEX IF NOT EXISTS knowledge_metrics_agent_time ON knowledge_retrieval_metrics(owner,agent,created_at);`);
  initialized.add(db);
  }
  return {
    record(owner,agent,mode,result,error,duration){
      if(!owner)return;
      const rows=result?.evidence||result?.chunks||[];
      const sources=[...new Set(rows.map(r=>r.source).filter(s=>typeof s==='string'))].slice(0,100);
      const records=new Set(rows.map(r=>r.entity||r.document_id).filter(Boolean)).size;
      const denied=error?.status===403||String(result?.company_knowledge_access||'').startsWith('no_');
      db.prepare('INSERT INTO knowledge_retrieval_metrics(owner,agent,mode,outcome,records,relationships,duration_ms,sources,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(owner,String(agent||'unattributed').slice(0,200),mode,denied?'denied':error?'error':records?'success':'empty',records,result?.relationships?.length||0,Math.max(0,Math.round(duration)),JSON.stringify(sources),new Date(clock()).toISOString());
    },
    report(owner,{days='14',source='',agent='',page=0,section='sources'}={}){
      if(!owner)throw Object.assign(new Error('Authenticated company required'),{status:403});
      if(!['7','14','30','90','all'].includes(String(days))||!['sources','runs','agents'].includes(section)||!Number.isSafeInteger(Number(page))||Number(page)<0||Number(page)>100000||typeof source!=='string'||source.length>200||typeof agent!=='string'||agent.length>200)throw Object.assign(new Error('Invalid Knowledge metrics filter'),{status:400});
      if(source&&!db.prepare('SELECT 1 FROM knowledge_sources WHERE owner=? AND id=?').get(owner,source))throw Object.assign(new Error('Source not found'),{status:404});
      const since=days==='all'?'':new Date(clock()-Number(days)*86400000).toISOString();
      const sw='owner=?'+(source?' AND id=?':'');const sp=source?[owner,source]:[owner];
      const jw='owner=? AND started_at>=?'+(source?' AND source_id=?':'');const jp=source?[owner,since,source]:[owner,since];
      const rw='owner=? AND created_at>=?'+(agent?' AND agent=?':'')+(source?' AND EXISTS(SELECT 1 FROM json_each(sources) WHERE value=?)':'');
      const rp=[owner,since,...(agent?[agent]:[]),...(source?[source]:[])];
      const health=db.prepare(`SELECT count(*) total,sum(enabled=0) paused,sum(status='error') failed,sum(status='running' OR status='syncing') syncing FROM knowledge_sources WHERE ${sw}`).get(...sp);
      const sync=db.prepare(`SELECT count(*) runs,sum(status='failed') failed,sum(records) checked,sum(changed) changed,sum(reused) reused,sum(deleted) deleted,sum(changed IS NULL) unmeasured_runs,avg((julianday(ended_at)-julianday(started_at))*86400) seconds FROM knowledge_jobs WHERE ${jw}`).get(...jp);
      const usage=db.prepare(`SELECT count(*) calls,sum(mode='graph') graph_calls,sum(mode='rag') rag_calls,sum(outcome='empty') empty,sum(outcome='denied') denied,sum(outcome='error') errors,sum(records) retrieved,sum(relationships) relationships,avg(duration_ms) latency_ms,min(created_at) first_recorded FROM knowledge_retrieval_metrics WHERE ${rw}`).get(...rp);
      for(const key of ['graph_calls','rag_calls','empty','denied','errors','retrieved','relationships'])usage[key]??=0;
      for(const key of ['paused','failed','syncing'])health[key]??=0;
      usage.p95_ms=usage.calls?db.prepare(`SELECT duration_ms FROM knowledge_retrieval_metrics WHERE ${rw} ORDER BY duration_ms LIMIT 1 OFFSET ?`).get(...rp,Math.max(0,Math.ceil(usage.calls*.95)-1)).duration_ms:null;
      const heartbeat=db.prepare('SELECT max(heartbeat_at) at FROM knowledge_worker_health').get().at;
      health.worker=heartbeat?(clock()-Date.parse(heartbeat)<120000?'online':'stale'):'not recorded';
      const pending=db.prepare(`SELECT count(*) count,min(started_at) oldest FROM knowledge_jobs WHERE owner=? AND status IN ('queued','running')${source?' AND source_id=?':''}`).get(...sp);
      const size=20,offset=Number(page)*size;
      let items,total;
      if(section==='sources'){
        total=health.total;
        items=db.prepare(`SELECT id,json_extract(config,'$.name') name,json_extract(config,'$.kind') kind,enabled,status,last_success,next_sync,revision,CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END has_error FROM knowledge_sources WHERE ${sw} ORDER BY id LIMIT ? OFFSET ?`).all(...sp,size,offset);
        for(const s of items){s.retry=db.prepare('SELECT failures,retry_at FROM knowledge_retry_state WHERE owner=? AND source_id=?').get(owner,s.id)||null;s.excluded=db.prepare('SELECT count(*) n FROM knowledge_exclusions WHERE owner=? AND source_id=?').get(owner,s.id).n;}
      }else if(section==='runs'){
        total=sync.runs;
        items=db.prepare(`SELECT id,source_id,(SELECT json_extract(config,'$.name') FROM knowledge_sources s WHERE s.id=knowledge_jobs.source_id AND s.owner=knowledge_jobs.owner) source_name,status,trigger,started_at,ended_at,records checked,changed,reused,deleted,content_groups_loaded,(julianday(ended_at)-julianday(started_at))*86400 seconds,CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END has_error FROM knowledge_jobs WHERE ${jw} ORDER BY started_at DESC,id LIMIT ? OFFSET ?`).all(...jp,size,offset);
      }else{
        total=db.prepare(`SELECT count(DISTINCT agent) n FROM knowledge_retrieval_metrics WHERE ${rw}`).get(...rp).n;
        items=db.prepare(`SELECT agent,count(*) calls,sum(mode='graph') graph_calls,sum(mode='rag') rag_calls,sum(records) retrieved,sum(outcome='empty') empty,sum(outcome='denied') denied,sum(outcome='error') errors,avg(duration_ms) latency_ms FROM knowledge_retrieval_metrics WHERE ${rw} GROUP BY agent ORDER BY calls DESC,agent LIMIT ? OFFSET ?`).all(...rp,size,offset);
      }
      return {health,sync,usage,pending,items,total,page:Number(page),page_size:size,next:offset+size<total?Number(page)+1:null,as_of:new Date(clock()).toISOString(),notes:['Sync metrics use retained history; older runs may lack change counters.','Retrieval telemetry starts with this release. Retrieved evidence is not proof of final-response citation.','Provider coverage, final citations, unique records across calls, extraction time and attributed cost are not recorded.','Source filters apply to successful retrieval evidence; denied calls have no source attribution. Agent filters apply to retrieval metrics only.']};
    }
  };
}

export async function trackKnowledgeRetrieval(owner,params,invoke,{metrics=()=>knowledgeEfficiency(),clock=Date.now}={}){
  const start=clock();let result,error;
  try{return result=await invoke();}catch(e){error=e;throw e;}finally{
    if(params.retrieval_mode!=='knowledge_management')try{metrics().record(owner,params.agentId||params.agent_id||params.source,params.retrieval_mode==='connected_information'?'graph':'rag',result,error,clock()-start);}catch{console.warn('[knowledge-metrics] telemetry unavailable');}
  }
}

export async function knowledgeEfficiencyReport(owner,options={},deps={}){
  const service=deps.service||knowledgeEfficiency();
  const report=service.report(owner,options);
  // Only aggregate published revisions, never document content. Fail soft on search downtime.
  try{const sources=(deps.store||knowledgeStore()).list(owner).filter(s=>s.revision&&(!options.source||s.id===options.source));report.index=await (deps.search||knowledgeSearch()).metrics(owner,sources);}catch{report.index={available:false};}
  return report;
}

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/schema.js';
import { validateSource, validateMapping } from './knowledge-contract.js';
import { validateFieldRule } from './knowledge-field-rules.js';
import { knowledgeProcessingState } from './knowledge-processing-state.js';

// Persist scheduler state centrally so work survives a process restart. Every
// statement also scopes by authenticated owner, even when IDs are unguessable.
export function knowledgeStore(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_exclusions (
      owner TEXT NOT NULL,source_id TEXT NOT NULL,object_id TEXT NOT NULL,created_at TEXT NOT NULL,
      PRIMARY KEY(owner,source_id,object_id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_incremental_drafts (
      owner TEXT NOT NULL,source_id TEXT NOT NULL,generation INTEGER NOT NULL,
      PRIMARY KEY(owner,source_id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_incremental_records (
      owner TEXT NOT NULL,source_id TEXT NOT NULL,object_id TEXT NOT NULL,
      hash TEXT NOT NULL,version INTEGER NOT NULL,
      PRIMARY KEY(owner,source_id,object_id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, revision TEXT, status TEXT NOT NULL DEFAULT 'pending',
      next_sync TEXT NOT NULL, last_success TEXT, error TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_sources_due ON knowledge_sources(enabled,next_sync);
    CREATE TABLE IF NOT EXISTS knowledge_jobs (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, owner TEXT NOT NULL,
      status TEXT NOT NULL, lease_until TEXT, started_at TEXT, ended_at TEXT,
      records INTEGER NOT NULL DEFAULT 0, error TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS knowledge_jobs_pending ON knowledge_jobs(source_id)
      WHERE status IN ('queued','running');
    CREATE TABLE IF NOT EXISTS knowledge_mappings (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, config TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_agent_access (
      owner TEXT NOT NULL, agent_id TEXT NOT NULL, sources_json TEXT NOT NULL,
      PRIMARY KEY(owner,agent_id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_cleanup (
      owner TEXT NOT NULL, source_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(owner,source_id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_field_rules (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, config TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_field_rules_owner ON knowledge_field_rules(owner,id);
    CREATE INDEX IF NOT EXISTS knowledge_mappings_owner ON knowledge_mappings(owner,id);
    CREATE INDEX IF NOT EXISTS knowledge_mappings_from ON knowledge_mappings(owner,json_extract(config,'$.from_source'),json_extract(config,'$.from_object'));
    CREATE INDEX IF NOT EXISTS knowledge_mappings_to ON knowledge_mappings(owner,json_extract(config,'$.to_source'),json_extract(config,'$.to_object'));
  `);
  const now = () => new Date().toISOString();
  const processing=knowledgeProcessingState(db);
  const columns=new Set(db.prepare('PRAGMA table_info(knowledge_jobs)').all().map(c=>c.name));
  for(const [name,type] of [['trigger','TEXT'],['changed','INTEGER'],['reused','INTEGER'],['deleted','INTEGER']])if(!columns.has(name))db.exec(`ALTER TABLE knowledge_jobs ADD COLUMN ${name} ${type}`);
  db.exec('CREATE TABLE IF NOT EXISTS knowledge_worker_health(id TEXT PRIMARY KEY,heartbeat_at TEXT NOT NULL)');
  const map = row => row && ({ ...JSON.parse(row.config), id:row.id, owner:row.owner, enabled:!!row.enabled,
    revision:row.revision,status:row.status,last_success:row.last_success,error:row.error,next_sync:row.next_sync,retry:processing.getRetry(row.owner,row.id) });
  return {
    fullResync(owner,id) {
      return db.transaction(()=>{
        const source=this.get(owner,id);
        if(!source)throw Object.assign(new Error('Source not found'),{status:404});
        if(!source.enabled)throw Object.assign(new Error('Resume the source before rebuilding'),{status:409});
        if(db.prepare("SELECT 1 FROM knowledge_jobs WHERE owner=? AND source_id=? AND status IN ('queued','running')").get(owner,id))throw Object.assign(new Error('Wait for the existing synchronization before rebuilding'),{status:409});
        // Keep the published revision, exclusions, grants and relationship rules.
        // Only invalidate reuse metadata; publication remains atomic on success.
        for(const table of ['knowledge_incremental_records','knowledge_incremental_drafts'])db.prepare(`DELETE FROM ${table} WHERE owner=? AND source_id=?`).run(owner,id);
        return this.enqueue(owner,id,'full_resync');
      })();
    },
    globallyPaused() {
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_settings'").get())return false;
      const raw=db.prepare("SELECT value FROM platform_settings WHERE key='platform_cron_paused'").get()?.value;
      try{return !!JSON.parse(raw||'{}').knowledge_sync;}catch{return true;}
    },
    workerHeartbeat() {db.prepare("INSERT INTO knowledge_worker_health VALUES('worker',?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at").run(now());},
    adminStats() {
      const heartbeat=db.prepare("SELECT heartbeat_at FROM knowledge_worker_health WHERE id='worker'").get()?.heartbeat_at;
      return {knowledge_stats:{worker_health:!heartbeat?'not_seen':Date.now()-Date.parse(heartbeat)<90000?'online':'stale',heartbeat_at:heartbeat||null,
        sources:db.prepare('SELECT count(*) AS total,sum(enabled) AS enabled,min(CASE WHEN enabled=1 THEN next_sync END) AS next_sync FROM knowledge_sources').get(),
        jobs:db.prepare('SELECT status,count(*) AS count FROM knowledge_jobs GROUP BY status').all(),
        totals:db.prepare('SELECT count(*) AS runs,sum(records) AS checked,sum(changed) AS changed,sum(reused) AS reused,sum(deleted) AS deleted FROM knowledge_jobs WHERE ended_at>=?').get(new Date(Date.now()-86400000).toISOString())}};
    },
    enqueueDue(trigger='scheduled') {
      if(this.globallyPaused())return 0;
      const due=db.prepare('SELECT owner,id FROM knowledge_sources WHERE enabled=1 AND next_sync<=?').all(now());
      for(const row of due)this.enqueue(row.owner,row.id,trigger);
      return due.length;
    },
    excluded(owner,source,id){return !!db.prepare('SELECT 1 FROM knowledge_exclusions WHERE owner=? AND source_id=? AND object_id=?').get(owner,source,id);},
    exclusions(owner,source,after=''){return db.prepare('SELECT object_id,created_at FROM knowledge_exclusions WHERE owner=? AND source_id=? AND object_id>? ORDER BY object_id LIMIT 101').all(owner,source,after);},
    beginRecordManagement(owner,id){
      return db.transaction(()=>{
        const source=this.get(owner,id);if(!source)throw Object.assign(new Error('Source not found'),{status:404});
        if(db.prepare("SELECT 1 FROM knowledge_jobs WHERE owner=? AND source_id=? AND status='running'").get(owner,id))throw Object.assign(new Error('Synchronization is active. Wait for completion before managing records.'),{status:409});
        this.setEnabled(owner,id,false);return source;
      })();
    },
    setExcluded(owner,source,id,excluded){
      if(!this.get(owner,source))throw Object.assign(new Error('Source not found'),{status:404});
      if(excluded)db.prepare('INSERT OR IGNORE INTO knowledge_exclusions VALUES(?,?,?,?)').run(owner,source,id,now());
      else db.prepare('DELETE FROM knowledge_exclusions WHERE owner=? AND source_id=? AND object_id=?').run(owner,source,id);
      db.prepare('DELETE FROM knowledge_incremental_records WHERE owner=? AND source_id=? AND object_id=?').run(owner,source,id);
    },
    incrementalDraft(job){
      this.heartbeat(job,0);
      return db.transaction(()=>{
        const source=this.get(job.owner,job.source_id);
        const generation=Math.max(Date.now(),Number(String(source.revision||'').replace('g:',''))+1||0);
        db.prepare('INSERT OR IGNORE INTO knowledge_incremental_drafts VALUES(?,?,?)').run(job.owner,job.source_id,generation);
        return db.prepare('SELECT generation FROM knowledge_incremental_drafts WHERE owner=? AND source_id=?').get(job.owner,job.source_id);
      })();
    },
    incrementalRecord(job,id){return db.prepare('SELECT hash,version FROM knowledge_incremental_records WHERE owner=? AND source_id=? AND object_id=?').get(job.owner,job.source_id,id);},
    saveIncrementalRecord(job,id,hash,version){db.prepare('INSERT INTO knowledge_incremental_records VALUES(?,?,?,?,?) ON CONFLICT(owner,source_id,object_id) DO UPDATE SET hash=excluded.hash,version=excluded.version').run(job.owner,job.source_id,id,hash,version);},
    completeIncremental(job){db.prepare('DELETE FROM knowledge_incremental_drafts WHERE owner=? AND source_id=?').run(job.owner,job.source_id);},
    recordProgress(job,objectId,stage,error=null){return processing.record(job,objectId,stage,error);},
    recordPage(owner,jobId,options){return processing.page(owner,jobId,options);},
    cleanupHistory(owner,days){return processing.cleanup(owner,days);},
    list(owner) { return db.prepare('SELECT * FROM knowledge_sources WHERE owner=? ORDER BY created_at').all(owner).map(map); },
    get(owner,id) { return map(db.prepare('SELECT * FROM knowledge_sources WHERE owner=? AND id=?').get(owner,id)); },
    setEnabled(owner,id,enabled) {
      if(typeof enabled!=='boolean')throw new Error('enabled must be boolean');
      return db.transaction(()=>{
        if(!this.get(owner,id))throw Object.assign(new Error('Source not found'),{status:404});
        if(!enabled)db.prepare("UPDATE knowledge_jobs SET status='cancelled',ended_at=?,error='Source paused' WHERE owner=? AND source_id=? AND status IN ('queued','running')").run(now(),owner,id);
        db.prepare("UPDATE knowledge_sources SET enabled=?,status=?,next_sync=? WHERE owner=? AND id=?").run(+enabled,enabled?'pending':'paused',now(),owner,id);
        return this.get(owner,id);
      })();
    },
    remove(owner,id) {
      return db.transaction(()=>{
        if(!this.get(owner,id))throw Object.assign(new Error('Source not found'),{status:404});
        db.prepare("UPDATE knowledge_jobs SET status='cancelled',ended_at=?,error='Source deleted' WHERE owner=? AND source_id=? AND status IN ('queued','running')").run(now(),owner,id);
        db.prepare('INSERT OR IGNORE INTO knowledge_cleanup VALUES(?,?,?)').run(owner,id,now());
        for(const mapping of this.mappings(owner))if(mapping.from_source===id||mapping.to_source===id)this.removeMapping(owner,mapping.id);
        db.prepare("DELETE FROM knowledge_field_rules WHERE owner=? AND (json_extract(config,'$.from_source')=? OR json_extract(config,'$.to_source')=?)").run(owner,id,id);
        for(const row of db.prepare('SELECT agent_id,sources_json FROM knowledge_agent_access WHERE owner=?').all(owner)){
          db.prepare('UPDATE knowledge_agent_access SET sources_json=? WHERE owner=? AND agent_id=?').run(JSON.stringify(JSON.parse(row.sources_json).filter(source=>source!==id)),owner,row.agent_id);
        }
        db.prepare('DELETE FROM knowledge_sources WHERE owner=? AND id=?').run(owner,id);
        for(const table of ['knowledge_incremental_records','knowledge_incremental_drafts','knowledge_exclusions'])db.prepare(`DELETE FROM ${table} WHERE owner=? AND source_id=?`).run(owner,id);
        return true;
      })();
    },
    cleanupPending() {return db.prepare('SELECT * FROM knowledge_cleanup WHERE created_at<=? ORDER BY created_at LIMIT 20').all(now());},
    // Retain an ID-only tombstone and periodically sweep again. A cancelled
    // worker could finish an in-flight index write after the first purge, then
    // crash before discarding its draft. It must never leave permanent orphans.
    cleanupFinished(owner,id) {db.prepare('UPDATE knowledge_cleanup SET created_at=? WHERE owner=? AND source_id=?').run(new Date(Date.now()+300000).toISOString(),owner,id);},
    agentSources(owner,agentId) {
      const row=db.prepare('SELECT sources_json FROM knowledge_agent_access WHERE owner=? AND agent_id=?').get(owner,agentId);
      return row?JSON.parse(row.sources_json):[];
    },
    setAgentSources(owner,agentId,ids) {
      if(!Array.isArray(ids)||ids.length>200||ids.some(id=>typeof id!=='string'||!this.get(owner,id)))throw new Error('Select sources belonging to this company');
      const sources=[...new Set(ids)];
      db.prepare('INSERT INTO knowledge_agent_access(owner,agent_id,sources_json) VALUES(?,?,?) ON CONFLICT(owner,agent_id) DO UPDATE SET sources_json=excluded.sources_json').run(owner,agentId,JSON.stringify(sources));
      return sources;
    },
    save(owner,input,id=null) {
      if(!owner) throw new Error('Owner required');
      const config=validateSource(input);
      if(id) {
        const prev=this.get(owner,id);
        if(!prev) throw Object.assign(new Error('Source not found'),{status:404});
        if(prev.kind!==config.kind) throw new Error('Source type cannot change');
        if(db.prepare("SELECT id FROM knowledge_jobs WHERE owner=? AND source_id=? AND status='running'").get(owner,id)) throw new Error('Wait for the active synchronization before editing');
        for(const table of ['knowledge_incremental_records','knowledge_incremental_drafts'])db.prepare(`DELETE FROM ${table} WHERE owner=? AND source_id=?`).run(owner,id);
        db.prepare("UPDATE knowledge_sources SET config=?,enabled=?,revision=NULL,status='pending',next_sync=?,error=NULL WHERE owner=? AND id=?")
          .run(JSON.stringify(config),+config.enabled,now(),owner,id);
      } else {
        id=randomUUID();
        db.prepare('INSERT INTO knowledge_sources(id,owner,config,enabled,next_sync,created_at) VALUES(?,?,?,?,?,?)')
          .run(id,owner,JSON.stringify(config),+config.enabled,now(),now());
      }
      return this.get(owner,id);
    },
    enqueue(owner,id,trigger='manual') {
      if(!['manual','scheduled','admin','lifecycle','full_resync'].includes(trigger))throw new Error('Invalid sync trigger');
      const src=this.get(owner,id); if(!src) throw Object.assign(new Error('Source not found'),{status:404});
      if(!src.enabled) throw new Error('Enable source before synchronizing');
      const job=randomUUID();
      db.prepare("INSERT OR IGNORE INTO knowledge_jobs(id,source_id,owner,status,trigger) VALUES(?,?,?,'queued',?)").run(job,id,owner,trigger);
      return db.prepare("SELECT * FROM knowledge_jobs WHERE source_id=? AND owner=? AND status IN ('queued','running')").get(id,owner);
    },
    claim() {
      return db.transaction(()=>{
        if(this.globallyPaused())return null;
        const time=now();
        db.prepare("UPDATE knowledge_jobs SET status='failed',ended_at=?,error='Worker lease expired; safe to resynchronize' WHERE status='running' AND lease_until<?").run(time,time);
        const due=db.prepare("SELECT owner,id FROM knowledge_sources WHERE enabled=1 AND next_sync<=? LIMIT 20").all(time);
        for(const row of due) this.enqueue(row.owner,row.id,'scheduled');
        const job=db.prepare("SELECT j.* FROM knowledge_jobs j JOIN knowledge_sources s ON s.id=j.source_id AND s.owner=j.owner WHERE j.status='queued' AND s.enabled=1 LIMIT 1").get();
        if(!job) return null;
        db.prepare("UPDATE knowledge_jobs SET status='running',started_at=?,lease_until=? WHERE id=?").run(time,new Date(Date.now()+120000).toISOString(),job.id);
        db.prepare("UPDATE knowledge_sources SET status='syncing',error=NULL WHERE owner=? AND id=?").run(job.owner,job.source_id);
        return job;
      })();
    },
    heartbeat(job,count) {
      const result=db.prepare("UPDATE knowledge_jobs SET lease_until=?,records=? WHERE id=? AND owner=? AND status='running' AND lease_until>=?")
        .run(new Date(Date.now()+120000).toISOString(),count,job.id,job.owner,now());
      if(!result.changes) throw new Error('Knowledge job lease lost');
    },
    finish(job,revision,error=null,{retryAfterMs=0,metrics=null}={}) {
      db.transaction(()=>{
        const src=this.get(job.owner,job.source_id); const time=now();
        const claimed=db.prepare("SELECT id FROM knowledge_jobs WHERE id=? AND owner=? AND status='running' AND lease_until>=?").get(job.id,job.owner,time);
        if(!claimed) throw new Error('Cannot publish after lease expiry');
        if(metrics)db.prepare('UPDATE knowledge_jobs SET records=?,changed=?,reused=?,deleted=? WHERE id=? AND owner=?').run(metrics.checked,metrics.changed,metrics.reused,metrics.deleted,job.id,job.owner);
        db.prepare('UPDATE knowledge_jobs SET status=?,ended_at=?,error=? WHERE id=? AND owner=?')
          .run(error?'failed':'completed',time,error,job.id,job.owner);
        // Failed sources are excluded from connected retrieval until resynchronized.
        db.prepare('UPDATE knowledge_sources SET status=?,revision=?,last_success=?,error=?,next_sync=? WHERE owner=? AND id=?')
          .run(error?'error':'ready',error?src.revision:revision,error?src.last_success:time,error,
            processing.retry(job.owner,job.source_id,error,src.interval_seconds,retryAfterMs),job.owner,job.source_id);
        if(!error&&String(revision).startsWith('g:'))this.completeIncremental(job);
      })();
    },
    history(owner,id) { return db.prepare('SELECT * FROM knowledge_jobs WHERE owner=? AND source_id=? ORDER BY rowid DESC LIMIT 100').all(owner,id); },
    historyPage(owner,id,{after=null,limit=25}={}){
      limit=Number(limit);const cursor=after==null?Number.MAX_SAFE_INTEGER:Number(after);
      if(!Number.isSafeInteger(cursor)||cursor<1||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid history page');
      const rows=db.prepare('SELECT rowid AS cursor,* FROM knowledge_jobs WHERE owner=? AND source_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(owner,id,cursor,limit+1);
      return {jobs:rows.slice(0,limit).map(({cursor,...job})=>job),next:rows.length>limit?String(rows[limit-1].cursor):null};
    },
    mappings(owner) { return db.prepare('SELECT id,config,created_at FROM knowledge_mappings WHERE owner=?').all(owner).map(r=>({...JSON.parse(r.config),id:r.id,created_at:r.created_at})); },
    mappingsFor(owner,records){
      if(!records.length)return [];
      const clauses=[],params=[owner];
      for(const record of records.slice(0,100))for(const side of ['from','to']){
        clauses.push(`(json_extract(config,'$.${side}_source')=? AND json_extract(config,'$.${side}_object')=?)`);params.push(record.source,record.object_id);
      }
      return db.prepare(`SELECT id,config FROM knowledge_mappings WHERE owner=? AND (${clauses.join(' OR ')}) LIMIT 200`).all(...params).map(r=>({...JSON.parse(r.config),id:r.id}));
    },
    relationshipPage(owner,{kind='mappings',after='',query='',limit=25}={}){
      const table=kind==='rules'?'knowledge_field_rules':kind==='mappings'?'knowledge_mappings':null;
      if(!table)throw new Error('Invalid relationship list');
      limit=Number(limit);query=String(query).trim();
      if(!Number.isInteger(limit)||limit<1||limit>100||query.length>200||!/^[a-f0-9-]{0,36}$/.test(after))throw new Error('Invalid relationship page');
      const like=`%${query.replace(/[\\%_]/g,'\\$&')}%`;
      const rows=db.prepare(`SELECT id,config,created_at FROM ${table} WHERE owner=? AND id>? AND config LIKE ? ESCAPE '\\' ORDER BY id LIMIT ?`).all(owner,after,like,limit+1);
      return {items:rows.slice(0,limit).map(r=>({...JSON.parse(r.config),id:r.id,created_at:r.created_at})),next:rows.length>limit?rows[limit-1].id:null};
    },
    fieldRules(owner){return db.prepare('SELECT id,config FROM knowledge_field_rules WHERE owner=? LIMIT 50').all(owner).map(r=>({...JSON.parse(r.config),id:r.id}));},
    saveFieldRule(owner,input,id=null){
      const config=validateFieldRule(input);
      for(const side of ['from','to']){
        const source=this.get(owner,config[`${side}_source`]);
        if(!source?.graph_enabled||!source.collections.includes(config[`${side}_collection`]))throw new Error('Choose an owned graph-enabled source and collection');
      }
      if(id&&!db.prepare('SELECT id FROM knowledge_field_rules WHERE owner=? AND id=?').get(owner,id))throw Object.assign(new Error('Rule not found'),{status:404});
      if(!id){
        const prior=this.fieldRules(owner).find(r=>['from_source','to_source','from_collection','to_collection','from_field','to_field','relation'].every(key=>r[key]===config[key]));
        if(prior)id=prior.id;
        else if(this.fieldRules(owner).length>=50)throw new Error('Maximum 50 active/configured rules per owner; consolidate rules first');
      }
      id??=randomUUID();
      db.prepare('INSERT INTO knowledge_field_rules VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config').run(id,owner,JSON.stringify(config),now());
      return {...config,id};
    },
    removeFieldRule(owner,id){return db.prepare('DELETE FROM knowledge_field_rules WHERE owner=? AND id=?').run(owner,id).changes;},
    addMapping(owner,input) {
      const config=validateMapping(input);
      if(!this.get(owner,config.from_source)||!this.get(owner,config.to_source)) throw new Error('Both sources must belong to this owner');
      const existing=this.mappings(owner).find(r=>['from_source','from_object','to_source','to_object','relation'].every(k=>r[k]===config[k]));
      if(existing) return existing;
      const id=randomUUID(); db.prepare('INSERT INTO knowledge_mappings VALUES(?,?,?,?)').run(id,owner,JSON.stringify(config),now());
      return {...config,id};
    },
    removeMapping(owner,id) { return db.prepare('DELETE FROM knowledge_mappings WHERE owner=? AND id=?').run(owner,id).changes; },
  };
}

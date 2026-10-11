import { randomUUID } from 'node:crypto';
import { getDb } from '../db/schema.js';
import { validateSource, validateMapping } from './knowledge-contract.js';

// Persist scheduler state centrally so work survives a process restart. Every
// statement also scopes by authenticated owner, even when IDs are unguessable.
export function knowledgeStore(db = getDb()) {
  db.exec(`
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
  `);
  const now = () => new Date().toISOString();
  const map = row => row && ({ ...JSON.parse(row.config), id:row.id, owner:row.owner, enabled:!!row.enabled,
    revision:row.revision,status:row.status,last_success:row.last_success,error:row.error,next_sync:row.next_sync });
  return {
    list(owner) { return db.prepare('SELECT * FROM knowledge_sources WHERE owner=? ORDER BY created_at').all(owner).map(map); },
    get(owner,id) { return map(db.prepare('SELECT * FROM knowledge_sources WHERE owner=? AND id=?').get(owner,id)); },
    save(owner,input,id=null) {
      if(!owner) throw new Error('Owner required');
      const config=validateSource(input);
      if(id) {
        const prev=this.get(owner,id);
        if(!prev) throw Object.assign(new Error('Source not found'),{status:404});
        if(prev.kind!==config.kind) throw new Error('Source type cannot change');
        if(db.prepare("SELECT id FROM knowledge_jobs WHERE owner=? AND source_id=? AND status='running'").get(owner,id)) throw new Error('Wait for the active synchronization before editing');
        db.prepare("UPDATE knowledge_sources SET config=?,enabled=?,revision=NULL,status='pending',next_sync=?,error=NULL WHERE owner=? AND id=?")
          .run(JSON.stringify(config),+config.enabled,now(),owner,id);
      } else {
        id=randomUUID();
        db.prepare('INSERT INTO knowledge_sources(id,owner,config,enabled,next_sync,created_at) VALUES(?,?,?,?,?,?)')
          .run(id,owner,JSON.stringify(config),+config.enabled,now(),now());
      }
      return this.get(owner,id);
    },
    enqueue(owner,id) {
      const src=this.get(owner,id); if(!src) throw Object.assign(new Error('Source not found'),{status:404});
      if(!src.enabled) throw new Error('Enable source before synchronizing');
      const job=randomUUID();
      db.prepare("INSERT OR IGNORE INTO knowledge_jobs(id,source_id,owner,status) VALUES(?,?,?,'queued')").run(job,id,owner);
      return db.prepare("SELECT * FROM knowledge_jobs WHERE source_id=? AND owner=? AND status IN ('queued','running')").get(id,owner);
    },
    claim() {
      return db.transaction(()=>{
        const time=now();
        db.prepare("UPDATE knowledge_jobs SET status='failed',ended_at=?,error='Worker lease expired; safe to resynchronize' WHERE status='running' AND lease_until<?").run(time,time);
        const due=db.prepare("SELECT owner,id FROM knowledge_sources WHERE enabled=1 AND next_sync<=? LIMIT 20").all(time);
        for(const row of due) this.enqueue(row.owner,row.id);
        const job=db.prepare("SELECT j.* FROM knowledge_jobs j JOIN knowledge_sources s ON s.id=j.source_id AND s.owner=j.owner WHERE j.status='queued' AND s.enabled=1 LIMIT 1").get();
        if(!job) return null;
        db.prepare("UPDATE knowledge_jobs SET status='running',started_at=?,lease_until=? WHERE id=?").run(time,new Date(Date.now()+120000).toISOString(),job.id);
        db.prepare("UPDATE knowledge_sources SET status='syncing',error=NULL WHERE owner=? AND id=?").run(job.owner,job.source_id);
        return job;
      })();
    },
    heartbeat(job,count) {
      const result=db.prepare("UPDATE knowledge_jobs SET lease_until=?,records=? WHERE id=? AND owner=? AND status='running'")
        .run(new Date(Date.now()+120000).toISOString(),count,job.id,job.owner);
      if(!result.changes) throw new Error('Knowledge job lease lost');
    },
    finish(job,revision,error=null) {
      db.transaction(()=>{
        const src=this.get(job.owner,job.source_id); const time=now();
        const claimed=db.prepare("SELECT id FROM knowledge_jobs WHERE id=? AND owner=? AND status='running' AND lease_until>=?").get(job.id,job.owner,time);
        if(!claimed) throw new Error('Cannot publish after lease expiry');
        db.prepare('UPDATE knowledge_jobs SET status=?,ended_at=?,error=? WHERE id=? AND owner=?')
          .run(error?'failed':'completed',time,error,job.id,job.owner);
        // Failed sources are excluded from connected retrieval until resynchronized.
        db.prepare('UPDATE knowledge_sources SET status=?,revision=?,last_success=?,error=?,next_sync=? WHERE owner=? AND id=?')
          .run(error?'error':'ready',error?src.revision:revision,error?src.last_success:time,error,
            new Date(Date.now()+src.interval_seconds*1000).toISOString(),job.owner,job.source_id);
      })();
    },
    history(owner,id) { return db.prepare('SELECT * FROM knowledge_jobs WHERE owner=? AND source_id=? ORDER BY rowid DESC LIMIT 100').all(owner,id); },
    mappings(owner) { return db.prepare('SELECT id,config,created_at FROM knowledge_mappings WHERE owner=?').all(owner).map(r=>({...JSON.parse(r.config),id:r.id,created_at:r.created_at})); },
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

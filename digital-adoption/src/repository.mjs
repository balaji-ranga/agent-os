import { DatabaseSync } from 'node:sqlite';

// Independent database; never open the Flolah application database here.
export function openRepository(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS adoption_state (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key))');
  db.exec("CREATE INDEX IF NOT EXISTS adoption_embedding_scope ON adoption_state(namespace,json_extract(value,'$.embeddingId')); CREATE INDEX IF NOT EXISTS adoption_owner_scope ON adoption_state(namespace,json_extract(value,'$.organizationId'));");
  db.exec("CREATE INDEX IF NOT EXISTS adoption_work_status ON adoption_state(namespace,json_extract(value,'$.status'),json_extract(value,'$.leaseUntil')); CREATE INDEX IF NOT EXISTS adoption_work_domain ON adoption_state(namespace,json_extract(value,'$.embeddingId'),json_extract(value,'$.status'));");
  const get = db.prepare('SELECT value FROM adoption_state WHERE namespace=? AND key=?');
  const put = db.prepare('INSERT INTO adoption_state VALUES (?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value');
  const remove = db.prepare('DELETE FROM adoption_state WHERE namespace=? AND key=?');
  const all = db.prepare('SELECT value FROM adoption_state WHERE namespace=?');
  const entries = db.prepare('SELECT key,value FROM adoption_state WHERE namespace=?');
  const scopedStatements=new Map();
  let transactionDepth=0;
  const scoped=(namespace,filters,withKeys)=>{
    const names=Object.keys(filters).sort();
    if(names.some(name=>!['embeddingId','organizationId','audienceId','sessionId','origin','scope'].includes(name)||typeof filters[name]!=='string'||!filters[name]||filters[name].length>512))throw new Error('Invalid repository scope');
    if(!names.length)return withKeys?entries.all(namespace):all.all(namespace);
    const cacheKey=`${withKeys}:${names.join(',')}`;
    if(!scopedStatements.has(cacheKey))scopedStatements.set(cacheKey,db.prepare(`SELECT ${withKeys?'key,':''}value FROM adoption_state WHERE namespace=? AND ${names.map(name=>`json_extract(value,'$.${name}')=?`).join(' AND ')}`));
    return scopedStatements.get(cacheKey).all(namespace,...names.map(name=>filters[name]));
  };
  return {
    workItems(namespace,statuses,before=Number.MAX_SAFE_INTEGER,limit=1000){
      if(!['source_jobs','sources','source_cleanup'].includes(namespace)||!Array.isArray(statuses)||!statuses.length||statuses.length>4||!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('Invalid work query');
      return db.prepare(`SELECT value FROM adoption_state WHERE namespace=? AND json_extract(value,'$.status') IN (${statuses.map(()=>'?').join(',')}) AND coalesce(json_extract(value,'$.leaseUntil'),0)<=? LIMIT ?`).all(namespace,...statuses,before,limit).map(row=>JSON.parse(row.value));
    },
    nextSourceJob(now,perDomain){
      const row=db.prepare(`SELECT j.value FROM adoption_state j LEFT JOIN adoption_state f ON f.namespace='worker_fairness' AND f.key=json_extract(j.value,'$.embeddingId') WHERE j.namespace='source_jobs' AND json_extract(j.value,'$.status')='queued' AND coalesce(json_extract(j.value,'$.nextAttemptAt'),0)<=? AND (SELECT count(*) FROM adoption_state a WHERE a.namespace='source_jobs' AND json_extract(a.value,'$.embeddingId')=json_extract(j.value,'$.embeddingId') AND json_extract(a.value,'$.status') IN ('extracting','indexing'))<? ORDER BY coalesce(json_extract(f.value,'$.sequence'),0),json_extract(j.value,'$.createdAt'),j.key LIMIT 1`).get(now,perDomain);
      return row?JSON.parse(row.value):null;
    },
    workCounts(){
      return Object.fromEntries(db.prepare("SELECT json_extract(value,'$.status') status,count(*) count FROM adoption_state WHERE namespace='source_jobs' GROUP BY json_extract(value,'$.status')").all().map(row=>[row.status,row.count]));
    },
    oldestQueuedAt(){return db.prepare("SELECT min(json_extract(value,'$.createdAt')) oldest FROM adoption_state WHERE namespace='source_jobs' AND json_extract(value,'$.status')='queued'").get().oldest;},
    sourceEmbeddings(){return db.prepare("SELECT DISTINCT json_extract(value,'$.embeddingId') id FROM adoption_state WHERE namespace='sources' AND json_extract(value,'$.status')!='deleted'").all().map(row=>row.id);},
    map(namespace) {
      if (!/^[a-z_]{1,40}$/.test(namespace)) throw new Error('Invalid namespace');
      return {
        get: key => { const row = get.get(namespace, key); return row ? JSON.parse(row.value) : undefined; },
        set: (key, value) => put.run(namespace, key, JSON.stringify(value)),
        delete: key => remove.run(namespace, key),
        values: (filters={}) => scoped(namespace,filters,false).map(r => JSON.parse(r.value)),
        entries: (filters={}) => scoped(namespace,filters,true).map(r => [r.key,JSON.parse(r.value)]),
      };
    },
    transaction(fn) {
      const nested=transactionDepth>0,savepoint=`adoption_${transactionDepth}`;
      db.exec(nested?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');transactionDepth++;
      try {
        const result=fn();
        if(result&&typeof result.then==='function')throw new Error('Repository transactions must be synchronous');
        db.exec(nested?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');return result;
      }catch(error){db.exec(nested?`ROLLBACK TO SAVEPOINT ${savepoint}`:'ROLLBACK');if(nested)db.exec(`RELEASE SAVEPOINT ${savepoint}`);throw error;}
      finally{transactionDepth--;}
    },
    close: () => db.close(),
  };
}

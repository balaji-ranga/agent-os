import { DatabaseSync } from 'node:sqlite';
import {pageRequest,pagination} from './pagination.mjs';

// Independent database; never open the Flolah application database here.
export function openRepository(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS adoption_state (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key))');
  db.exec("CREATE INDEX IF NOT EXISTS adoption_state_expiry ON adoption_state(namespace,json_extract(value,'$.expiresAt')); CREATE INDEX IF NOT EXISTS adoption_embedding_scope ON adoption_state(namespace,json_extract(value,'$.embeddingId')); CREATE INDEX IF NOT EXISTS adoption_owner_scope ON adoption_state(namespace,json_extract(value,'$.organizationId'));");
  db.exec("CREATE INDEX IF NOT EXISTS adoption_content_scope ON adoption_state(namespace,json_extract(value,'$.scope')); CREATE INDEX IF NOT EXISTS adoption_website_audit ON adoption_state(namespace,json_extract(value,'$.websiteId')); CREATE INDEX IF NOT EXISTS adoption_audience_scope ON adoption_state(namespace,json_extract(value,'$.embeddingId'),json_extract(value,'$.audienceId'));");
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
    durableActions:true,
    expireConversations(now){return Number(db.prepare("DELETE FROM adoption_state WHERE namespace='conversation_history' AND json_extract(value,'$.expiresAt')<=?").run(now).changes);},
    expireGoalPlans(now){return Number(db.prepare("DELETE FROM adoption_state WHERE namespace='goal_plans' AND json_extract(value,'$.expiresAt')<=?").run(now).changes);},
    expireActionAttempts(now){return Number(db.prepare("DELETE FROM adoption_state WHERE namespace='action_attempts' AND json_extract(value,'$.expiresAt')<=?").run(now).changes);},
    expireUploadAdmission(now){return Number(db.prepare("DELETE FROM adoption_state WHERE namespace IN ('upload_windows','upload_leases') AND json_extract(value,'$.expiresAt')<=?").run(now).changes);},
    analyticsStore(){
      db.exec('CREATE TABLE IF NOT EXISTS visitor_analytics (id TEXT PRIMARY KEY, embedding_id TEXT NOT NULL, owner_id TEXT NOT NULL, at INTEGER NOT NULL, visitor TEXT NOT NULL, session TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS analytics_expiry ON visitor_analytics(expires_at); CREATE INDEX IF NOT EXISTS analytics_site_time ON visitor_analytics(embedding_id,owner_id,at); CREATE INDEX IF NOT EXISTS analytics_visitor_time ON visitor_analytics(embedding_id,owner_id,visitor,at)');
      const insert=db.prepare('INSERT OR IGNORE INTO visitor_analytics VALUES (?,?,?,?,?,?,?,?,?)');
      return {
        expireAll(now){return db.prepare('DELETE FROM visitor_analytics WHERE expires_at<=?').run(now).changes;},
        shorten(embeddingId,ownerId,retentionMs){db.prepare('UPDATE visitor_analytics SET expires_at=min(expires_at,at+?) WHERE embedding_id=? AND owner_id=?').run(retentionMs,embeddingId,ownerId);},
        insert(rows){let accepted=0;for(const r of rows)accepted+=Number(insert.run(r.id,r.embeddingId,r.ownerId,r.at,r.visitor,r.session,r.kind,JSON.stringify(r.data),r.expiresAt).changes);return accepted;},
        count(embeddingId,ownerId){return db.prepare('SELECT count(*) n FROM visitor_analytics WHERE embedding_id=? AND owner_id=?').get(embeddingId,ownerId).n;},
        total(){return db.prepare('SELECT count(*) n FROM visitor_analytics').get().n;},
        expire(embeddingId,ownerId,before){return db.prepare('DELETE FROM visitor_analytics WHERE embedding_id=? AND owner_id=? AND at<?').run(embeddingId,ownerId,before).changes;},
        rows(embeddingId,ownerId,since,limit){return db.prepare('SELECT * FROM visitor_analytics WHERE embedding_id=? AND owner_id=? AND at>=? ORDER BY at DESC,rowid DESC LIMIT ?').all(embeddingId,ownerId,since,limit).map(r=>({id:r.id,at:r.at,visitor:r.visitor,session:r.session,kind:r.kind,...JSON.parse(r.payload)}));},
      };
    },
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
        counts({groupBy,distinct,filters={},excludeStatus}={}){
          const field=name=>{if(!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name))throw new Error('Invalid count field');return `json_extract(value,'$.${name}')`;};
          const where=['namespace=?'],args=[namespace];for(const [name,value]of Object.entries(filters)){where.push(`${field(name)}=?`);args.push(value);}if(excludeStatus){where.push("coalesce(json_extract(value,'$.status'),'')!=?");args.push(excludeStatus);}
          const clause=where.join(' AND ');
          if(groupBy)return db.prepare(`SELECT ${field(groupBy)} category,count(*) total FROM adoption_state WHERE ${clause} GROUP BY ${field(groupBy)}`).all(...args);
          return db.prepare(`SELECT count(${distinct?'DISTINCT '+field(distinct):'*'}) total FROM adoption_state WHERE ${clause}`).get(...args).total;
        },
        page(options={}) {
          const request=pageRequest(options),{filters={},searchFields=[],sort='id',descending=false,audienceIds,latest=false,omit=[]}=options;
          const field=name=>{if(!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name))throw new Error('Invalid page field');return `json_extract(value,'$.${name}')`;};
          const root=latest?"json_extract(value,'$.versions[#-1]')":'value';
          const prop=name=>field(name).replace('json_extract(value,',`json_extract(${root},`);
          const where=['namespace=?'],args=[namespace];
          for(const [name,value]of Object.entries(filters)){if(typeof value!=='string'||value.length>512)throw new Error('Invalid page scope');where.push(`${field(name)}=?`);args.push(value);}
          if(audienceIds){if(!Array.isArray(audienceIds)||!audienceIds.length||audienceIds.length>100||audienceIds.some(a=>typeof a!=='string'||a.length>100))throw new Error('Invalid page audience');where.push(`EXISTS (SELECT 1 FROM json_each(adoption_state.value,'$.audienceIds') a WHERE a.value IN (${audienceIds.map(()=>'?').join(',')}))`);args.push(...audienceIds);}
          if(request.query){if(!searchFields.length||searchFields.length>6)throw new Error('Invalid page search');where.push('('+searchFields.map(name=>`instr(lower(coalesce(${prop(name)},'')),?)>0`).join(' OR ')+')');args.push(...searchFields.map(()=>request.query.toLowerCase()));}
          const clause=where.join(' AND '),total=db.prepare(`SELECT count(*) n FROM adoption_state WHERE ${clause}`).get(...args).n;
          const projection=omit.length?`json_remove(${root},${omit.map(name=>{field(name);return `'$.${name}'`;}).join(',')})`:root;
          const items=db.prepare(`SELECT key,${projection} value FROM adoption_state WHERE ${clause} ORDER BY ${prop(sort)} ${descending?'DESC':'ASC'},key ASC LIMIT ? OFFSET ?`).all(...args,request.limit,request.offset).map(row=>({...(latest?{id:row.key}:{}),...JSON.parse(row.value)}));
          return {items,pagination:pagination(total,request)};
        },
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

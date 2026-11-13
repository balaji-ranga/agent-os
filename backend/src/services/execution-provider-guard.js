// A failed provider is terminal for this check, not a pagination instruction.
// Keep the failure separate from coverage so completed sources remain usable.
const initialized=new WeakSet();
export function ensureExecutionProviderFailures(db){
 if(initialized.has(db))return;
 db.exec(`CREATE TABLE IF NOT EXISTS execution_provider_failures(owner_id TEXT,run_id TEXT,app_id TEXT,code TEXT,created_at INTEGER,PRIMARY KEY(owner_id,run_id,app_id)); CREATE INDEX IF NOT EXISTS execution_provider_failures_age ON execution_provider_failures(created_at);`);
 initialized.add(db);
}
export function executionProviderFailure(db,context,app){
 if(!context?.owner||!context?.run)return null;
 ensureExecutionProviderFailures(db);
 return db.prepare('SELECT code FROM execution_provider_failures WHERE owner_id=? AND run_id=? AND app_id=?').get(context.owner,context.run,app);
}
export function recordExecutionProviderFailure(db,context,app,error){
 if(!context?.owner||!context?.run)return;
 const status=Number(error?.status||error?.statusCode||error?.response?.status);
 // Schema/input errors are correctable. Only provider availability/authentication
 // failures open the run-scoped circuit; do not store provider response bodies.
 if(!([401,403,408,429].includes(status)||status>=500||['FLOASSIST_SOURCE_READ_FAILED','provider_error','authorization_failed','ETIMEDOUT','ECONNRESET','ECONNREFUSED','AbortError','TimeoutError'].includes(error?.code||error?.name)))return;
 ensureExecutionProviderFailures(db);
 db.prepare('INSERT OR IGNORE INTO execution_provider_failures VALUES (?,?,?,?,?)').run(context.owner,context.run,app,String(error?.code||error?.name||'provider_error').slice(0,100),Date.now());
 db.prepare('DELETE FROM execution_provider_failures WHERE created_at<?').run(Date.now()-7*86400000);
}

const providerAttempts=new WeakMap();
export async function withExecutionProviderAttempt(db,context,app,execute){
 if(!context?.owner||!context?.run)return execute();
 let pending=providerAttempts.get(db);if(!pending){pending=new Map();providerAttempts.set(db,pending);}
 const key=JSON.stringify([context.owner,context.run,app]);
 const previous=pending.get(key)||Promise.resolve();
 const work=previous.catch(()=>{}).then(async()=>{
  if(executionProviderFailure(db,context,app))throw Object.assign(new Error('This provider failed earlier in this check. Continue other sources and report partial coverage; do not retry it in this run.'),{code:'EXECUTION_PROVIDER_UNAVAILABLE',status:503});
  try{return await execute();}catch(error){recordExecutionProviderFailure(db,context,app,error);throw error;}
 });
 pending.set(key,work);
 try{return await work;}finally{if(pending.get(key)===work)pending.delete(key);}
}

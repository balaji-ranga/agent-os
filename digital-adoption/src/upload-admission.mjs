import {createHmac,randomBytes,randomUUID} from 'node:crypto';
export const uploadDefaults=Object.freeze({cooldownMs:5000,windowMs:60000,retentionWindowMs:86400000,sessionRequests:5,websiteRequests:30,ownerRequests:60,networkRequests:60,globalRequests:120,sessionFiles:20,websiteFiles:100,ownerFiles:200,globalFiles:1000,sessionBytes:67108864,websiteBytes:268435456,ownerBytes:536870912,globalBytes:1073741824,concurrentUploads:2,readTimeoutMs:15000,maxQueuedFiles:50,maxBuckets:10000});
const denied=(code,until,now)=>{throw Object.assign(new Error(code),{publicCode:code,retryAfter:Math.max(1,Math.ceil((until-now)/1000))});};
// Production shares these counters/leases in SQLite. No field values, filenames,
// raw network addresses or document contents enter the admission ledger.
export function createUploadAdmission({repository,clock=Date.now,limits={}}={}){
 if(!limits||Array.isArray(limits)||Object.keys(limits).some(k=>!Object.hasOwn(uploadDefaults,k)))throw new Error('Invalid upload admission limits');
 const config={...uploadDefaults,...limits};
 for(const [key,value]of Object.entries(config))if(!Number.isSafeInteger(value)||value<(key==='cooldownMs'?0:1)||value>uploadDefaults[key]*16)throw new Error('Invalid upload admission limit');
 if(config.readTimeoutMs>60000||config.retentionWindowMs<86400000)throw new Error('Upload retention budget must cover at least 24 hours; body reads must be bounded');
 const windows=repository?.map('upload_windows')||new Map(),leases=repository?.map('upload_leases')||new Map(),keys=repository?.map('upload_keys')||new Map(),atomic=fn=>repository?repository.transaction(fn):fn(),issued=new WeakSet(),heartbeats=new WeakMap();
 const secret=atomic(()=>{let row=keys.get('network');if(!row){row={value:randomBytes(32).toString('base64url')};keys.set('network',row);}return row.value;});
 const digest=text=>createHmac('sha256',secret).update(text).digest('hex'),values=map=>[...map.values()],entries=map=>[...map.entries()];
 const maintain=()=>{if(repository)return repository.expireUploadAdmission(clock());for(const map of [windows,leases])for(const [key,value]of entries(map))if(value.expiresAt<=clock())map.delete(key);};
 const identity=scope=>{if(typeof scope?.embeddingId!=='string'||!scope.embeddingId||typeof scope.sessionId!=='string'||!scope.sessionId)throw new Error('Upload identity required');return scope.embeddingId+':'+scope.sessionId;};
 const checks=(definitions,now)=>definitions.map(([key,ms,maxCount,maxBytes,bytes=0])=>{const previous=windows.get(key),row=previous?.expiresAt>now?previous:{count:0,bytes:0,expiresAt:now+ms};if(row.count+1>maxCount||row.bytes+bytes>maxBytes)denied(bytes?'UPLOAD_BUDGET_EXCEEDED':'UPLOAD_RATE_LIMIT',row.expiresAt,now);return [key,{...row,count:row.count+1,bytes:row.bytes+bytes}];});
 const write=rows=>{for(const [key,value]of rows)windows.set(key,value);};
 const validate=(permit,scope)=>{if(!issued.has(permit)||permit.identity!==identity(scope)||permit.expiresAt<=clock()||!leases.get(permit.id))throw new Error('Upload admission expired');};
 return {
  limits:config,maintain,
  admit(scope,{ownerId=scope.embeddingId,network}={}){return atomic(()=>{
   const now=clock(),who=identity(scope);maintain();
   const cooldown=windows.get('cooldown:'+digest(who));if(cooldown?.expiresAt>now)denied('UPLOAD_COOLDOWN',cooldown.expiresAt,now);
   if(values(leases).length>=config.concurrentUploads)denied('UPLOAD_BUSY',now+2000,now);
   if((repository?windows.counts({}):windows.size)>=config.maxBuckets-12)denied('UPLOAD_BUSY',now+config.windowMs,now);
   const counters=[['session:'+digest(who),config.sessionRequests],['website:'+digest(scope.embeddingId),config.websiteRequests],['owner:'+digest(ownerId),config.ownerRequests],['global',config.globalRequests],...(network?[['network:'+digest(network),config.networkRequests]]:[])];
   const rows=checks(counters.map(([key,count])=>['rate:'+key,config.windowMs,count,Number.MAX_SAFE_INTEGER]),now);
   const permit={id:randomUUID(),identity:who,expiresAt:now+config.readTimeoutMs+10000};write(rows);if(config.cooldownMs)windows.set('cooldown:'+digest(who),{expiresAt:now+config.cooldownMs});leases.set(permit.id,{expiresAt:permit.expiresAt});issued.add(permit);
   // Keep an active disk write charged until its caller releases it. A crashed
   // process stops renewing, allowing another coordinator to reclaim the slot.
   const heartbeat=setInterval(()=>{try{atomic(()=>{validate(permit,scope);permit.expiresAt=clock()+config.readTimeoutMs+10000;leases.set(permit.id,{expiresAt:permit.expiresAt});});}catch{clearInterval(heartbeat);}},5000);heartbeat.unref?.();heartbeats.set(permit,heartbeat);return permit;
  });},
  validate,
  charge(scope,{ownerId=scope.embeddingId,taskId,operationId,bytes},permit){return atomic(()=>{
   validate(permit,scope);if(!Number.isSafeInteger(bytes)||bytes<1||typeof taskId!=='string'||typeof operationId!=='string')throw new Error('Invalid upload charge');
   const now=clock(),operation='operation:'+digest(identity(scope)+':'+taskId+':'+operationId);if(windows.get(operation)?.expiresAt>now)throw Object.assign(new Error('Upload operation already consumed'),{publicCode:'OPERATION_CONFLICT'});
   const counters=[['session:'+digest(identity(scope)),config.sessionFiles,config.sessionBytes],['website:'+digest(scope.embeddingId),config.websiteFiles,config.websiteBytes],['owner:'+digest(ownerId),config.ownerFiles,config.ownerBytes],['global',config.globalFiles,config.globalBytes]];
   const rows=checks(counters.map(([key,count,limit])=>['retained:'+key,config.retentionWindowMs,count,limit,bytes]),now);write(rows);windows.set(operation,{expiresAt:now+config.retentionWindowMs});
  });},
  release(permit){if(permit&&issued.has(permit)){clearInterval(heartbeats.get(permit));heartbeats.delete(permit);issued.delete(permit);leases.delete(permit.id);}},
  publicLimits(){return {cooldownMs:config.cooldownMs,sessionRequests:config.sessionRequests,windowMs:config.windowMs,sessionFiles:config.sessionFiles,sessionBytes:config.sessionBytes,retentionWindowMs:config.retentionWindowMs};},
 };
}

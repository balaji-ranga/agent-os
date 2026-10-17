import {createHash} from 'node:crypto';
const hash=value=>typeof value==='string'&&value.length<=100?'sha256:'+createHash('sha256').update(value).digest('hex').slice(0,24):undefined;
const routes=new Set('sessions history capabilities messages ask plan approve renew terminate save/plan history/clear knowledge/search knowledge/documents knowledge/upload knowledge/upload-status learning/observe learning/draft learning/complete coaching/exchange recipes recipe/plan discovery/start discovery/next discovery/status discovery/list discovery/observe discovery/block discovery/pause discovery/resume discovery/stop discovery/extend'.split(' '));
const management=new Set('websites register verify approve suspend configure activate tokens audit rotate revoke-token revoke-session website-state transfer-owner source-file source-url source-text sources source-job source-raw source-refresh source-retry source-delete source-map source-map-refresh source-map-teach coaching-code host-identity-configure host-identity-status host-identity-revoke learning-settings learning-status learning-list learning-maps learning-graph learning-describe learning-create learning-validate learning-publish learning-repair learning-disable learning-versions learning-rollback learning-export learning-import email-status email-start email-confirm email-snippet'.split(' '));
for(const route of 'live/ticket tasks/start tasks/status tasks/end tasks/upload tasks/remove tasks/plan tasks/summary tasks/approve tasks/save-review tasks/relay tasks/command-plan tasks/effect pair/invite pair/join pair/status pair/confirm pair/revoke pair/link'.split(' '))routes.add(route);

// Emit a fixed schema only. Never accept bodies, error messages, URLs, headers,
// tokens, DOM, source content or chat. The operator owns its log/alert sink.
export function createOperationalTelemetry({emit=event=>process.stdout.write(JSON.stringify(event)+'\n'),clock=Date.now}={}){
 const write=event=>{try{emit({service:'digital-adoption',schema:1,at:new Date(clock()).toISOString(),...event});}catch{/* A log sink cannot change an approval or retry a business effect. */}};
 return {
  operation(path){const route=String(path).replace(/^\/v1\//,'');if(routes.has(route))return route;const managed=/^(?:owner\/)?manage\/(.+)$/.exec(route);if(managed&&management.has(managed[1]))return 'manage/'+managed[1];if(['owner/start','owner/confirm','owner/logout'].includes(route))return route;return 'unknown';},
  request({requestId,operation,status,durationMs,embeddingId,sessionId,entityId,state}){
   if(!/^[a-f0-9-]{36}$/.test(requestId)||!Number.isInteger(status)||status<100||status>599)return;
   const name=typeof operation==='string'?operation:'unknown';
   const safeOperation=name==='unknown'||routes.has(name)||name.startsWith('manage/')&&management.has(name.slice(7))||['owner/start','owner/confirm','owner/logout'].includes(name)?name:'unknown';
   const revoked=status<400&&['manage/revoke-session','manage/revoke-token','manage/suspend','manage/website-state'].includes(safeOperation);
   write({event:'request',requestId,operation:safeOperation,status,severity:status>=500?'error':status>=400?'warn':'info',code:status>=500?'DEPENDENCY_FAILURE':status===429?'RATE_LIMITED':status>=400?'REQUEST_DENIED':revoked?'ACCESS_POLICY_CHANGED':'REQUEST_COMPLETED',durationMs:Math.max(0,Math.round(Number(durationMs)||0)),embedding:hash(embeddingId),session:hash(sessionId),entity:hash(entityId),...(['queued','processing','indexing','ready','failed','deleted'].includes(state)?{state}:{})});
  },
  job({embeddingId,jobId,state,attempts}){if(!['processing','queued','ready','failed'].includes(state))return;write({event:state==='failed'?'alert':'ingestion',severity:state==='failed'?'error':state==='queued'?'warn':'info',code:state==='failed'?'INGESTION_FAILED':state==='ready'?'INGESTION_READY':state==='queued'?'INGESTION_RETRY_SCHEDULED':'INGESTION_STARTED',embedding:hash(embeddingId),entity:hash(jobId),state,attempts:Number.isSafeInteger(attempts)?attempts:0});},
 };
}

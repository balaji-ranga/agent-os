import {randomUUID} from 'node:crypto';

const deny=()=>{throw Object.assign(new Error('Action already used, expired or outside this session. Inspect the host before preparing a new action.'),{publicCode:'ACTION_ATTEMPT_DENIED'});};
// Only opaque authorization metadata belongs here, never field values or hashes.
export function createActionAttempts(repository,{clock=Date.now,retentionMs=86_400_000}={}){
 if(!Number.isSafeInteger(retentionMs)||retentionMs<600_000||retentionMs>604_800_000)throw new Error('Invalid action retention');
 const records=repository.map('action_attempts');
 const owned=(scope,id)=>{const r=records.get(id);if(!r||r.embeddingId!==scope.embeddingId||r.sessionId!==scope.sessionId||r.conversationVersion!==(scope.conversationVersion||0)||r.expiresAt<=clock())deny();return r;};
 return {
  reserve(scope,{id,proposalId,index,grantExpiresAt,path}){return repository.transaction(()=>{if(!scope.sessionId||!scope.embeddingId||!Number.isSafeInteger(grantExpiresAt)||grantExpiresAt<=clock())deny();if(records.get(id))deny();const row={id,embeddingId:scope.embeddingId,sessionId:scope.sessionId,conversationVersion:scope.conversationVersion||0,proposalId,index,path,state:'reserved',fence:randomUUID(),grantExpiresAt,createdAt:clock(),expiresAt:clock()+retentionMs};records.set(id,row);return {actionId:id,fence:row.fence,grantExpiresAt};});},
  dispatch(scope,{actionId,fence}){return repository.transaction(()=>{const row=owned(scope,actionId);if(row.state!=='reserved'||row.fence!==fence||row.grantExpiresAt<=clock())deny();row.state='dispatch_started';row.dispatchedAt=clock();records.set(actionId,row);return {allowed:true,actionId};});},
  // Browser observations cannot promote a row to business-verified.
  observe(scope,{actionId,fence,outcome}){return repository.transaction(()=>{const row=owned(scope,actionId);if(row.fence!==fence||row.state!=='dispatch_started'||!['local_state_verified','host_reported_saved','rejected','unknown'].includes(outcome))deny();row.state=outcome==='rejected'?'observed_rejected':outcome==='unknown'?'unknown':'effect_observed';row.outcome=outcome;records.set(actionId,row);return {recorded:true};});},
  verify(scope,{actionId,fence}){return repository.transaction(()=>{const row=owned(scope,actionId);if(row.fence!==fence||!['dispatch_started','effect_observed'].includes(row.state))deny();row.state='verified';row.outcome='business_verified';records.set(actionId,row);return {verified:true,outcome:'business_verified'};});},
  status(scope,id){return structuredClone(owned(scope,id));},
  expire(){return repository.transaction(()=>{if(repository.expireActionAttempts)return repository.expireActionAttempts(clock());let n=0;for(const [id,row]of records.entries())if(row.expiresAt<=clock()){records.delete(id);n++;}return n;});},
 };
}

import {arrayPage} from './pagination.mjs';
import {createRequestBudget} from './request-budget.mjs';
export function createManagement({authenticate,control,knowledge,search,platformOrigin,registrationEmail,ingestion,learning,coaching,sourceMap,hostIdentity,privateTasks,analytics,capacity={}}){
 const budget=createRequestBudget(),actorLimit=capacity.managementPerActor??60;if(!Number.isInteger(actorLimit)||actorLimit<1||actorLimit>600)throw new Error('Invalid management request capacity');
 return async({authorization,origin,path,input})=>{
  if(origin!==platformOrigin)throw new Error('Management origin denied');
  const actor=await authenticate(authorization);
  budget.take(`actor:${actor.organizationId}:${actor.id}`,actorLimit);
  if(path.startsWith('/v1/manage/email-')){
   if(!registrationEmail)throw new Error('Email not configured');
   if(path.endsWith('/email-status'))return registrationEmail.status(actor,input.id);
   if(path.endsWith('/email-start'))return registrationEmail.start(actor,input.id,input.email);
   if(path.endsWith('/email-confirm'))return registrationEmail.confirm(actor,input.id,input.code);
   if(path.endsWith('/email-snippet'))return registrationEmail.deliver(actor,input.id);
   throw new Error('Unsupported email operation');
  }
  if(path==='/v1/manage/websites')return {actor:{role:actor.role},websites:control.list(actor,{id:input.id})};
  if(path==='/v1/manage/website-page')return control.page(actor,input);
  if(path==='/v1/manage/audit-page')return control.auditPage(actor,input.id,input);
  if(path==='/v1/manage/token-page'){const out=arrayPage(control.tokens(actor,input.id),input,t=>t.maskedId+' '+t.status);return {tokens:out.items,pagination:out.pagination};}
  if(path==='/v1/manage/admin-websites')return control.inventory(actor,input);
  if(path==='/v1/manage/transfer-owner')return control.transfer(actor,input.id,input);
  if(path==='/v1/manage/register')return control.register(actor,{origin:input.origin,environment:input.environment,operationId:input.operationId});
  if(path==='/v1/manage/renew-challenge')return control.renewChallenge(actor,input.id,input);
  if(path==='/v1/manage/onboarding'){const state=control.readiness(actor,input.id);return {...state,knowledgeScope:'public',...(state.verified&&state.status==='approved'&&learning?{learning:learning.readiness(control.scope(actor,input.id))}:{}),diagnostics:['If the panel is missing: check the approved origin, snippet URL, token expiry, CSP script-src/connect-src/frame-src and blocked frames. Issuing a snippet alone does not prove installation.']};}
  if(path==='/v1/manage/verify'){const result=await control.verify(actor,input.id);if(result.verified&&search){await search.provision(input.id);await search.privateTasks?.provision(input.id);}return result;}
  if(path==='/v1/manage/approve')return control.transition(actor,input.id,'approved',input.reason);
  if(path==='/v1/manage/suspend')return control.transition(actor,input.id,'suspended',input.reason);
  if(path==='/v1/manage/tokens')return {tokens:control.tokens(actor,input.id)};
  if(path==='/v1/manage/audit')return {events:control.audit(actor,input.id)};
  if(path==='/v1/manage/website-state')return control.transition(actor,input.id,input.status,input.reason);
  if(path==='/v1/manage/configure')return control.configure(actor,input.id,input);
  let scope=control.scope(actor,input.id); // IDs select an already authorized resource, never an identity.
  if(path==='/v1/manage/analytics-report'){if(!analytics)throw new Error('Analytics unavailable');return analytics.report(scope,input);}
  if(path==='/v1/manage/analytics-configure'){if(!analytics)throw new Error('Analytics unavailable');const result=analytics.configure(scope,input);control.recordAnalytics(actor,input.id);return result;}
  if(path.startsWith('/v1/manage/pairing-')){
   if(!privateTasks)throw new Error('Pairing management unavailable');
   if(path.endsWith('/pairing-list'))return privateTasks.managedPairings(scope,input);
   if(!['/v1/manage/pairing-revoke','/v1/manage/pairing-policy'].includes(path)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)throw new Error('Choose a pairing action and enter a reason');
   control.recordPairing(actor,input.id,{action:path.endsWith('/pairing-revoke')?'revoke_pairing':'update_pairing_expiry',groupId:input.groupId,reason:input.reason,status:'requested'});
   const result=path.endsWith('/pairing-revoke')?privateTasks.revokeManagedPairing(scope,input):privateTasks.updateManagedPairing(scope,input);
   control.recordPairing(actor,input.id,{action:path.endsWith('/pairing-revoke')?'revoke_pairing':'update_pairing_expiry',groupId:input.groupId,reason:input.reason,status:result.status||'revoked'});return result;
  }
  if(path==='/v1/manage/host-identity-configure'){if(!hostIdentity)throw new Error('Host identity unavailable');return hostIdentity.configure(scope,input.policy);}
  if(path==='/v1/manage/host-identity-status'){if(!hostIdentity)throw new Error('Host identity unavailable');return hostIdentity.status(scope);}
  if(path==='/v1/manage/host-identity-revoke'){if(!hostIdentity)throw new Error('Host identity unavailable');return hostIdentity.revoke(scope,input);}
  if(input.hostScope){if(!hostIdentity)throw new Error('Host identity unavailable');const audienceId=hostIdentity.audience(scope,input.hostScope);scope={...scope,audienceId,audienceIds:[audienceId]};}
  if(path==='/v1/manage/source-map-refresh'){if(!sourceMap)throw new Error('Source map unavailable');return sourceMap.refresh(scope,input.manifest);}
  if(path==='/v1/manage/source-map'){if(!sourceMap)throw new Error('Source map unavailable');return sourceMap.summary(scope);}
  if(path==='/v1/manage/source-map-page'){if(!sourceMap)throw new Error('Source map unavailable');return sourceMap.page(scope,input);}
  if(path==='/v1/manage/source-map-screen'){if(!sourceMap)throw new Error('Source map unavailable');return sourceMap.screen(scope,{path:input.path});}
  if(path==='/v1/manage/source-map-export'){if(!sourceMap)throw new Error('Source map unavailable');return sourceMap.export(scope,{path:input.path});}
  if(path==='/v1/manage/source-map-context'){if(!sourceMap)throw new Error('Source map unavailable');return sourceMap.describe(scope,{path:input.path,revision:input.revision,target:input.target,description:input.description,reviewed:input.reviewed});}
  if(path==='/v1/manage/source-map-teach'){if(!sourceMap||!learning)throw new Error('Teaching unavailable');return learning.create(scope,sourceMap.recipeDraft(scope,input));}
  if(path==='/v1/manage/coaching-code'){if(!coaching)throw new Error('Coaching unavailable');return coaching.issue(scope);}
  if(path.startsWith('/v1/manage/learning-')){
   if(!learning)throw new Error('Learning unavailable');
   const request={...input,id:input.recipeId};
   if(path==='/v1/manage/learning-page')return learning.page(scope,input);
   if(path==='/v1/manage/learning-map-page')return learning.mapPage(scope,input);
   if(path==='/v1/manage/learning-version-page'){const out=arrayPage(learning.versions(scope,request).slice().reverse(),input,v=>String(v.version)+' '+v.status);return {versions:out.items,pagination:out.pagination};}
   const operations={settings:()=>learning.settings(scope,input),status:()=>({enabled:learning.learningEnabled(scope)}),list:()=>({recipes:learning.list(scope)}),maps:()=>({screens:learning.maps(scope)}),graph:()=>learning.graph(scope),describe:()=>learning.describe(scope,request),create:()=>learning.create(scope,input),validate:()=>learning.validate(scope,request),publish:()=>learning.publish(scope,request),repair:()=>learning.repair(scope,request),disable:()=>learning.disable(scope,request),versions:()=>({versions:learning.versions(scope,request)}),rollback:()=>learning.rollback(scope,request),export:()=>learning.export(scope,request),import:()=>learning.import(scope,input)};
   const action=path.slice('/v1/manage/learning-'.length);if(!Object.hasOwn(operations,action))throw new Error('Unsupported learning operation');return operations[action]();
  }
  if(path==='/v1/manage/activate'){await search.provision(scope.embeddingId);await search.privateTasks?.provision(scope.embeddingId);return control.activate(actor,input.id,{lifetimeDays:input.lifetimeDays});}
  if(path==='/v1/manage/sources')return {sources:knowledge.list(scope)};
  if(path==='/v1/manage/source-page')return knowledge.page(scope,input);
  if(path==='/v1/manage/source-file'){if(!ingestion)throw new Error('File ingestion unavailable');return ingestion.upload(scope,input,{checkAuthorized:()=>{const current=control.scope(actor,input.id);if(input.hostScope&&hostIdentity.audience(current,input.hostScope)!==scope.audienceId)throw new Error('Content audience changed');}});}
  if(path==='/v1/manage/source-url'){if(!ingestion)throw new Error('URL ingestion unavailable');return ingestion.addUrl(scope,input);}
  if(path==='/v1/manage/source-refresh'){if(!ingestion)throw new Error('URL ingestion unavailable');return ingestion.refresh(scope,input.sourceId);}
  if(path==='/v1/manage/source-job'){if(!ingestion)throw new Error('File ingestion unavailable');return ingestion.status(scope,input.sourceId);}
  if(path==='/v1/manage/source-raw'){if(!ingestion)throw new Error('File ingestion unavailable');return ingestion.raw(scope,input.sourceId);}
  if(path==='/v1/manage/source-text'){
   if(input.sharedConsent!==true)throw new Error('Embedding-wide sharing consent required');
   const source=knowledge.createText(scope,{title:input.title,text:input.text});
   await knowledge.ingest(scope,source.id);return {id:source.id,status:'ready'};
  }
  if(path==='/v1/manage/source-retry'){const source=knowledge.inspect(scope,input.sourceId);return source.kind?ingestion.retry(scope,input.sourceId):knowledge.ingest(scope,input.sourceId);}
  if(path==='/v1/manage/source-delete')return ingestion?ingestion.remove(scope,input.sourceId):knowledge.remove(scope,input.sourceId);
  if(path==='/v1/manage/rotate')return control.rotate(actor,input.id,input.installationId,{overlapMs:input.overlapMs,reason:input.reason});
  if(path==='/v1/manage/revoke-token')return control.revokeToken(actor,input.id,input.installationId,input.reason);
  if(path==='/v1/manage/revoke-session')return control.revokeSession(actor,input.id,input.sessionId,input.reason);
  throw new Error('Unsupported management action');
 };
}

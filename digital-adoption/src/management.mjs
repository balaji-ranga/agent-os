export function createManagement({authenticate,control,knowledge,search,platformOrigin,registrationEmail,ingestion,learning,coaching,sourceMap,hostIdentity}){
 return async({authorization,origin,path,input})=>{
  if(origin!==platformOrigin)throw new Error('Management origin denied');
  const actor=await authenticate(authorization);
  if(path.startsWith('/v1/manage/email-')){
   if(!registrationEmail)throw new Error('Email not configured');
   if(path.endsWith('/email-status'))return registrationEmail.status(actor,input.id);
   if(path.endsWith('/email-start'))return registrationEmail.start(actor,input.id,input.email);
   if(path.endsWith('/email-confirm'))return registrationEmail.confirm(actor,input.id,input.code);
   if(path.endsWith('/email-snippet'))return registrationEmail.deliver(actor,input.id);
   throw new Error('Unsupported email operation');
  }
  if(path==='/v1/manage/websites')return {actor:{role:actor.role},websites:control.list(actor)};
  if(path==='/v1/manage/transfer-owner')return control.transfer(actor,input.id,input);
  if(path==='/v1/manage/register')return control.register(actor,{origin:input.origin,environment:input.environment,operationId:input.operationId});
  if(path==='/v1/manage/verify')return control.verify(actor,input.id);
  if(path==='/v1/manage/approve')return control.transition(actor,input.id,'approved',input.reason);
  if(path==='/v1/manage/suspend')return control.transition(actor,input.id,'suspended',input.reason);
  if(path==='/v1/manage/tokens')return {tokens:control.tokens(actor,input.id)};
  if(path==='/v1/manage/audit')return {events:control.audit(actor,input.id)};
  if(path==='/v1/manage/website-state')return control.transition(actor,input.id,input.status,input.reason);
  if(path==='/v1/manage/configure')return control.configure(actor,input.id,input);
  let scope=control.scope(actor,input.id); // IDs select an already authorized resource, never an identity.
  if(path==='/v1/manage/host-identity-configure'){if(!hostIdentity)throw new Error('Host identity unavailable');return hostIdentity.configure(scope,input.policy);}
  if(path==='/v1/manage/host-identity-status'){if(!hostIdentity)throw new Error('Host identity unavailable');return hostIdentity.status(scope);}
  if(path==='/v1/manage/host-identity-revoke'){if(!hostIdentity)throw new Error('Host identity unavailable');return hostIdentity.revoke(scope,input);}
  if(input.hostScope){if(!hostIdentity)throw new Error('Host identity unavailable');const audienceId=hostIdentity.audience(scope,input.hostScope);scope={...scope,audienceId,audienceIds:[audienceId]};}
  if(path==='/v1/manage/source-map-refresh'){if(!sourceMap)throw new Error('Source map unavailable');return sourceMap.refresh(scope,input.manifest);}
  if(path==='/v1/manage/source-map'){if(!sourceMap)throw new Error('Source map unavailable');return sourceMap.summary(scope);}
  if(path==='/v1/manage/source-map-teach'){if(!sourceMap||!learning)throw new Error('Teaching unavailable');return learning.create(scope,sourceMap.recipeDraft(scope,input));}
  if(path==='/v1/manage/coaching-code'){if(!coaching)throw new Error('Coaching unavailable');return coaching.issue(scope);}
  if(path.startsWith('/v1/manage/learning-')){
   if(!learning)throw new Error('Learning unavailable');
   const request={...input,id:input.recipeId};
   const operations={settings:()=>learning.settings(scope,input),status:()=>({enabled:learning.learningEnabled(scope)}),list:()=>({recipes:learning.list(scope)}),maps:()=>({screens:learning.maps(scope)}),create:()=>learning.create(scope,input),validate:()=>learning.validate(scope,request),publish:()=>learning.publish(scope,request),repair:()=>learning.repair(scope,request),disable:()=>learning.disable(scope,request),versions:()=>({versions:learning.versions(scope,request)}),rollback:()=>learning.rollback(scope,request),export:()=>learning.export(scope,request),import:()=>learning.import(scope,input)};
   const action=path.slice('/v1/manage/learning-'.length);if(!Object.hasOwn(operations,action))throw new Error('Unsupported learning operation');return operations[action]();
  }
  if(path==='/v1/manage/activate'){await search.provision(scope.embeddingId);return control.activate(actor,input.id);}
  if(path==='/v1/manage/sources')return {sources:knowledge.list(scope)};
  if(path==='/v1/manage/source-file'){if(!ingestion)throw new Error('File ingestion unavailable');return ingestion.upload(scope,input);}
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

export function createManagement({authenticate,control,knowledge,search,platformOrigin,registrationEmail,ingestion}){
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
  const scope=control.scope(actor,input.id); // IDs select an already authorized resource, never an identity.
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

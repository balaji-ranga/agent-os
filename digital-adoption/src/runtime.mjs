import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {SessionAuthority} from './session-authority.mjs';
import {openRepository} from './repository.mjs';
import {createOpenSearch} from './opensearch.mjs';
import {createKnowledgeService} from './knowledge-service.mjs';
import {createKnowledgeAnswer} from './knowledge-answer.mjs';
import {createPlatformPlanner} from './platform-model.mjs';
import {createProposalStore} from './proposals.mjs';
import {createAdoptionServer} from './server.mjs';
import {createControlPlane} from './control-plane.mjs';
import {createManagement} from './management.mjs';
import {createManagementIdentity} from './management-identity.mjs';
import {createRegistrationEmail} from './registration-email.mjs';
import {createMailer} from './mailer.mjs';
import {createOwnerIdentity} from './owner-identity.mjs';
import {createBlobStore} from './blob-store.mjs';
import {createDocumentExtractor} from './document-extractor.mjs';
import {createSourceIngestion} from './source-ingestion.mjs';
import {createPublicUrlFetcher} from './public-url.mjs';
const config=JSON.parse(readFileSync('/config/service.json','utf8'));
const repository=openRepository('/data/adoption.sqlite');
const authority=new SessionAuthority({repository,development:true}); // Only explicit loopback demo origins below are registered.
const search=createOpenSearch({...config.search,privateNetwork:true});
const knowledge=createKnowledgeService(repository,search);
const ingestion=createSourceIngestion(repository,{knowledge,blobs:createBlobStore('/data/objects'),extract:createDocumentExtractor({python:'/opt/adoption-python/bin/python'}),fetchUrl:createPublicUrlFetcher()});
knowledge.recoverExpired();
const recoveryTimer=setInterval(()=>knowledge.recoverExpired(),30_000);
recoveryTimer.unref();
const embeddings=['adoption-demo-alpha','adoption-demo-beta'];
for(const embeddingId of embeddings)await search.provision(embeddingId);
const publicPath='/data/demo-public.json';
let demo;
if(existsSync(publicPath))demo=JSON.parse(readFileSync(publicPath,'utf8'));
else {
 demo={serviceUrl:config.serviceUrl,embeddings:[]};
 for(const embeddingId of embeddings){
  const registration=authority.registerApproved({embeddingId,origins:['http://127.0.0.1:4194','http://localhost:4194',new URL(config.serviceUrl).origin],expiresAt:Date.now()+7*24*3_600_000});
  demo.embeddings.push({embeddingId,...registration});
 }
 writeFileSync(publicPath,JSON.stringify(demo),{mode:0o600});
}
for(const [i,embeddingId] of embeddings.entries()){
 authority.setUploadPolicy(embeddingId,true); // Authorized synthetic acceptance embeddings only.
 const scope={embeddingId,audienceIds:['public'],role:'maintainer'};
 const title=i===0?'Alpha demonstration handbook':'Beta isolation handbook';
 const existing=knowledge.list(scope).find(s=>s.title===title&&s.status!=='deleted');
 const source=existing||knowledge.createText(scope,{title,text:i===0?
  'Alpha customer onboarding: company name, contact email and region are required. The Alpha delivery promise is seven working days. Alpha verification code is ALPHA_ORCHID_7391. Review entered details before saving. Amount is in the selected currency.':
  'Beta private test knowledge: the Beta verification code is BETA_COPPER_2846. Beta delivery promise is eleven working days. This must never be returned in the Alpha embedding.'});
 if(source.status==='pending'||source.status==='failed')await knowledge.ingest(scope,source.id);
}
const model={gatewayUrl:config.gatewayUrl,serviceToken:config.serviceToken};
const platformOrigin=new URL(config.serviceUrl).origin;
const control=createControlPlane(repository,authority);
const registrationEmail=createRegistrationEmail(repository,{send:createMailer(config.mail),control,search,serviceUrl:config.serviceUrl});
const management=createManagement({authenticate:createManagementIdentity({platformOrigin}),control,knowledge,search,platformOrigin,registrationEmail,ingestion});
const ownerIdentity=createOwnerIdentity(repository,{send:createMailer(config.mail)});
const ownerManagement=createManagement({authenticate:cookie=>ownerIdentity.authenticate(cookie),control,knowledge,search,platformOrigin,registrationEmail,ingestion});
ingestion.start();
const server=createAdoptionServer({authority,knowledge,ingestion,management,ownerIdentity,ownerManagement,platformOrigin,answer:createKnowledgeAnswer(model),planner:createPlatformPlanner(model),proposals:createProposalStore(repository)});
server.listen(4193,'0.0.0.0',()=>console.log('Independent adoption service listening; full acceptance not yet certified'));
process.on('SIGTERM',()=>{ingestion.stop();clearInterval(recoveryTimer);server.closeAllConnections();server.close(()=>{process.exit(0);});});

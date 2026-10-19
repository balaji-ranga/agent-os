import {MODEL_CLIENT_TIMEOUT_MS} from '../web/model-timeouts.mjs';
import {createActionAttempts} from './action-attempts.mjs';
import {createVisitorAnalytics} from './visitor-analytics.mjs';
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
import {createLearningStore} from './learning-store.mjs';
import {createLearningRuntime} from './learning-runtime.mjs';
import {createCoachingGrants} from './coaching-grants.mjs';
import {createDiscoveryJobs} from './discovery-jobs.mjs';
import {createSourceMap} from './source-map.mjs';
import {createHostIdentity} from './host-identity.mjs';
import {createOperationalTelemetry} from './operational-telemetry.mjs';
import {createWorkerServer} from './worker-server.mjs';
import {createPrivateTasks} from './private-tasks.mjs';
import {createParserBroker} from './parser-broker.mjs';
import {createTaskBridge} from './live-transport.mjs';
import {startLocalParsers} from './local-parser.mjs';
const config=JSON.parse(readFileSync('/config/service.json','utf8'));
const repository=openRepository('/data/adoption.sqlite');
const actionAttempts=createActionAttempts(repository,{retentionMs:config.execution?.attemptRetentionMs??86_400_000});
const telemetry=createOperationalTelemetry();
const hostIdentity=createHostIdentity(repository);
const authority=new SessionAuthority({repository,development:true,hostIdentity}); // Only explicit loopback demo origins below are registered.
const search=createOpenSearch({...config.search,privateNetwork:true});
// Fail startup if the private retention policy cannot be installed/verified.
// Shared website indexes are never used for transaction passages.
await search.privateTasks.provision();
const knowledge=createKnowledgeService(repository,search);
const ingestion=createSourceIngestion(repository,{...config.ingestion,knowledge,blobs:createBlobStore('/data/objects'),extract:createDocumentExtractor({python:'/opt/adoption-python/bin/python'}),fetchUrl:createPublicUrlFetcher(),onEvent:telemetry.job});
knowledge.recoverExpired();
authority.maintain();
let analytics;
const recoveryTimer=setInterval(()=>{try{knowledge.recoverExpired();authority.maintain();actionAttempts.expire();analytics?.maintain();}catch{/* Authorization remains fail-closed; retry maintenance next turn. */}},30_000);
recoveryTimer.unref();
// Demo content is an explicit development option, never owner website knowledge.
const embeddings=config.demoSeedEnabled===true?['adoption-demo-alpha','adoption-demo-beta']:[];
// Apply additive lexical mappings to this service's existing source indexes
// as well as fresh synthetic embeddings. No platform index is selected.
for(const embeddingId of new Set([...embeddings,...repository.sourceEmbeddings()]))await search.provision(embeddingId);
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
const model={requestDeadlineMs:config.capacity?.modelDeadlineMs??MODEL_CLIENT_TIMEOUT_MS,gatewayUrl:config.gatewayUrl,serviceToken:config.serviceToken};
const planner=createPlatformPlanner(model);
const taskWebsite=id=>repository.map('websites').get(id);
const privateTasks=await createPrivateTasks({commandState:repository.map('command_attempts'),actionAttempts,passageStore:search.privateTasks,observe:(scope,event)=>analytics?.fact(scope,event),pairingState:repository.map('paired_groups'),root:'/data/private-objects',website:taskWebsite,activeScope:scope=>authority.activeScope(scope),planner,answer:createKnowledgeAnswer(model),guidance:(scope,text,snapshot)=>({sourceGuidance:sourceMap.guidance(scope,text,snapshot),recipeGuidance:learning.context(scope,text,snapshot),siteGuidance:learning.planningMemory(scope,text,snapshot)}),limits:config.privateTasks,authorizeEffect:async input=>{if(!config.taskPolicyUrl||!config.taskBridgeToken)return false;try{const response=await fetch(config.taskPolicyUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.taskBridgeToken}`},body:JSON.stringify(input)});return response.ok&&(await response.json()).allowed===true;}catch{return false;}}});
const parserBroker=createParserBroker(ingestion,privateTasks,{maxWorkers:config.ingestion?.maxWorkers||2});
const taskBridge=config.taskBridgeToken?createTaskBridge({tasks:privateTasks,token:config.taskBridgeToken}):null;
taskBridge?.listen(4197,'0.0.0.0');
const platformOrigin=new URL(config.serviceUrl).origin;
const control=createControlPlane(repository,authority);
const learning=createLearningRuntime(repository,createLearningStore(repository),{knowledge}),coaching=createCoachingGrants(repository);
const discovery=createDiscoveryJobs(repository,learning);
const sourceMap=createSourceMap(repository);
analytics=createVisitorAnalytics(repository,{...config.analytics,website:taskWebsite,labels:scope=>learning.maps(scope),networkAddress:req=>{const peer=req?.socket?.remoteAddress;if(!(config.analytics?.trustedProxyAddresses||[]).includes(peer))return null;const forwarded=req.headers['x-forwarded-for'];return typeof forwarded==='string'&&forwarded.length<512?forwarded.split(',').at(-1).trim():null;}});
const registrationEmail=createRegistrationEmail(repository,{send:createMailer(config.mail),control,search,serviceUrl:config.serviceUrl});
const management=createManagement({authenticate:createManagementIdentity({platformOrigin}),control,knowledge,search,platformOrigin,registrationEmail,ingestion,learning,coaching,sourceMap,hostIdentity,privateTasks,analytics,capacity:config.capacity});
const ownerIdentity=createOwnerIdentity(repository,{send:createMailer(config.mail)});
const ownerManagement=createManagement({authenticate:cookie=>ownerIdentity.authenticate(cookie),control,knowledge,search,platformOrigin,registrationEmail,ingestion,learning,coaching,sourceMap,hostIdentity,privateTasks,analytics,capacity:config.capacity});
ingestion.start({local:false});
const localParsers=!config.workerToken?startLocalParsers(parserBroker,createDocumentExtractor({python:'/opt/adoption-python/bin/python'}),{workers:config.ingestion?.maxWorkers||2}):null;
const workerServer=config.workerToken?createWorkerServer({ingestion:parserBroker,token:config.workerToken}):null;
workerServer?.listen(4196,'0.0.0.0');
const server=createAdoptionServer({capacity:config.capacity,authority,knowledge,ingestion,learning,coaching,discovery,sourceMap,hostIdentity,management,ownerIdentity,ownerManagement,platformOrigin,telemetry,privateTasks,taskWebsite,analytics,answer:createKnowledgeAnswer(model),planner,proposals:createProposalStore(repository,{attempts:actionAttempts,checkBinding:(scope,binding)=>learning.bindingAllowed(scope,binding)})});
server.listen(4193,'0.0.0.0',()=>console.log('Independent adoption service listening; full acceptance not yet certified'));
process.on('SIGTERM',async()=>{ingestion.stop();localParsers?.stop();clearInterval(recoveryTimer);await privateTasks.close();taskBridge?.closeAllConnections();taskBridge?.close();workerServer?.closeAllConnections();workerServer?.close();server.closeAllConnections();server.close(()=>{process.exit(0);});});

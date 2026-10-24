import {createConversationHistory} from './conversation-history.mjs';
import {goalAuthorization} from './goal-store.mjs';
import {handleGoal} from './goal-service.mjs';
import {MODEL_CLIENT_TIMEOUT_MS,MODEL_SESSION_TIMEOUT_MS} from '../web/model-timeouts.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { validateSnapshot } from './proposals.mjs';
import {pageObservationEvidence} from './page-understanding.mjs';
import {createRequestBudget,createConcurrencyBudget} from './request-budget.mjs';
import {createUploadAdmission} from './upload-admission.mjs';
import {constrainNavigation} from './navigation-intent.mjs';
import {constrainEdit} from './edit-intent.mjs';
import {randomUUID} from 'node:crypto';
import {attachLiveTransport} from './live-transport.mjs';
import {fieldGuidance} from './field-guidance.mjs';

const assets = new Map([
  ['/goal-ui.mjs', ['../web/goal-ui.mjs','text/javascript']],
  ['/page-targets.mjs',['../web/page-targets.mjs','text/javascript']],
  ['/page-context.mjs',['../web/page-context.mjs','text/javascript']],
  ['/guidance-intent.mjs',['../web/guidance-intent.mjs','text/javascript']],
  ['/workspace.mjs', ['../web/workspace.mjs','text/javascript']],
  ['/workspace.css', ['../web/workspace.css','text/css']],
  ['/review-card.mjs', ['../web/review-card.mjs','text/javascript']],
  ['/dependent-controls.mjs', ['../web/dependent-controls.mjs','text/javascript']],
  ['/task-controller.mjs', ['../web/task-controller.mjs','text/javascript']],
  ['/host-observation.mjs', ['../web/host-observation.mjs','text/javascript']],
  ['/review-editor.mjs', ['../web/review-editor.mjs','text/javascript']],
  ['/manage-onboarding.mjs', ['../web/manage-onboarding.mjs','text/javascript']],
  ['/manage-action-profiles.mjs', ['../web/manage-action-profiles.mjs','text/javascript']],

  ['/model-timeouts.mjs', ['../web/model-timeouts.mjs', 'text/javascript']],
  ['/manage.css', ['../web/manage.css', 'text/css']],
  ['/manage-shell.mjs', ['../web/manage-shell.mjs', 'text/javascript']],
  ['/manage-map-context.mjs', ['../web/manage-map-context.mjs', 'text/javascript']],
  ['/manage-pagination.mjs', ['../web/manage-pagination.mjs', 'text/javascript']],
  ['/choice-intent.mjs', ['../web/choice-intent.mjs', 'text/javascript']],
  ['/owner.html', ['../web/manage.html', 'text/html']],
  ['/manage.html', ['../web/manage.html', 'text/html']],
  ['/visitor-analytics.mjs',['../web/visitor-analytics.mjs','text/javascript']],
  ['/manage-analytics.mjs',['../web/manage-analytics.mjs','text/javascript']],
  ['/manage-pairings.mjs',['../web/manage-pairings.mjs','text/javascript']],
  ['/manage.mjs', ['../web/manage.mjs', 'text/javascript']],
  ['/sdk.mjs', ['../web/sdk.mjs', 'text/javascript']],
  ['/theme.mjs', ['../web/theme.mjs', 'text/javascript']],
  ['/session-client.mjs', ['../web/session-client.mjs', 'text/javascript']],
  ['/conversation-ui.mjs',['../web/conversation-ui.mjs','text/javascript']],
  ['/dom.mjs', ['../web/dom.mjs', 'text/javascript']],
  ['/pointer-overlay.mjs', ['../web/pointer-overlay.mjs', 'text/javascript']],
  ['/activation.mjs', ['../web/activation.mjs', 'text/javascript']],
  ['/page-observer.mjs', ['../web/page-observer.mjs', 'text/javascript']],
  ['/form-submit.mjs', ['../web/form-submit.mjs', 'text/javascript']],
  ['/semantic.mjs', ['../web/semantic.mjs', 'text/javascript']],
  ['/site-loader.mjs', ['../web/site-loader.mjs', 'text/javascript']],
  ['/recording.mjs', ['../web/recording.mjs', 'text/javascript']],
  ['/files.mjs', ['../web/files.mjs', 'text/javascript']],
  ['/screen-capture.mjs', ['../web/screen-capture.mjs', 'text/javascript']],
  ['/learning-package.mjs', ['../web/learning-package.mjs', 'text/javascript']],
  ['/widget.html', ['../web/widget.html', 'text/html']],
  ['/widget.mjs', ['../web/widget.mjs', 'text/javascript']],
  ['/task-client.mjs', ['../web/task-client.mjs', 'text/javascript']],
  ['/task-panel.mjs', ['../web/task-panel.mjs', 'text/javascript']],
  ['/action-feedback.mjs', ['../web/action-feedback.mjs', 'text/javascript']],
  ['/install-snippet.mjs', ['../src/install-snippet.mjs', 'text/javascript']],
]);
function withMode(response,mode='assist'){
 if(!['assist','guide'].includes(mode))throw new Error('Unsupported assistance mode');
 return mode==='guide'?{...response,...(response.actions.some(action=>action.type==='fill')?{intent:'guide',message:'Guide only is active: these are highlights, with no input edits. Choose Prepare changes and send the request again to review and apply values.'}:{}),actions:response.actions.map(action=>action.type==='fill'?{type:'highlight',ref:action.ref}:action)}:response;
}
async function body(req,limit=32_768) {
  const chunks=[];let size=0;
  for await (const chunk of req) {
    size+=chunk.length;if(size>limit)throw new Error('Request too large');chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Invalid request');
  return parsed;
}

export function createAdoptionServer({ goals,goalModel,conversations=createConversationHistory(),authority, proposals, planner, knowledge, ingestion, learning, coaching, discovery, sourceMap,hostIdentity, answer, management, ownerIdentity, ownerManagement, platformOrigin,telemetry,privateTasks,taskWebsite,analytics,uploadAdmission,uploadProxyAddresses=[],capacity={}, development = false, fixture = null }) {
  const budget=createRequestBudget();
  const managementPerIp=capacity.managementPerIp??600;if(!Number.isInteger(managementPerIp)||managementPerIp<30||managementPerIp>6000)throw new Error('Invalid management network capacity');
  const modelSlots=createConcurrencyBudget({global:capacity.modelConcurrency??25,perDomain:capacity.modelPerDomain??5}),searchSlots=createConcurrencyBudget({global:capacity.searchConcurrency??25,perDomain:capacity.searchPerDomain??5});
  const requestTimeoutMs=(capacity.modelDeadlineMs??MODEL_CLIENT_TIMEOUT_MS)+5000;if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<6000||requestTimeoutMs>MODEL_SESSION_TIMEOUT_MS)throw new Error('Invalid model deadline');
  let activeUploads=0;
  const uploads=uploadAdmission||privateTasks?.uploadAdmission||createUploadAdmission();
  if(!Array.isArray(uploadProxyAddresses)||uploadProxyAddresses.some(ip=>typeof ip!=='string'||ip.length>80||!ip))throw new Error('Invalid trusted upload proxies');
  const server=createServer({headersTimeout:15000,requestTimeout:30000,maxHeaderSize:16384},async (req, res) => {
    const requestController=new AbortController();res.on('close',()=>{if(!res.writableEnded)requestController.abort();});
    let uploadSlot=false,uploadPermit,uploadReadTimer,uploadBodyLimit=23_000_000,releaseModel,releaseSearch;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    let requestScope,entityId,state;const analyticsStarted=Date.now();if(analytics)res.once('finish',()=>{if(requestScope)try{analytics.operation(requestScope,path,res.statusCode,Date.now()-analyticsStarted);if(path==='/v1/terminate')analytics.endSession(requestScope);}catch{}});
    const send = (code, data) => {entityId=data?.id||data?.messageId||entityId;state=data?.status;res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const managedScope=(operation,input)=>{requestScope={embeddingId:input.id,sessionId:operation.endsWith('/revoke-session')?input.sessionId:undefined};entityId=input.installationId;};
    let path;try{path=new URL(req.url,'http://unused').pathname;}catch{return send(400,{error:'Invalid request URL'});}
    if(telemetry&&req.method==='POST'&&path.startsWith('/v1/')){
      const requestId=randomUUID(),started=Date.now(),operation=telemetry.operation(path);
      res.setHeader('X-Adoption-Request-Id',requestId);
      res.setHeader('Access-Control-Expose-Headers','X-Adoption-Request-Id');
      res.once('finish',()=>telemetry.request({requestId,operation,status:res.statusCode,durationMs:Date.now()-started,embeddingId:requestScope?.embeddingId,sessionId:requestScope?.sessionId,entityId,state}));
    }
    try {
      if (req.method === 'GET' && path === '/health') return send(200, { service: 'digital-adoption', status: 'ok', releaseReady: false });
      if (req.method === 'GET' && assets.has(path)) {
        res.setHeader('Access-Control-Allow-Origin','*'); // Public SDK assets only; API authorization is separate.
        const [file, type] = assets.get(path);
        res.setHeader('Content-Security-Policy', ['/manage.html','/owner.html'].includes(path)?"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'":"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src blob:; frame-ancestors *; base-uri 'none'; form-action 'none'");
        res.writeHead(200, { 'Content-Type': type });
        return res.end(await readFile(new URL(file, import.meta.url)));
      }
      if (development && fixture && req.method === 'GET' && path === '/fixture') {
        res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fixture);
      }
      if (development && fixture && req.method === 'GET' && path === '/fixture/destination') {
        res.writeHead(200, {'Content-Type':'text/html'});
        return res.end('<!doctype html><html lang="en"><title>Recorded destination</title><h1>Recorded navigation reached its destination</h1><p>No form was submitted.</p><a href="/fixture">Return to harness</a></html>');
      }
      // Actual request Origin is used; no user-supplied embedding/session IDs select scope.
      const origin = req.headers.origin;
      if (typeof origin !== 'string' || origin === 'null') return send(403, { error: 'Access denied' });
      // CORS is not authorization. Generic refusal/rate-limit responses must
      // remain readable even before a runtime session has been established.
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
      if (req.method === 'OPTIONS') {
        // CORS is not authentication; POST still validates the installation/session.
        res.writeHead(204, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin',
          'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Adoption-Analytics',
          'Access-Control-Max-Age': '60' }); return res.end();
      }
      if (req.method !== 'POST') return send(404, { error: 'Not found' });
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'JSON required' });
      if(path==='/v1/knowledge/upload')throw Object.assign(new Error('Use authenticated website management to upload shared knowledge.'),{publicCode:'OWNER_KNOWLEDGE_UPLOAD_REQUIRED'});
      if((path.startsWith('/v1/tasks/')||path.startsWith('/v1/pair/'))&&!/^\/v1\/(tasks|pair)\/[a-z-]+$/.test(path))throw new Error('Unsupported private operation');
      const fileUpload=['/v1/manage/source-file','/v1/owner/manage/source-file','/v1/tasks/upload'].includes(path);
      if(fileUpload){
        budget.take(`upload:${req.socket.remoteAddress}`,path==='/v1/tasks/upload'?(capacity.privateUploadsPerIp??100):5);
        // Authorize before buffering a large file. Resource ownership is checked
        // again after parsing, before it reaches raw storage or a worker.
        if(path==='/v1/manage/source-file'){if(!management)throw new Error('Management unavailable');await management({authorization:req.headers.authorization,origin,path:'/v1/manage/websites',input:{}});}
        else if(path==='/v1/owner/manage/source-file'){if(!ownerManagement||origin!==platformOrigin)throw new Error('Owner access denied');await ownerManagement({authorization:req.headers.cookie,origin,path:'/v1/manage/websites',input:{}});}
        else {const sessionToken=/^Bearer (\S+)$/.exec(req.headers.authorization||'')?.[1],scope=authority.context({sessionToken,origin}),site=taskWebsite?.(scope.embeddingId);if(!privateTasks||site?.taskPolicy?.attachments!==true)throw new Error('Uploads disabled');const fileBytes=Math.min(privateTasks.limits?.fileBytes||16777216,site.taskPolicy.limits?.fileBytes||16777216);uploadBodyLimit=Math.min(uploadBodyLimit,Math.ceil(fileBytes/3)*4+8192);const length=req.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>uploadBodyLimit))throw new Error('Request too large');const peer=req.socket.remoteAddress,forwarded=req.headers['x-forwarded-for'],network=uploadProxyAddresses.includes(peer)&&typeof forwarded==='string'&&forwarded.length<512?forwarded.split(',').at(-1).trim():peer;uploadPermit=uploads.admit(scope,{ownerId:site.organizationId,network});}
        if(path!=='/v1/tasks/upload'){if(activeUploads>=2)throw new Error('Request capacity reached');activeUploads++;uploadSlot=true;}
        uploadReadTimer=setTimeout(()=>req.destroy(new Error('Upload body deadline reached')),uploads.limits.readTimeoutMs);uploadReadTimer.unref?.();
      }
      const mapRefresh=['/v1/manage/source-map-refresh','/v1/owner/manage/source-map-refresh'].includes(path);
      if(mapRefresh){
        budget.take(`map:${req.socket.remoteAddress}`,5);
        const handler=path.startsWith('/v1/owner/')?ownerManagement:management;
        if(!handler)throw new Error('Management unavailable');
        await handler({authorization:path.startsWith('/v1/owner/')?req.headers.cookie:req.headers.authorization,origin,path:'/v1/manage/websites',input:{}});
      }
      const mapObservation=['/v1/learning/observe','/v1/discovery/observe'].includes(path);
      if(mapObservation){const sessionToken=/^Bearer (\S+)$/.exec(req.headers.authorization||'')?.[1],access=authority.context({sessionToken,origin});if(!access.capabilities.coach)throw new Error('Coaching permission required');budget.take(`map-observe:${access.sessionId}`,60);}
      const input = await body(req,fileUpload?uploadBodyLimit:path.startsWith('/v1/conversations/')?131072:mapRefresh?512_000:mapObservation?256_000:32_768);clearTimeout(uploadReadTimer);
      let result;
      if(path.startsWith('/v1/owner/')){
        if(!ownerIdentity||origin!==platformOrigin)return send(403,{error:'Access denied'});
        budget.take(`${path.startsWith('/v1/owner/manage/')?'owner-management':'owner-login'}:${req.socket.remoteAddress}`,path.startsWith('/v1/owner/manage/')?managementPerIp:30);
        if(path==='/v1/owner/start')result=await ownerIdentity.start(input.email);
        else if(path==='/v1/owner/confirm'){const login=ownerIdentity.confirm(input.email,input.challenge,input.code);res.setHeader('Set-Cookie',login.cookie);result={signedIn:true};}
        else if(path==='/v1/owner/logout'){res.setHeader('Set-Cookie',ownerIdentity.logout(req.headers.cookie).cookie);result={signedOut:true};}
        else if(path.startsWith('/v1/owner/manage/')){result=await ownerManagement({authorization:req.headers.cookie,origin,path:path.replace('/v1/owner/manage/','/v1/manage/'),input});managedScope(path,input);}
        else return send(404,{error:'Not found'});
        return send(200,result);
      }
      if(path.startsWith('/v1/manage/')){
        if(!management)return send(403,{error:'Management unavailable'});
        budget.take(`management:${req.socket.remoteAddress}`,managementPerIp);
        result=await management({authorization:req.headers.authorization,origin,path,input});
        managedScope(path,input);
        return send(200,result);
      }
      if (path === '/v1/sessions') {budget.take(`init:${req.socket.remoteAddress}`,60);result = {...authority.initialize({ installationToken: input.installationToken, origin, initializationKey:input.initializationKey,identityToken:input.identityToken }),requestTimeoutMs};}
      else {
        const sessionToken = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
        const auth = { sessionToken, origin };
        const authorizedScope=authority.context(auth);const scope={...authorizedScope,websiteRevision:taskWebsite?.(authorizedScope.embeddingId)?.configurationRevision||0};
        requestScope=scope;if(req.headers['x-adoption-analytics']==='off')analytics?.endSession(scope);
        if(!path.startsWith('/v1/analytics/')&&!['/v1/renew','/v1/history','/v1/capabilities','/v1/pair/status','/v1/tasks/status','/v1/discovery/status','/v1/discovery/list','/v1/discovery/next'].includes(path))privateTasks?.touchSession(scope);
        // Authorized callers must be able to read dependency failures as well
        // as successful responses, rather than receiving an opaque CORS error.
        res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
        if(path.startsWith('/v1/analytics/')){if(!analytics)throw new Error('Analytics unavailable');if(path==='/v1/analytics/policy')result=analytics.policy(scope);else if(path==='/v1/analytics/consent')result=analytics.consent(scope,input,req);else if(path==='/v1/analytics/events'){budget.take(`analytics:${scope.sessionId}`,60);result=analytics.collect(scope,input);authority.touch(auth);}else throw new Error('Unknown analytics operation');}
        else if (path === '/v1/history') result = { messages: authority.history(auth),conversationVersion:scope.conversationVersion };
        else if(path.startsWith('/v1/conversations/')){
          budget.take(`conversations:${scope.sessionId}`,30);const operation=path.split('/').at(-1);
          if(operation==='list')result=conversations.list(scope,input);
          else if(operation==='delete')result=await conversations.remove(scope,input);
          else if(operation==='archive'||operation==='resume'){
            const target=operation==='resume'?await conversations.read(scope,input):null;
            if(input.expectedVersion!==scope.conversationVersion)throw new Error('Conversation changed. Refresh history before switching.');
            const archived=await conversations.archive(scope,{...input,messages:input.messages||authority.history(auth)});
            authority.context(auth);if(archived.reused&&operation==='archive'){result={...archived,messages:authority.history(auth),conversationVersion:scope.conversationVersion};}
            else {privateTasks?.endSession(scope);goals?.clear(scope);authority.clearConversation(auth);if(target){const restored=authority.restoreConversation(auth,target.messages);result={...restored,id:target.id,expiresAt:target.expiresAt,resumed:true,archived};}else result={...archived,conversationVersion:authority.context(auth).conversationVersion};}
          }else throw new Error('Unknown private history operation');
        }
        else if(path==='/v1/capabilities')result={privateRetentionHours:conversations.retentionMs/3600000,requestTimeoutMs,executionContractVersion:2,goalPlanning:!!(goals&&goalModel),capabilities:scope.capabilities,uploadLimits:{...uploads.publicLimits(),taskFiles:Math.min(privateTasks?.limits?.files||4,taskWebsite?.(scope.embeddingId)?.taskPolicy?.limits?.files||privateTasks?.limits?.files||4),taskBytes:Math.min(privateTasks?.limits?.taskBytes||67108864,taskWebsite?.(scope.embeddingId)?.taskPolicy?.limits?.taskBytes||privateTasks?.limits?.taskBytes||67108864),fileBytes:Math.min(privateTasks?.limits?.fileBytes||16777216,taskWebsite?.(scope.embeddingId)?.taskPolicy?.limits?.fileBytes||16777216)},taskPolicy:privateTasks?taskWebsite?.(scope.embeddingId)?.taskPolicy||{}:{},learningEnabled:learning?.learningEnabled?.(scope)===true};
        else if(path.startsWith('/v1/goals/')){
          const operation=path.split('/').at(-1);if(['create','next','observe','clarify'].includes(operation)){budget.take(`model:${scope.embeddingId}`);releaseModel=modelSlots.acquire(scope.embeddingId);}
          authority.touch(auth);result=await handleGoal({operation,scope,input,goals,goalModel,planner,proposals,privateTasks,sourceMap,learning,signal:requestController.signal,stillCurrent:()=>{const current=authority.context(auth);if(current.conversationVersion!==scope.conversationVersion||goalAuthorization({...current,websiteRevision:taskWebsite?.(current.embeddingId)?.configurationRevision||0})!==goalAuthorization(scope))throw Object.assign(new Error('Website access changed; goal response discarded.'),{publicCode:'GOAL_STALE'});}});
        }
        else if(path==='/v1/live/ticket'){if(!privateTasks)throw new Error('Private tasks unavailable');result=privateTasks.ticket(scope,input);}
        else if(path.startsWith('/v1/tasks/')||path.startsWith('/v1/pair/')){
          if(!privateTasks)throw new Error('Private tasks unavailable');
          budget.take(`private:${scope.sessionId}`,60);
          const operations=path.startsWith('/v1/tasks/')?{start:'start',status:'status',end:'end',upload:'upload',remove:'remove',plan:'plan',summary:'summary',approve:'approve',revise:'revise',reject:'reject','save-review':'saveReview',relay:'relay','peer-catalog':'peerCatalog','peer-request':'peerRequest','peer-status':'peerStatus','peer-answer':'peerAnswer','peer-cancel':'peerCancel','command-plan':'commandPlan',effect:'effect'}:{invite:'invite',join:'join',status:'pairStatus',confirm:'confirm',revoke:'revoke',link:'linkRequest'};
          const key=path.split('/').at(-1),action=Object.hasOwn(operations,key)?operations[key]:null;if(!action)throw new Error('Unsupported private operation');
          if(['plan','summary','commandPlan'].includes(action))releaseModel=modelSlots.acquire(scope.embeddingId);
          if(!['status','pairStatus'].includes(action))authority.touch(auth);
          if(['end','remove'].includes(action))goals?.clear(scope);
          let authorizedKnowledgeHistory;
          if(action==='summary'&&input.channel==='knowledge'){
            authority.appendMessage({...auth,text:input.text,channel:'knowledge',replyTo:input.replyTo??null});
            authorizedKnowledgeHistory=authority.history(auth).filter(m=>m.channel==='knowledge');
          }
          result=await privateTasks[action](scope,['plan','summary','commandPlan'].includes(action)?{...input,authorizedKnowledgeHistory,authorizedReplyContext:authority.history(auth).find(m=>m.id===input.replyTo&&(m.channel||'guide')===(authorizedKnowledgeHistory?'knowledge':'guide'))?.text,requestSignal:requestController.signal}:input,action==='upload'?uploadPermit:action==='peerAnswer'&&input.goalId?goals?.get(scope,input.goalId):undefined);
          if(authorizedKnowledgeHistory){if(authority.context(auth).conversationVersion!==scope.conversationVersion)throw new Error('Conversation cleared; response discarded');result.messageId=authority.appendAssistant(auth,result.message,'knowledge').id;}
        }
        else if(path==='/v1/learning/complete'){
          if(!learning?.learningEnabled(scope)||input.consent!==true)result={created:false};
          else{
            if(!hostIdentity||!proposals)throw new Error('Verified host outcome integration required');
            const snapshot=validateSnapshot(input.snapshot),steps=proposals.verifiedLearningSteps(scope,{saveProposalId:input.proposalId,path:snapshot.path});
            if(steps.some(step=>snapshot.fields.filter(field=>field.key===step.field).length!==1))throw new Error('Task fields changed or are ambiguous');
            const evidence=hostIdentity.verifyOutcome(scope,origin,input.receipt,{proposalId:input.proposalId,path:snapshot.path});
            result=learning.candidate(scope,{title:'Verified draft workflow',steps,consent:true,evidence});
          }
        }
        else if(path==='/v1/coaching/exchange'){
          if(!coaching)throw new Error('Coaching unavailable');budget.take(`coaching:${scope.sessionId}`,5);
          result=authority.grantCoaching(auth,coaching.exchange(scope,origin,input.code));
        }
        else if(path==='/v1/learning/observe'){
          if(!learning||!scope.capabilities.coach)throw new Error('Coaching permission required');
          result=learning.observe({...scope,origin},input.snapshot);
        }
        else if(path==='/v1/recipes'){if(!learning)throw new Error('Learning unavailable');result={recipes:learning.list(scope)};}
        else if(path==='/v1/learning/draft'){
          if(!learning||!scope.capabilities.coach)throw new Error('Coaching permission required');
          if(input.package?.sourceOrigin!==origin)throw new Error('Teaching origin changed');
          result=learning.import({...scope,origin},{package:input.package,operationId:input.operationId});
        }
        else if(path.startsWith('/v1/discovery/')){
          if(!discovery||!scope.capabilities.coach)throw new Error('Coaching permission required');
          const action=path.slice('/v1/discovery/'.length),discoveryScope={...scope,origin};
          if(action==='start')result=discovery.start(discoveryScope,{...input,origin});
          else if(action==='list')result={jobs:discovery.list(discoveryScope)};
          else if(action==='extend')result=discovery.extend(discoveryScope,input.id,input.paths);
          else if(action==='next')result=discovery.next(discoveryScope,input.id,{hasUnsavedWork:input.hasUnsavedWork});
          else if(action==='observe')result=discovery.observe(discoveryScope,input.id,input.snapshot);
          else if(action==='block')result=discovery.block(discoveryScope,input.id);
          else if(['pause','resume','stop'].includes(action))result=discovery.control(discoveryScope,input.id,action);
          else if(action==='status')result=discovery.status(discoveryScope,input.id);
          else throw new Error('Unsupported discovery operation');
        }
        else if(path==='/v1/recipe/test/start'){if(!learning||!scope.capabilities.coach)throw new Error('Coaching required');result=learning.startTest(scope,input);}
        else if(path==='/v1/recipe/test/observe'){if(!learning||!scope.capabilities.coach)throw new Error('Coaching required');result=learning.observeTest(scope,{proposalId:input.proposalId,evidence:proposals.testEvidence(scope,input.proposalId)});}
        else if(path==='/v1/recipe/test/finish'){if(!learning||!scope.capabilities.coach)throw new Error('Coaching required');result=learning.finishTest(scope,input);}
        else if(path==='/v1/recipe/plan'){
          if(!learning||!proposals)throw new Error('Learning unavailable');
          const snapshot=validateSnapshot(input.snapshot),review=input.testRunId?learning.testReview(scope,snapshot,input):learning.review(scope,snapshot,input);
          result={...proposals.prepare(scope,snapshot,withMode(review.response,input.mode),review.binding),nextStep:review.nextStep,complete:review.complete};authority.touch(auth);
        }
        else if(path==='/v1/history/clear'){privateTasks?.endSession(scope);goals?.clear(scope);result=authority.clearConversation(auth);}
        else if(path==='/v1/knowledge/documents'){if(!knowledge)throw new Error('Knowledge unavailable');result={sources:knowledge.available(scope)};}
        else if(path==='/v1/knowledge/upload-status'){if(!ingestion)throw new Error('Ingestion unavailable');result=ingestion.status(scope,input.sourceId);}
        else if (path === '/v1/messages') result = authority.appendMessage({ ...auth, text: input.text, replyTo: input.replyTo });
        else if (path === '/v1/renew') result = authority.renew({...auth,identityToken:input.identityToken});
        else if (path === '/v1/terminate') { privateTasks?.endSession(scope);goals?.clear(scope);authority.terminate(auth); result = { terminated: true }; }
        else if(path==='/v1/save/plan'){
          if(!proposals)throw new Error('Action reviews unavailable');
          authority.touch(auth);result=proposals.prepareSave(scope,input.snapshot,input.ref);
        }
        else if (path === '/v1/plan') {
          if (!proposals) return send(503,{ error:'Model assistance is not configured' });
          if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 8000) throw new Error('Invalid request');
          const snapshot=constrainEdit(input.text,constrainNavigation(input.text,validateSnapshot(input.snapshot)));
          const pointing=input.replyTo?null:fieldGuidance(input.text,snapshot,authority.history(auth).filter(m=>(m.channel||'guide')==='guide'));
          if(!pointing){budget.take(`model:${scope.embeddingId}`);releaseModel=modelSlots.acquire(scope.embeddingId);if(!planner)return send(503,{error:'Model assistance is not configured'});}
          authority.touch(auth);
          authority.appendMessage({...auth,text:input.text,replyTo:input.replyTo??null});
          // No credentials or caller-provided identity are passed to the model.
          const guideHistory=authority.history(auth).filter(m=>(m.channel||'guide')==='guide');
          const recipeGuidance=learning?.context?.(scope,input.text,snapshot);
          const response=pointing||(['ambiguous','manual_replay'].includes(recipeGuidance?.status)?{message:recipeGuidance.status==='ambiguous'?`More than one reviewed workflow matches: ${recipeGuidance.candidates.map(candidate=>candidate.title).join('; ')}. Clarify which workflow you intend before I prepare changes.`:'This workflow is too large to include safely as one guidance context. Ask the website owner to split it into smaller reviewed workflows.',actions:[]}:await planner({signal:requestController.signal, text:input.text,snapshot,history:guideHistory.slice(-12),replyContext:guideHistory.find(m=>m.id===input.replyTo)?.text,sourceGuidance:sourceMap?.guidance(scope,input.text,snapshot),recipeGuidance,siteGuidance:learning?.planningMemory?.(scope,input.text,snapshot) }));
          if(authority.context(auth).conversationVersion!==scope.conversationVersion)throw new Error('Conversation cleared; response discarded');
          const destination=response.actions?.length===1&&response.actions[0].type==='navigate'?snapshot.links.find(link=>link.ref===response.actions[0].ref)?.path:null;
          const navigationBinding=destination?learning?.navigationProfile?.(scope,destination):null;
          result=proposals.prepare(scope,snapshot,withMode(response,input.mode),navigationBinding);
          result.matchedWorkflows=(recipeGuidance?.matches||[]).map(({id,version,title})=>({id,version,title}));
          result.messageId=authority.appendAssistant(auth,result.message).id;
        }
        else if(path==='/v1/knowledge/search'||path==='/v1/ask') {
          budget.take(`${path==='/v1/ask'?'model':'search'}:${scope.embeddingId}`);
          releaseSearch=searchSlots.acquire(scope.embeddingId);
          if(path==='/v1/ask')releaseModel=modelSlots.acquire(scope.embeddingId);
          if(!knowledge)return send(503,{error:'Knowledge is not configured'});
          if(typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)throw new Error('Invalid query');
          const retrieved=await knowledge.retrieve(scope,{query:input.text,size:path==='/v1/knowledge/search'?(input.size??6):24,after:path==='/v1/knowledge/search'?(input.after??null):null});
          if(authority.context(auth).conversationVersion!==scope.conversationVersion)throw new Error('Conversation cleared; request discarded');
          if(path==='/v1/knowledge/search')result=retrieved;
          else {
            if(!answer)return send(503,{error:'Knowledge model is not configured'});
            const snapshot=input.snapshot?validateSnapshot(input.snapshot):undefined;
            const pageEvidence=pageObservationEvidence(snapshot);
            authority.appendMessage({...auth,text:input.text,channel:'knowledge',replyTo:input.replyTo??null});
            const knowledgeHistory=authority.history(auth).filter(m=>m.channel==='knowledge');
            result=await answer({signal:requestController.signal,text:input.text,snapshot,evidence:retrieved.evidence,history:knowledgeHistory,replyContext:knowledgeHistory.find(m=>m.id===input.replyTo)?.text});
            if(authority.context(auth).conversationVersion!==scope.conversationVersion)throw new Error('Conversation cleared; response discarded');
            // Source deletion during inference must invalidate its citations.
            const current=await knowledge.retrieve(scope,{query:input.text,size:24});
            if(authority.context(auth).conversationVersion!==scope.conversationVersion)throw new Error('Conversation cleared; response discarded');
            if(result.citations.some(c=>![...current.evidence,...pageEvidence].some(e=>e.chunkId===c.chunkId&&e.revision===c.revision&&e.text===c.text)))throw new Error('Evidence changed');
            result.messageId=authority.appendAssistant(auth,result.message,'knowledge').id;
          }
        }
        else if(path==='/v1/actions/dispatch')result=proposals.ownsAttempt(scope,input.actionId)?proposals.dispatch(scope,input):await privateTasks.dispatchAction(scope,input);
        else if(path==='/v1/actions/verify'){if(!hostIdentity)throw new Error('Host verification unavailable');const binding=proposals.attemptBinding(scope,input.actionId);hostIdentity.verifyActionOutcome(scope,origin,input.receipt,{actionId:input.actionId,proposalId:binding.proposalId,path:binding.path});result=proposals.verifyAttempt(scope,input);}
        else if(path==='/v1/actions/observe')result=proposals.observeAttempt(scope,input);
        else if(path==='/v1/revise')result=proposals.revise(scope,input);
        else if(path==='/v1/reject'){if(!proposals)throw new Error('Action review is not configured');result=proposals.reject(scope,input.id);authority.touch(auth);}
        else if (path === '/v1/approve') {
          if (!proposals) return send(503,{ error:'Action review is not configured' });
          result={...proposals.consume(scope,{ id:input.id,revision:input.revision,approved:input.approved }),outcomeProfile:taskWebsite?.(scope.embeddingId)?.taskPolicy?.outcomeProfile};
          authority.touch(auth);
        }
        else return send(404, { error: 'Not found' });
      }
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      if(path==='/v1/learning/complete'&&result?.created===true&&requestScope)analytics?.fact(requestScope,{kind:'verified_save_learning',status:'ok'});
      return send(200, result);
    } catch (error) {
      const unavailable=['COPILOT_CHECKER_UNAVAILABLE','COPILOT_REVIEW_FAILED'].includes(error.publicCode)||['Platform model unavailable','Knowledge model unavailable','Search operation failed','Search provisioning check failed','Management identity unavailable'].includes(error.message)||['ERR_SQLITE_ERROR','SQLITE_BUSY','SQLITE_IOERR','ENOSPC','EROFS','EIO','EMFILE','ENFILE'].includes(error.code)||error.code==='ERR_INVALID_STATE'&&/database|statement/i.test(error.message);
      const invalidResponse=['Invalid platform model response','Invalid evidence citations','The assistant could not produce a valid current-screen proposal. Nothing was changed.'].includes(error.message);
      const uploadLimited=['UPLOAD_RATE_LIMIT','UPLOAD_BUDGET_EXCEEDED','UPLOAD_COOLDOWN','UPLOAD_BUSY','UPLOAD_QUEUE_FULL'].includes(error.publicCode);
      const code = error.message === 'Request too large' ? 413 : uploadLimited||error.publicCode==='OWNER_CODE_COOLDOWN'||error.message==='Request rate exceeded'||error.message==='Request capacity reached'?429:unavailable?503:invalidResponse?502:403;
      if(code===429){res.setHeader('Retry-After',String(error.retryAfter|| (error.message==='Request rate exceeded'?60:2)));res.setHeader('Access-Control-Expose-Headers','Retry-After, X-Adoption-Request-Id');}
      return send(code, { error: error.publicCode?.startsWith('GOAL_')?error.message:['DNS_CHALLENGE_EXPIRED','DNS_RECORD_MISSING','DNS_RECORD_MISMATCH','DNS_RESOLVER_UNAVAILABLE','SOURCE_MAP_CHANGED','SOURCE_MAP_INVALID'].includes(error.publicCode)?error.message:code===429?'Copilot is busy. Please retry shortly.':code===413?'Request too large':code===503?'Copilot service temporarily unavailable':code===502?'The assistant could not prepare a valid response. Nothing was changed.':'Access denied or invalid request',...(error.publicCode?{code:error.publicCode}:{}) });
    }finally{clearTimeout(uploadReadTimer);uploads.release(uploadPermit);releaseModel?.();releaseSearch?.();if(uploadSlot)activeUploads--;}
  });
  if(privateTasks)attachLiveTransport(server,{tasks:privateTasks});
  return server;
}

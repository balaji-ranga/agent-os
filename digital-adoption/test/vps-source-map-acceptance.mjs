// Trusted synthetic identity setup, then deployed HTTP APIs and real model.
// This is not browser execution or full phase acceptance.
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
const demo=JSON.parse(readFileSync('/data/demo-public.json')),origin=new URL(demo.serviceUrl).origin,repository=openRepository('/data/adoption.sqlite'),authority=new SessionAuthority({repository});
const id=randomUUID(),ownerId='synthetic-map-'+id,token=randomBytes(32).toString('base64url'),tokenHash=createHash('sha256').update(token).digest('hex'),sessions=[];
repository.map('owner_sessions').set(tokenHash,{ownerId,expiresAt:Date.now()+600_000,lastSeen:Date.now()});
repository.map('websites').set(id,{id,organizationId:ownerId,origin,environment:'staging',status:'approved',verified:true,installations:[]});
const installation=authority.registerApproved({embeddingId:id,origins:[origin],expiresAt:Date.now()+600_000});
async function post(path,input={},session,expected=200,owner=false){const response=await fetch(new URL(path,demo.serviceUrl),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(owner?{Cookie:`__Secure-adoption-owner=${token}`} :session?{Authorization:`Bearer ${session.sessionToken}`}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(100_000)});assert.equal(response.status,expected,path);return response.json();}
const manage=(action,input={},expected=200)=>post('v1/owner/manage/'+action,{id,...input},null,expected,true);
try{
 const manifest={schema:1,origin,reviewed:true,screens:[{path:'/synthetic-clients',title:'Synthetic clients',forms:[{id:'client-draft',label:'Client draft'}],fields:[{key:'company',label:'Company name',type:'text',form:'client-draft'}]}]};
 const map=await manage('source-map-refresh',{manifest});assert.deepEqual(map.counts,{screens:1,forms:1,fields:1});
 await manage('source-map-refresh',{manifest:{...manifest,origin:'https://foreign.example.com'}},403);
 assert.equal((await manage('source-map')).revision,map.revision);
 const draft=await manage('source-map-teach',{path:'/synthetic-clients',form:'client-draft',revision:map.revision});assert.equal(draft.status,'draft');
 assert.equal((await manage('learning-validate',{recipeId:draft.id,version:1})).compatible,false);await manage('learning-publish',{recipeId:draft.id,version:1,reviewed:true},403);
 const session=await post('v1/sessions',installation);sessions.push(session);
 const navigation=await post('v1/plan',{text:'Create a synthetic client with company name Cedar Test.',snapshot:{revision:1,path:'/',screen:'Home',fields:[],links:[{ref:'r1n0',label:'Synthetic clients',path:'/synthetic-clients'}]}},session);
 assert.equal(navigation.actions[0]?.type,'navigate');assert.equal(navigation.actions.length,1);
 const patch=await post('v1/plan',{text:'Set Company name to Cedar Test.',snapshot:{revision:2,path:'/synthetic-clients',screen:'Client draft',fields:[{ref:'r2f0',key:'company',label:'Company name',type:'text'}],links:[]}},session);
 assert.equal(patch.actions[0]?.ref,'r2f0');assert.equal(patch.actions[0]?.value,'Cedar Test');
 const result={build:process.env.ADOPTION_BUILD,kind:'live-api-with-trusted-synthetic-identity',counts:map.counts,checks:['reviewed source map refresh and foreign-origin denial','source-derived draft cannot publish without live compatibility','real-model observed navigation before destination field preparation','fresh observed field refs used for reviewed partial patch'],browserActionsExecuted:false,fullPhaseCertification:false};writeFileSync('/data/source-map-acceptance-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
 for(const session of sessions)try{await post('v1/terminate',{},session);}catch{}
 authority.revokeInstallation(installation.installationId);repository.map('owner_sessions').delete(tokenHash);repository.map('websites').delete(id);repository.close();
}

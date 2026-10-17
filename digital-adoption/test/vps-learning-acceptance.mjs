// Trusted synthetic setup and real HTTP checks; no browser execution is claimed.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createCoachingGrants} from '../src/coaching-grants.mjs';
import {createKnowledgeService} from '../src/knowledge-service.mjs';
import {createOpenSearch} from '../src/opensearch.mjs';
const config=JSON.parse(readFileSync('/config/service.json')),demo=JSON.parse(readFileSync('/data/demo-public.json')),repository=openRepository('/data/adoption.sqlite');
const knowledge=createKnowledgeService(repository,createOpenSearch({...config.search,privateNetwork:true})),learning=createLearningRuntime(repository,createLearningStore(repository),{knowledge}),grants=createCoachingGrants(repository);
const origin='http://127.0.0.1:4194',owner={embeddingId:'adoption-demo-alpha',audienceId:'public',audienceIds:['public'],role:'maintainer',origin},sessions=[],checks=[];
const snapshot={revision:1,path:'/customer',fields:[{ref:'r1f0',key:'company_name',label:'Company name',type:'text'}],links:[]};
async function post(path,input,session,expected=200){const response=await fetch(new URL(path,demo.serviceUrl),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.sessionToken}`}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(60_000)});assert.equal(response.status,expected,path);return response.json();}
try{
 const a=await post('v1/sessions',demo.embeddings[0]),b=await post('v1/sessions',demo.embeddings[0]),c=await post('v1/sessions',demo.embeddings[1]);sessions.push(a,b,c);
 await post('v1/learning/observe',{snapshot,role:'maintainer'},b,403);
 const grant=grants.issue(owner);await post('v1/coaching/exchange',{code:grant.code},c,403);await post('v1/coaching/exchange',{code:grant.code},a);await post('v1/coaching/exchange',{code:grant.code},b,403);await post('v1/learning/observe',{snapshot},a);
 checks.push('one-use coaching, exact embedding and visitor inspection denial');
 const scan=await post('v1/discovery/start',{seed:'/customer',paths:['/customer','/note'],maxPages:2},a);
 await post('v1/discovery/next',{id:scan.id,hasUnsavedWork:false},b,403);await post('v1/discovery/next',{id:scan.id,hasUnsavedWork:false},a);
 await post('v1/discovery/observe',{id:scan.id,snapshot:{...snapshot,links:[{ref:'r1n0',label:'Note',path:'/note'}],blockedCount:1}},a);
 await post('v1/discovery/pause',{id:scan.id},a);await post('v1/discovery/resume',{id:scan.id},a);assert.equal((await post('v1/discovery/next',{id:scan.id,hasUnsavedWork:false},a)).next.path,'/note');
 await post('v1/discovery/stop',{id:scan.id},a);checks.push('scoped persistent discovery protocol, pause/resume and read-only frontier; browser navigation not executed');
 const draft=learning.create(owner,{title:'Cedar reusable customer draft',steps:[{action:'fill',path:'/customer',field:'company_name',parameter:'company'}]});
 assert.equal((await post('v1/recipes',{},b)).recipes.some(r=>r.id===draft.id),false);learning.validate(owner,{id:draft.id,version:1});assert.equal((await learning.publish(owner,{id:draft.id,version:1,reviewed:true})).indexed,true);
 const pack=learning.export(owner,{id:draft.id}),request={id:draft.id,version:2,snapshot};
 const pa=await post('v1/recipe/plan',{...request,parameters:{company:'Cedar A'}},a),pb=await post('v1/recipe/plan',{...request,parameters:{company:'Cedar B'}},b);assert.equal(pa.actions[0].value,'Cedar A');assert.equal(pb.actions[0].value,'Cedar B');
 await post('v1/approve',{id:pa.id,revision:1,approved:true},b,403);await post('v1/approve',{id:pa.id,revision:1,approved:true},a);await post('v1/approve',{id:pa.id,revision:1,approved:true},a,403);
 checks.push('separate parameter reviews, foreign approval denial and one-use approval');
 learning.repair(owner,{id:draft.id,version:2,steps:[{action:'fill',path:'/customer',field:'renamed_company',parameter:'company'}]});await post('v1/approve',{id:pb.id,revision:1,approved:true},b,403);assert.equal(learning.validate(owner,{id:draft.id,version:3}).compatible,false);
 assert.equal((await knowledge.retrieve(owner,{query:'Cedar reusable customer draft'})).evidence.filter(e=>knowledge.inspect(owner,e.sourceId).recipeBinding?.id===draft.id).length,0);
 checks.push('drift blocks publication/stale approvals and revokes obsolete summary retrieval');
 const target={...owner,embeddingId:'adoption-demo-beta'},targetCode=grants.issue(target);await post('v1/coaching/exchange',{code:targetCode.code},c);await post('v1/learning/observe',{snapshot:{...snapshot,path:'/clients'}},c);
 const imported=learning.import(target,{package:pack,operationId:`CedarImport${Date.now()}`,routes:{'/customer':'/clients'}});learning.validate(target,{id:imported.id,version:1});assert.equal((await learning.publish(target,{id:imported.id,version:1,reviewed:true})).indexed,true);
 const guide=await post('v1/recipe/plan',{id:imported.id,version:2,parameters:{company:'Cedar target'},snapshot:{...snapshot,path:'/clients'},mode:'guide'},c);assert.ok(guide.actions.every(action=>action.type==='highlight'&&!Object.hasOwn(action,'value')));assert.equal((await post('v1/recipes',{},b)).recipes.some(r=>r.id===imported.id),false);
 checks.push('mapped target-owned import, independent summary indexing and non-writing guide mode');
 // Restore a compatible published alpha workflow for UAT; historical versions remain immutable.
 learning.repair(owner,{id:draft.id,version:3,steps:[{action:'fill',path:'/customer',field:'company_name',parameter:'company'}]});await post('v1/learning/observe',{snapshot},a);learning.validate(owner,{id:draft.id,version:4});await learning.publish(owner,{id:draft.id,version:4,reviewed:true});
 const result={build:process.env.ADOPTION_BUILD||'unknown',kind:'live-api-with-trusted-synthetic-setup',checks,recipeIds:{alpha:draft.id,beta:imported.id},browserActionsExecuted:false,fullPhaseCertification:false};writeFileSync('/data/learning-acceptance-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{for(const session of sessions)try{await post('v1/terminate',{},session);}catch{}repository.close();}

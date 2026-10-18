import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
import {createKnowledgeService} from '../src/knowledge-service.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createManagement} from '../src/management.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createSourceMap} from '../src/source-map.mjs';

test('management pages reach records beyond legacy caps without crossing owner, website or content audience',async()=>{
 const repository=openRepository();try{
  const owner={id:'owner',organizationId:'owner-a',role:'owner'},scope={embeddingId:'site-000',audienceId:'public',audienceIds:['public'],role:'maintainer'},control=createControlPlane(repository,new SessionAuthority({repository}));
  repository.transaction(()=>{for(let n=0;n<160;n++){const id=`site-${String(n).padStart(3,'0')}`;repository.map('websites').set(id,{id,origin:`https://site${n}.example`,organizationId:owner.organizationId,status:'approved',verified:true,challengeHash:'PRIVATE_PROOF',environment:'staging'});repository.map('sources').set(id,{id,embeddingId:scope.embeddingId,audienceIds:['public'],title:`Source ${n}`,createdAt:n,status:'deleted',text:'PRIVATE_TEXT',sections:[{text:'PRIVATE_TEXT'}],uploadedBySessionId:'PRIVATE_SESSION'});repository.map('recipes').set(id,{id,scope:'site-000:public',versions:[{title:'Old',version:1,status:'draft'},{title:`Workflow ${n}`,version:2,status:'draft',updatedAt:n,steps:[]}]});repository.map('screen_maps').set(id,{embeddingId:scope.embeddingId,audienceId:'public',path:`/page-${String(n).padStart(3,'0')}`,fields:[]});repository.map('management_audit').set(id,{websiteId:scope.embeddingId,action:'test',at:n});}
   repository.map('websites').set('foreign',{id:'foreign',origin:'https://foreign.example',organizationId:'owner-b',challengeHash:'FOREIGN_PROOF'});repository.map('sources').set('foreign',{id:'foreign',embeddingId:'foreign',audienceIds:['public'],title:'FOREIGN_SOURCE'});repository.map('sources').set('tenant',{id:'tenant',embeddingId:scope.embeddingId,audienceIds:['tenant-only'],title:'PRIVATE_TENANT'});repository.map('recipes').set('foreign',{id:'foreign',scope:'foreign:public',versions:[{title:'FOREIGN_WORKFLOW'}]});repository.map('screen_maps').set('foreign',{embeddingId:scope.embeddingId,audienceId:'private',path:'/PRIVATE_PAGE'});
  });
  const knowledge=createKnowledgeService(repository,{}),learning=createLearningRuntime(repository,createLearningStore(repository)),call=createManagement({authenticate:async()=>owner,control,knowledge,learning,platformOrigin:'https://platform.example'}),request=(action,input={})=>call({origin:'https://platform.example',path:'/v1/manage/'+action,input:{id:scope.embeddingId,...input}});
  const sites=await request('website-page',{offset:150,limit:10});assert.equal(sites.websites.length,10);assert.equal(sites.pagination.total,160);assert.ok(!JSON.stringify(sites).includes('PRIVATE_PROOF'));assert.ok(!JSON.stringify(sites).includes('FOREIGN'));
  const sources=await request('source-page',{offset:150,limit:10});assert.equal(sources.sources.length,10);assert.equal(sources.pagination.total,160);assert.ok(!JSON.stringify(sources).includes('PRIVATE_'));assert.ok(!JSON.stringify(sources).includes('FOREIGN'));
  const recipes=await request('learning-page',{offset:150,limit:10});assert.equal(recipes.recipes.length,10);assert.equal(recipes.pagination.total,160);assert.ok(recipes.recipes.every(r=>r.version===2));assert.ok(!JSON.stringify(recipes).includes('Old'));
  const maps=await request('learning-map-page',{offset:150,limit:10});assert.equal(maps.screens.length,10);assert.equal(maps.pagination.total,160);assert.ok(!JSON.stringify(maps).includes('PRIVATE_PAGE'));
  assert.equal((await request('source-page',{query:'Source 159'})).sources[0].title,'Source 159');assert.equal((await request('source-page',{query:'%'})).pagination.total,0);
  for(const action of ['website-page','source-page','learning-page','learning-map-page'])for(const input of [{offset:-1},{limit:101},{offset:1.5},{query:'x'.repeat(201)}])await assert.rejects(()=>request(action,input));
  await assert.rejects(()=>request('source-page',{id:'foreign'}));await assert.rejects(()=>request('audit-page'));
  const audit=control.auditPage({...owner,role:'platform_admin'},scope.embeddingId,{offset:150,limit:10});assert.equal(audit.events.length,10);assert.equal(audit.events[0].at,9);
 }finally{repository.close();}
});

test('authenticated management budgets are per trusted actor and cannot be reset by input identities',async()=>{
 let actor={id:'one',organizationId:'org',role:'owner'};
 const call=createManagement({authenticate:async()=>actor,platformOrigin:'https://platform.example',capacity:{managementPerActor:2},control:{page:()=>({websites:[]})}}),request=input=>call({origin:'https://platform.example',path:'/v1/manage/website-page',input});
 await request({});await request({});await assert.rejects(()=>request({actor:{id:'forged'}}),/rate exceeded/);actor={...actor,id:'two'};await request({});
});

test('reviewed hints, audit, installation and workflow histories expose bounded subsequent pages',async()=>{
 const repository=openRepository();try{
  const actor={id:'admin',organizationId:'org',role:'platform_admin'},id='history-site',origin='https://history.example',authority=new SessionAuthority({repository}),control=createControlPlane(repository,authority),sourceMap=createSourceMap(repository),learning=createLearningRuntime(repository,createLearningStore(repository));
  repository.map('websites').set(id,{id,origin,organizationId:'org',status:'approved',verified:true,installations:[]});for(let n=0;n<130;n++)authority.registerApproved({embeddingId:id,origins:[origin],expiresAt:Date.now()+3600000});
  sourceMap.refresh(control.scope(actor,id),{schema:1,reviewed:true,origin,screens:Array.from({length:160},(_,n)=>({path:'/page-'+n,title:'Page '+n,forms:[],fields:[]}))});
  repository.map('recipes').set('history',{id:'history',scope:id+':public',versions:Array.from({length:160},(_,n)=>({version:n+1,title:'History',status:'draft',steps:[],updatedAt:n}))});
  const handler=createManagement({authenticate:async()=>actor,control,learning,sourceMap,platformOrigin:origin}),call=(action,input={})=>handler({origin,path:'/v1/manage/'+action,input:{id,offset:125,limit:10,...input}});
  const tokens=await call('token-page');assert.equal(tokens.tokens.length,5);assert.equal(tokens.pagination.total,130);assert.ok(!JSON.stringify(tokens).includes('dac_install_'));
  const hints=await call('source-map-page');assert.equal(hints.screens.length,10);assert.equal(hints.pagination.total,160);assert.equal(hints.counts.screens,160);
  const versions=await call('learning-version-page',{recipeId:'history'});assert.equal(versions.versions.length,10);assert.equal(versions.versions[0].version,35);assert.equal(versions.pagination.total,160);
 }finally{repository.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementIdentity} from '../src/management-identity.mjs';
import {createManagement} from '../src/management.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {openRepository} from '../src/repository.mjs';
import {createSourceMap} from '../src/source-map.mjs';
test('management identity comes only from validated platform response and fails closed',async()=>{
 let role='ceo',ok=true;
 const authenticate=createManagementIdentity({platformOrigin:'https://platform.example',fetchImpl:async(url,options)=>{
  assert.equal(url.href,'https://platform.example/api/auth/me');assert.equal(options.redirect,'error');return {ok,json:async()=>({user:{id:'owner',role,enabled:true}})};
 }});
 const header='Bearer '+'a'.repeat(64);
 assert.equal((await authenticate(header)).role,'owner');
 role='org_user';await assert.rejects(()=>authenticate(header));role='admin';assert.equal((await authenticate(header)).role,'platform_admin');
 ok=false;await assert.rejects(()=>authenticate(header));await assert.rejects(()=>authenticate('Bearer dac_install_fake'));
});
test('management routes enforce origin, ownership, approval and sharing consent before indexing',async()=>{
 const repository=openRepository();let dns='';
 try{
  const control=createControlPlane(repository,new SessionAuthority({repository}),{dns:async()=>[[dns]]});
  const owner={id:'a',organizationId:'a',role:'owner'},foreign={id:'b',organizationId:'b',role:'owner'},admin={id:'admin',organizationId:'platform',role:'platform_admin'};
  let actor=owner;const indexed=[],temporary=[];
  const handler=createManagement({platformOrigin:'https://platform.example',authenticate:async()=>actor,control,sourceMap:createSourceMap(repository),search:{provision:async id=>indexed.push(id),privateTasks:{provision:async id=>temporary.push(id)}},knowledge:{list:scope=>[{owner:scope.embeddingId}],createText:()=>({id:'source'}),ingest:async()=>{}}});
  const call=(action,input={})=>handler({origin:'https://platform.example',path:'/v1/manage/'+action,input});
  const registered=await call('register',{origin:'https://customer.example',environment:'staging'});
  await assert.rejects(()=>call('activate',{id:registered.id}));assert.deepEqual(indexed,[]);assert.deepEqual(temporary,[]);dns=registered.dnsValue;await call('verify',{id:registered.id});
  actor=foreign;assert.equal((await call('websites')).websites.length,0);await assert.rejects(()=>call('sources',{id:registered.id}));
  await assert.rejects(()=>call('approve',{id:registered.id,role:'platform_admin'}));
  actor=admin;await assert.rejects(()=>call('approve',{id:registered.id}));await call('approve',{id:registered.id,reason:'Synthetic acceptance approval'});actor=owner;
  await call('activate',{id:registered.id});assert.deepEqual(indexed,[registered.id,registered.id]);assert.deepEqual(temporary,[registered.id,registered.id]);
  await call('source-map-refresh',{id:registered.id,manifest:{schema:1,origin:'https://customer.example',reviewed:true,screens:[{path:'/new',title:'New form',forms:[],fields:[]}]}});
  assert.equal((await call('source-map',{id:registered.id})).counts.screens,1);actor=foreign;await assert.rejects(()=>call('source-map',{id:registered.id}));await assert.rejects(()=>call('source-map-refresh',{id:registered.id,manifest:{}}));actor=owner;
  await assert.rejects(()=>call('source-text',{id:registered.id,title:'Synthetic',text:'data'}));
  assert.equal((await call('source-text',{id:registered.id,title:'Synthetic',text:'data',sharedConsent:true})).status,'ready');
  await assert.rejects(()=>handler({origin:'https://foreign.example',path:'/v1/manage/websites',input:{}}));
 }finally{repository.close();}
});

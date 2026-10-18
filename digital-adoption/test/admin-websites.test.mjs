import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
import {createManagement} from '../src/management.mjs';

test('platform website inventory spans owners beyond legacy 100 rows with bounded paging and no secrets',()=>{
 const repository=openRepository();try{
 const plane=createControlPlane(repository,new SessionAuthority({repository})),admin={id:'synthetic-admin',organizationId:'platform',role:'platform_admin'},owners=['owner-one','owner-two'].map(id=>({id,organizationId:id,role:'owner'}));
 const registered=[];for(let i=0;i<130;i++)registered.push(plane.register(owners[i%2],{origin:`https://w${String(i).padStart(3,'0')}.synthetic.test`,environment:'staging'}));
 plane.configure(owners[0],registered[0].id,{taskPolicy:{attachments:true,actionBindings:[{id:'synthetic-binding',path:'/form',label:'PRIVATE_BINDING_CANARY',family:'write_internal'}]}});
 const first=plane.inventory(admin),last=plane.inventory(admin,{offset:125,limit:25});assert.equal(first.summary.total,130);assert.equal(first.summary.owners,2);assert.equal(first.pagination.total,130);assert.equal(first.websites.length,25);assert.equal(first.pagination.hasNext,true);assert.equal(last.websites.length,5);assert.equal(last.pagination.hasNext,false);assert.equal(last.pagination.hasPrevious,true);
 assert.equal(first.websites[0].capabilities.attachments,true);assert.equal(first.websites[0].ownerId,'owner-one');assert.equal(JSON.stringify(first).includes('PRIVATE_BINDING_CANARY'),false);assert.equal(JSON.stringify(first).includes('challengeHash'),false);assert.equal(JSON.stringify(first).includes(registered[0].dnsValue),false);assert.equal(JSON.stringify(first).includes('installations"'),false);
 assert.equal(plane.inventory(admin,{query:'w129'}).websites.length,1);assert.equal(plane.inventory(admin,{query:'owner-two'}).pagination.total,65);assert.equal(plane.inventory(admin,{status:'approved'}).websites.length,0);
 for(const input of [{limit:101},{offset:-1},{status:'invalid'},{query:'x'.repeat(201)}])assert.throws(()=>plane.inventory(admin,input));
 assert.throws(()=>plane.inventory(owners[0],{role:'platform_admin'}));assert.throws(()=>plane.list(owners[0],{id:registered[1].id}));assert.equal(plane.list(admin,{id:registered[129].id})[0].id,registered[129].id);
 }finally{repository.close();}
});

test('management inventory requires authenticated platform admin rather than request-supplied role or owner cookie',async()=>{
 const repository=openRepository();try{
 const plane=createControlPlane(repository,new SessionAuthority({repository}));let actor={id:'owner',organizationId:'owner',role:'owner'};
 const handler=createManagement({platformOrigin:'https://platform.example',authenticate:async()=>actor,control:plane});const call=input=>handler({origin:'https://platform.example',path:'/v1/manage/admin-websites',input});
 await assert.rejects(()=>call({role:'platform_admin'}));actor={id:'admin',organizationId:'platform',role:'platform_admin'};assert.equal((await call({})).scope,'platform');await assert.rejects(()=>handler({origin:'https://foreign.example',path:'/v1/manage/admin-websites',input:{}}));
 }finally{repository.close();}
});

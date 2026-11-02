import assert from 'node:assert/strict';
import express from 'express';
import {PhysicalControlPlane} from '../src/services/physical/control-plane.js';
import {physicalApiRouter} from '../src/routes/physical-api.js';
import {profile} from '../src/services/physical/contracts.js';
const p=new PhysicalControlPlane({load:()=>null,save:()=>{}}),h=p.enroll('company',{siteId:'site',name:'hub'});const lamp=profile('lamp');lamp.actions.set_state.output={version:1,schema:{type:'object',properties:{lamp_state:{type:'boolean'}},required:['lamp_state']},bindings:{lamp_state:{source:'observation_value'}}};p.discover(h.hubId,[lamp]);const e=p.register('company',{hubId:h.hubId,candidateId:'lamp',actions:{set_state:'approval_required'}});p.setEntitlements('company',e.id,{grants:[{principal:'user:operator',discover:true,actions:['set_state']},{principal:'user:viewer',discover:true,actions:[]}]});
const app=express();app.use(express.json());app.use('/physical',physicalApiRouter({plane:p,auth:[(req,res,next)=>{req.authUser={id:req.headers['x-user'],role:req.headers['x-user']==='company'?'ceo':'org_user'};next();}],owner:()=> 'company'}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
async function request(user,path='',method='GET',body){const r=await fetch('http://127.0.0.1:'+server.address().port+'/physical'+path,{method,headers:{'x-user':user,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
try{
 assert.equal((await request('outsider')).body.entities.length,0);assert.equal((await request('outsider','/view?resource=devices')).body.total,0);assert.equal((await request('operator','/view?pageSize=101')).status,400);assert.equal((await request('viewer','/view?owner_user_id=other')).body.total,1);assert.equal((await request('viewer')).body.entities.length,1);assert.equal((await request('viewer','/hubs/'+h.hubId+'/configuration')).status,403);
 assert.equal((await request('operator','/entities/'+e.id+'/workflow-contract?action=set_state')).body.ports.find(p=>p.id==='lamp_state').type,'boolean');assert.equal((await request('viewer','/entities/'+e.id+'/workflow-contract?action=set_state')).status,403);assert.equal((await request('outsider','/entities/'+e.id+'/workflow-contract?action=set_state')).status,403);assert.equal((await request('company','/entities/other-company-device/workflow-contract?action=set_state')).status,404);
 const args={entityId:e.id,action:'set_state',input:{on:true},idempotencyKey:'request-one'};
 assert.equal((await request('viewer','/operations','POST',args)).status,403);const op=await request('operator','/operations','POST',args);assert.equal(op.status,200);assert.equal(op.body.status,'awaiting_approval');
 assert.equal((await request('operator','/operations/'+op.body.id+'/approve','POST',{allow:true})).status,403);assert.equal((await request('outsider','/operations/'+op.body.id)).status,403);assert.equal((await request('operator','/entities/'+e.id+'/entitlements','PUT',{grants:[]})).status,403);
 assert.equal((await request('company','/operations/'+op.body.id+'/approve','POST',{allow:false})).body.status,'denied');
 assert.deepEqual((await request('operator')).body.hubs[0].candidates,[]);
 console.log('PHYSICAL_RESOURCE_API_PASS: member discover/invoke/read isolation; owner-only approvals, mapping and grant administration; no hidden hub candidate leakage.');
}finally{await new Promise(r=>server.close(r));}

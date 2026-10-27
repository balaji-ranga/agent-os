import assert from 'node:assert/strict';
import express from 'express';
import {createFloAssistManagementRouter} from '../src/routes/floassist-management.js';
const calls=[];const service=()=>({
 publicConfig:()=>({connectors:[{id:'gmail',label:'Gmail'}]}),
 view:owner=>{if(owner==='new')throw Object.assign(Error('No profile'),{status:404});return {status:'active',preferences:{connectors:['gmail']},phone:'fixture',owner};},
 connections:owner=>[{id:'gmail',connected:true,owner}],
 save:(owner,p)=>{calls.push({owner,kind:'save'});return {preferences:p};},
 connect:(owner,provider)=>{calls.push({owner,provider,kind:'connect'});return {authorization_url:'https://example.test/oauth'};},
 qr:(owner,operation)=>{calls.push({owner,operation,kind:'qr'});return {connected:true};},
});
const app=express();app.use(express.json());app.use('/manage',createFloAssistManagementRouter({service,auth:[(_req,_res,next)=>next()],resolveOwner:req=>req.headers['x-fixture-owner']}));
app.use('/protected',createFloAssistManagementRouter({service}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const request=(path,method='GET',body,owner='owner-a')=>fetch(base+path,{method,headers:{'content-type':'application/json',...(owner?{'x-fixture-owner':owner}:{})},...(body?{body:JSON.stringify(body)}:{})});
try{
 assert.equal((await request('/manage','GET',null,null)).status,403);
 assert.equal((await request('/protected')).status,401,'production middleware rejects unauthenticated access');
 const me=await request('/manage?owner_id=owner-b');assert.equal(me.headers.get('cache-control'),'no-store');assert.equal((await me.json()).owner,'owner-a');
 assert.equal((await (await request('/manage/connections?owner_id=owner-b')).json())[0].owner,'owner-a');
 assert.equal((await (await request('/manage','GET',null,'new')).json()).enrolled,false);
 await request('/manage/preferences','PUT',{owner_id:'owner-b',connectors:['gmail']});
 await request('/manage/connections/gmail','POST',{owner_id:'owner-b'});
 await request('/manage/whatsapp/start','POST',{owner_id:'owner-b'});
 await request('/manage/whatsapp/wait','POST',{});
 assert.ok(calls.every(c=>c.owner==='owner-a'),'request body/query cannot select a different owner');
 assert.ok(calls.some(c=>c.kind==='connect'&&c.provider==='gmail'));
 assert.ok(calls.some(c=>c.kind==='qr'&&c.operation==='start'));
 console.log('FLOASSIST_MANAGEMENT_OK: authenticated owner only, cross-owner input ignored, no-store, profile setup and existing connector/QR services');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}

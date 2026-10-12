// Opt-in synthetic live-model smoke check; no customer records or credentials printed.
import { chatCompletions } from '../src/config/llm.js';
import { COPILOT_FORMS, validateCopilotProposal } from '../src/services/ui-copilot-contract.js';
import express from 'express';
import Database from 'better-sqlite3';
import { uiCopilotRouter } from '../src/routes/ui-copilot.js';
import assert from 'node:assert/strict';
const owner=process.env.COPILOT_TEST_OWNER;
if(!owner)throw new Error('COPILOT_TEST_OWNER required');
const catalog={forms:COPILOT_FORMS,screens:[{id:'master-data',label:'Knowledge',route:'/master-data'}],agents:[]};
const reply=await chatCompletions({ownerUserId:owner,toolName:'platform_help_ui_copilot',maxTokens:1600,temperature:0,responseFormat:{type:'json_object'},messages:[{role:'system',content:'Return JSON {message:string,actions:[{type:"fill",form:"knowledge_source",values:allowedPatch}]}. Use only fields in catalog.'},{role:'user',content:JSON.stringify({request:'Prepare a Knowledge source named Copilot synthetic test, content folder generated only, every 10 minutes, disabled and hidden from search. Do not save.',catalog})}]});
console.log(JSON.stringify({model:reply.modelUsed,finishReason:reply.finishReason,content:reply.content}));
validateCopilotProposal(JSON.parse(reply.content),catalog);
console.log('COPILOT_LIVE_MODEL_PASS');
const db=new Database(':memory:');
const app=express();app.use(express.json());app.use((req,res,next)=>{req.authUser={id:owner,role:'ceo'};next();});
app.use('/copilot',uiCopilotRouter({database:()=>db,getCatalog:()=>catalog,complete:async options=>{const result=await chatCompletions(options);console.log(JSON.stringify({routeResponse:result.content,finishReason:result.finishReason}));return result;}}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try{
 const base=`http://127.0.0.1:${server.address().port}/copilot`;
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const s=(await post('/session',{origin:'/'})).body;
 const result=await post(`/session/${s.id}/propose`,{version:s.version,message:'Prepare a Knowledge source named Copilot synthetic test for the Flolah content folder, generated content only, every 10 minutes. Keep synchronization disabled and hidden from search. Do not save.'});
 console.log(JSON.stringify({routeStatus:result.status,error:result.body.error}));
 if(result.status!==200)throw new Error('Live Copilot route failed');
 const patch=Object.assign({},...result.body.proposal.actions.filter(a=>a.type==='fill'&&a.form==='knowledge_source').map(a=>a.values));
 assert.equal(patch.name,'Copilot synthetic test');assert.equal(patch.kind,'content');assert.deepEqual(patch.collections,['generated']);
 assert.equal(patch.interval_seconds,600);assert.equal(patch.enabled,false);assert.equal(patch.retrieval_enabled,false);
 console.log('COPILOT_LIVE_ROUTE_PASS');
}finally{await new Promise(r=>server.close(r));db.close();}

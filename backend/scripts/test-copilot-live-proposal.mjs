// Opt-in synthetic live-model acceptance; no business records or production
// Copilot sessions are written. Run against the configured tenant LLM route.
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
const {uiCopilotRouter}=await import(process.env.COPILOT_TEST_ROUTER||'../src/routes/ui-copilot.js');
import {chatCompletions} from '../src/config/llm.js';
const owner=process.env.COPILOT_TEST_OWNER;
if(!owner)throw Error('Set COPILOT_TEST_OWNER to an explicitly authorized test tenant.');
const db=new Database(':memory:');
const app=express();app.use(express.json());
app.use((req,res,next)=>{req.authUser={id:owner,role:'ceo'};next();});
app.use('/test',uiCopilotRouter({database:()=>db,getCatalog:()=>({forms:{},agents:[],screens:[{id:'erp',route:'/erp'}]}),complete:async options=>{
  const context=options.messages.map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).find(m=>m?.available_embedded_fields);
  assert.deepEqual(context.available_embedded_fields,['name']);
  assert.match(options.messages[0].content,/Current available reviewed embedded edit capability/);
  const result=await chatCompletions(options);
  console.log(JSON.stringify({model:result.modelUsed,proposal:JSON.parse(result.content)}));
  return result;
}}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/test`;
try{
 let response=await fetch(base+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:'/erp'})});
 const session=await response.json();assert.equal(response.status,200);
 response=await fetch(base+`/session/${session.id}/propose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:session.version,screen:'erp',embedded_fields:['name'],embedded_field_labels:{name:'ID'},message:'Please clear the invoice ID list filter back to empty. Prepare that one field for review. Leave all invoices unchanged.'})});
 const result=await response.json();assert.equal(response.status,200);
 assert.deepEqual(result.proposal.actions,[{type:'embed_fill',screen:'erp',values:{name:''}}]);
 console.log('PASS live synthetic natural-language ERP proposal; no business data changed.');
}finally{await new Promise(r=>server.close(r));db.close();}

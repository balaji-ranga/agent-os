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
app.use('/test',uiCopilotRouter({database:()=>db,...(process.env.COPILOT_TEST_FULL_CATALOG==='1'?{}:{getCatalog:()=>({forms:{},agents:[],screens:[{id:'erp',route:'/erp'}]})}),complete:async options=>{
  const context=options.messages.map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).find(m=>m?.available_embedded_fields);
  if(process.env.COPILOT_TEST_CONNECTOR!=='1'){
    assert.deepEqual(context.available_embedded_fields,['name']);
    assert.match(options.messages[0].content,/Current available reviewed embedded edit capability/);
  }
  if(process.env.COPILOT_TEST_FORCE_RECHECK==='1'&&options.messages.some(m=>m.content.includes('previous_proposal'))){
    return {content:JSON.stringify({message:'This input requires manual entry.',actions:[]})};
  }
  const result=await chatCompletions(options);
  console.log(JSON.stringify({model:result.modelUsed,proposal:JSON.parse(result.content)}));
  return result;
}}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/test`;
try{
 let response=await fetch(base+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:'/erp'})});
 const session=await response.json();assert.equal(response.status,200);
 if(process.env.COPILOT_TEST_STALE_HISTORY==='1'){
   const row=db.prepare('SELECT state FROM ui_copilot_sessions WHERE id=?').get(session.id);
   const state=JSON.parse(row.state);
   state.conversation=Array.from({length:3},()=>[
     {role:'user',text:'Clear the invoice ID filter back to empty.'},
     {role:'assistant',text:'I cannot directly clear the Invoice ID filter as it requires manual input. Please open the Invoice ID field in the ERP screen.'},
   ]).flat();
   state.proposal={message:state.conversation.at(-1).text,actions:[]};
   db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(state),session.id);
 }
 let version=session.version;
 const cases=process.env.COPILOT_TEST_CONNECTOR==='1'?[
   ['I am on Connectors now. Explain the next Google Drive setup steps only. Keep authorization deferred and do not create or rotate tokens.',null],
 ]:[
   ['Set the invoice ID filter to COPILOT-NO-MATCH. Prepare it for review without changing any invoice.','COPILOT-NO-MATCH'],
   ['Please clear the invoice ID list filter back to empty. Prepare that one field for review. Leave all invoices unchanged.',''],
 ];
 for(const [message,value] of cases){
   const connector=process.env.COPILOT_TEST_CONNECTOR==='1';
   response=await fetch(base+`/session/${session.id}/propose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,screen:connector?'connectors':'erp',embedded_fields:connector?[]:['name'],embedded_field_labels:{name:'ID'},message})});
   const result=await response.json();assert.equal(response.status,200);
   if(connector)assert.deepEqual(result.proposal.actions,[]);
   else assert.deepEqual(result.proposal.actions,[{type:'embed_fill',screen:'erp',values:{name:value}}]);
   version=result.version;
 }
 console.log('PASS live synthetic natural-language '+(process.env.COPILOT_TEST_CONNECTOR==='1'?'connector guidance':'ERP set/clear')+'; no business data changed.');
}finally{await new Promise(r=>server.close(r));db.close();}

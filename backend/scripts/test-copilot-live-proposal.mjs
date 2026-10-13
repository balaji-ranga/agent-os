// Opt-in synthetic live-model acceptance; no business records or production
// Copilot sessions are written. Run against the configured tenant LLM route.
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
const {uiCopilotRouter}=await import(process.env.COPILOT_TEST_ROUTER||'../src/routes/ui-copilot.js');
import {chatCompletions} from '../src/config/llm.js';
import {copilotScreenControls} from '../src/services/ui-copilot-screen-specs.js';
const searchControl=copilotScreenControls('/content-tools').find(c=>c.label==='Search tools registry');
const eventMode=process.env.COPILOT_TEST_EVENT==='1';
const policyMode=process.env.COPILOT_TEST_POLICY==='1';
const marketingMode=process.env.COPILOT_TEST_MARKETING==='1';
const marketingControls=copilotScreenControls('/marketing').filter(c=>['Campaign name','Outcome goal','Content topics'].includes(c.label));
const marketingField=label=>marketingControls.find(c=>c.label===label).id;
const eventControls=copilotScreenControls('/connectors').filter(c=>['Subscription name','Event provider','Event type','Enable provider listener'].includes(c.label));
const eventField=label=>eventControls.find(c=>c.label===label).id;
const eventOptions={[eventField('Event provider')]:[{label:'Published calendar URL (ICS)',value:'calendar_url'},{label:'Google Workspace',value:'google_workspace'}],[eventField('Event type')]:[{label:'Calendar event changed',value:'calendar.event.changed'}]};
const owner=process.env.COPILOT_TEST_OWNER;
if(!owner)throw Error('Set COPILOT_TEST_OWNER to an explicitly authorized test tenant.');
const db=new Database(':memory:');
const app=express();app.use(express.json());
app.use((req,res,next)=>{req.authUser={id:owner,role:'ceo'};next();});
app.use('/test',uiCopilotRouter({database:()=>db,...(process.env.COPILOT_TEST_FULL_CATALOG==='1'?{}:{getCatalog:()=>({forms:{},agents:[],screens:[{id:'erp',route:'/erp'}]})}),complete:async options=>{
  const context=options.messages.map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).find(m=>m?.available_embedded_fields||m?.fields);
  if(!policyMode&&!marketingMode&&!eventMode&&process.env.COPILOT_TEST_CONNECTOR!=='1'&&process.env.COPILOT_TEST_SEARCH!=='1'){
    assert.deepEqual(context.available_embedded_fields||context.fields.map(f=>f.id),['name']);
    assert.match(options.messages[0].content,/Current available reviewed embedded edit capability|available embedded form/);
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
 if(process.env.COPILOT_TEST_MODE==='guided'){
   const row=db.prepare('SELECT state FROM ui_copilot_sessions WHERE id=?').get(session.id);
   const state=JSON.parse(row.state);state.mode='guided';db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(state),session.id);
 }
 if(process.env.COPILOT_TEST_STALE_HISTORY==='1'){
   const row=db.prepare('SELECT state FROM ui_copilot_sessions WHERE id=?').get(session.id);
   const state=JSON.parse(row.state);
   state.conversation=Array.from({length:3},()=>[
     {role:'user',text:'Clear the invoice ID filter back to empty.'},
     {role:'assistant',text:'I cannot directly clear the Invoice ID filter as it requires manual input. Please open the Invoice ID field in the ERP screen.'},
   ]).flat();
   if(policyMode)state.conversation=[{role:'user',text:'Where is email approval policy?'},{role:'assistant',text:'Review Permitted email IDs for the approval policy.'}];
   state.proposal={message:state.conversation.at(-1).text,actions:[]};
   db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(state),session.id);
 }
 let version=session.version;
 if(process.env.COPILOT_TEST_SEARCH==='1'){
   const row=db.prepare('SELECT state FROM ui_copilot_sessions WHERE id=?').get(session.id);
   const state=JSON.parse(row.state);state.mode='autofill';
   state.conversation=[{role:'user',text:'Prepare a Knowledge document upload draft titled Copilot UAT guide with tags acceptance,copilot. Do not upload anything.'},{role:'assistant',text:'Shall I prepare those fields for review?'},{role:'user',text:'Open Research Analyst chat with an unsent draft about research capabilities.'},{role:'assistant',text:'Shall I prepare this draft?'},{role:'user',text:'I want to start a voice call with Research Analyst.'},{role:'assistant',text:'Please review Start call.'}];
   db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(state),session.id);
 }
 const cases=policyMode?[
   ['Explain where I review the external email approval policy on this screen. Guidance only: do not change any policy, permission or approval mode.',null],
 ]:marketingMode?[
   ['Prepare an unsaved campaign named Copilot UAT onboarding. Set outcome goal to Improve product onboarding awareness and content topics to onboarding, product education. Leave budgets, channels, audiences and scheduling unchanged. Guide me through these three fields only; do not save or launch.',null],
 ]:eventMode?[
   ['Prepare this Event subscription draft named Copilot UAT calendar, with provider Published calendar URL (ICS) and event Calendar event changed. Leave the listener off and do not create the subscription.'+(process.env.COPILOT_TEST_MODE==='guided'?' Guide me through filling each field.':''),null],
 ]:process.env.COPILOT_TEST_SEARCH==='1'?[
   ['Filter the Tools registry search to crm. Prepare the search field for review; do not change any tool configuration.','crm'],
 ]:process.env.COPILOT_TEST_CONNECTOR==='1'?[
   ['I am on Connectors now. Explain the next Google Drive setup steps only. Keep authorization deferred and do not create or rotate tokens.',null],
 ]:[
   ['Set the invoice ID filter to COPILOT-NO-MATCH. Prepare it for review without changing any invoice.','COPILOT-NO-MATCH'],
   ['Please clear the invoice ID list filter back to empty. Prepare that one field for review. Leave all invoices unchanged.',''],
 ];
 for(const [message,value] of cases){
   const connector=process.env.COPILOT_TEST_CONNECTOR==='1';
   const search=process.env.COPILOT_TEST_SEARCH==='1';
   response=await fetch(base+`/session/${session.id}/propose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,screen:policyMode?'policies':marketingMode?'marketing':search?'content-tools':connector||eventMode?'connectors':'erp',visible_control_ids:marketingMode?marketingControls.map(c=>c.id):eventMode?eventControls.map(c=>c.id):search?[searchControl.id]:[],visible_control_options:eventMode?eventOptions:{},embedded_fields:policyMode||marketingMode||connector||search||eventMode?[]:['name'],embedded_field_labels:{name:'ID'},message})});
   const result=await response.json();assert.equal(response.status,200);
   if(policyMode){assert.deepEqual(result.proposal.actions,[]);assert.match(result.proposal.message,/Action control/i);}
   else if(marketingMode){assert.equal(result.proposal.actions.length,1);assert.equal(result.proposal.actions[0].type,'screen_fill');assert.deepEqual(result.proposal.actions[0].values,{[marketingField('Campaign name')]:'Copilot UAT onboarding',[marketingField('Outcome goal')]:'Improve product onboarding awareness',[marketingField('Content topics')]:'onboarding, product education'});}
   else if(eventMode){assert.equal(result.proposal.actions.length,1);assert.equal(result.proposal.actions[0].type,'screen_fill');const values=result.proposal.actions.reduce((all,a)=>({...all,...a.values}),{});assert.equal(values[eventField('Subscription name')],'Copilot UAT calendar');assert.equal(values[eventField('Event provider')],'calendar_url');assert.equal(values[eventField('Event type')],'calendar.event.changed');assert.equal(values[eventField('Enable provider listener')],undefined);}
   else if(search){assert.equal(result.proposal.actions[0].type,'screen_fill');assert.equal(result.proposal.actions[0].values[searchControl.id],'crm');}
   else if(connector)assert.deepEqual(result.proposal.actions,[]);
   else assert.deepEqual(result.proposal.actions,[{type:'embed_fill',screen:'erp',values:{name:value}}]);
   version=result.version;
 }
 console.log('PASS live synthetic natural-language '+(policyMode?'policy guidance':marketingMode?'Marketing draft':eventMode?'event draft':process.env.COPILOT_TEST_SEARCH==='1'?'Tools search':process.env.COPILOT_TEST_CONNECTOR==='1'?'connector guidance':'ERP set/clear')+'; no business data changed.');
}finally{await new Promise(r=>server.close(r));db.close();}

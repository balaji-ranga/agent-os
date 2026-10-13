// Opt-in synthetic live-model test. Only in-memory Copilot sessions are written.
// Can run from /tmp on a deployed backend without modifying its application.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.COPILOT_BACKEND_ROOT||resolve(import.meta.dirname,'..');
const require=createRequire(resolve(root,'package.json'));
const express=require('express'),Database=require('better-sqlite3');
const {uiCopilotRouter}=await import(pathToFileURL(resolve(root,'src/routes/ui-copilot.js')));
const {chatCompletions}=await import(pathToFileURL(resolve(root,'src/config/llm.js')));
const {copilotScreenControls}=await import(pathToFileURL(resolve(root,'src/services/ui-copilot-screen-specs.js')));
const owner=process.env.COPILOT_TEST_OWNER;
assert(owner,'Specify the authorized demo tenant');
const db=new Database(':memory:'),app=express();
app.use(express.json());app.use((req,res,next)=>{req.authUser={id:owner,role:'ceo'};next();});
app.use('/test',uiCopilotRouter({database:()=>db,complete:async options=>{
  const response=await chatCompletions(options);
  // This harness contains only its synthetic prompt; never enable content logs
  // in the production route or replay real user history through this test.
  console.log(JSON.stringify({model:response.modelUsed,syntheticProposal:response.content}));
  return response;
}}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/test`;
try{
  const session=await (await fetch(base+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:'/'})})).json();
  if(process.env.COPILOT_TEST_STALE_HISTORY==='1'){
    const row=db.prepare('SELECT state FROM ui_copilot_sessions WHERE id=?').get(session.id),state=JSON.parse(row.state);
    state.mode='guided';state.conversation=[{id:'synthetic-user',role:'user',text:'Create a new daily goal draft that will query Apple shares prices from Yahoo Finance website. Assign this goal to COO agent.'},{id:'synthetic-assistant',role:'assistant',text:'Please provide the title and cadence.'}];
    state.proposal={message:'Please provide the title and cadence.',actions:[]};
    db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(state),session.id);
  }
  const response=await fetch(base+`/session/${session.id}/propose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:session.version,screen:'home',visible_control_ids:copilotScreenControls('/').map(f=>f.id),message:'Create a new daily goal draft that will query Apple shares prices from Yahoo Finance website. Assign this goal to COO agent.'})});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
  const draft=result.proposal.actions.find(a=>a.type==='fill'&&a.form==='scheduled_goal');
  assert(draft,'Expected a registered form draft, not current-screen substitution');
  assert.equal(draft.values.cadence,'daily');assert.match(draft.values.prompt,/Apple/i);assert.match(draft.values.prompt,/Yahoo/i);assert(draft.values.title);assert(draft.values.agent_id);assert.equal(draft.values.time_local,undefined,'Do not invent a run time');
  const followResponse=await fetch(base+`/session/${session.id}/propose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:result.version,reply_to:result.conversation.at(-1).id,message:'Run it at 10:30. Keep the other proposed details. Do not save or activate it.'})});
  const follow=await followResponse.json();assert.equal(followResponse.status,200,JSON.stringify(follow));
  assert.equal(follow.proposal.actions.find(a=>a.form==='scheduled_goal')?.values.time_local,'10:30');
  const tableResponse=await fetch(base+`/session/${session.id}/propose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:follow.version,screen:'home',message:'Create a new knowledge table for supplier contacts with columns Company, Contact name, Email. Recommend a descriptive name and purpose. Do not save it.'})});
  const table=await tableResponse.json();assert.equal(tableResponse.status,200,JSON.stringify(table));
  const tableDraft=table.proposal.actions.find(a=>a.form==='knowledge_table');assert(tableDraft?.values.name);assert(tableDraft.values.purpose);assert.match(tableDraft.values.columns,/Email/i);
  console.log('PASS synthetic live intent coverage; no goals saved or activated.');
}finally{await new Promise(r=>server.close(r));db.close();}

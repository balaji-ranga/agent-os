// Opt-in live model test: synthetic metadata and in-memory sessions only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.COPILOT_BACKEND_ROOT||resolve(import.meta.dirname,'..');
const require=createRequire(resolve(root,'package.json'));
const express=require('express'),Database=require('better-sqlite3');
const {uiCopilotRouter}=await import(pathToFileURL(resolve(root,'src/routes/ui-copilot.js')));
const {chatCompletions}=await import(pathToFileURL(resolve(root,'src/config/llm.js')));
const owner=process.env.COPILOT_TEST_OWNER;assert(owner);
const db=new Database(':memory:'),app=express();app.use(express.json());
app.use((req,res,next)=>{req.authUser={id:owner,role:'ceo'};next();});
app.use('/test',uiCopilotRouter({database:()=>db,complete:async options=>{const reply=await chatCompletions(options);console.log(JSON.stringify({syntheticProposal:reply.content}));return reply;}}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/test`,message='create a new opportunity with name Demo Test and value of USD 10000';
try{
 let s=await (await fetch(base+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:'/'})})).json();
 // Reproduce the real-chat contamination: unrelated previous scheduled goal.
 const oldState=JSON.parse(db.prepare('SELECT state FROM ui_copilot_sessions WHERE id=?').get(s.id).state);
 oldState.conversation=[{id:'old-goal',role:'user',text:'Create a daily goal to query Apple prices and assign COO. Run it at 10:30.'}];
 oldState.proposal={message:'Review daily goal',actions:[{type:'fill',form:'scheduled_goal',values:{title:'Apple prices',prompt:'Query Yahoo Finance',cadence:'daily',time_local:'10:30'}}]};
 db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(oldState),s.id);
 async function step(context){const response=await fetch(base+`/session/${s.id}/propose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:s.version,message,...context})});s=await response.json();assert.equal(response.status,200,JSON.stringify(s));return s.proposal.actions;}
 assert.deepEqual(await step({screen:'home'}),[{type:'navigate',screen:'crm',route:'/crm'}]);
 const path='/objects/opportunities?viewId=synthetic';
 assert.deepEqual(await step({screen:'crm',navigation_continuation:true,embedded_path:'/objects/companies',embedded_navigation:[{path,label:'Opportunities'}],embedded_forms:['Create new Company']}),[{type:'embed_navigate',screen:'crm',path}]);
 const formLabel=process.env.COPILOT_TEST_COMPACT==='1'?'Add New Opportunities':'Create new Opportunity';
 assert.deepEqual(await step({screen:'crm',navigation_continuation:true,embedded_path:path,embedded_navigation:[{path,label:'Opportunities'},{path:'/objects/companies',label:'Companies'}],embedded_forms:[formLabel]}),[{type:'embed_open_form',screen:'crm',label:formLabel}]);
 const actions=await step({screen:'crm',creation_continuation:true,embedded_path:'/object/opportunity/synthetic',embedded_fields:['name','amount','currency'],embedded_field_labels:{name:'Name',amount:'Amount',currency:'Currency'}});
 assert.deepEqual(actions,[{type:'embed_fill',screen:'crm',values:{name:'Demo Test',amount:'10000',currency:'USD'}}]);
 console.log('PASS exact opportunity prompt: home navigation, observed link, creation review, all three field values. No business records written.');
}finally{await new Promise(r=>server.close(r));db.close();}

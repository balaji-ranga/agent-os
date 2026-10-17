// Opt-in real-provider diagnostic; only the Copilot transcript uses an in-memory
// database. Never calls a profile/settings/save API or writes a customer session.
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {chatCompletions} from '../src/config/llm.js';
import {COPILOT_FORMS} from '../src/services/ui-copilot-contract.js';
import {copilotScreenControls} from '../src/services/ui-copilot-screen-specs.js';
const owner=process.env.COPILOT_TEST_OWNER;
if(!owner||process.env.COPILOT_LIVE_ACCEPTANCE!=='1')throw new Error('Explicit COPILOT_LIVE_ACCEPTANCE=1 and COPILOT_TEST_OWNER required');
const {uiCopilotRouter}=await import(process.env.COPILOT_TEST_ROUTER||'../src/routes/ui-copilot.js');
const db=new Database(':memory:');let modelCalls=0;const models=new Set();
let liveCatalog;
if(process.env.COPILOT_TEST_FULL_CATALOG==='1'){
 const {readFileSync}=await import('node:fs');const fixture=JSON.parse(readFileSync('/tmp/copilot-map-ui-acceptance.json'));
 const response=await fetch(fixture.origin+'/api/ui-copilot/catalog',{headers:{authorization:'Bearer '+fixture.token}});assert.equal(response.status,200);liveCatalog=await response.json();
}
const screens=liveCatalog?.screens||[{id:'profile',route:'/profile'},{id:'scheduled-goals',route:'/scheduled-goals'},{id:'connectors',route:'/connectors'},{id:'content-explorer',route:'/content-explorer'}];
const field=copilotScreenControls('/profile').find(c=>c.label==='Efficiency mode');assert(field);
const title=copilotScreenControls('/scheduled-goals').find(c=>c.label==='Title (optional)');assert(title);
const provider=copilotScreenControls('/connectors').find(c=>c.label==='Event provider');assert(provider);
const app=express();app.use(express.json());app.use((req,res,next)=>{req.authUser={id:owner,role:'ceo'};next()});
app.use('/test',uiCopilotRouter({database:()=>db,getCatalog:()=>liveCatalog||({forms:COPILOT_FORMS,screens,agents:[]}),complete:async req=>{modelCalls++;const result=await chatCompletions(req);models.add(result.modelUsed||result.actualModel||'configured-route');return result}}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/test`;
async function post(path,body){const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return{status:res.status,data:await res.json()};}
try{
 const cases=[
  {mode:'hybrid',screen:'profile',control:field.id,value:'no',options:[{value:'no',label:'No'},{value:'yes',label:'Yes'}],request:'Looking to update profile to make efficiency mode as No'},
  {mode:'hybrid',screen:'profile',control:field.id,value:'no',options:[{value:'no',label:'No'},{value:'yes',label:'Yes'}],request:'I need to change the efficiency mode for my profile to No. Prepare only that setting for review; leave all other existing details unchanged.'},
  {mode:'guided',screen:'profile',control:field.id,value:'no',options:[{value:'no',label:'No'},{value:'yes',label:'Yes'}],request:'update efficency mode to No. Prepare that visible setting only; do not save.'},
  {mode:'autofill',screen:'profile',control:field.id,value:'yes',options:[{value:'no',label:'No'},{value:'yes',label:'Yes'}],request:'Prepare Efficiency mode as Yes for my review. Leave all other fields unchanged.'},
  {mode:'hybrid',screen:'scheduled-goals',control:title.id,value:'Synthetic title',request:'Set the visible Title (optional) field to "Synthetic title" for review only; do not create, save, run or activate a goal.'},
  {mode:'hybrid',screen:'connectors',control:provider.id,value:'calendar_url',options:[{value:'calendar_url',label:'Published calendar URL (ICS)'},{value:'google_workspace',label:'Google Workspace'}],request:'Prepare the visible Event provider dropdown as Published calendar URL (ICS). Do not create a subscription or change listener settings.'},
 ];
 for(const test of cases){
  const s=(await post('/session',{origin:screens.find(x=>x.id===test.screen).route})).data;
  const state=JSON.parse(db.prepare('SELECT state FROM ui_copilot_sessions WHERE id=?').get(s.id).state);state.mode=test.mode;
  state.conversation=[{role:'user',text:'Open profile'},{role:'assistant',text:'Efficiency mode is unsupported in this form; provide display name and email.'}];
  db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(state),s.id);
  const before=modelCalls,started=Date.now();
  const response=await post(`/session/${s.id}/propose`,{version:s.version,screen:test.screen,visible_control_ids:[test.control],visible_control_options:test.options?{[test.control]:test.options}:{},message:test.request});
  assert.equal(response.status,200,JSON.stringify({screen:test.screen,mode:test.mode,error:response.data.error}));
  assert.equal(response.data.proposal.actions.length,1,'exactly one reviewed native patch, not navigation or a questionnaire: '+JSON.stringify(response.data.proposal.actions));
  const action=response.data.proposal.actions[0];
  // A registered title draft is equally valid on the current new-goal form;
  // Profile efficiency and the native provider dropdown have no such adapter.
  if(test.screen==='scheduled-goals'&&action.type==='fill'){assert.equal(action.form,'scheduled_goal');assert.deepEqual(action.values,{title:test.value});}
  else {assert.equal(action.type,'screen_fill');assert.equal(action.screen,test.screen);assert.deepEqual(action.values,{[test.control]:test.value});}
  console.log(JSON.stringify({stage:'live_model_copilot',screen:test.screen,mode:test.mode,expected_value:test.value,model_calls:modelCalls-before,elapsed_ms:Date.now()-started,pass:true}));
 }
 // Same natural-language request from another screen, not just an already
 // open Profile with a single known field. Navigation must retain its intent.
 for(const mode of ['hybrid','guided','autofill']){
  const s=(await post('/session',{origin:'/content-explorer'})).data;
  const state=JSON.parse(db.prepare('SELECT state FROM ui_copilot_sessions WHERE id=?').get(s.id).state);state.mode=mode;
  state.conversation=[{role:'user',text:'Open profile'},{role:'assistant',text:'Provide display name and email before changing settings.'}];
  db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(state),s.id);
  const before=modelCalls,started=Date.now(),message='Looking to update profile to make efficiency mode as No';
  const opening=await post(`/session/${s.id}/propose`,{version:s.version,screen:'content-explorer',visible_control_ids:copilotScreenControls('/content-explorer').map(c=>c.id),message});
  assert.equal(opening.status,200,JSON.stringify({mode,error:opening.data.error}));
  assert.deepEqual(opening.data.proposal.actions.map(({type,screen})=>({type,screen})),[{type:'navigate',screen:'profile'}],'off-screen request first opens Profile, never fills without current observation');
  const response=await post(`/session/${s.id}/propose`,{version:opening.data.version,screen:'profile',navigation_continuation:true,visible_control_ids:copilotScreenControls('/profile').map(c=>c.id),visible_control_options:{[field.id]:[{value:'no',label:'No'},{value:'yes',label:'Yes'}]},message});
  assert.equal(response.status,200,JSON.stringify({mode,error:response.data.error}));
  assert.equal(response.data.proposal.actions.length,1);assert.equal(response.data.proposal.actions[0].type,'screen_fill');assert.equal(response.data.proposal.actions[0].screen,'profile');assert.deepEqual(response.data.proposal.actions[0].values,{[field.id]:'no'});
  console.log(JSON.stringify({stage:'live_model_cross_screen',mode,model_calls:modelCalls-before,elapsed_ms:Date.now()-started,pass:true}));
  const beforeSave=modelCalls;
  const saving=await post(`/session/${s.id}/propose`,{version:response.data.version,screen:'profile',visible_control_ids:copilotScreenControls('/profile').map(c=>c.id),message:'Save changes in profile'});
  assert.equal(saving.status,200);assert.deepEqual(saving.data.proposal.actions,[]);assert.equal(modelCalls,beforeSave,'save-only request is code-enforced, not a model suggestion');
  console.log(JSON.stringify({stage:'save_only_after_live_edit',mode,pass:true,model_calls:0,settings_saved:false}));
 }
 console.log(JSON.stringify({stage:'COPILOT_LIVE_PROFILE_PASS',cases:cases.length+3,catalog_screens:screens.length,models:[...models],production_settings_unchanged:true,production_sessions_unchanged:true}));
}finally{await new Promise(resolve=>server.close(resolve));db.close();}

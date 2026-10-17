import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import {COPILOT_FORMS,validateCopilotProposal,normalizeCopilotScreenActions} from '../src/services/ui-copilot-contract.js';
import {copilotScreenControls,copilotScreenSpec} from '../src/services/ui-copilot-screen-specs.js';
import {COPILOT_RESPONSE_POLICY,parseCopilotResponse,copilotResponseContract,targetsCurrentNativeControls,copilotValidationCategory,reconcileCopilotCurrentNavigation} from '../src/services/ui-copilot-response.js';
let checks=0;
const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++};
const reject=(fn,label)=>{assert.throws(fn,undefined,label);checks++};
const inventory=JSON.parse(readFileSync(new URL('../src/generated/copilot-screen-inventory.json',import.meta.url)));
const screens=[{id:'profile',route:'/profile'},{id:'scheduled-goals',route:'/scheduled-goals'},{id:'master-data',route:'/master-data'}];
const catalog={forms:COPILOT_FORMS,screens,agents:[{id:'fixture-agent'}]};
const efficiency=copilotScreenControls('/profile').find(c=>c.label==='Efficiency mode');
assert(efficiency);const options={[efficiency.id]:[{value:'no',label:'No'},{value:'yes',label:'Yes'}]};
const spec=copilotScreenSpec('/profile',[efficiency.id],options);
const contract=copilotResponseContract(catalog,screens[0],spec).response_contract;
const native={type:'screen_fill',screen:'profile',values:{[efficiency.id]:'no'}};
const offscreenPatch={message:'Prepare Profile',actions:[{type:'fill',form:'user_profile',values:{llm_efficiency_mode:false}}]};
check(normalizeCopilotScreenActions(offscreenPatch,catalog,'scheduled-goals',[]).actions,[{type:'navigate',screen:'profile'}],'an off-screen partial adapter cannot fill unknown fields: open its authorized screen for live inspection');
check(normalizeCopilotScreenActions({message:'Review',actions:[native]},catalog,'master-data',[]).actions,[{type:'navigate',screen:'profile'}],'off-screen native patches must also navigate and discard unobserved values');
check(normalizeCopilotScreenActions(offscreenPatch,catalog,'profile',[]),offscreenPatch,'current hidden fields still require validation, not invented navigation');
check(normalizeCopilotScreenActions(offscreenPatch,{...catalog,screens:screens.filter(s=>s.id!=='profile')},'scheduled-goals',[]),offscreenPatch,'no navigation to an unentitled screen');
check(normalizeCopilotScreenActions({...offscreenPatch,actions:[...offscreenPatch.actions,{type:'navigate',screen:'master-data'}]},catalog,'scheduled-goals',[]).actions.length,2,'do not discard other actions or conflicting destinations');
for(const patch of [offscreenPatch.actions[0],native])check(normalizeCopilotScreenActions({message:'Open and review',actions:[{type:'navigate',screen:'profile'},patch]},catalog,'master-data',[]).actions,[{type:'navigate',screen:'profile'}],'coherent grouped off-screen edits must be inspected, not validated against the old screen');
check(normalizeCopilotScreenActions({message:'Mixed',actions:[{type:'navigate',screen:'profile'},{type:'agent_call',agent:'fixture-agent'}]},catalog,'master-data',[]).actions.length,2,'non-native actions are never silently discarded');
check(reconcileCopilotCurrentNavigation({message:'Review',actions:[{type:'navigate',screen:'profile'},native]},screens[0],[efficiency.id]).actions,[native],'already observed native field does not need same-screen navigation');
check(reconcileCopilotCurrentNavigation({message:'Review',actions:[{type:'navigate',screen:'profile'},native]},screens[0],[]).actions.length,2,'hidden field does not justify stripping navigation');
check(reconcileCopilotCurrentNavigation({message:'Review',actions:[{type:'navigate',screen:'scheduled-goals'},native]},screens[0],[efficiency.id]).actions.length,2,'cross-screen journeys not reordered');
check(contract.native_fields.map(f=>f.id),[efficiency.id],'eligible profile setting not limited by registered basic details');
check(contract.native_fields[0].allowed_options,options[efficiency.id],'exact No/Yes dropdown values retained');
check(contract.registered_forms.user_profile.fields.includes('llm_efficiency_mode'),false,'no broadening of registered form authority');
check(targetsCurrentNativeControls([{type:'fill',form:'user_profile',values:{llm_efficiency_mode:false}}],catalog,screens[0]),true,'registered form mismatch must repair against same-screen controls');
check(targetsCurrentNativeControls([{type:'fill',form:'scheduled_goal',values:{unregistered:'value'}}],catalog,screens[0]),false,'off-screen destination must not be stolen by Profile');
check(targetsCurrentNativeControls([{type:'fill',form:'user_profile',values:{name:'Name'}}],catalog,screens[0]),false,'valid registered form retains its adapter');
check(targetsCurrentNativeControls([null],catalog,screens[0]),false,'malformed actions do not crash repair routing');
check(parseCopilotResponse('```json\n{"message":"Review","actions":[]}\n```'),{message:'Review',actions:[]},'whole fenced JSON is portable across model providers');
for(const value of ['text {"message":"Review","actions":[]}','{"message":"Review","actions":[]} trailing','```json\n{}\n```\nrun code',null])reject(()=>parseCopilotResponse(value),'never extract a convenient object from extra instructions');
for(const action of [null,7,[],{},'navigate'])reject(()=>validateCopilotProposal({message:'Review',actions:[action]},catalog),'malformed actions rejected structurally');
check(copilotValidationCategory(new Error('Unregistered field: never-log-the-value')),'unregistered_form_field','diagnostics contain categories, not model content');
check(copilotValidationCategory(new Error('Screen is not available')),'unavailable_screen_id','wrong action namespace distinguishable');
let covered=0;
for(const route of inventory.routes){
 const screen={id:'current-screen',route:route.path};
 const c={forms:{},screens:[screen],agents:[]};
 const screenSpec=copilotScreenSpec(route.path);
 const response=copilotResponseContract(c,screen,screenSpec).response_contract;
 check(response.screen_ids,['current-screen'],'response namespace scoped to catalog');
 check(response.native_fields.map(f=>f.id),(screenSpec.modules||[]).flatMap(m=>m.fields).filter(f=>f.autofill_allowed).map(f=>f.id),'every source route shares exact execution policy');
 check(response.registered_forms,{},'no unentitled forms introduced');covered++;
}

// Optional proof against the untouched HEAD router, with exact temporary-file cleanup.
const baseline=process.argv.includes('--baseline');
const baselineFile=new URL(`../src/routes/.copilot-baseline-${randomUUID()}.mjs`,import.meta.url);
if(baseline)writeFileSync(baselineFile,execFileSync('git',['show','HEAD:backend/src/routes/ui-copilot.js']));
const {uiCopilotRouter}=await import(baseline?baselineFile.href:'../src/routes/ui-copilot.js');
const db=new Database(':memory:');let calls=0,behavior,allow=true;
const app=express();app.use(express.json());app.use((req,res,next)=>{req.authUser={id:'fixture-ceo',role:'ceo'};next()});
app.use('/copilot',uiCopilotRouter({database:()=>db,getCatalog:()=>allow?catalog:{forms:{},screens:[],agents:[]},complete:async req=>{calls++;return behavior(req)}}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/copilot`;
async function post(path,body){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
const completion=proposal=>({content:JSON.stringify(proposal)});
try{
 // Exact reported wording, starting elsewhere, must inspect the destination
 // before proposing native fields. It must also survive a navigation continuation.
 const away=(await post('/session',{origin:'/master-data'})).body;
 behavior=()=>completion(offscreenPatch);
 const opening=await post(`/session/${away.id}/propose`,{version:away.version,screen:'master-data',message:'Looking to update profile to make efficiency mode as No'});
 check(opening.status,200,'off-screen Profile setting does not exhaust repair with unregistered_form_field');
 check(opening.body.proposal.actions.map(({type,screen})=>({type,screen})),[{type:'navigate',screen:'profile'}],'only authorized navigation is prepared before live field inspection');
 behavior=()=>completion({message:'Review only',actions:[native]});
 const arrived=await post(`/session/${away.id}/propose`,{version:opening.body.version,screen:'profile',navigation_continuation:true,visible_control_ids:[efficiency.id],visible_control_options:options,message:'Looking to update profile to make efficiency mode as No'});
 check(arrived.status,200,'same original request continues after destination inspection');
 check(arrived.body.proposal.actions[0].values,native.values,'continuation prepares only the requested value');
 for(const mode of ['hybrid','guided','autofill'])for(const value of ['no','yes']){
  const session=(await post('/session',{origin:'/profile'})).body;
  const state=JSON.parse(db.prepare('SELECT state FROM ui_copilot_sessions WHERE id=?').get(session.id).state);state.mode=mode;
  state.conversation=[{role:'user',text:'Open profile'},{role:'assistant',text:'You must provide display name and email before changing anything.'}];
  db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(state),session.id);
  let attempt=0;
  behavior=req=>{
   attempt++;
   if(attempt===1)return completion({message:'Profile draft',actions:[{type:'fill',form:'user_profile',values:{llm_efficiency_mode:value==='yes'}}]});
   const metadata=req.messages.map(m=>{try{return JSON.parse(m.content)}catch{return null}}).find(m=>m?.response_contract)?.response_contract;
   // A realistic repair responder only succeeds when it is given the actual
   // namespaces, dropdown values and partial-patch semantics, not hidden hints.
   if(!metadata||!req.messages[0].content.includes(COPILOT_RESPONSE_POLICY))return completion({message:'Open profile',actions:[{type:'navigate',screen:'user_profile'}]});
   check(metadata.native_fields[0].id,efficiency.id,'repair receives exact current control, not an invented field');
   check(req.messages.some(m=>m.content.includes('"fields"')&&m.content.includes('prepare_complete_review_patch')),true,'same-screen partial adapter gets focused native repair');
   return {content:'```json\n'+JSON.stringify({message:'Review Efficiency mode only, then use Save. Other details remain unchanged.',actions:[{type:'screen_fill',screen:'profile',values:{[metadata.native_fields[0].id]:value}}]})+'\n```'};
  };
  const response=await post(`/session/${session.id}/propose`,{version:session.version,screen:'profile',visible_control_ids:[efficiency.id],visible_control_options:options,message:`Update efficiency mode to ${value==='yes'?'Yes':'No'}; leave all other profile fields unchanged.`});
  check(response.status,200,'reported Profile failure repaired in '+mode+' mode');
  check(response.body.proposal.actions[0].values,{[efficiency.id]:value},'only reviewed efficiency dropdown prepared');
  check(attempt,2,'one focused repair, no endless retries');
  check(/display name|email/i.test(response.body.proposal.message),false,'no irrelevant required-field interview');
 }
 // Same mechanism for another screen with a narrower registered adapter.
 const title=copilotScreenControls('/scheduled-goals').find(c=>c.label==='Title (optional)');assert(title);
 const scheduled=(await post('/session',{origin:'/scheduled-goals'})).body;let attempt=0;
 behavior=req=>{
  if(++attempt===1)return completion({message:'Review',actions:[{type:'fill',form:'scheduled_goal',values:{display_title:'Synthetic draft'}}]});
  const context=req.messages.map(m=>{try{return JSON.parse(m.content)}catch{return null}}).find(m=>m?.response_contract)?.response_contract;
  check(context.action_shapes.screen_fill.screen,'scheduled-goals','generic repair derives destination from catalog');
  return completion({message:'Review the existing title field only.',actions:[{type:'screen_fill',screen:'scheduled-goals',values:{[title.id]:'Synthetic draft'}}]});
 };
 const schedule=await post(`/session/${scheduled.id}/propose`,{version:scheduled.version,screen:'scheduled-goals',visible_control_ids:[title.id],message:'Prepare the visible title as Synthetic draft; do not save or activate anything.'});
 check(schedule.status,200,'same-screen adapter repair is not a Profile-specific branch');
 const invalid=(await post('/session',{origin:'/profile'})).body;
 for(const [label,proposal] of [
  ['invented option',{message:'Review',actions:[{type:'screen_fill',screen:'profile',values:{[efficiency.id]:'false'}}]}],
  ['wrong screen namespace',{message:'Review',actions:[{type:'screen_fill',screen:'user_profile',values:{[efficiency.id]:'no'}}]}],
  ['unknown protected field',{message:'Review',actions:[{type:'fill',form:'user_profile',values:{llm_api_key:'synthetic-value'}}]}],
  ['hidden control',{message:'Review',actions:[{type:'screen_fill',screen:'profile',values:{[efficiency.id]:'no'}}]}],
 ]){
  const before=calls;behavior=()=>completion(proposal);
  const result=await post(`/session/${invalid.id}/propose`,{version:invalid.version,screen:'profile',visible_control_ids:label==='hidden control'?[]:[efficiency.id],visible_control_options:options,message:'Prepare a profile change for review.'});
  check(result.status,502,label+' still fails closed');check(calls-before,3,'repair budget unchanged');
  check(db.prepare('SELECT version FROM ui_copilot_sessions WHERE id=?').get(invalid.id).version,invalid.version,'failed attempt does not overwrite session or prior draft');
 }
 behavior=()=>{allow=false;return completion({message:'Review',actions:[{type:'fill',form:'user_profile',values:{name:'Synthetic name'}}]})};
 check((await post(`/session/${invalid.id}/propose`,{version:invalid.version,message:'Prepare display name.'})).status,403,'permissions revalidated after inference');
 console.log(`PASS Copilot response contract: ${checks} checks, ${covered} source routes; Profile No/Yes in three modes, generic adapter repair, bounded failures and permission checks. No production writes or provider calls.`);
}finally{await new Promise(resolve=>server.close(resolve));db.close();if(baseline)rmSync(baselineFile,{force:true});}

// All source routes exercise the SAME response/navigation boundary. Synthetic
// schemas and in-memory sessions are not rendered-browser or provider acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import Database from 'better-sqlite3';
import {uiCopilotRouter} from '../src/routes/ui-copilot.js';
import {copilotScreenSpec} from '../src/services/ui-copilot-screen-specs.js';
import {validateCopilotProposal,normalizeCopilotScreenActions} from '../src/services/ui-copilot-contract.js';
import {COPILOT_RESPONSE_POLICY} from '../src/services/ui-copilot-response.js';
const inventory=JSON.parse(readFileSync(new URL('../src/generated/copilot-screen-inventory.json',import.meta.url)));
const screens=inventory.routes.map((r,i)=>({id:'source-screen-'+i,route:r.path}));
let checks=0,calls=0,behavior,denied=null,nativeFields=0,guidanceScreens=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++};
const db=new Database(':memory:'),app=express();app.use(express.json());app.use((req,res,next)=>{req.authUser={id:'screen-matrix-fixture',role:'ceo'};next()});
app.use('/test',uiCopilotRouter({database:()=>db,getCatalog:()=>({screens:screens.filter(s=>s.id!==denied),forms:{},agents:[]}),complete:async request=>{calls++;return behavior(request)}}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/test`;
async function post(path,body){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
const reply=proposal=>({content:JSON.stringify(proposal)}),logInfo=console.info,logWarn=console.warn;
console.info=()=>{};console.warn=()=>{};
try{
 for(const target of screens){
  const from=screens.find(s=>s.id!==target.id),catalog={screens,forms:{},agents:[]};
  const fields=(copilotScreenSpec(target.route).modules||[]).flatMap(m=>m.fields),eligible=fields.filter(f=>f.autofill_allowed);
  // Every supported native field shares the validator; denied fields never
  // become writable merely because the source map or model mentions them.
  for(const field of fields){
   const p={message:'Synthetic review only',actions:[{type:'screen_fill',screen:target.id,values:{[field.id]:'fixture'}}]};
   if(field.autofill_allowed){check(validateCopilotProposal(p,catalog).actions[0].values,p.actions[0].values,'eligible field contract '+target.route);nativeFields++;}
   else {assert.throws(()=>validateCopilotProposal(p,catalog));checks++;}
  }
  const field=eligible[0],unobserved={message:'Prepare after navigation',actions:[{type:'screen_fill',screen:target.id,values:{[field?.id||'unobserved-placeholder']:'untrusted-value'}}]};
  check(normalizeCopilotScreenActions(unobserved,catalog,from.id,[]).actions,[{type:'navigate',screen:target.id}],'discard off-screen values '+target.route);
  const s=(await post('/session',{origin:from.route})).body,message='Prepare the requested visible field for review; do not save.';
  behavior=()=>reply(unobserved);
  const before=calls,opened=await post(`/session/${s.id}/propose`,{version:s.version,screen:from.id,message});
  check(opened.status,200,'cross-screen entry '+target.route);check(calls-before,1,'no invalid-form retry loop '+target.route);
  check(opened.body.proposal.actions.map(({type,screen})=>({type,screen})),[{type:'navigate',screen:target.id}],'navigation only '+target.route);
  const proposal={message:field?'Review the observed field.':'No eligible native fields are exposed; use the existing screen manually.',actions:field?[{type:'screen_fill',screen:target.id,values:{[field.id]:'fixture'}}]:[]};
  let attempt=0;
  behavior=req=>{
   if(++attempt===1)return {content:'{"type":"object","properties":{"message":{}}}'};
   check(req.messages[0].content.includes(COPILOT_RESPONSE_POLICY),true,'repair keeps shared schema policy '+target.route);
   return reply(proposal);
  };
  const observed={screen:target.id,visible_control_ids:field?[field.id]:[],visible_control_options:field?.type==='select'?{[field.id]:[{value:'fixture',label:'Fixture'}]}:{}};
  const result=await post(`/session/${s.id}/propose`,{version:opened.body.version,message,navigation_continuation:true,...observed});
  check(result.status,200,'destination inspection and generic schema repair '+target.route);check(attempt,2,'bounded repair resolves invalid model schema '+target.route);
  check(result.body.proposal.actions.length,field?1:0,'manual-only screens do not invent writable fields '+target.route);if(!field)guidanceScreens++;
  if(field){
   behavior=()=>reply(proposal);
   const hidden=await post(`/session/${s.id}/propose`,{version:result.body.version,message,screen:target.id,visible_control_ids:[]});
   check(hidden.status,502,'hidden target still fails closed '+target.route);
   if(field.type==='select'){
    const invalid=await post(`/session/${s.id}/propose`,{version:result.body.version,message,...observed,visible_control_options:{[field.id]:[{value:'other',label:'Other'}]}});
    check(invalid.status,502,'unavailable dropdown option still fails closed '+target.route);
   }
  }
  const beforeSave=calls,save=await post(`/session/${s.id}/propose`,{version:result.body.version,message:'Save this form',screen:target.id});
  check(save.status,200,'save-only guidance '+target.route);check(save.body.proposal.actions,[],'save request never repopulates '+target.route);check(calls,beforeSave,'no model-generated defaults on save '+target.route);
  if(field)check((await post(`/session/${s.id}/review`,{version:save.body.version,action:proposal.actions[0]})).status>=400,true,'old field patch cannot be reused after save-only request '+target.route);
  denied=target.id;const beforeDenied=calls;
  check((await post(`/session/${s.id}/propose`,{version:save.body.version,message,screen:target.id})).status,403,'denied screen rejected '+target.route);
  check(calls,beforeDenied,'denied access makes no model call '+target.route);denied=null;
 }
 check(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='platform_users'").get().n,0,'harness has no profile persistence or customer settings');
}finally{console.info=logInfo;console.warn=logWarn;await new Promise(resolve=>server.close(resolve));db.close();}
console.log(JSON.stringify({stage:'COPILOT_ALL_SOURCE_JOURNEYS_PASS',screens:screens.length,native_field_contracts:nativeFields,guidance_only_screens:guidanceScreens,checks,model:'synthetic_contract_stub',production_writes:false,rendered_acceptance:false}));

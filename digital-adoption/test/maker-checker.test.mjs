import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createPlatformGateway } from '../integrations/platform-gateway.mjs';
import { resolveGatewaySettings } from '../integrations/gateway-settings.mjs';
import { completeProvider, createProviderCompletion } from '../integrations/provider-completion.mjs';
import { createPlatformPlanner } from '../src/platform-model.mjs';
const serviceToken='synthetic-quality-test-service-token-000000';
const snapshot={revision:1,path:'/request',fields:[{ref:'r1f0',label:'Shipping method',type:'select-one',choices:['Standard','Express']}],links:[]};
const proposal=value=>({message:'Review the proposed shipping choice.',actions:[{type:'fill',ref:'r1f0',value}]});
const body={purpose:'digital_adoption_plan',selection:'platform_active',messages:[{role:'system',content:'Prepare JSON using observed controls; never save.'},{role:'user',content:JSON.stringify({task:'Use the fastest offered delivery',observed:snapshot})}]};
const call=(gateway,input=body)=>gateway({authorization:`Bearer ${serviceToken}`,body:input});
function fixture({enabled=true,active='primary',verdicts=['accept'],values=['Express'],missing=false}={}) {
 const calls=[];let maker=0,judge=0;
 const config={active,baseUrl:'https://maker.example/v1',model:'configured-maker',apiKey:'private-key',quality:{enabled},checker:missing?null:{slot:active==='primary'?'secondary':'primary',baseUrl:'https://checker.example/v1',model:'configured-checker',apiKey:'private-checker-key'}};
 const gateway=createPlatformGateway({serviceToken,resolveActive:async()=>config,complete:async request=>{
   calls.push(request);
   if(request.config.slot){const decision=verdicts[Math.min(judge++,verdicts.length-1)];return {content:typeof decision==='string'?JSON.stringify({decision,feedback:decision==='accept'?'Supported by observed choices.':'Use the requested supported choice or clarify.',checks:{taskMatch:decision==='accept'?'pass':'fail',grounding:'pass',safety:'pass'}}):JSON.stringify(decision)};}
   return {content:JSON.stringify(proposal(values[Math.min(maker++,values.length-1)]))};
 }});return {gateway,calls,config};
}
test('disabled mode preserves one maker call and no checker; shortcut draft needs no LLM',async()=>{
 const f=fixture({enabled:false});assert.equal(JSON.parse((await call(f.gateway)).content).actions[0].value,'Express');assert.equal(f.calls.length,1);
 const result=await call(f.gateway,{...body,purpose:'digital_adoption_review',draft:proposal('Standard')});assert.equal(JSON.parse(result.content).actions[0].value,'Standard');assert.equal(f.calls.length,1);assert.equal(result.quality.enabled,false);
});
test('enabled review uses inactive slot and accepts supported proposals; roles swap with active slot',async()=>{
 for(const active of ['primary','secondary']){const f=fixture({active}),r=await call(f.gateway);assert.equal(f.calls.length,2);assert.equal(r.quality.checkerSlot,active==='primary'?'secondary':'primary');assert.equal(r.quality.decision,'accept');assert.equal(r.quality.revisions,0);assert.equal(JSON.parse(r.content).actions[0].value,'Express');assert.match(f.calls[1].messages[0].content,/never authorize execution/);}
});
test('checker can request one maker revision; corrected result is checked again',async()=>{
 const f=fixture({verdicts:['revise','accept'],values:['Standard','Express']}),r=await call(f.gateway);assert.equal(f.calls.length,4);assert.equal(r.quality.revisions,1);assert.equal(JSON.parse(r.content).actions[0].value,'Express');assert.match(f.calls[2].messages.at(-1).content,/boundedCheckerFeedback/);
});
test('repeated disagreement is bounded and produces no actions',async()=>{
 const f=fixture({verdicts:['revise']}),r=await call(f.gateway);assert.equal(f.calls.length,4);assert.equal(r.quality.decision,'clarify');assert.deepEqual(JSON.parse(r.content).actions,[]);
});
test('clarification and rejection do not authorize proposed changes',async()=>{
 for(const decision of ['clarify','reject']){const f=fixture({verdicts:[decision]}),r=await call(f.gateway);assert.equal(f.calls.length,2);assert.deepEqual(JSON.parse(r.content).actions,[]);assert.equal(r.quality.decision,decision);}
});
test('missing or invalid checker fails closed and never falls back to maker-only',async()=>{
 const missing=fixture({missing:true});await assert.rejects(()=>call(missing.gateway),e=>e.code==='COPILOT_CHECKER_UNAVAILABLE');assert.equal(missing.calls.length,0);
 for(const verdict of [{decision:'accept',feedback:'ok',actions:[{type:'submit'}]},{decision:'maybe',feedback:'ok'}]){const f=fixture({verdicts:[verdict]});await assert.rejects(()=>call(f.gateway),e=>e.code==='COPILOT_CHECKER_UNAVAILABLE');assert.equal(f.calls.length,2);}
});
test('invalid observed choices cannot be accepted by a judge and get at most one repair',async()=>{
 const f=fixture({values:['Teleportation','Express']}),r=await call(f.gateway);assert.equal(f.calls.length,3);assert.equal(r.quality.revisions,1);assert.equal(JSON.parse(r.content).actions[0].value,'Express');
 const bad=fixture({values:['Teleportation']});await assert.rejects(()=>call(bad.gateway),e=>e.code==='COPILOT_REVIEW_FAILED');assert.equal(bad.calls.length,2);
});
test('website cannot override global review or choose a provider',async()=>{
 const f=fixture();for(const patch of [{reviewEnabled:false},{checkerMode:'off'},{model:'untrusted'},{draft:proposal('Express')}])await assert.rejects(()=>call(f.gateway,{...body,...patch}),/Invalid/);assert.equal(f.calls.length,0);
 await assert.rejects(()=>f.gateway({authorization:'Bearer visitor-token',body}),/denied/);
});
test('shortcut field and navigation proposals still pass global checker without local bypass',async()=>{
 const f=fixture(),planner=createPlatformPlanner({gatewayUrl:'https://platform.example/complete',serviceToken,fetchImpl:async(_,{headers,body})=>({ok:true,json:async()=>f.gateway({authorization:headers.Authorization,body:JSON.parse(body)})})});
 const r=await planner({text:'Set Shipping method to Express',snapshot});assert.equal(f.calls.length,1);assert.equal(f.calls[0].config.slot,'secondary');assert.equal(r.actions[0].value,'Express');
 f.config.quality.enabled=false;await planner({text:'Set Shipping method to Standard',snapshot});assert.equal(f.calls.length,1);
});
test('checked clarification is terminal rather than retried into a local fallback',async()=>{
 const f=fixture({verdicts:['clarify']}),planner=createPlatformPlanner({gatewayUrl:'https://platform.example/complete',serviceToken,fetchImpl:async(_,{headers,body})=>({ok:true,json:async()=>f.gateway({authorization:headers.Authorization,body:JSON.parse(body)})})});
 assert.deepEqual((await planner({text:'Use the fastest offered delivery for Shipping method',snapshot})).actions,[]);assert.equal(f.calls.length,2);
});
test('global policy and inactive roles resolve fresh from persisted settings; local checker uses registry model',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE platform_settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE model_deployments(id TEXT,enabled INTEGER,base_url TEXT,model TEXT)');
 const ep={baseUrl:'https://slot.example/v1',model:'configured',apiKey:'private'},config={primary:ep,secondary:ep};
 assert.equal(resolveGatewaySettings(db,config).quality.enabled,false);
 db.prepare('INSERT INTO platform_settings VALUES (?,?)').run('digital_adoption_maker_checker',JSON.stringify({enabled:true,checkerMode:'platform_inactive'}));assert.equal(resolveGatewaySettings(db,config).checker.slot,'secondary');
 db.prepare('INSERT INTO platform_settings VALUES (?,?)').run('llm_active_endpoint','secondary');assert.equal(resolveGatewaySettings(db,config).checker.slot,'primary');
 db.prepare('UPDATE platform_settings SET value=? WHERE key=?').run(JSON.stringify({enabled:true,checkerMode:'ollama_reasoning'}),'digital_adoption_maker_checker');db.prepare('INSERT INTO model_deployments VALUES (?,?,?,?)').run('ollama-reasoning',1,'http://ollama:11434/v1','configured-local-reasoner');assert.equal(resolveGatewaySettings(db,config).checker.model,'configured-local-reasoner');assert.equal(resolveGatewaySettings(db,config).checker.nativeOllama,true);
 db.exec("UPDATE model_deployments SET base_url='https://external.example/v1'");assert.throws(()=>resolveGatewaySettings(db,config),/private Ollama/);
 db.exec("UPDATE platform_settings SET value='broken' WHERE key='digital_adoption_maker_checker'");assert.throws(()=>resolveGatewaySettings(db,config));
 }finally{db.close();}
});
test('Ollama reasoning transport requests native thinking/JSON and discards reasoning traces',async()=>{
 let sent;const signal=AbortSignal.timeout(1000),r=await completeProvider({config:{baseUrl:'http://ollama:11434/v1',model:'configured-reasoner',apiKey:'private',nativeOllama:true,thinking:true,threads:2},messages:[{role:'user',content:'Synthetic check'}],maxTokens:700,signal},async(url,init)=>{if(url.pathname==='/api/show')return {ok:true,json:async()=>({capabilities:['completion','thinking']})};sent={url:String(url),...init,body:JSON.parse(init.body)};return {ok:true,json:async()=>({message:{content:'{"decision":"accept","feedback":"ok"}',thinking:'PRIVATE_REASONING_CANARY'},done:true,done_reason:'stop'})};});
 assert.equal(sent.url,'http://ollama:11434/api/chat');assert.equal(sent.body.think,true);assert.equal(sent.body.format,'json');assert.equal(sent.body.truncate,false);assert.equal(sent.signal,signal);assert.equal(JSON.stringify(r).includes('PRIVATE_REASONING_CANARY'),false);
});

test('knowledge answers also require checker review and rejected claims become insufficient',async()=>{
 for(const decision of ['accept','reject']){let calls=0;const f=fixture(),gateway=createPlatformGateway({serviceToken,resolveActive:async()=>f.config,complete:async({config})=>{calls++;return {content:JSON.stringify(config.slot?{decision,feedback:'Synthetic evidence review.',checks:{taskMatch:'pass',grounding:decision==='accept'?'pass':'fail',safety:'pass'}}:{evidenceStatus:'supported',message:'Synthetic documented guidance.',citations:[{chunkId:'c1',quote:'Synthetic documented guidance.'}]})};}});
 const r=await call(gateway,{...body,purpose:'digital_adoption_knowledge',messages:[{role:'user',content:JSON.stringify({question:'What is the synthetic guidance?',evidence:[{chunkId:'c1',text:'Synthetic documented guidance.'}]})}]});assert.equal(calls,2);assert.equal(JSON.parse(r.content).evidenceStatus,decision==='accept'?'supported':'insufficient');if(decision==='reject')assert.deepEqual(JSON.parse(r.content).citations,[]);}
});
test('checker failures surface a specific no-change message to the planner',async()=>{
 const planner=createPlatformPlanner({gatewayUrl:'https://platform.example/complete',serviceToken,fetchImpl:async()=>({ok:false,json:async()=>({code:'COPILOT_CHECKER_UNAVAILABLE'})})});await assert.rejects(()=>planner({text:'Set Shipping method to Express',snapshot}),e=>e.publicCode==='COPILOT_CHECKER_UNAVAILABLE');
});
test('local reasoning admission is bounded and releases its slot on completion',async()=>{
 let finish;const complete=createProviderCompletion({localConcurrency:1,fetchImpl:url=>url.pathname==='/api/show'?Promise.resolve({ok:true,json:async()=>({capabilities:['completion']})}):new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({done:true,message:{content:'{}'}})});})});
 const request={config:{baseUrl:'http://ollama:11434/v1',model:'configured',apiKey:'local',nativeOllama:true},messages:[],maxTokens:700};
 const first=complete(request);await assert.rejects(()=>complete(request),e=>e.diagnosticCode==='LOCAL_CAPACITY');await new Promise(setImmediate);finish();await first;const next=complete(request);await new Promise(setImmediate);finish();await next;
});

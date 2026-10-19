// Run in the existing gateway image with config/DB mounted read-only.
// Resolver override is process-local: no shared Admin/database/config writes.
import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createPlatformGateway} from '/adoption/integrations/platform-gateway.mjs';
import {resolveGatewaySettings} from '/adoption/integrations/gateway-settings.mjs';
import {createProviderCompletion} from '/adoption/integrations/provider-completion.mjs';
import {createPlatformPlanner} from '/candidate/src/platform-model.mjs';
import {createKnowledgeAnswer} from '/candidate/src/knowledge-answer.mjs';
const config=JSON.parse(await readFile('/config/gateway.json','utf8')),db=new DatabaseSync('/platform/agent-os.db',{readOnly:true}),observed=JSON.parse(await readFile('/evidence/snapshots.json','utf8')).snapshots;
const originalSetting=db.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value;
let checker=true,lastQuality,lastGatewayError,lastChecker;
const complete=createProviderCompletion({localConcurrency:1});
const gateway=createPlatformGateway({serviceToken:config.serviceToken,complete:async request=>{const response=await complete(request);if(request.config.slot)lastChecker={content:response.content,diagnostics:response.diagnostics};return response;},resolveActive:async()=>{const active=resolveGatewaySettings(db,config),slot=active.active==='primary'?'secondary':'primary';return {...active,quality:{enabled:checker,checkerMode:'platform_inactive',checkerMaxTokens:2048},checker:{...config[slot],slot,maxTokens:2048}};}});
const fetchImpl=async(url,options)=>{let output;try{output=await gateway({authorization:options.headers.Authorization,body:JSON.parse(options.body),signal:options.signal});}catch(error){lastGatewayError={code:error.code,diagnosticCode:error.diagnosticCode,providerStatus:error.providerStatus,providerDiagnostics:error.providerDiagnostics};throw error;}lastQuality=output.quality;return new Response(JSON.stringify(output),{headers:{'Content-Type':'application/json'}});};
const model={gatewayUrl:'https://isolated.invalid/complete',serviceToken:config.serviceToken,requestDeadlineMs:120000,fetchImpl},planner=createPlatformPlanner(model),answer=createKnowledgeAnswer(model);
const local=observed.local,publicPage=observed.public;
const selected=(process.env.IMMEDIATE_MODEL_CASES||'').split(',').filter(Boolean);
const tests=[
 {id:'transaction-summary',kind:'knowledge',text:'summarize the company name and shipping method in this transaction.',evidence:[{chunkId:'synthetic-txn',title:'Synthetic transaction',text:'Company name: Synthetic Orchid. Requested shipping method: Express. Gift wrap requested: yes.',locator:'line 1'}]},
 {id:'natural-select-checkbox',snapshot:local,text:'Set Shipping method to Express and select Include gift wrap. Do not save.',want:{'Shipping method':'Express','Include gift wrap':'true'}},
 {id:'spelling-choice',snapshot:local,text:'Please change the shiping method to Expres. Leave everything else alone.',want:{'Shipping method':'Express'}},
 {id:'radio-language',snapshot:local,text:'I will collect it myself; select Store pickup for Delivery preference.',want:{'Delivery preference':'Store pickup'}},
 {id:'preserve-current',snapshot:local,text:'Set Contact email to synthetic@example.test and leave Company name unchanged.',want:{'Contact email':'synthetic@example.test'}},
 {id:'unknown-option',snapshot:local,text:'Set Shipping method to Teleport.',none:true},
 {id:'advice-no-effect',snapshot:local,text:'Explain the Shipping method choices and recommend one for urgency; do not change any fields.',none:true},
 {id:'public-default-language',snapshot:publicPage,text:'Keep the transport default All transport.',want:{transport:'All transports'}},
 {id:'public-typo',snapshot:publicPage,text:'Please set transprot to stido.',want:{transport:'stdio'}},
];
const repetitions=Number(process.env.IMMEDIATE_REPETITIONS||1);if(!Number.isInteger(repetitions)||repetitions<1||repetitions>10)throw new Error('Invalid repetition count');
const results=[];
try{for(const enabled of process.env.IMMEDIATE_CHECKER_ONLY==='1'?[true]:[false,true]){checker=enabled;for(const testcase of tests.filter(t=>!selected.length||selected.includes(t.id)))for(let repetition=1;repetition<=repetitions;repetition++){const started=Date.now();let response;try{lastQuality=lastGatewayError=lastChecker=undefined;response=testcase.kind==='knowledge'?await answer(testcase):await planner({text:testcase.text,snapshot:testcase.snapshot});if(testcase.kind==='knowledge'){assert.equal(response.kind,'answer');assert.match(response.message,/Synthetic Orchid/);assert.match(response.message,/Express/);assert.equal(response.citations[0].chunkId,'synthetic-txn');}else{const actual=Object.fromEntries(response.actions.map(a=>[testcase.snapshot.fields.find(f=>f.ref===a.ref)?.label,a.value]));if(testcase.none)assert.equal(response.actions.length,0);else assert.deepEqual(actual,testcase.want);}if(enabled)assert.equal(lastQuality.enabled,true);results.push({id:testcase.id,repetition,mode:enabled?'active maker / passive checker':'maker only',status:'passed',latencyMs:Date.now()-started,quality:lastQuality,response});console.log('PASS '+results.at(-1).mode+' '+testcase.id);}catch(error){results.push({id:testcase.id,repetition,mode:enabled?'active maker / passive checker':'maker only',status:'failed',latencyMs:Date.now()-started,error:error.message,quality:lastQuality,gatewayError:lastGatewayError,lastSuccessfulCheckerResponse:lastChecker,response});console.log('FAIL '+testcase.id+' '+error.message);}}}
 assert.equal(db.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value,originalSetting);
 await writeFile('/output/model-results.json',JSON.stringify({at:new Date().toISOString(),sharedSettingUnchanged:true,override:'process-local only; active platform maker and passive platform checker; 2048-token verdict budget',results},null,2));
 assert.equal(results.filter(r=>r.status==='failed').length,0);
}finally{db.close();}

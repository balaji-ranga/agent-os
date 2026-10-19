// Isolated real-model acceptance. No live owner map/setting changes or host effects.
import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createPlatformGateway} from '/candidate/integrations/platform-gateway.mjs';
import {resolveGatewaySettings} from '/adoption/integrations/gateway-settings.mjs';
import {createProviderCompletion} from '/adoption/integrations/provider-completion.mjs';
import {createPlatformPlanner} from '/candidate/src/platform-model.mjs';
import {openRepository} from '/candidate/src/repository.mjs';
import {createSourceMap} from '/candidate/src/source-map.mjs';
const config=JSON.parse(await readFile('/config/gateway.json','utf8')),db=new DatabaseSync('/platform/agent-os.db',{readOnly:true}),input=JSON.parse(await readFile('/evidence/context-acceptance.json','utf8')),setting=db.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value;
const repo=openRepository(),map=createSourceMap(repo),scope={embeddingId:'isolated-context-acceptance',audienceId:'public',role:'maintainer',origin:input.origin};map.refresh(scope,{...input.manifest,reviewed:true});
let checker=false,quality,lastContext;const complete=createProviderCompletion({localConcurrency:1});
const gateway=createPlatformGateway({serviceToken:config.serviceToken,complete,resolveActive:async()=>{const active=resolveGatewaySettings(db,config),slot=active.active==='primary'?'secondary':'primary';return {...active,quality:{enabled:checker,checkerMode:'platform_inactive',checkerMaxTokens:2048},checker:{...config[slot],slot,maxTokens:2048}};}});
const fetchImpl=async(url,options)=>{const body=JSON.parse(options.body);lastContext=JSON.parse(body.messages.at(-1).content).sourceGuidance;const output=await gateway({authorization:options.headers.Authorization,body,signal:options.signal});quality=output.quality;return new Response(JSON.stringify(output));};
const planner=createPlatformPlanner({gatewayUrl:'https://isolated.invalid/complete',serviceToken:config.serviceToken,fetchImpl,requestDeadlineMs:120000}),results=[];
const tests=[
 {id:'short-assignment-semantic-code',text:'Set Region to Northern branch.',want:{Region:'SYN-NORTH-42'}},
 {id:'field-description-interprets-assignment',text:'Set Region to Northern branch. Leave other fields unchanged.',want:{Region:'SYN-NORTH-42'}},
 {id:'form-description-determines-choice',text:'For a priority desk customer, set Shipping method according to the reviewed form guidance. Leave other fields unchanged.',want:{'Shipping method':'Express'}},
 {id:'description-explains-business-meaning',text:'Explain what Region means in this form and which code Northern branch uses. Do not fill any fields.',explain:true},
 {id:'unmapped-branch-clarifies',text:'Set Region for the Southern branch using the servicing code in the reviewed guidance. If it is not documented, ask me rather than inventing a code.',none:true},
];
try{for(const enabled of [false,true]){checker=enabled;for(const t of tests){const started=Date.now();let response;try{const sourceGuidance=map.guidance({...scope,role:'visitor'},t.text,input.snapshot);response=await planner({text:t.text,snapshot:input.snapshot,sourceGuidance});assert.match(JSON.stringify(lastContext),/SYN-NORTH-42/);assert.match(JSON.stringify(lastContext),/priority desk/);const actual=Object.fromEntries(response.actions.map(a=>[input.snapshot.fields.find(f=>f.ref===a.ref)?.label,a.value]));if(t.want)assert.deepEqual(actual,t.want);else assert.equal(response.actions.length,0);if(t.explain){assert.match(response.message,/SYN-NORTH-42/i);assert.match(response.message,/servic/i);}if(t.none)assert.match(response.message,/Southern|code|region/i);if(enabled)assert.equal(quality.enabled,true);results.push({id:t.id,status:'passed',mode:enabled?'active maker / passive checker':'maker only',latencyMs:Date.now()-started,quality,response,contextRevision:sourceGuidance.revision});console.log('PASS '+t.id+' '+results.at(-1).mode);}catch(error){results.push({id:t.id,status:'failed',mode:enabled?'active maker / passive checker':'maker only',latencyMs:Date.now()-started,error:error.message,response});console.log('FAIL '+t.id+' '+error.message);}}}
 assert.equal(db.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value,setting);
 await writeFile('/output/map-context-model-results.json',JSON.stringify({at:new Date().toISOString(),scope:'Real model, owner-UI-exported map, real local DOM snapshot, process-local in-memory map. No host effects or shared settings changes.',sharedSettingUnchanged:true,results},null,2));assert.equal(results.filter(r=>r.status==='failed').length,0);
}finally{db.close();repo.close();}

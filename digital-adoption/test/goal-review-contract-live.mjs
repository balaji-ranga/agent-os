// Explicit real-model evaluation. Produces descriptions only; no browser writes.
// Run in a candidate image with read-only platform/config mounts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createGoalModel} from '../src/goal-model.mjs';
import {createPlatformGateway} from '../integrations/platform-gateway.mjs';
import {resolveGatewaySettings} from '../integrations/gateway-settings.mjs';
import {completeProvider} from '../integrations/provider-completion.mjs';

const db=new DatabaseSync('/platform/agent-os.db',{readOnly:true});
const config=resolveGatewaySettings(db,JSON.parse(readFileSync('/config/gateway.json','utf8')));db.close();
const token='synthetic-description-only-evaluation-token',qualities=[],drafts=[];
const gateway=createPlatformGateway({serviceToken:token,resolveActive:async()=>config,complete:async request=>{const r=await completeProvider(request);if(!request.config.slot)drafts.push(JSON.parse(r.content));return r;}});
const model=createGoalModel({gatewayUrl:'https://synthetic.invalid/complete',serviceToken:token,fetchImpl:async(_,{headers,body,signal})=>{
 const result=await gateway({authorization:headers.Authorization,body:JSON.parse(body),signal});qualities.push(result.quality);return {ok:true,json:async()=>result};
}});
const snapshot={revision:1,path:'/customer',forms:[{key:'customer',label:'Customer draft',fields:['company_name','contact_email','region']}],fields:[{ref:'r1f0',label:'Company name',key:'company_name',form:'customer',type:'text'},{ref:'r1f1',label:'Contact email',key:'contact_email',form:'customer',type:'email'},{ref:'r1f2',label:'Region',key:'region',form:'customer',type:'text'}],links:[],submissions:[{ref:'r1s0',label:'Save synthetic record'}]};
const peer='synthetic-exact-peer',text=readFileSync(process.argv[2],'utf8');
const began=Date.now(),plan=await model({text,snapshot,peerGuidance:[{instanceId:peer,websiteId:'synthetic-public',origin:'https://flolah.cloud'}]});
console.log(JSON.stringify({stage:'descriptions-only',plan,qualities,drafts,elapsedMs:Date.now()-began},null,2));
assert.deepEqual(plan.steps.map(s=>s.kind),['fill','save','peer','peer','inspect']);
assert.equal(plan.steps[2].mode,'inspect');assert.equal(plan.steps[3].mode,'goal');
assert.equal(plan.steps[2].recipient,peer);assert.equal(plan.steps[3].recipient,peer);
for(const value of ['genosys','multisite.uat@example.test','Singapore'])assert.ok(plan.steps[0].instruction.includes(value));
assert.match(plan.steps[3].instruction,/review/i);assert.match(plan.steps[3].instruction,/transport/i);
console.log('PASS exact request coverage, grouped local fields, confirmation-gated Save, remote inspection and constrained peer goal');

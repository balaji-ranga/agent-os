import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {assertOpenClawAgentId,assertOpenClawConfigContract,pinFlolahAgentRuntime,addOpenClawAllowedTools} from '../../scripts/lib/openclaw-config-contract.js';
const dir=mkdtempSync(join(tmpdir(),'flolah-gateway-contract-'));process.env.OPENCLAW_DIR=dir;process.env.OPENCLAW_CONFIG_PATH=join(dir,'openclaw.json');
const {writeOpenClawConfigSafe,withOpenClawConfigBatch}=await import('../src/services/openclaw-config-safe.js');
const good={gateway:{mode:'local',port:18789},agents:{ownership:'explicit',defaults:{model:{primary:'platform/model'}},entries:{helper:{tools:{profile:'full',allow:['read']}}}},tools:{},plugins:{entries:{}},browser:{}};
let checks=0;
try{
 assertOpenClawAgentId('a'.repeat(64));assert.throws(()=>assertOpenClawAgentId('a'.repeat(65)));checks++;
 const initial=writeOpenClawConfigSafe(structuredClone(good)),before=readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'),mtime=statSync(process.env.OPENCLAW_CONFIG_PATH).mtimeMs;
 const mutations=[
  c=>{c.agents.entries['a'.repeat(65)]={};},
  c=>{c.agents.entries['bad/id']={};},
  c=>{c.agents.entries.helper.tools.allow='read';},
  c=>{c.agents.entries.helper.tools.profile='made-up-profile';},
  c=>{c.agents.entries.helper.tools.alsoAllow=['browser'];},
  c=>{c.plugins.entries.fake={enabled:'yes'};},
  c=>{c.tools.byProvider={remote:{allow:['read'],alsoAllow:['browser']}};},
 ];
 for(const mutate of mutations){const next=structuredClone(initial);mutate(next);assert.throws(()=>writeOpenClawConfigSafe(next),e=>e.code==='OPENCLAW_CONFIG_CONTRACT_INVALID');assert.equal(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'),before);assert.equal(statSync(process.env.OPENCLAW_CONFIG_PATH).mtimeMs,mtime);checks++;}
 assert.throws(()=>assertOpenClawConfigContract({...good,agents:{...good.agents,list:[]}}));checks++;
 assert.throws(()=>withOpenClawConfigBatch(()=>{writeOpenClawConfigSafe({...initial,gateway:{...initial.gateway,port:18790}});const bad=structuredClone(initial);bad.agents.entries['x'.repeat(65)]={};writeOpenClawConfigSafe(bad);}));assert.equal(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'),before);checks++;
 assertOpenClawConfigContract({...good,tools:{allow:[],alsoAllow:['read']}});checks++;
 for(const policy of [{profile:'coding',alsoAllow:['browser']},{allow:['read']},{profile:'minimal'}]){addOpenClawAllowedTools(policy,['fixture_tool']);assertOpenClawConfigContract({...good,tools:policy});assert.ok((policy.allow||policy.alsoAllow).includes('fixture_tool'));}checks++;
 const byok={models:{providers:{'private-provider':{api:'openai-completions',baseUrl:'https://model.example/v1',apiKey:'synthetic-fixture-key',models:[{id:'unchanged'}]},other:{api:'other-api',agentRuntime:{id:'unchanged'}}}}};const original=structuredClone(byok);pinFlolahAgentRuntime(byok);assert.deepEqual(byok.models.providers['private-provider'],{...original.models.providers['private-provider'],agentRuntime:{id:'openclaw'}});assert.deepEqual(byok.models.providers.other,original.models.providers.other);checks++;
 writeOpenClawConfigSafe({...initial,gateway:{...initial.gateway,port:18790}});assert.equal(JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH)).gateway.port,18790);checks++;
 writeFileSync(join(dir,'flolah-runtime-contract.json'),JSON.stringify({source:'installed-openclaw-schema-validation',plugins:['browser']}));
 const snapshot=readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'),unknown=structuredClone(initial);unknown.plugins.entries.uninstalled={enabled:true};assert.throws(()=>writeOpenClawConfigSafe(unknown),/plugin is not in/);assert.equal(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'),snapshot);checks++;
 unknown.plugins.entries.uninstalled.enabled=false;writeOpenClawConfigSafe(unknown);checks++; // Explicit disable policy is retained, never auto-enabled.
 mkdirSync(join(dir,'extensions','fixture-plugin'),{recursive:true});writeFileSync(join(dir,'extensions','fixture-plugin','openclaw.plugin.json'),JSON.stringify({id:'fixture-plugin'}));const installed=structuredClone(initial);installed.plugins.entries['fixture-plugin']={enabled:true};writeOpenClawConfigSafe(installed);checks++;
 console.log(JSON.stringify({suite:'OpenClaw publication contract',checks,passed:true,rejectedCandidatesPreservedPreviousConfig:true,failedBatchDiscarded:true}));
}finally{
 const parent=resolve(tmpdir())+sep;if(!resolve(dir).startsWith(parent))throw Error('Unsafe fixture cleanup path');
 rmSync(dir,{recursive:true,force:true});
}

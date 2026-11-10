import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';
const load=pattern=>import(join(root,readdirSync(root).find(n=>pattern.test(n))));
const rosterName=readFileSync(join(root,'flolah-harness-reference.mjs'),'utf8').match(/from ["']\.\/(agent-scope-config-[^"']+\.js)["']/)[1];
const patched=await load(/^harness-runtimes-.*\.js$/),original=await import(join(root,'flolah-harness-reference.mjs')),roster=await import(join(root,rosterName));
const find=(m,name)=>Object.values(m).find(v=>typeof v==='function'&&v.name===name);
const collect=find(patched,'collectConfiguredAgentHarnessRuntimes'),reference=find(original,'collectConfiguredAgentHarnessRuntimes');
const config=()=>({models:{providers:{fixture:{agentRuntime:{id:'fixture-provider'},models:[{id:'model-a',agentRuntime:{id:'fixture-model'}},{id:'model-b'}]}}},agents:{defaults:{model:{primary:'fixture/model-a',fallbacks:['fixture/model-b']},models:{'fixture/model-b':{agentRuntime:{id:'fixture-default'}}}},entries:{alpha:{models:{'fixture/model-a':{agentRuntime:{id:'fixture-agent'}}}},beta:{model:'fixture/model-b'}}}});
for(const kind of ['entries','list'])for(const implicit of [true,false]){
 const cfg=config();if(kind==='list'){cfg.agents.list=Object.entries(cfg.agents.entries).map(([id,v])=>({...v,id}));delete cfg.agents.entries;}
 assert.deepEqual(collect(cfg,{includeImplicitRuntimePreferences:implicit}),reference(cfg,{includeImplicitRuntimePreferences:implicit}));
 cfg.models.providers.fixture.agentRuntime.id='changed-provider';
 assert.deepEqual(collect(cfg,{includeImplicitRuntimePreferences:implicit}),reference(cfg,{includeImplicitRuntimePreferences:implicit}),'configuration changes must be visible');
}
const cfg=config();let reads=0;const entries=Object.fromEntries(Array.from({length:399},(_,i)=>['fixture-'+i,{model:'fixture/model-a'}]));
Object.defineProperty(cfg.agents,'entries',{configurable:true,get(){reads++;return entries;}});
const expected=reference(cfg),baselineReads=reads;reads=0;
assert.deepEqual(collect(cfg),expected);const snapshotReads=reads;
assert.ok(baselineReads>snapshotReads*100,`expected fewer roster materializations: ${baselineReads}/${snapshotReads}`);
entries['fixture-0'].models={'fixture/model-a':{agentRuntime:{id:'new-runtime'}}};
assert.deepEqual(collect(cfg),reference(cfg),'same-object roster mutations must not use stale state');
assert.throws(()=>roster.flolahWithRosterSnapshot(cfg,()=>{throw Error('fixture exception')}),/fixture exception/);
entries['fixture-0'].models['fixture/model-a'].agentRuntime.id='after-exception';
assert.deepEqual(collect(cfg),reference(cfg),'exception cleanup must release the snapshot');
assert.deepEqual(collect({}),reference({}));
console.log(JSON.stringify({test:'HARNESS_ROSTER_SNAPSHOT_OK',baselineReads,snapshotReads,coverage:'entries/list, provider/model/agent/default policy, implicit modes, mutable config, exception cleanup, empty config'}));

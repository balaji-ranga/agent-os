import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {chatCompletions} from '../src/config/llm.js';
const owner=process.argv[2];if(!owner)throw Error('Owner ID required');
const soul=readFileSync(new URL('../../openclaw-workspace-templates/balserve/SOUL.md',import.meta.url),'utf8');
const cases=[
 ['model','What model are you using?',['answer','inspect']],
 ['schedule','When is the weekly report scheduled?','inspect'],
 ['why','Why did you run that workflow just now?','inspect'],
 ['device','Can this thermostat change temperature?','inspect'],
 ['pending','Has my export finished? Tracking ID job-17.','inspect'],
 ['explicit','Run my weekly report now.','execute'],
 ['device_action','Set the living-room thermostat to 24 degrees.','execute'],
 ['ambiguous','Run it again.','clarify']
];
const replay=process.argv[3]?JSON.parse(readFileSync(process.argv[3],'utf8')):null;
const r=replay?{content:JSON.stringify({decisions:replay.decisions}),modelUsed:replay.model,usage:replay.usage}:await chatCompletions({ownerUserId:owner,toolName:'coo_intent_guidance_regression',maxTokens:650,temperature:0,responseFormat:{type:'json_object'},messages:[{role:'system',content:soul+'\nEvaluate independent cases. For each choose the next step: answer (self-contained answer), inspect (relevant read-only evidence), execute (explicit requested action within policy), clarify (material ambiguity). Output JSON {decisions:[{id,step}]}. Do not execute tools. Assume target descriptions are unique except ambiguous references. Effective policy permits the exact actions in explicit requests, with no extra approval required. No standing authorization to start unrelated work. For action cases the schemas/targets are available; for capability and schedule enquiries current metadata has not been supplied.'},{role:'user',content:JSON.stringify({history:'A briefing was previously running; duplicate protection blocked a retry. A notification mentioned an export and a thermostat operation. This is historical context.',cases:cases.map(([id,request])=>({id,request}))})}]});
const d=JSON.parse(r.content);console.log(JSON.stringify({model:r.modelUsed,usage:r.usage,decisions:d.decisions}));assert.equal(d.decisions.length,cases.length);for(const [id,,expected]of cases)assert.ok((Array.isArray(expected)?expected:[expected]).includes(d.decisions.find(x=>x.id===id)?.step),id);
console.log(JSON.stringify({passed:cases.length,model:r.modelUsed,usage:r.usage,decisions:d.decisions,scope:'isolated model-decision test; no actions executed or channel messages sent'}));process.exit(0);





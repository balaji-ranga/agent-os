import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dist=process.argv[2];if(!dist)throw new Error('Supply the installed OpenClaw dist directory');
const files=readdirSync(dist).filter(f=>/^tool-loop-detection-(?!config-).+\.js$/.test(f));assert.equal(files.length,1,'Exactly one installed loop detector is required');
const exports=await import(pathToFileURL(join(dist,files[0])).href);
const named=name=>{const fn=Object.values(exports).find(f=>typeof f==='function'&&f.name===name);assert.ok(fn,`Missing native contract ${name}`);return fn;};
const record=named('recordToolCall'),outcome=named('recordToolCallOutcome'),detect=named('detectToolCallLoop');
const state={},config={enabled:true},scope={runId:'synthetic-loop-test'},tool='connector_execute_action',params={action_id:'gmail.list_drafts',input:{maxResults:1}};let critical=null;
for(let n=0;n<40;n++){const decision=detect(state,tool,params,config,scope);if(decision.stuck&&decision.level==='critical'){critical={attempt:n+1,count:decision.count,detector:decision.detector};break;}record(state,tool,params,'test-'+n,config,scope);outcome(state,{toolName:tool,toolParams:params,toolCallId:'test-'+n,runId:scope.runId,error:new Error('DUPLICATE_NO_PROGRESS: blocked duplicate action')});}
assert.ok(critical&&critical.count<=30,'Repeated identical failures must reach a hard block within the fixed circuit-breaker bound');
assert.equal(detect(state,tool,params,config,{runId:'new-turn'}).stuck,false,'A new request must not inherit exhausted loop state');
console.log(JSON.stringify({synthetic:true,providerCalls:0,critical,newTurnIsolated:true}));

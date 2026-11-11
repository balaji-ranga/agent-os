import assert from 'node:assert/strict';
import {projectDiscoveryResult,projectDiscoveryMessages} from '../../openclaw-extensions/agent-os-content-tools/discovery-projection.js';
const schema={type:'object',required:['id'],properties:{id:{type:'string',pattern:'^[a-z]+$'}}};
const search={ok:true,actions:Array.from({length:60},(_,i)=>({action_id:`service.action_${i}`,description:'Description',granted:i%2===0,available:true,risk_tier:'R2',input_schema:schema,example_input:{id:'abc'},guide_call:{id:'connector_get_action_guide',args:{action_id:`service.action_${i}`}}})),truncated:true,matched_count:100,errors:['unavailable provider']};
const original=structuredClone(search),projected=projectDiscoveryResult('connector_search_actions',search);
assert.deepEqual(search,original);
assert.equal(projected.actions.length,60);
assert.deepEqual(projected.actions.map(a=>a.action_id),search.actions.map(a=>a.action_id));
assert.deepEqual(projected.errors,search.errors);
assert.equal(projected.matched_count,100);
for(let i=0;i<60;i++){assert.equal(projected.actions[i].granted,search.actions[i].granted);assert.equal(projected.actions[i].risk_tier,'R2');assert.equal(projected.actions[i].input_schema,undefined);}
const guide={input_schema:schema,description:'Read safely',guide:'Never perform writes.',raw:{inputSchema:schema,description:'Read safely',security:'Requires grant',outputSchema:{type:'string'}}};
const result=projectDiscoveryResult('connector_get_action_guide',guide);
assert.deepEqual(result.input_schema,schema);
assert.equal(result.guide,guide.guide);
assert.equal(result.raw.security,'Requires grant');
assert.deepEqual(result.raw.outputSchema,{type:'string'});
assert.equal(result.raw.inputSchema,undefined);
for(const name of ['connector_execute_action','floassist_source_read','physical_invoke'])assert.equal(projectDiscoveryResult(name,search),search);
const denied={...search,ok:false};assert.equal(projectDiscoveryResult('connector_search_actions',denied),denied);
assert.equal(projectDiscoveryResult('connector_get_action_guide',null),null);
const message={role:'toolResult',toolCallId:'call-preserved',content:[{type:'text',text:JSON.stringify({tool:{name:'connector_search_actions'},result:{content:[{type:'text',text:JSON.stringify(search)}]}})},{type:'image',data:'unchanged'}]};
const frozen=JSON.stringify(message),messages=projectDiscoveryMessages([message,{role:'user',content:'preserved'}]);
assert.equal(JSON.stringify(message),frozen);
assert.equal(messages[0].toolCallId,'call-preserved');
assert.deepEqual(messages[0].content[1],message.content[1]);
assert.ok(JSON.stringify(messages[0]).length<frozen.length);
assert.equal(projectDiscoveryMessages([{...message,isError:true}])[0].content,message.content);
assert.deepEqual(projectDiscoveryMessages(messages),messages);
console.log('Discovery projection: schemas on demand, all capabilities and permissions retained; source/execution results unchanged.');

// Generic execution projection removes serialization overhead, never source data.
const {compactExecutionEnvelope}=await import('../../openclaw-extensions/agent-os-content-tools/discovery-projection.js');
const payload={content:'Quoted source "evidence"\n'.repeat(500),next_request:{cursor:'page-2'},coverage_complete:false,trackingId:'track-fixture',error:null};
const raw={type:'text',text:JSON.stringify({tool:{id:'tool-fixture',name:'source_read',sourceName:'agent-os-content-tools',description:'Schema already in catalogue '.repeat(100),input:'{...}'},result:{content:[{type:'text',text:JSON.stringify(payload)}],isError:false}})};
const compact=compactExecutionEnvelope(raw);assert(compact.text.length<raw.text.length);assert.deepEqual(JSON.parse(compact.text).result.content[0].data,payload);assert(raw.text.includes('Schema already'),'Audit input remains untouched');
const image={type:'image',data:'fixture',mimeType:'image/png'};assert.equal(compactExecutionEnvelope(image),image);
console.log('EXECUTION_ENVELOPE_OK: source text, cursor, tracking and coverage retained; no transcript mutation');

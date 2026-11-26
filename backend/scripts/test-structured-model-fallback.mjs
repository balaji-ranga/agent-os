import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'structured-fallback-'));
Object.assign(process.env,{AGENT_OS_DATA_DIR:root,OPENCLAW_DIR:root,OPENCLAW_CONFIG_PATH:join(root,'openclaw.json'),OPENSEARCH_ENABLED:'0',MODEL_ROUTING_ENABLED:'0',LITELLM_BASE_URL:'http://fixture-gateway:4000/v1',LITELLM_MASTER_KEY:'fixture',OPENAI_BASE_URL:'http://fixture-gateway:4000/v1',OPENAI_PRIMARY_BASE_URL:'http://fixture-gateway:4000/v1',OPENAI_PRIMARY_MODEL:'fixture-model',OPENAI_MODEL:'fixture-model',OPENAI_API_KEY:'fixture',OPENAI_PRIMARY_API_KEY:'fixture',OPENAI_SECONDARY_BASE_URL:'',OPENAI_SECONDARY_API_KEY:'',OPENAI_SECONDARY_MODEL:''});
const originalFetch=globalThis.fetch,calls=[],schema={type:'object',additionalProperties:false,properties:{mode:{type:'string',enum:['read','run']}},required:['mode']};
try{
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body);calls.push(body);
  if(calls.length===1){assert.equal(body.response_format.type,'json_schema');return new Response(JSON.stringify({error:{message:'response_format json_schema unsupported'}}),{status:400});}
  assert.equal(body.response_format,undefined);
  assert.ok(body.messages.some(m=>m.role==='system'&&m.content.includes(JSON.stringify(schema))),'fallback must still supply the entire machine contract');
  assert.equal(body.messages.at(-1).content,'Retry the exact replied-to task');
  return new Response(JSON.stringify({model:'fixture-model',choices:[{message:{content:JSON.stringify({mode:'read'})},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10}}));
 };
 const {chatCompletions}=await import('../src/config/llm.js');
 const messages=[{role:'system',content:'Resolve the current request from its linked context'},{role:'user',content:'Retry the exact replied-to task'}],original=JSON.stringify(messages);
 const result=await chatCompletions({messages,responseSchema:schema,responseFormat:'json_object',maxTokens:100,endpointPreference:'primary'});
 assert.equal(JSON.parse(result.content).mode,'read');assert.equal(calls.length,2);assert.equal(JSON.stringify(messages),original);
 console.log('STRUCTURED_MODEL_FALLBACK_OK: real completion transport, rejected native format, complete schema retained in retry, bounded attempts and immutable user context; zero upstream model calls');
}finally{globalThis.fetch=originalFetch;rmSync(root,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
const root=mkdtempSync(join(tmpdir(),'local-checker-route-'));
Object.assign(process.env,{AGENT_OS_DATA_DIR:root,OPENCLAW_DIR:root,OPENSEARCH_ENABLED:'0',MODEL_ROUTING_ENABLED:'1',LITELLM_MASTER_KEY:'fixture',LITELLM_BASE_URL:'http://litellm:4000/v1',OPENAI_BASE_URL:'https://maker.invalid/v1',OPENAI_PRIMARY_BASE_URL:'https://maker.invalid/v1',OPENAI_PRIMARY_API_KEY:'fixture',OPENAI_API_KEY:'fixture',OPENAI_PRIMARY_MODEL:'fixture-maker',OPENAI_SECONDARY_BASE_URL:'http://ollama:11434/v1',OPENAI_SECONDARY_API_KEY:'ollama',OPENAI_SECONDARY_MODEL:'fixture-deepseek-checker',OLLAMA_CHECKER_THREADS:'6',OLLAMA_CHECKER_NUM_CTX:'32768'});
const realFetch=globalThis.fetch;let calls=[];
try{
 const {chatCompletions,resolveChatCompletionsConfig}=await import('../src/config/llm.js');
 const {getDb}=await import('../src/db/schema.js');
 const primary=await resolveChatCompletionsConfig({endpointPreference:'primary'});
 assert.equal(primary.cfg.logical_model,'fixture-maker');assert.equal(primary.cfg.primary.baseUrl,'http://litellm:4000/v1');
 const local=await resolveChatCompletionsConfig({endpointPreference:'secondary'});
 assert.equal(local.cfg.primary.model,'fixture-deepseek-checker');assert.equal(local.localCheckerTransport,true);assert.equal(local.cfg.secondary,null);
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return new Response(JSON.stringify({model:'fixture-deepseek-checker',message:{content:'{"approved":true,"issues":[]}'},done:true,done_reason:'stop',prompt_eval_count:20,eval_count:10}));};
 const result=await chatCompletions({endpointPreference:'secondary',toolName:'goal_plan_checker',responseFormat:'json_object',thinkingMode:'disabled',maxTokens:250,messages:[{role:'user',content:'Synthetic checker input'}]});
 assert.equal(result.localModel,true);assert.equal(result.actualModel,'fixture-deepseek-checker');assert.equal(calls.length,1);
 assert.equal(calls[0].url,'http://ollama:11434/api/chat');assert.equal(calls[0].body.think,false);assert.equal(calls[0].body.format,'json');assert.equal(calls[0].body.truncate,false);assert.equal(calls[0].body.options.num_ctx,32768);assert.equal(calls[0].body.options.num_thread,6);assert.equal(calls[0].body.options.num_predict,250);
 calls=[];globalThis.fetch=async(url)=>{calls.push(String(url));return new Response('{"error":"fixture failure"}',{status:503});};
 await assert.rejects(()=>chatCompletions({endpointPreference:'secondary',toolName:'goal_plan_checker',messages:[{role:'user',content:'fixture'}]}));
 assert.deepEqual(calls,['http://ollama:11434/api/chat'],'A local-checker failure cannot become a paid success');
 process.env.OLLAMA_CHECKER_NUM_CTX='invalid';calls=[];
 await assert.rejects(()=>chatCompletions({endpointPreference:'secondary',toolName:'goal_plan_checker',messages:[{role:'user',content:'fixture'}]}),/context limit/);assert.equal(calls.length,0);
 process.env.OLLAMA_CHECKER_NUM_CTX='32768';process.env.OPENAI_SECONDARY_BASE_URL='http://127.0.0.1:18080/v1';
 const otherLocal=await resolveChatCompletionsConfig({endpointPreference:'secondary'});
 assert.notEqual(otherLocal.localCheckerTransport,true,'A generic loopback OpenAI-compatible service is not automatically Ollama');
 getDb().close();console.log('LOCAL_CHECKER_ROUTING_OK: maker preserved, actual local secondary, native JSON/think/context/thread limits, no hidden fallback and invalid-resource refusal');
}finally{globalThis.fetch=realFetch;rmSync(root,{recursive:true,force:true});}

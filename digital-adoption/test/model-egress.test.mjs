import test from 'node:test';
import assert from 'node:assert/strict';
import {completeProvider} from '../integrations/provider-completion.mjs';

test('hosted adoption requests preserve selected provider credentials through the gateway',async()=>{
 const previous={base:process.env.LITELLM_BASE_URL,key:process.env.LITELLM_MASTER_KEY};
 process.env.LITELLM_BASE_URL='http://gateway-fixture:4000/v1';process.env.LITELLM_MASTER_KEY='proxy-fixture';
 try{
  let calls=0;
  for(const key of ['owner-a-fixture','owner-b-fixture'])await completeProvider({config:{baseUrl:'https://provider.invalid/v1',model:'configured-model',apiKey:key},messages:[],maxTokens:100},async(url,init)=>{
   calls++;assert.equal(String(url),'http://gateway-fixture:4000/v1/chat/completions');
   assert.equal(init.headers.Authorization,'Bearer proxy-fixture');
   const body=JSON.parse(init.body),cfg=body.user_config;
   assert.equal(cfg.model_list[0].litellm_params.api_key,key);assert.equal(cfg.model_list[0].litellm_params.model,'openai/configured-model');
   assert.equal(cfg.num_retries,0);assert.deepEqual(cfg.fallbacks,[]);
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{}'}}],usage:{prompt_tokens:10,completion_tokens:2}})};
  });
  delete process.env.LITELLM_MASTER_KEY;
  await assert.rejects(completeProvider({config:{baseUrl:'https://provider.invalid/v1',model:'configured-model',apiKey:'fixture'},messages:[],maxTokens:100},async()=>{calls++;}),e=>e.diagnosticCode==='MODEL_GATEWAY_REQUIRED');
  assert.equal(calls,2,'missing gateway makes no direct request');
 }finally{
  for(const [name,value] of [['LITELLM_BASE_URL',previous.base],['LITELLM_MASTER_KEY',previous.key]])if(value===undefined)delete process.env[name];else process.env[name]=value;
 }
});

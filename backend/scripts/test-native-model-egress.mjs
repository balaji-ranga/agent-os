import assert from 'node:assert/strict';
import {wrapFlolahModelEgress} from '../../openclaw-extensions/agent-os-content-tools/model-egress-transport.js';
const settings={baseUrl:'http://gateway.invalid/v1',apiKey:'gateway-fixture',localBases:[]};
for(const api of ['openai-completions','openai-responses']) {
 const model={api,id:'chosen-model',baseUrl:'https://provider.invalid/v1',provider:'owner-provider'};
 let called=0;
 const wrapped=wrapFlolahModelEgress(async(m,c,o)=>{
  called++;assert.equal(m.baseUrl,settings.baseUrl);assert.equal(o.apiKey,settings.apiKey);
  assert.equal(m.id,model.id);assert.equal(m.api,api);
  const body=await o.onPayload({model:m.id,messages:[]},m);
  assert.equal(body.originalHook,true);
  assert.equal(body.user_config.model_list[0].litellm_params.api_key,'owner-key');
  return 'same-stream';
 },{settings});
 assert.equal(await wrapped(model,{}, {apiKey:'owner-key',onPayload:p=>({...p,originalHook:true})}),'same-stream');
 assert.equal(called,1);
 assert.throws(()=>wrapFlolahModelEgress(()=>{throw Error('must not execute');},{settings:{...settings,apiKey:''}})(model,{}, {apiKey:'owner-key'}),/prohibited/);
}
console.log('NATIVE_MODEL_EGRESS_OK: Chat/Responses model identity and payload hook preserved; BYOK routed; missing proxy fails before provider');

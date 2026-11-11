import assert from 'node:assert/strict';
import {applyPlatformMemoryEmbeddings} from '../src/services/openclaw-memory-embeddings.js';
const endpoint={enabled:true,baseUrl:'http://embedding-fixture:8080/v1/',model:'fixture-embedding',apiKey:'destination-only'};
const gateway={baseUrl:'http://proxy-fixture:4000/v1',apiKey:'proxy-only',model:'fixture-embedding-alias'};
const config={agents:{defaults:{model:{primary:'secondary-chat'}}},memory:{citations:'on',search:{sources:['memory'],remote:{headers:{Authorization:'stale-chat-key'}}}}};
applyPlatformMemoryEmbeddings(config,endpoint,gateway);
assert.deepEqual(config.memory.search,{sources:['memory'],provider:'openai-compatible',fallback:'none',model:gateway.model,remote:{baseUrl:gateway.baseUrl,apiKey:gateway.apiKey,batch:{enabled:false}}});
assert.equal(config.memory.citations,'on');
assert.equal(config.agents.defaults.model.primary,'secondary-chat');
const once=JSON.stringify(config);applyPlatformMemoryEmbeddings(config,endpoint,gateway);assert.equal(JSON.stringify(config),once);
for(const disabled of [{...endpoint,enabled:false},{...endpoint,baseUrl:'https://api.openai.com/v1'},{...endpoint,model:''}]){
 const c=structuredClone(config);applyPlatformMemoryEmbeddings(c,disabled,gateway);
 assert.equal(c.memory.search.provider,'none');assert.equal(c.memory.search.fallback,'none');
 assert.equal(c.memory.search.remote,undefined);assert.equal(c.memory.search.model,undefined);
}
console.log('MEMORY_EMBEDDING_ROUTE_OK: configured destination/model, no chat credential inheritance, no cloud fallback, idempotent, disabled route fails closed');

const missing=structuredClone(config);applyPlatformMemoryEmbeddings(missing,endpoint,{});assert.equal(missing.memory.search.provider,'none');

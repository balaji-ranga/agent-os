import assert from 'node:assert/strict';
import { fetchEfficiencyOllama } from '../src/services/efficiency-ollama-transport.js';

const originalFetch = globalThis.fetch;
const originalThreads = process.env.OLLAMA_EFFICIENCY_THREADS;
const signal = new AbortController().signal;
const body = {model:'llama3.2', messages:[{role:'user',content:'Synthetic fixture'}], max_tokens:100, temperature:0, response_format:{type:'json_object'}, thinking:{type:'disabled'}};
const request = (override={}) => ({method:'POST',headers:{'content-type':'application/json'},signal,body:JSON.stringify({...body,...override})});
try {
  process.env.OLLAMA_EFFICIENCY_THREADS='2';
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url),'http://ollama:11434/api/chat');
    assert.equal(init.signal,signal);
    const native=JSON.parse(init.body);
    assert.deepEqual(native.options,{num_thread:2,num_predict:100,temperature:0});
    assert.equal(native.format,'json');
    assert.equal(native.truncate,false);
    assert.equal(native.stream,false);
    assert.equal(native.think,false);
    assert.deepEqual(native.messages,body.messages);
    return new Response(JSON.stringify({model:'llama3.2:latest',message:{content:'{"query":"synthetic"}'},done:true,done_reason:'stop',prompt_eval_count:5,eval_count:7}));
  };
  const converted=await (await fetchEfficiencyOllama('http://ollama:11434/v1/chat/completions',request())).json();
  assert.equal(converted.model,'llama3.2:latest');
  assert.equal(converted.choices[0].message.content,'{"query":"synthetic"}');
  assert.equal(converted.choices[0].finish_reason,'stop');
  assert.deepEqual(converted.usage,{prompt_tokens:5,completion_tokens:7});
  process.env.OLLAMA_EFFICIENCY_THREADS='4';
  globalThis.fetch=async(_url,init)=>{
    assert.equal(JSON.parse(init.body).options.num_thread,4);
    assert.equal(init.signal,signal);
    return new Response(JSON.stringify({message:{content:'{}'},done:true,done_reason:'stop'}));
  };
  await fetchEfficiencyOllama('http://ollama:11434/v1/chat/completions',request());
  for(const result of [
    {done:false,message:{content:'unfinished'}},
    {done:true,done_reason:'length',message:{content:'truncated'}},
    {done:true,message:{thinking:'private reasoning only'}},
  ]) {
    globalThis.fetch=async()=>new Response(JSON.stringify(result));
    const out=await (await fetchEfficiencyOllama('http://ollama:11434/v1/chat/completions',request())).json();
    if(result.done===false||result.done_reason==='length') assert.equal(out.choices[0].finish_reason,'length');
    else assert.equal(out.choices[0].message.content,'');
    assert.ok(!JSON.stringify(out).includes('private reasoning'));
  }
  const error=new Response('provider failure',{status:503});
  globalThis.fetch=async()=>error;
  assert.equal(await fetchEfficiencyOllama('http://ollama:11434/v1/chat/completions',request()),error);
  let requests=0;
  globalThis.fetch=async()=>{requests++;throw new Error('unexpected request');};
  await assert.rejects(()=>fetchEfficiencyOllama('https://external.example/v1/chat/completions',request()),/private Ollama/);
  await assert.rejects(()=>fetchEfficiencyOllama('http://ollama:11434/v1/chat/completions',request({messages:[{role:'user',content:[]}]})),/text messages/);
  for(const threads of ['0','17','1.5','invalid']) {
    process.env.OLLAMA_EFFICIENCY_THREADS=threads;
    await assert.rejects(()=>fetchEfficiencyOllama('http://ollama:11434/v1/chat/completions',request()),/CPU thread limit/);
  }
  assert.equal(requests,0);
  console.log('PASS efficiency native transport: payload, abort signal, accounting, unfinished/empty output, private endpoint and CPU bounds');
} finally {
  globalThis.fetch=originalFetch;
  if(originalThreads===undefined) delete process.env.OLLAMA_EFFICIENCY_THREADS;
  else process.env.OLLAMA_EFFICIENCY_THREADS=originalThreads;
}

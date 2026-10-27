// Run inside the built gateway, with --network none. Exercises its real stream
// ABI against a fake backend/provider; imports no user sessions or credentials.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dist='/usr/local/lib/node_modules/openclaw/dist';
const root=mkdtempSync(join(tmpdir(),'native-budget-runtime-'));
const originalFetch=globalThis.fetch;
let denied=false,providerCalls=0;
try{
 process.env.OPENCLAW_DIR=root;process.env.OPENCLAW_CONFIG_PATH=join(root,'openclaw.json');process.env.PLATFORM_RUNTIME_SECRETS_PATH=join(root,'runtime-secrets.json');
 mkdirSync(root,{recursive:true});writeFileSync(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify({plugins:{entries:{'agent-os-content-tools':{config:{baseUrl:'https://budget-fixture.invalid'}}}}}));writeFileSync(process.env.PLATFORM_RUNTIME_SECRETS_PATH,JSON.stringify({secrets:{tool_broker:{value:'fixture-only'}}}));
 const requests=[];globalThis.fetch=async(url,options)=>{
  assert.ok(String(url).startsWith('https://budget-fixture.invalid/api/tools/native-model-budget/'));
  const body=JSON.parse(options.body);requests.push({url,body});
  return new Response(JSON.stringify(denied?{error:'Fixture budget exhausted',code:'native_model_token_budget'}:String(url).endsWith('/admit')?{allowed:true,id:body.id,output_limit:100}:{ok:true}),{status:denied?429:200});
 };
 const file=readdirSync(dist).find(name=>/^attempt\.model-diagnostic-events-.*\.js$/.test(name));assert.ok(file);
 assert.match(readFileSync(join(dist,file),'utf8'),/streamFn = wrapFlolahBudgetStream\(streamFn, ctx\)/);
 const runtime=await import(join(dist,file));assert.equal(typeof runtime.t,'function','pinned wrapper export');
 const message={role:'assistant',content:[{type:'text',text:'fixture response'}],usage:{input:20,output:5,cacheRead:10,totalTokens:35},stopReason:'stop'};
 const upstream=async(_model,_context,options)=>{providerCalls++;assert.equal(options.maxTokens,100);return {[Symbol.asyncIterator]:async function*(){yield {type:'text_delta',delta:'fixture response'};yield {type:'done',message};},result:async()=>message};};
 const ctx={runId:'fixture-turn',sessionKey:'agent:t-fixture-owner--fixture-agent:whatsapp:fixture',provider:'fixture',model:'fixture',nextCallId:()=> 'fixture-model-call'};
 const wrapped=runtime.t(upstream,ctx),stream=await wrapped({maxTokens:1000},{systemPrompt:'fixture',messages:[],tools:[]},{});
 const emitted=[];for await(const event of stream)emitted.push(event);assert.equal(emitted[1].message,message);assert.equal(await stream.result(),message);
 assert.equal(requests.filter(r=>String(r.url).endsWith('/admit')).length,1);assert.equal(requests.filter(r=>String(r.url).endsWith('/settle')).length,1);assert.equal(requests.at(-1).body.input_tokens,30);
 denied=true;await assert.rejects(wrapped({maxTokens:1000},{messages:[]},{}),/budget exhausted/);assert.equal(providerCalls,1);
 console.log('NATIVE_MODEL_BUDGET_RUNTIME_OK: installed stream ABI, unchanged content/result, usage, and refusal before provider submission; zero network');
}finally{globalThis.fetch=originalFetch;rmSync(root,{recursive:true,force:true});}

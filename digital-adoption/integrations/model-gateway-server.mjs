// Independent backend integration. Reads only the active-slot setting; never
// writes the platform database or imports Platform Help/OpenClaw runtime code.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createPlatformGateway} from './platform-gateway.mjs';
const config=JSON.parse(readFileSync(process.env.ADOPTION_GATEWAY_CONFIG||'/config/gateway.json','utf8'));
const database=new DatabaseSync(process.env.ADOPTION_PLATFORM_DB||'/platform/agent-os.db',{readOnly:true});
const handler=createPlatformGateway({serviceToken:config.serviceToken,
 resolveActive:async()=>{
  const active=database.prepare("SELECT value FROM platform_settings WHERE key='llm_active_endpoint'").get()?.value==='secondary'?'secondary':'primary';
  const endpoint=config[active];if(!endpoint?.baseUrl||!endpoint?.model||!endpoint?.apiKey)throw new Error('Active endpoint is not configured');
  return {active,...endpoint};
 },
 complete:async({config:ep,messages,maxTokens})=>{
  const url=new URL(ep.baseUrl.replace(/\/$/,'')+'/chat/completions');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['litellm','ollama'].includes(url.hostname)))throw new Error('Invalid provider transport');
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(45_000),headers:{Authorization:`Bearer ${ep.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:ep.model,messages,max_tokens:maxTokens,temperature:0,response_format:{type:'json_object'}})});
  if(!response.ok)throw new Error('Provider rejected request');
  const data=await response.json();const content=data.choices?.[0]?.message?.content;
  if(typeof content!=='string'||content.length>32_000)throw new Error('Invalid provider response');
  return {content};
 }});
createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 if(req.method==='GET'&&req.url==='/health'){res.end('{"status":"ok"}');return;}
 if(req.method!=='POST'||req.url!=='/complete'||req.headers.origin){res.writeHead(403);res.end('{"error":"Denied"}');return;}
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32_768)throw new Error('Too large');}
  const output=await handler({authorization:req.headers.authorization,body:JSON.parse(raw)});res.end(JSON.stringify(output));
 }catch{res.writeHead(503);res.end('{"error":"Model gateway unavailable"}');}
}).listen(4195,'0.0.0.0');

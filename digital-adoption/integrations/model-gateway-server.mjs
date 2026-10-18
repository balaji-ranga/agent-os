// Independent backend integration. Reads Admin model/review settings; never
// writes the platform database or imports Platform Help/OpenClaw runtime code.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createPlatformGateway} from './platform-gateway.mjs';
import {resolveGatewaySettings} from './gateway-settings.mjs';
import {createProviderCompletion} from './provider-completion.mjs';
const config=JSON.parse(readFileSync(process.env.ADOPTION_GATEWAY_CONFIG||'/config/gateway.json','utf8'));
const database=new DatabaseSync(process.env.ADOPTION_PLATFORM_DB||'/platform/agent-os.db',{readOnly:true});
const handler=createPlatformGateway({serviceToken:config.serviceToken,
 resolveActive:async()=>resolveGatewaySettings(database,config),complete:createProviderCompletion({localConcurrency:config.ollamaReasoning?.concurrency||1})});
createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 if(req.method==='GET'&&req.url==='/health'){res.end('{"status":"ok"}');return;}
 if(req.method!=='POST'||req.url!=='/complete'||req.headers.origin){res.writeHead(403);res.end('{"error":"Denied"}');return;}
 const controller=new AbortController(),deadline=AbortSignal.timeout(38_000),signal=AbortSignal.any([controller.signal,deadline]);
 res.on('close',()=>{if(!res.writableEnded)controller.abort();});
 const started=Date.now();
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32_768)throw new Error('Too large');}
  const body=JSON.parse(raw),output=await handler({authorization:req.headers.authorization,body,signal});
  console.info(JSON.stringify({event:'copilot_model',purpose:body.purpose,active:output.active,quality:output.quality,latencyMs:Date.now()-started}));
  res.end(JSON.stringify(output));
 }catch(error){const code=['COPILOT_CHECKER_UNAVAILABLE','COPILOT_REVIEW_FAILED'].includes(error.code)?error.code:'MODEL_UNAVAILABLE';console.info(JSON.stringify({event:'copilot_model_failed',code,latencyMs:Date.now()-started}));res.writeHead(503);res.end(JSON.stringify({error:'Model review unavailable',code}));}
}).listen(4195,'0.0.0.0');

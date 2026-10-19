// Isolated UAT process: publish only on VPS loopback and reach it via a
// loopback-bound SSH tunnel. The platform database/config stay read-only.
import {AsyncLocalStorage} from 'node:async_hooks';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {timingSafeEqual} from 'node:crypto';
import {createPlatformGateway} from '/adoption/integrations/platform-gateway.mjs';
import {createProviderCompletion} from '/adoption/integrations/provider-completion.mjs';
import {resolveGatewaySettings} from '/adoption/integrations/gateway-settings.mjs';
const config=JSON.parse(await readFile('/config/gateway.json','utf8')),db=new DatabaseSync('/platform/agent-os.db',{readOnly:true}),token=Buffer.from((await readFile('/token/uat','utf8')).trim());
if(token.length!==64)throw new Error('Invalid UAT token');
const original=db.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value;
const trace=new AsyncLocalStorage(),tracedFetch=async(...args)=>{const response=await fetch(...args);try{const body=await response.clone().json(),turn=body.choices?.[0];if(turn){const state=trace.getStore();if(state)state.push({finishReason:turn.finish_reason,completionTokens:body.usage?.completion_tokens,contentLength:turn.message?.content?.length,verdict:(()=>{try{const value=JSON.parse(turn.message.content);return {parseable:true,keys:Object.keys(value),feedbackLength:value.feedback?.length,decision:value.decision,checks:value.checks};}catch{return {parseable:false};}})()});}}catch{}return response;};
const gateway=createPlatformGateway({serviceToken:config.serviceToken,complete:createProviderCompletion({localConcurrency:1,fetchImpl:tracedFetch}),resolveActive:async()=>{const active=resolveGatewaySettings(db,config),slot=active.active==='primary'?'secondary':'primary';return {...active,quality:{enabled:true,checkerMode:'platform_inactive',checkerMaxTokens:2048},checker:{...config[slot],slot,maxTokens:2048}};}});
const server=createServer(async(req,res)=>{
 const actual=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,''));
 if(req.method!=='POST'||req.url!=='/complete'||actual.length!==token.length||!timingSafeEqual(actual,token)){res.writeHead(403);return res.end();}
 const diagnostics=[];let size=0;const chunks=[],controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
 try{for await(const chunk of req){size+=chunk.length;if(size>32768)throw new Error('Request limit');chunks.push(chunk);}const response=await trace.run(diagnostics,()=>gateway({authorization:'Bearer '+config.serviceToken,body:JSON.parse(Buffer.concat(chunks)),signal:controller.signal}));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(response));}
 catch(error){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Isolated model request failed',code:error.publicCode||error.code||'MODEL_UNAVAILABLE',diagnosticCode:error.diagnosticCode,providerStatus:error.providerStatus,diagnostics}));}
});
server.listen(4197,'0.0.0.0',()=>console.log('Loopback-mapped UAT relay ready; active maker / passive checker; shared settings read-only.'));
function close(){if(db.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value!==original)console.log('Shared setting changed externally during test');else console.log('Shared setting unchanged');server.close();db.close();}
process.on('SIGTERM',()=>{close();process.exit(0);});setTimeout(()=>{close();process.exit(0);},30*60*1000).unref();

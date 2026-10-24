// Real configured maker/checker with read-only settings and synthetic/public UI.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createPlatformGateway} from '/candidate/integrations/platform-gateway.mjs';
import {reviewCopilotResponse} from '/candidate/integrations/maker-checker.mjs';
import {resolveGatewaySettings} from '/adoption/integrations/gateway-settings.mjs';
import {createProviderCompletion} from '/adoption/integrations/provider-completion.mjs';
import {createPlatformPlanner} from '/candidate/src/platform-model.mjs';
import {createKnowledgeAnswer} from '/candidate/src/knowledge-answer.mjs';
import {pageUnderstandingPrompt,pageObservationEvidence} from '/candidate/src/page-understanding.mjs';
const config=JSON.parse(await readFile('/config/gateway.json','utf8')),db=new DatabaseSync('/platform/agent-os.db',{readOnly:true}),snapshots=JSON.parse(await readFile('/candidate/test/evidence/page-understanding-20261024/snapshots.json','utf8')),results=[],trace=[];
const setting=db.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value;
const provider=createProviderCompletion(),complete=async request=>{const start=Date.now(),result=await provider(request);trace.push({role:request.config.slot?'checker':'maker',latencyMs:Date.now()-start,response:JSON.parse(result.content),receivedFeedback:request.messages.at(-1).content.includes('boundedCheckerFeedback')});return result;};
const active=async()=>{const c=resolveGatewaySettings(db,config);assert.equal(c.quality.enabled,true);return c;},gateway=createPlatformGateway({serviceToken:config.serviceToken,complete,resolveActive:active});
let quality;
const fetchImpl=async(_,options)=>{const result=await gateway({authorization:options.headers.Authorization,body:JSON.parse(options.body),signal:options.signal});quality=result.quality;return new Response(JSON.stringify(result));};
const reader=createKnowledgeAnswer({gatewayUrl:'https://isolated.invalid/model',serviceToken:config.serviceToken,fetchImpl,requestDeadlineMs:120000});
const planner=createPlatformPlanner({gatewayUrl:'https://isolated.invalid/model',serviceToken:config.serviceToken,fetchImpl,requestDeadlineMs:120000});
async function check(id,fn){const start=Date.now();const detail=await fn();results.push({id,passed:true,latencyMs:Date.now()-start,...detail});console.log(JSON.stringify(results.at(-1)));}
try{
 const source=snapshots.public,match=source.pageContext.structure.map(e=>e.label).join('\n').match(/([\d,]+) approved listings/),total=Number(match[1].replaceAll(',','')),loaded=source.pageContext.collections.find(c=>c.labels.some(l=>l.includes('/'))).itemCount,pages=Math.ceil(total/loaded);
 for(const [name,answer] of [['prepare',planner],['ask',reader]])await check(name+'-sequential-scope-change',async()=>{
  const history=[],messages=[];
  for(const [text,numbers]of [['what is the total approved listing',[total]],['how many MCPS listed and how many pages totally?',[loaded,total,pages]],['how many MCPs are listed in this page',[loaded]]]){
   const out=await answer({text,snapshot:source,evidence:[],history});for(const n of numbers)assert.match(out.message.replaceAll(',',''),new RegExp('\\b'+n+'\\b'));assert.equal(quality.decision,'accept');messages.push({text,message:out.message,quality});history.push({role:'user',text},{role:'assistant',text:out.message});
  }
  return {messages};
 });
 await check('ask-public-dataset-loaded-and-derived-page-count',async()=>{const answer=await reader({text:'What is the total approved listing, how many MCPs are listed on this page and how many pages totally? Explain what is observed and what you infer.',snapshot:source,evidence:[]});const message=answer.message.replaceAll(',','');for(const n of [total,loaded,pages])assert.match(message,new RegExp('\\b'+n+'\\b'));assert.match(answer.message,/assum|estimat|if .*page|calculat|infer/i);assert.equal(answer.pageObserved,true);assert.equal(quality.decision,'accept');return {message:answer.message,quality};});
 await check('ask-independent-form-label-and-description-relationships',async()=>{const answer=await reader({text:'What does the Serial reference input in Warranty claim mean, and is Submit claim available? Do not change anything.',snapshot:snapshots.tail,evidence:[]});assert.match(answer.message,/purchase certificate/i);assert.match(answer.message,/disabled|not (?:available|enabled)|unavailable/i);assert.equal(quality.decision,'accept');return {message:answer.message,quality};});
 await check('prepare-read-only-independent-table-and-pagination',async()=>{const answer=await planner({text:'How many assets are registered, how many rows are loaded and how many pages would that mean if each page has this capacity? Do not navigate.',snapshot:snapshots.generic});for(const n of [107,10,11])assert.match(answer.message,new RegExp('\\b'+n+'\\b'));assert.deepEqual(answer.actions,[]);assert.equal(quality.decision,'accept');return {message:answer.message,quality};});
 await check('real-checker-repairs-false-absence-and-maker-rechecked',async()=>{const before=trace.length,result=await reviewCopilotResponse({config:await active(),purpose:'digital_adoption_plan',messages:[{role:'system',content:pageUnderstandingPrompt+' Read the supplied current-page evidence. Return only JSON {intent:"explain",message:string,actions:[]}. Never activate controls.'},{role:'user',content:JSON.stringify({task:'Explain what Serial reference means specifically in Warranty claim and whether Submit claim is usable.',observed:snapshots.tail,pageEvidence:pageObservationEvidence(snapshots.tail)})}],draft:JSON.stringify({intent:'explain',message:'The information is not visible. Search the website or ask its owner.',actions:[]}),complete,signal:AbortSignal.timeout(120000)});const answer=JSON.parse(result.content);assert.match(answer.message,/purchase certificate/i);assert.match(answer.message,/disabled|not (?:available|enabled)|unavailable/i);assert.ok(result.quality.checkerRevisions>=1);assert.ok(trace.slice(before).some(t=>t.role==='maker'&&t.receivedFeedback));assert.equal(result.quality.decision,'accept');return {message:answer.message,quality:result.quality,trace:trace.slice(before)};});
 assert.equal(db.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value,setting);
}finally{await writeFile('/output/model-results.json',JSON.stringify({at:new Date().toISOString(),results,trace,sharedSettingsUnchanged:db.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value===setting},null,2));db.close();}

import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {arithmeticEvidence} from '../src/arithmetic-evidence.mjs';
const {chromium}=await import(process.env.ADOPTION_PLAYWRIGHT_MODULE?pathToFileURL(process.env.ADOPTION_PLAYWRIGHT_MODULE):new URL('./frameworks/node_modules/playwright/index.mjs',import.meta.url));
const out=new URL('./evidence/page-understanding-20261024/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),results=[];let publicWrites=0;
page.setDefaultTimeout(40000);
await page.route('https://flolah.cloud/**',r=>!['GET','HEAD','OPTIONS'].includes(r.request().method())?(publicWrites++,r.abort()):r.continue());
const panel=page.frameLocator('iframe[data-adoption-widget]');
async function send(mode,text,{reply=false}={}){
 await panel.locator('#chat-mode').selectOption(mode);if(reply)await panel.getByRole('button',{name:'Reply to assistant message',exact:true}).last().click();
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(mode==='knowledge'?'/v1/ask':'/v1/plan'),{timeout:150000}),start=Date.now();await panel.locator('#message').fill(text);await panel.locator('#plan').click();
 const res=await response,data=await res.json(),input=res.request().postDataJSON();assert.equal(res.status(),200,JSON.stringify(data));assert.ok(input.snapshot?.pageContext?.structure?.length);assert.ok(Buffer.byteLength(res.request().postData())<32768);await panel.locator('#plan:not([disabled])').waitFor();assert.equal(await panel.locator('#error-banner').isVisible(),false);
 const arithmeticChecks=arithmeticEvidence(data.message);for(const c of arithmeticChecks)assert.ok(c.matchesRoundedValue||c.claimed===c.ceiling||Math.abs(c.computed-c.claimed)<0.01,JSON.stringify(c));
 return {message:data.message,actions:data.actions||[],pageObserved:data.pageObserved,replyTo:input.replyTo,latencyMs:Date.now()-start,requestBytes:Buffer.byteLength(res.request().postData()),arithmeticChecks};
}
async function check(id,fn){try{const detail=await fn();await page.screenshot({path:fileURLToPath(new URL(id+'.png',out))});results.push({id,passed:true,...detail,screenshot:id+'.png'});console.log(JSON.stringify(results.at(-1)));}catch(error){await page.screenshot({path:fileURLToPath(new URL(id+'-failed.png',out))});results.push({id,passed:false,error:error.message});throw error;}}
try{
 await page.goto('https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1');await panel.locator('#message').waitFor();const loaded=await page.locator('#grid h2').count(),label=await page.locator('#directory').innerText(),total=Number(label.match(/([\d,]+) approved listings/)[1].replaceAll(',','')),pages=Math.ceil(total/loaded),beforeTransport=await page.locator('#transport').inputValue();
 for(const mode of ['guide','knowledge']){
  for(const [name,text,numbers]of [['total','what is the total approved listing',[total]],['pages','how many MCPS listed and how many pages totally?',[loaded,total,pages]],['loaded','how many MCPs are listed in this page',[loaded]]])await check(mode+'-'+name,async()=>{const answer=await send(mode,text);for(const n of numbers)assert.match(answer.message.replaceAll(',',''),new RegExp('\\b'+n+'\\b'));if(name==='pages')assert.match(answer.message,/assum|estimat|calculat|infer|if .*page/i);assert.deepEqual(answer.actions,[]);if(mode==='knowledge')assert.equal(answer.pageObserved,true);return answer;});
 }
 await check('knowledge-reply-continuity',async()=>{const answer=await send('knowledge','And how many pages would that make, assuming the same capacity?',{reply:true});assert.ok(answer.replyTo);assert.match(answer.message,new RegExp('\\b'+pages+'\\b'));assert.equal(answer.pageObserved,true);return answer;});
 await check('question-preserves-pending-field-review',async()=>{
  const draft=await send('guide','Set Search MCPs, publishers, capabilities… to "uat-page-understanding". Do not click Search, navigate, save or submit.');assert.ok(draft.actions.some(a=>a.type==='fill'));
  const approve=panel.getByRole('button',{name:'Approve field changes',exact:true});await approve.waitFor();
  const answer=await send('knowledge','How many items are loaded on this page?');assert.match(answer.message,new RegExp('\\b'+loaded+'\\b'));
  await panel.locator('#chat-mode').selectOption('guide');await approve.click();await page.waitForFunction(()=>document.querySelector('#q').value==='uat-page-understanding');assert.equal(await page.locator('#transport').inputValue(),beforeTransport);assert.equal(await page.locator('#grid h2').count(),loaded);await page.locator('#q').fill('');return {message:answer.message,reviewAppliedAfterQuestion:true,publicSubmission:false};
 });
 assert.equal(publicWrites,0);assert.equal(await page.locator('#transport').inputValue(),beforeTransport);
}finally{await writeFile(new URL('live-browser-results.json',out),JSON.stringify({at:new Date().toISOString(),results,publicWrites},null,2));await browser.close();}
console.log(JSON.stringify({passed:results.length,failed:0,publicWrites}));

// Actual deployed public copilot; no host forms, navigation or submission.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import('./frameworks/node_modules/playwright/index.mjs');
const out=new URL('./evidence/page-inspection-20261023/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),results=[];let publicWrites=0,previousRevision;
await context.route('https://flolah.cloud/**',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.request().method())){publicWrites++;return r.abort();}return r.continue();});
try{
 await page.goto('https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1');const panel=page.frameLocator('iframe[data-adoption-widget]');await panel.locator('#message').waitFor({timeout:30000});const expected=await page.locator('#grid h2').count();assert.equal(expected,24);
 for(const [id,text,reply]of [['live-initial-page-count','How many MCPs are listed on this page?',false],['live-reply-full-dom-reinspection','Inspect full dome, there are more?',true]]){
  if(reply)await panel.getByRole('button',{name:'Reply to assistant message',exact:true}).last().click();
  const pending=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/v1/plan'),{timeout:150000}),started=Date.now();await panel.locator('#message').fill(text);await panel.locator('#plan').click();const response=await pending,data=await response.json(),input=response.request().postDataJSON();assert.equal(response.status(),200,JSON.stringify(data));assert.match(data.message,/\b24\b/);assert.deepEqual(data.actions,[]);assert.ok(input.snapshot.pageContext.collections.some(c=>c.itemCount===24&&!c.truncated));if(reply){assert.ok(input.replyTo);assert.notEqual(input.snapshot.revision,previousRevision);}previousRevision=input.snapshot.revision;
  await panel.locator('#plan:not([disabled])').waitFor();assert.equal(await panel.locator('#error-banner').isVisible(),false);assert.match(await panel.locator('#log p[data-role=assistant]').last().innerText(),/\b24\b/);await page.screenshot({path:fileURLToPath(new URL(id+'.png',out))});results.push({id,passed:true,message:data.message,replyToProvided:!!input.replyTo,freshSnapshotRevision:input.snapshot.revision,requestBytes:Buffer.byteLength(response.request().postData()),latencyMs:Date.now()-started,screenshot:id+'.png'});
 }
 assert.equal(publicWrites,0);console.log(JSON.stringify({passed:results.length,failed:0,publicWrites,results}));
}finally{await writeFile(new URL('live-browser-results.json',out),JSON.stringify({at:new Date().toISOString(),results,publicWrites},null,2));await browser.close();}

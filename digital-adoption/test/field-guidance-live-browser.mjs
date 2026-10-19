// Actual deployed installation; read-only pointing and knowledge greeting.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import('./frameworks/node_modules/playwright/index.mjs');
const out=new URL('./evidence/field-guidance-20261019/live/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
let publicWrites=0;
try{for(const [site,url,prompt,selector]of [['local','http://127.0.0.1:4194/customer','Where is company name field','[name=company_name]'],['public','https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1','Where is search field','#q']]){
 const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();context.setDefaultTimeout(20000);
 await context.route('https://flolah.cloud/**',route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){publicWrites++;return route.abort();}return route.continue();});
 await page.goto(url);const panel=page.frameLocator('iframe[data-adoption-widget]');await panel.locator('#message').waitFor();const before=await page.locator(selector).inputValue();
 async function check(id,fn){try{const detail=await fn(),screenshot=site+'-'+id+'.png';await page.screenshot({path:fileURLToPath(new URL(screenshot,out))});results.push({id:site+'_'+id,status:'passed',detail,screenshot});}catch(error){results.push({id:site+'_'+id,status:'failed',detail:error.message});await page.screenshot({path:fileURLToPath(new URL(site+'-failed.png',out))});throw error;}}
 await check('WHERE_POINTS_TO_ACTUAL_INPUT',async()=>{const start=Date.now();await panel.locator('#message').fill(prompt);await panel.locator('#plan').click();const marker=page.locator('[data-adoption-highlight=true]');await marker.waitFor();const box=await marker.boundingBox(),target=await page.locator(selector).boundingBox();assert.ok(Math.abs(box.x-target.x+3)<1);assert.ok(Math.abs(box.width-target.width-6)<1);assert.equal(await page.locator(selector).inputValue(),before);return {elapsedMs:Date.now()-start,inputUnchanged:true};});
 await check('SHOW_ME_WHERE_REUSES_TARGET_WITHOUT_ABORT_ERROR',async()=>{await panel.locator('#plan:not([disabled])').waitFor();await panel.locator('#choice-guide').click();await page.locator('[data-adoption-highlight=true]').waitFor();await panel.locator('#choice-guide:not([disabled])').waitFor();assert.equal(await panel.locator('#error-banner').isVisible(),false);assert.doesNotMatch(await panel.locator('#log').innerText(),/aborted without reason|\[20\]/);assert.equal(await page.locator(selector).inputValue(),before);});
 await check('ASK_A_QUESTION_GREETING_USES_KNOWLEDGE',async()=>{await panel.locator('#choice-question').click();await panel.locator('#message').fill('Hello');await panel.locator('#plan').click();await panel.locator('#log p[data-role=assistant]').getByText(/Hello!/).waitFor();assert.equal(await panel.locator('#review button').count(),0);});
 await context.close();
}assert.equal(publicWrites,0);}finally{await writeFile(new URL('results.json',out),JSON.stringify({at:new Date().toISOString(),scope:'Actual deployed registrations on both approved domains; no host form submission or model-route override. Pointing is local-control lookup; greeting does not require LLM inference.',results,publicWrites},null,2));await browser.close();}
console.log(JSON.stringify({results,publicWrites}));

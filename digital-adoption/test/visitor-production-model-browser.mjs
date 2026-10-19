// Actual deployed models/settings and registration. Synthetic loopback values.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import('./frameworks/node_modules/playwright/index.mjs');
const out=new URL('./evidence/field-guidance-20261019/production-model/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try{for(const kind of ['knowledge','prepare']){
 const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();context.setDefaultTimeout(210000);let hostWrites=0;
 await context.route('http://127.0.0.1:4194/**',route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){hostWrites++;return route.abort();}return route.continue();});
 await page.goto('http://127.0.0.1:4194/customer');const panel=page.frameLocator('iframe[data-adoption-widget]');await panel.locator('#message').waitFor();
 const start=Date.now();let payload,status;
 try{const endpoint=kind==='knowledge'?'/v1/ask':'/v1/plan';
  if(kind==='knowledge')await panel.locator('#choice-question').click();else{await page.getByRole('button',{name:'Add native controls',exact:true}).click();await panel.locator('#choice-prepare').click();}
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith(endpoint)&&response.request().method()==='POST');
  await panel.locator('#message').fill(kind==='knowledge'?'What is the Alpha delivery promise?':'Set Shipping method to expres and select Include gift wrap. Do not save.');await panel.locator('#plan').click();const response=await responsePromise;status=response.status();payload=await response.json();assert.equal(response.ok(),true,JSON.stringify(payload));await panel.locator('#plan:not([disabled])').waitFor();
  if(kind==='prepare'){assert.match(await panel.locator('#review').innerText(),/Shipping method: Express/);assert.match(await panel.locator('#review').innerText(),/Include gift wrap: Selected/);await panel.getByRole('button',{name:'Approve field changes',exact:true}).click();await panel.locator('#status').getByText(/approved field values verified/).waitFor();assert.equal(await page.locator('[name=shipping_method]').inputValue(),'express');assert.equal(await page.locator('[name=gift_wrap]').isChecked(),true);}
  else{assert.ok(['answer','no_evidence','greeting'].includes(payload.kind));if(payload.kind==='answer')assert.ok(payload.citations.length);assert.equal(await panel.locator('#review button').count(),0);}
  assert.equal(hostWrites,0);results.push({id:'LIVE_'+kind.toUpperCase(),status:'passed',httpStatus:status,elapsedMs:Date.now()-start,response:payload,hostWrites,screenshot:kind+'.png'});
 }catch(error){results.push({id:'LIVE_'+kind.toUpperCase(),status:'failed',httpStatus:status,elapsedMs:Date.now()-start,detail:error.message,response:payload,hostWrites,screenshot:kind+'.png'});}
 await page.screenshot({path:fileURLToPath(new URL(kind+'.png',out))});await context.close();await writeFile(new URL('results.json',out),JSON.stringify({at:new Date().toISOString(),scope:'Actual deployed registrations and global checker route. No model override, shared configuration change or host Save.',results},null,2));console.log(JSON.stringify(results.at(-1)));
}}finally{await browser.close();}

if(results.some(result=>result.status==='failed'))process.exitCode=1;

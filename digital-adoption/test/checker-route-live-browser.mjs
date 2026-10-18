// Run after Admin selects the checker route. Uses only synthetic loopback UI.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import('./frameworks/node_modules/playwright/index.mjs');
const out=new URL('../.local/maker-checker-evidence/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),frame=page.frameLocator('iframe[data-adoption-widget]');
context.setDefaultTimeout(60000);let writes=0;
await context.route('**/*',route=>{const request=route.request();if(new URL(request.url()).hostname==='127.0.0.1'&&!['GET','HEAD','OPTIONS'].includes(request.method())){writes++;return route.abort();}return route.continue();});
try{
 await page.goto('http://127.0.0.1:4194/customer');await frame.locator('#private-task').waitFor();await page.getByRole('button',{name:'Decline analytics',exact:true}).click({timeout:2000}).catch(()=>{});await page.getByRole('button',{name:'Add native controls',exact:true}).click();
 const before=await page.locator('[name=shipping_method]').inputValue(),started=Date.now(),pending=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/v1/plan')&&r.request().method()==='POST');
 await frame.locator('#message').fill('Set Shipping method to Express. Do not save.');await frame.locator('#plan').click();const response=await pending,payload=await response.json();
 let result;if(response.ok()){await frame.locator('#review').getByText(/Shipping method: Express/i).waitFor();result={status:'passed',outcome:'Checked Express proposal offered for visitor approval',review:await frame.locator('#review').innerText()};}
 else{assert.equal(response.status(),503);assert.ok(['COPILOT_CHECKER_UNAVAILABLE','COPILOT_REVIEW_FAILED'].includes(payload.code));await frame.getByText(/checker is unavailable|review could not validate/i).last().waitFor();assert.equal(await frame.locator('#review button').count(),0);result={status:'partial',outcome:'Configured checker did not return an accepted proposal within the live request; failed closed',code:payload.code};}
 assert.equal(await page.locator('[name=shipping_method]').inputValue(),before);assert.equal(writes,0);result={...result,at:new Date().toISOString(),httpStatus:response.status(),elapsedMs:Date.now()-started,hostWrites:writes,fieldUnchanged:true};await page.screenshot({path:new URL('ollama-route.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:false});await writeFile(new URL('ollama-route.json',out),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}

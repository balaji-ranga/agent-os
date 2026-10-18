// Live chained LLM context test: hide the synthetic current form after inspection.
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import('./frameworks/node_modules/playwright/index.mjs');
const out=new URL('../.local/feedback-context/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage({viewport:{width:1440,height:1050}});p.setDefaultTimeout(20000);const f=p.frameLocator('iframe[data-adoption-widget]');
let inspections=0,summaries=0;const results=[];
await p.route('**/v1/tasks/command-plan',async route=>{const request=route.request().postDataJSON(),response=await route.fetch(),body=await response.json();
 if(body.observed){inspections++;await p.locator('#toggle-host-form').click();assert.equal(await p.locator('#demo-form').isVisible(),false);results.push({stage:'inspect',observedFields:body.observed.fields.map(x=>x.label),hiddenBeforeNextStep:true});}
 else{summaries++;assert.equal(request.snapshot.fields.length,0);assert.match(body.message,/Company name/i);assert.match(body.message,/Contact email/i);assert.match(body.message,/Region/i);results.push({stage:'summary',currentFields:request.snapshot.fields.length,message:body.message,citations:body.citations,evidence:body.evidence});await writeFile(new URL('chain-result.json',out),JSON.stringify({at:new Date().toISOString(),results},null,2));}
 await p.screenshot({path:new URL(body.observed?'inspection-incoming.png':'summary-incoming-current-form-hidden.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:false,mask:[f.locator('#pair-link-code'),f.locator('#pair-code')]});await route.fulfill({response});
});
try{await p.goto('http://127.0.0.1:4194/customer');await f.locator('#private-task').waitFor();await f.locator('#private-task>summary').press('Space');await f.locator('#private-task details>summary').press('Space');await f.locator('#pair-name').fill('Chained context UAT');await f.locator('#pair-link').press('Enter');await f.locator('#pair-link-code').getByText(/expires/).waitFor();const code=(await f.locator('#pair-link-code').innerText()).split(' · ')[0];await writeFile(new URL('link.json',out),JSON.stringify({code}));console.log(JSON.stringify({event:'link_ready',code}));
 const rl=createInterface({input:process.stdin});for await(const line of rl){const c=JSON.parse(line);if(c.op==='status'){console.log(JSON.stringify({inspections,summaries,state:await f.locator('#task-state').innerText(),chat:await f.locator('#log').innerText()}));await p.screenshot({path:new URL('chain-completed.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:false,mask:[f.locator('#pair-link-code')]});}else if(c.op==='close'){rl.close();break;}}
}finally{await browser.close();}

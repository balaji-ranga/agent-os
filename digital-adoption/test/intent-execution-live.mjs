import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.ADOPTION_PLAYWRIGHT_MODULE));
const out=new URL(process.env.ADOPTION_INTENT_EVIDENCE||'./evidence/intent-execution-20261024/before/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[],traces=[];
const cases=[
 {id:'public-search-long',site:'public',text:'search for events related MCP and get the results',check:r=>assert.ok(r.actions.some(a=>a.type==='fill'&&/events/i.test(a.value)))},
 {id:'public-search-short',site:'public',text:'search for events MCP',check:r=>assert.ok(r.actions.some(a=>a.type==='fill'&&/events/i.test(a.value)))},
 {id:'local-fill',site:'local',text:'Fill Company name with Intent UAT, Contact email with intent.uat@example.test, and Region with Singapore. Do not save.',check:r=>assert.equal(r.actions.filter(a=>a.type==='fill').length,3)},
 {id:'local-navigation',site:'local',text:'Open the Opportunity form.',check:r=>assert.ok(r.actions.some(a=>a.type==='navigate'))}
];
try{for(const c of cases){if(process.env.ADOPTION_INTENT_CASES&&!process.env.ADOPTION_INTENT_CASES.split(',').includes(c.id))continue;const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();await page.route('https://flolah.cloud/**',r=>!['GET','HEAD','OPTIONS'].includes(r.request().method())?r.abort():r.continue());
 try{await page.goto(c.site==='public'?'https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1':'http://127.0.0.1:4194/customer');const panel=page.frameLocator('iframe[data-adoption-widget]');await panel.locator('#message').waitFor({timeout:40000});const pending=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/v1/plan'),{timeout:150000});await panel.locator('#message').fill(c.text);await panel.locator('#plan').click();const response=await pending,result=await response.json();traces.push({id:c.id,status:response.status(),request:response.request().postDataJSON(),result});assert.equal(response.status(),200,JSON.stringify(result));await panel.locator('#plan:not([disabled])').waitFor();c.check(result);await panel.locator('#review').getByRole('button',{name:c.id==='local-navigation'?'Approve navigation':'Approve field changes',exact:true}).waitFor();results.push({id:c.id,passed:true,message:result.message,actions:result.actions});}
 catch(error){results.push({id:c.id,passed:false,error:error.message});}finally{await page.screenshot({path:fileURLToPath(new URL(c.id+'.png',out))});await context.close();console.log(JSON.stringify(results.at(-1)));}}
}finally{await writeFile(new URL('results.json',out),JSON.stringify({at:new Date().toISOString(),results,traces},null,2));await browser.close();}
if(results.some(r=>!r.passed))process.exitCode=1;

// UI-only observer. It never fills a host input, clicks Save or writes a record API.
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import('./frameworks/node_modules/playwright/index.mjs');
const out=new URL('../.local/workflow-e2e/',import.meta.url);await mkdir(new URL('evidence/',out),{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({viewport:{width:1440,height:1100}}),p=await ctx.newPage(),f=p.frameLocator('iframe[data-adoption-widget]');
ctx.setDefaultTimeout(20000);const writes=[],events=[];
const shot=async name=>p.screenshot({path:new URL('evidence/'+name+'.png',out).pathname.replace(/^\/C:/,'C:'),mask:[f.locator('#pair-link-code'),f.locator('#pair-code')],fullPage:false});
p.on('response',async r=>{if(r.url()==='http://127.0.0.1:4194/api/records'&&r.request().method()==='POST'){writes.push({at:new Date().toISOString(),status:r.status(),request:JSON.parse(r.request().postData()),response:await r.json()});await shot('save-'+writes.length);await writeFile(new URL('writes.json',out),JSON.stringify(writes,null,2));console.log(JSON.stringify({event:'host_save',count:writes.length,status:r.status()}));}});
p.on('request',r=>{if(r.url().includes('/v1/tasks/command-plan'))events.push({at:new Date().toISOString(),event:'command_plan'});});
try{
 await p.goto('http://127.0.0.1:4194/customer');await f.locator('#private-task').waitFor();await p.getByRole('button',{name:'Decline analytics',exact:true}).click({timeout:4000}).catch(()=>{});
 await f.locator('#private-task>summary').press('Space');await f.locator('#private-task details>summary').press('Space');await f.locator('#pair-name').fill('UAT Local workflow saves');await f.locator('#pair-lifetime').selectOption('4');await f.locator('#pair-inactivity').selectOption('0');await f.locator('#pair-link').click();await f.locator('#pair-link-code').getByText(/expires/).waitFor();
 await writeFile(new URL('link.json',out),JSON.stringify({code:(await f.locator('#pair-link-code').innerText()).split(' · ')[0]}));console.log(JSON.stringify({event:'link_ready'}));
 const rl=createInterface({input:process.stdin});for await(const line of rl){const c=JSON.parse(line);if(c.op==='close'){rl.close();break;}if(c.op==='status'){const state={at:new Date().toISOString(),url:p.url(),state:await f.locator('#task-state').innerText(),chat:await f.locator('#log').innerText(),writes,events};await writeFile(new URL('state.json',out),JSON.stringify(state,null,2));await shot('workflow-current');console.log(JSON.stringify(state));}if(c.op==='readback'){const v=await ctx.newPage();await v.goto('http://127.0.0.1:4194/records');await v.locator('#records li').first().waitFor();await v.screenshot({path:new URL('evidence/independent-records.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:true});await writeFile(new URL('records-readback.txt',out),await v.locator('body').innerText());console.log(JSON.stringify({event:'independent_readback',text:await v.locator('body').innerText()}));await v.close();}}
}finally{await browser.close();}

// Scoped live visitor UAT. Workflow owner/editor stays in the user's signed-in browser.
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.ADOPTION_PLAYWRIGHT_MODULE||'./frameworks/node_modules/playwright/index.mjs');
const evidence=new URL('../.local/feedback-live/',import.meta.url);await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050}});
context.setDefaultTimeout(60000);
let publicWrites=0,publicLogin=0,publicSubmits=0;
await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.hostname==='flolah.cloud'&&!['GET','HEAD','OPTIONS'].includes(r.method())){publicWrites++;return route.abort();}if(r.isNavigationRequest()&&u.hostname==='flolah.cloud'&&/^\/(login|signup)(\/|$)/.test(u.pathname)){publicLogin++;return route.abort();}return route.continue();});
await context.addInitScript(()=>document.addEventListener('submit',e=>{if(location.hostname==='flolah.cloud'){window.__publicSubmits=(window.__publicSubmits||0)+1;e.preventDefault();}},true));
const local=await context.newPage(),publicPage=await context.newPage(),panel=p=>p.frameLocator('iframe[data-adoption-widget]'),a=panel(local),b=panel(publicPage),results=[];
const output=x=>console.log(JSON.stringify(x));
const report=async()=>writeFile(new URL('results.json',evidence),JSON.stringify({at:new Date().toISOString(),release:process.env.ADOPTION_UAT_BUILD,results,publicWrites,publicLogin,publicSubmits},null,2));
const check=async(id,fn)=>{try{await fn();results.push({id,status:'passed'});output({id,status:'passed'});}catch(e){results.push({id,status:'failed',error:e.message.slice(0,1600)});output({id,status:'failed',error:e.message});throw e;}finally{await report();}};
const send=async(f,text)=>{await f.locator('#plan').waitFor({state:'visible'});await f.locator('#message').fill(text);await f.locator('#plan').click();};
const ready=async p=>{await panel(p).locator('#private-task').waitFor({state:'visible'});};
const setup=async f=>{if(await f.locator('#private-task').getAttribute('open')===null)await f.locator('#private-task>summary').click();if(await f.locator('#private-task details').getAttribute('open')===null)await f.locator('#private-task details>summary').click();};
let groupId;
try{
 await Promise.all([local.goto('http://127.0.0.1:4194/customer'),publicPage.goto('https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1')]);await Promise.all([ready(local),ready(publicPage)]);
 await check('F04_MIXED_SEMANTIC_INTENT_AND_F09_REJECT',async()=>{
  await local.locator('#native-controls').click();await send(a,'Set Shipping method to Express and select Include gift wrap. Do not save.');
  await a.locator('#review').getByRole('button',{name:'Approve field changes',exact:true}).waitFor();
  const text=await a.locator('#review').innerText();assert.match(text,/Shipping method: Express/i);assert.match(text,/Include gift wrap: Selected/i);
  assert.equal(await local.locator('[name=shipping_method]').inputValue(),'');assert.equal(await local.locator('[name=gift_wrap]').isChecked(),false);
  await a.locator('#review').getByRole('button',{name:'Reject changes',exact:true}).click();await a.locator('#status').getByText(/Changes rejected/).waitFor();
  assert.equal(await local.locator('[name=shipping_method]').inputValue(),'');assert.equal(await local.locator('[name=gift_wrap]').isChecked(),false);
 });
 await check('F04_NATURAL_SELECTION_APPROVED_NO_SAVE',async()=>{
  await send(a,'Set Shipping method to Express and select Include gift wrap. Do not save.');await a.locator('#review').getByRole('button',{name:'Approve field changes',exact:true}).click();
  await a.locator('#status').getByText(/approved field values verified/).waitFor();assert.equal(await local.locator('[name=shipping_method]').inputValue(),'express');assert.equal(await local.locator('[name=gift_wrap]').isChecked(),true);
  await local.screenshot({path:new URL('mixed-intent-approved.png',evidence).pathname.replace(/^\/C:/,'C:'),fullPage:false});
 });
 await local.reload();await ready(local);
 await check('F10_PRIVATE_SUMMARY_ONLY_NO_REVIEW',async()=>{
  await setup(a);await a.locator('#transaction-file').setInputFiles({name:'synthetic-feedback.txt',mimeType:'text/plain',buffer:Buffer.from('Company name: Synthetic Feedback Orchid\nContact email: orchid@example.test\nRegion: Singapore\nRequested integration: Inventory API\nTransport: stdio')});
  await a.locator('#task-files').getByText(/ready/).waitFor();await send(a,'Summarize the requested integration and transport from the file. Do not fill or submit anything.');
  await a.locator('#log').getByText(/Inventory API/).waitFor();assert.equal(await a.locator('#review button').count(),0);assert.equal(await local.locator('[name=name]').count(),0);
 });
 await check('F06_F14_NAMED_BILATERAL_GROUP',async()=>{
  await setup(a);await setup(b);await a.locator('#pair-name').fill('Reusable guided UAT');await a.locator('#pair-lifetime').selectOption('4');await a.locator('#pair-inactivity').selectOption('0');await a.locator('#pair-invite').click();await a.locator('#pair-code').getByText(/expires/).waitFor();
  const code=(await a.locator('#pair-code').innerText()).split(' · ')[0];await b.locator('#pair-join input').fill(code);await b.locator('#pair-join button').click();await b.locator('#pair-members').getByRole('button',{name:'Confirm this panel'}).click();
  await a.locator('#pair-refresh').click();await a.locator('#pair-members').getByRole('button',{name:'Confirm this panel'}).click();await b.locator('#pair-refresh').click();
  await a.locator('#task-state').getByText(/1 counterpart\(s\) online/).waitFor();const state=await a.locator('#task-state').innerText();groupId=state.split(' · ')[1];assert.match(state,/Reusable guided UAT/);assert.equal(await a.locator('#error-banner').isVisible(),false);
 });
 await check('F11_RELAY_CONSENT_REQUIRED',async()=>{await a.locator('#message').fill('@');await a.locator('#paired-mentions button').click();await a.locator('#message').fill((await a.locator('#message').inputValue())+'Summarize the requested integration from relevant shared passages. Do not fill or submit.');await a.locator('#plan').click();await a.locator('#error-message').getByText(/sharing consent/).waitFor();assert.equal(await b.locator('#log').innerText(),'');});
 await check('F11_F15_UNIFIED_HANDOFF_AND_SENDER_TRACE',async()=>{
  await a.locator('#relay-consent').check();await a.locator('#message').fill('@');await a.locator('#paired-mentions button').click();await a.locator('#message').fill((await a.locator('#message').inputValue())+'Summarize the requested integration from relevant shared passages. Do not fill or submit.');await a.locator('#plan').click();
  await b.locator('#log').getByText(/Task shared from/).waitFor();await a.locator('#log').getByText(/Sent to https:\/\/flolah.cloud/).waitFor();assert.match(await a.locator('#log').innerText(),/Inventory API/);
  await b.locator('#task-summary').click();await b.locator('#log').getByText(/Inventory API/).first().waitFor();
  await local.screenshot({path:new URL('handoff-sender.png',evidence).pathname.replace(/^\/C:/,'C:'),fullPage:false});await publicPage.screenshot({path:new URL('handoff-recipient.png',evidence).pathname.replace(/^\/C:/,'C:'),fullPage:false});
 });
 await a.locator('#task-end').click();await b.locator('#task-state').getByText(/Task ended/).waitFor();
 await check('F08_F18_REFRESH_SAME_GROUP_NO_PRIVATE_RESTORE',async()=>{
  await Promise.all([local.reload(),publicPage.reload()]);await Promise.all([ready(local),ready(publicPage)]);await setup(a);await setup(b);
  await a.locator('#task-state').getByText(/1 counterpart\(s\) online/).waitFor();await b.locator('#task-state').getByText(/1 counterpart\(s\) online/).waitFor();
  for(const f of [a,b]){assert.match(await f.locator('#task-state').innerText(),new RegExp(groupId));assert.equal(await f.locator('#task-files').innerText(),'');assert.equal(await f.locator('#log').innerText(),'');}
 });
 await a.locator('#pair-link').click();await a.locator('#pair-link-code').getByText(/expires/).waitFor();output({event:'workflow_link_ready',groupId,linkText:await a.locator('#pair-link-code').innerText()});
 const rl=createInterface({input:process.stdin});
 for await(const line of rl){try{const c=JSON.parse(line);
  if(c.op==='status'){const state={event:'status',groupId,local:{state:await a.locator('#task-state').innerText(),log:await a.locator('#log').innerText()},public:publicPage.isClosed()?{closed:true}:{state:await b.locator('#task-state').innerText(),log:await b.locator('#log').innerText()}};await writeFile(new URL('workflow-state.json',evidence),JSON.stringify(state,null,2));output(state);}
  else if(c.op==='screenshots'){for(const [name,p] of [['local',local],['public',publicPage]])if(!p.isClosed())await p.screenshot({path:new URL(`workflow-${c.label||'final'}-${name}.png`,evidence).pathname.replace(/^\/C:/,'C:'),fullPage:false});output({event:'screenshots_saved'});}
  else if(c.op==='reload'){await Promise.all([local.reload(),publicPage.reload()]);await Promise.all([ready(local),ready(publicPage)]);await setup(a);await setup(b);output({event:'reloaded',groupId,state:await a.locator('#task-state').innerText()});}
  else if(c.op==='close-public'){await publicPage.close();output({event:'public_closed'});}
  else if(c.op==='close'){publicSubmits=await publicPage.evaluate(()=>window.__publicSubmits||0).catch(()=>0);assert.equal(publicWrites,0);assert.equal(publicLogin,0);assert.equal(publicSubmits,0);await report();rl.close();break;}
  else throw new Error('Unsupported command');
 }catch(e){output({event:'command_failed',error:e.message});}}
}catch(e){output({event:'failed',error:e.message});process.exitCode=1;await report();}
finally{await browser.close();}

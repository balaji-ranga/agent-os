// Run only during an approved public preview. Signed-in workflow actions use the owner's browser.
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import('./frameworks/node_modules/playwright/index.mjs');
const out=new URL('../.local/feedback-workflow/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1440,height:1050}});
context.setDefaultTimeout(15000);
let publicWrites=0,publicLogin=0;
await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.hostname==='flolah.cloud'&&!['GET','HEAD','OPTIONS'].includes(r.method())){publicWrites++;return route.abort();}if(r.isNavigationRequest()&&u.hostname==='flolah.cloud'&&/^\/(login|signup)(\/|$)/.test(u.pathname)){publicLogin++;return route.abort();}return route.continue();});
await context.addInitScript(()=>document.addEventListener('submit',e=>{if(location.hostname==='flolah.cloud'){window.__publicSubmits=(window.__publicSubmits||0)+1;e.preventDefault();}},true));
const local=await context.newPage(),publicPage=await context.newPage(),panel=p=>p.frameLocator('iframe[data-adoption-widget]');
const emit=x=>console.log(JSON.stringify(x));
async function setup(p){const f=panel(p);await f.locator('#private-task').waitFor();if(!await f.locator('#private-task').evaluate(e=>e.open))await f.locator('#private-task>summary').press('Space');if(!await f.locator('#private-task details').evaluate(e=>e.open))await f.locator('#private-task details>summary').press('Space');return f;}
async function link(p){const f=await setup(p);await f.locator('#pair-name').fill('Persistent workflow UAT');await f.locator('#pair-lifetime').selectOption('4');await f.locator('#pair-inactivity').selectOption('0');await f.locator('#pair-link').press('Enter');await f.locator('#pair-link-code').getByText(/expires/).waitFor();emit({event:'link_ready',website:new URL(p.url()).origin,linkText:await f.locator('#pair-link-code').innerText()});}
async function state(){const result={at:new Date().toISOString(),publicWrites,publicLogin};for(const [name,p] of [['local',local],['public',publicPage]]){result[name]=p.isClosed()?{closed:true}:{state:await panel(p).locator('#task-state').innerText(),log:await panel(p).locator('#log').innerText(),error:await panel(p).locator('#error-banner').isVisible()?await panel(p).locator('#error-message').innerText():null,open:await panel(p).locator('#private-task').evaluate(e=>e.open)};}await writeFile(new URL('state.json',out),JSON.stringify(result,null,2));return result;}
await context.route('**/v1/tasks/command-plan',async route=>{try{const p=route.request().frame().page(),name=p===local?'local':'public';await p.screenshot({path:new URL(`incoming-${name}.png`,out).pathname.replace(/^\/C:/,'C:'),fullPage:false});emit({event:'workflow_incoming',website:name,chat:await panel(p).locator('#log').innerText()});}finally{await route.continue();}});
for(const p of [local,publicPage])p.on('pageerror',e=>emit({event:'pageerror',message:e.message}));
try{
 await Promise.all([local.goto('http://127.0.0.1:4194/customer'),publicPage.goto('https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1')]);
 await Promise.all([setup(local),setup(publicPage)]);await link(local);
 const rl=createInterface({input:process.stdin});
 for await(const line of rl){try{const c=JSON.parse(line);
  if(c.op==='status')emit({event:'status',...await state()});
  else if(c.op==='link')await link(c.website==='public'?publicPage:local);
  else if(c.op==='reload'){await Promise.all([local.reload(),publicPage.reload()]);await Promise.all([panel(local).locator('#private-task').waitFor(),panel(publicPage).locator('#private-task').waitFor()]);emit({event:'reloaded',...await state()});}
  else if(c.op==='pair'){const a=await setup(local),b=await setup(publicPage);await a.locator('#pair-invite').click();await a.locator('#pair-code').getByText(/expires/).waitFor();const code=(await a.locator('#pair-code').innerText()).split(' · ')[0];await b.locator('#pair-join input').fill(code);await b.locator('#pair-join button').click();await b.locator('#pair-members').getByRole('button',{name:'Confirm this panel'}).click();await a.locator('#pair-refresh').click();await a.locator('#pair-members').getByRole('button',{name:'Confirm this panel'}).click();emit({event:'paired',...await state()});}
  else if(c.op==='screenshots'){for(const [name,p] of [['local',local],['public',publicPage]])if(!p.isClosed())await p.screenshot({path:new URL(`${c.label||'completed'}-${name}.png`,out).pathname.replace(/^\/C:/,'C:'),fullPage:false});emit({event:'screenshots_saved'});}
  else if(c.op==='close-public'){await publicPage.close();emit({event:'public_closed'});}
  else if(c.op==='close'){assert.equal(publicWrites,0);assert.equal(publicLogin,0);emit({event:'closed',publicWrites,publicLogin});rl.close();break;}
  else throw new Error('Unknown operation');
 }catch(e){emit({event:'error',message:e.message});}}
}catch(e){emit({event:'failed',message:e.message});for(const [name,p] of [['local',local],['public',publicPage]])await p.screenshot({path:new URL('failure-'+name+'.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:false}).catch(()=>{});await state().catch(()=>{});process.exitCode=1;}finally{await browser.close();}

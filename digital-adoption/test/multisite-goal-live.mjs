// Real-model two-website acceptance in an isolated Chrome profile. The unique
// email is intentional: never repeat the user's already completed Customer Save.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from './frameworks/node_modules/playwright/index.mjs';
const out=new URL(process.env.ADOPTION_MULTISITE_EVIDENCE||'./evidence/exact-multisite-20261020/postfix-live/',import.meta.url);await mkdir(out,{recursive:true});
const marker=Date.now().toString(36),email=`multisite.${marker}@example.test`,original=await readFile(new URL('./evidence/exact-multisite-20261020/prompt.txt',import.meta.url),'utf8'),prompt=original.replaceAll('multisite.uat@example.test',email);
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050}});context.setDefaultTimeout(20000);
let publicWrites=0,localSavePosts=0,publicNavigations=0,actions=0,transportBaseline;const results=[],traces=[],shares=[],latest=new Map();
await context.route('https://flolah.cloud/**',route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){publicWrites++;return route.abort();}return route.continue();});
await context.addInitScript(()=>{window.__uatHostActivations=[];document.addEventListener('click',event=>{const element=event.target.closest?.('a,button');if(element&&!element.closest('[data-adoption-widget]'))window.__uatHostActivations.push({tag:element.tagName,id:element.id,label:element.textContent.trim().slice(0,80)});},true);});
const a=await context.newPage(),b=await context.newPage(),ap=a.frameLocator('iframe[data-adoption-widget]'),bp=b.frameLocator('iframe[data-adoption-widget]');
const safeGoal=g=>Object.fromEntries(['id','status','current','version','message','clarifications','interruptions','steps'].filter(k=>g[k]!==undefined).map(k=>[k,g[k]]));
for(const [page,name]of [[a,'source'],[b,'recipient']]){
 page.on('request',request=>{if(request.method()==='POST'&&request.url()==='http://127.0.0.1:4194/api/records')localSavePosts++;if(request.method()==='POST'&&request.url().endsWith('/goals/peer-send')){const body=request.postDataJSON();shares.push({panel:name,includeValues:body.includeValues===true,valueCount:body.values?.length||0});}});
 page.on('response',async response=>{if(response.request().method()!=='POST'||!response.url().includes('/v1/goals/'))return;try{const data=await response.json();if(data.goal)latest.set(name,data.goal);traces.push({panel:name,path:new URL(response.url()).pathname,httpStatus:response.status(),...(data.goal?{goal:safeGoal(data.goal)}:{}),...(data.peerResult?{peerResult:data.peerResult}:{}),...(data.code?{code:data.code}:{})});}catch{}});
}
b.on('framenavigated',frame=>{if(frame===b.mainFrame())publicNavigations++;});
const report=()=>writeFile(new URL('results.json',out),JSON.stringify({at:new Date().toISOString(),scope:'Real configured maker/checker, two isolated Chrome tabs, existing loopback/public registrations, no backend seeding, no file, no autonomous grant. Synthetic reviewer approvals are exercised by this harness. Exact user email is preserved as a separate already-saved record.',marker,email,prompt,publicWrites,localSavePosts,publicNavigations,transportBaseline,actions,results,shares,traces},null,2));
async function shot(name){for(const [page,panel,label]of [[a,ap,'source'],[b,bp,'recipient']])if(await page.locator('iframe[data-adoption-widget]').count())await page.screenshot({path:fileURLToPath(new URL(`${name}-${label}.png`,out)),mask:[panel.locator('#pair-code'),panel.locator('#pair-link-code')]});}
async function check(id,fn){try{await fn();results.push({id,status:'passed'});console.log('PASS '+id);}catch(error){results.push({id,status:'failed',error:error.message});await shot(id+'-failed').catch(()=>{});throw error;}finally{await report();}}
async function records(){return (await(await a.request.get('http://127.0.0.1:4194/api/records')).json()).records;}
async function drive(){const until=Date.now()+480000;
 while(Date.now()<until){if(latest.get('source')?.status==='completed'&&latest.get('recipient')?.status==='completed')return;
  let acted=false;
  for(const [name,panel]of [['source',ap],['recipient',bp]]){
   const goal=latest.get(name),current=goal?.steps[goal.current];
   if(goal&&(['clarifying','cancelled','expired'].includes(goal.status)||goal.status==='blocked'&&!(current?.kind==='inspect'&&goal.pendingProposalId)))throw Error(`${name}: ${goal.status}: ${goal.message}`);
   const error=panel.locator('#error-banner');if(await error.isVisible()&&(await error.innerText()).trim())throw Error(name+': '+await error.innerText());
   for(const button of [panel.locator('#goal-start'),panel.locator('#goal-peer-send'),panel.getByRole('button',{name:/^(Approve field changes|Approve navigation|Confirm .* now)$/}).first()]){
    if(!await button.count()||!await button.isVisible()||!await button.isEnabled())continue;
    const title=await button.innerText();if(name==='recipient'&&/^Confirm /.test(title))throw Error('Public Save is forbidden');
    if(/^Confirm /.test(title)&&localSavePosts>0)throw Error('A second local Save must never be confirmed');
    await shot(`review-${String(actions).padStart(2,'0')}-${name}`);await button.click();actions++;if(actions>16)throw Error('Review/action bound exceeded');await report();acted=true;break;
   }
   if(acted)break;
  }
  await new Promise(resolve=>setTimeout(resolve,acted?900:500));
 }
 throw Error('Goal completion deadline exceeded');
}
try{
 await check('MULTI01_FRESH_PAIRED_PANELS_NO_FILES',async()=>{
  await a.goto('http://127.0.0.1:4194/customer');await b.goto('https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1');
  for(const panel of [ap,bp]){await panel.locator('#plan:not(:disabled)').waitFor();await panel.locator('#tab-connections').waitFor();}
  await ap.locator('#tab-connections').click();await bp.locator('#tab-connections').click();for(const panel of [ap,bp]){await panel.locator('#panel-connections:not([hidden])').waitFor();if(!await panel.locator('#pairing-settings').evaluate(e=>e.open))await panel.locator('#pairing-settings>summary').click();}await ap.locator('#pair-lifetime').selectOption('1');await ap.locator('#pair-invite').click();await ap.locator('#pair-code').filter({hasText:/expires/}).waitFor();
  const code=(await ap.locator('#pair-code').innerText()).split(' · ')[0];await bp.locator('#pair-join input').fill(code);await bp.locator('#pair-join button').click();await bp.getByRole('button',{name:'Confirm this panel',exact:true}).click();await ap.locator('#pair-refresh').click();await ap.getByRole('button',{name:'Confirm this panel',exact:true}).click();
  for(const panel of [ap,bp])assert.equal(await panel.locator('#task-files li').count(),0);assert.equal((await records()).filter(r=>r.values.contact_email===email).length,0);transportBaseline=await b.locator('#transport').inputValue();publicNavigations=0;
 });
 await check('MULTI02_ONE_PROMPT_COMPLETES_BOTH_WEBSITES_WITHOUT_ROLE_CLARIFICATION',async()=>{
  await ap.locator('#tab-guide').click();await bp.locator('#tab-guide').click();await ap.locator('#choice-goal').click();await ap.locator('#message').fill(prompt);const planned=a.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/goals/create'),{timeout:195000});await ap.locator('#plan').click();const response=await planned,data=await response.json();assert.equal(response.status(),200,JSON.stringify(data));assert.equal(data.goal?.status,'draft',data.goal?.message);
  await ap.locator('#goal-start').waitFor({timeout:20000});await drive();
  for(const name of ['source','recipient']){assert.equal(latest.get(name).status,'completed');assert.equal(latest.get(name).clarifications,0);assert.equal(latest.get(name).interruptions?.length||0,0);}
  assert.ok(latest.get('source').steps.some(s=>s.kind==='peer'&&s.mode==='inspect'));assert.equal(latest.get('source').steps.filter(s=>s.kind==='peer'&&s.mode==='goal').length,1);await shot('completed');
 });
 await check('MULTI03_ONE_SAVE_EXACT_VALUES_AND_ORIGINAL_RECORD_UNCHANGED',async()=>{
  const all=await records(),saved=all.filter(r=>r.values.contact_email===email);assert.equal(saved.length,1);assert.equal(localSavePosts,1);assert.equal(saved[0].values.company_name,'genosys');assert.equal(saved[0].values.region,'Singapore');assert.equal(all.filter(r=>r.values.contact_email==='multisite.uat@example.test').length,1);await writeFile(new URL('saved-record-readback.json',out),JSON.stringify(saved,null,2));
 });
 await check('MULTI04_PRIVATE_COMPANY_ONLY_NO_SEARCH_OR_PUBLIC_SIDE_EFFECTS',async()=>{
  assert.equal(await b.locator('#q').inputValue(),'genosys');assert.equal(await b.locator('#transport').inputValue(),transportBaseline);assert.equal(publicWrites,0);assert.equal(publicNavigations,0);assert.deepEqual(await b.evaluate(()=>window.__uatHostActivations),[]);assert.equal(await bp.locator('#task-files li').count(),0);assert.ok(shares.length===2&&shares.every(s=>s.valueCount===0));await bp.locator('#minimize').click();await b.screenshot({path:fileURLToPath(new URL('public-host-result-controls.png',out))});
 });
}finally{await report();await context.close();await browser.close();}

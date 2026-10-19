import {createPrivateTasks} from '../src/private-tasks.mjs';
import {createActionAttempts} from '../src/action-attempts.mjs';
// Scoped local-host acceptance. Deterministic planner/DNS/auth are explicitly simulated.
// Real model, public-domain and fresh-owner proof are separate evidence gates.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {createAdoptionServer} from '../src/server.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createCoachingGrants} from '../src/coaching-grants.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
import {createManagement} from '../src/management.mjs';
import {createSourceMap} from '../src/source-map.mjs';
const {chromium}=await import(process.env.ADOPTION_PLAYWRIGHT_MODULE||'./frameworks/node_modules/playwright/index.mjs');
const out=new URL('./evidence/field-guidance-20261019/',import.meta.url);await mkdir(out,{recursive:true});
const repo=openRepository(),authority=new SessionAuthority({repository:repo,development:true}),origin='http://127.0.0.1:4194',owner={id:'synthetic-owner',organizationId:'synthetic-org',role:'owner'},admin={id:'synthetic-admin',organizationId:'platform',role:'platform_admin'};
const install=authority.registerApproved({embeddingId:'immediate-local',origins:[origin],expiresAt:Date.now()+3_600_000});
// Explicit test fixture, not evidence of unseeded owner onboarding.
repo.map('websites').set('immediate-local',{id:'immediate-local',organizationId:owner.organizationId,origin,environment:'staging',status:'approved',verified:true,installations:[install.installationId],taskPolicy:{attachments:true,pairing:true,workflow:true,actionBindings:['customer','note','opportunity'].map(name=>({id:'save-'+name,path:'/'+name,label:'Save synthetic record',family:'write_internal'}))}});
const learning=createLearningRuntime(repo,createLearningStore(repo)),sourceMap=createSourceMap(repo),coaching=createCoachingGrants(repo),control=createControlPlane(repo,authority),proposals=createProposalStore(repo,{checkBinding:(s,b)=>learning.bindingAllowed(s,b)});
let serviceUrl,slow=false,planned=0;
const planner=async({text,snapshot})=>{planned++;const links=snapshot.links.filter(l=>l.label.toLowerCase()===text.toLowerCase().trim());if(links.length===1)return {message:'Review observed navigation',actions:[{type:'navigate',ref:links[0].ref}]};if(slow)await new Promise(r=>setTimeout(r,1500));const values=Object.fromEntries(text.split(';').map(piece=>{const at=piece.indexOf(':');return at>0?[piece.slice(0,at).trim().toLowerCase(),piece.slice(at+1).trim()]:['',''];}));return {message:'Synthetic planner: review observed controls.',actions:snapshot.fields.flatMap(f=>Object.hasOwn(values,f.label.toLowerCase())?[{type:'fill',ref:f.ref,value:values[f.label.toLowerCase()]}]:[])};};
let managed;
const tasks=await createPrivateTasks({root:fileURLToPath(new URL('../.local/field-guidance-private',import.meta.url)),website:id=>repo.map('websites').get(id),activeScope:s=>authority.activeScope(s),planner,actionAttempts:createActionAttempts(repo),commandState:repo.map('command_attempts'),authorizeEffect:async()=>true});
const server=createAdoptionServer({knowledge:{retrieve:async()=>({evidence:[]})},answer:async()=>({message:'Synthetic approved website answer',citations:[]}),authority,proposals,planner,learning,sourceMap,coaching,privateTasks:tasks,management:args=>managed(args),taskWebsite:id=>repo.map('websites').get(id),development:true});server.listen(0,'127.0.0.1');await once(server,'listening');serviceUrl=`http://127.0.0.1:${server.address().port}/`;
managed=createManagement({authenticate:async token=>{if(token!=='Bearer synthetic-test-owner')throw new Error('Test identity denied');return owner;},control,learning,sourceMap,coaching,platformOrigin:new URL(serviceUrl).origin});

import {startLocalParsers} from '../src/local-parser.mjs';
import {readFile} from 'node:fs/promises';
const parser=startLocalParsers(tasks,async({path})=>({sections:[{locator:'Text',text:await readFile(path,'utf8')}]}));
const browser=await chromium.launch({channel:'chrome',headless:true});let context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),panel=page.frameLocator('iframe[data-adoption-widget]');context.setDefaultTimeout(15000);
const results=[],errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
await context.route('**/demo-config.json',r=>r.fulfill({json:{serviceUrl,installationToken:install.installationToken}}));
const shot=name=>page.screenshot({path:fileURLToPath(new URL(name+'.png',out)),mask:[panel.locator('#pair-code'),panel.locator('#pair-link-code')],fullPage:false});
const report=()=>writeFile(new URL('results.json',out),JSON.stringify({at:new Date().toISOString(),scope:'Existing loopback host, actual SDK/service/DOM/WebSocket; deterministic planner/knowledge/extractor and synthetic owner/policy fixtures, not real-model acceptance',results,errors},null,2));
async function check(id,fn){try{await fn();await shot(id);results.push({id,status:'passed',screenshot:id+'.png'});console.log('PASS '+id);}catch(e){results.push({id,status:'failed',error:e.message});await shot(id+'-failed').catch(()=>{});throw e;}finally{await report();}}
const fresh=async()=>{await page.goto(origin+'/customer');await panel.locator('#tab-tasks').waitFor({state:'visible'});await page.getByRole('button',{name:'Decline analytics',exact:true}).click({timeout:500}).catch(()=>{});};
const send=async (text,wait=true)=>{await panel.locator('#message').fill(text);await panel.locator('#plan').click();if(wait)await panel.locator('#plan:not([disabled])').waitFor();};

const marker=()=>page.locator('[data-adoption-highlight=true]');
async function pointsTo(selector){await marker().waitFor();const target=await page.locator(selector).boundingBox(),box=await marker().boundingBox();assert.ok(target&&box);assert.ok(Math.abs(box.x-target.x+3)<1);assert.ok(Math.abs(box.y-target.y+3)<1);assert.ok(Math.abs(box.width-target.width-6)<1);}
try{
 await fresh();
 await page.getByLabel('Company name',{exact:true}).fill('Existing local-only value');await page.getByRole('heading',{name:'Customer draft',exact:true}).click();
 await page.evaluate(()=>{window.fieldChanges=0;for(const type of ['input','change','submit'])document.addEventListener(type,()=>window.fieldChanges++,true);});
 await check('G01_WHERE_QUESTION_POINTS_WITHOUT_EXTRA_APPROVAL_OR_MODEL',async()=>{const before=planned;await send('Where is company name field');await pointsTo('[name=company_name]');assert.equal(planned,before);assert.equal(await page.getByLabel('Company name',{exact:true}).inputValue(),'Existing local-only value');assert.equal(await page.evaluate(()=>window.fieldChanges),0);assert.equal(await panel.getByRole('button',{name:'Show guidance',exact:true}).count(),0);});
 await check('G02_SHOW_ME_WHERE_REUSES_TARGET',async()=>{await panel.locator('#choice-guide').click();await pointsTo('[name=company_name]');assert.equal(await page.evaluate(()=>window.fieldChanges),0);});
 await check('G03_SUPERSEDING_SLOW_REQUEST_POINTS_WITHOUT_ABORT_ERROR',async()=>{await panel.locator('#choice-prepare').click();slow=true;const before=planned;await send('Company name: Must never be applied',false);for(let i=0;i<200&&planned===before;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(planned>before);await panel.locator('#choice-guide').click();await pointsTo('[name=company_name]');assert.equal(await panel.locator('#error-banner').isVisible(),false);assert.doesNotMatch(await panel.locator('#log').innerText(),/aborted without reason|\[20\]/);assert.equal(await page.getByLabel('Company name',{exact:true}).inputValue(),'Existing local-only value');assert.equal(await page.evaluate(()=>window.fieldChanges),0);await panel.locator('#plan:not([disabled])').waitFor();await new Promise(resolve=>setTimeout(resolve,1600));assert.equal(await panel.locator('#execution-progress').isVisible(),false);assert.doesNotMatch(await panel.locator('#status').innerText(),/paused|blocked|aborted/i);slow=false;});
 await check('G04_PRIVATE_TASK_DOES_NOT_DIVERT_POINTING_TO_FILE_SUMMARY',async()=>{await panel.locator('#tab-tasks').click();await panel.locator('#transaction-file').setInputFiles({name:'synthetic-guidance.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic task data only.')});await panel.locator('#task-files li').first().waitFor();await panel.locator('#tab-guide').click();const before=planned;await send('Where is Region field');await pointsTo('[name=region]');assert.equal(planned,before);await panel.locator('#tab-tasks').click();await panel.locator('#task-end').click();await panel.locator('#task-state').getByText(/Task ended/).waitFor();await panel.locator('#tab-guide').click();});
 await check('G05_AMBIGUOUS_FIELDS_CLARIFY_WITHOUT_FALSE_POINT',async()=>{await page.evaluate(()=>{const copy=document.querySelector('[name=company_name]').cloneNode();copy.id='second-company';copy.name='second_company';const label=document.createElement('label');label.textContent='Company name';label.append(copy);document.querySelector('#demo-form').append(label);});await send('Where is company name field');await panel.locator('#log').getByText(/Which field do you mean/).waitFor();assert.equal(await marker().count(),0);});
 await check('G06_OFFSCREEN_TARGET_SCROLLS_AND_POINTS',async()=>{await page.evaluate(()=>{const spacer=document.createElement('div');spacer.style.height='1800px';document.querySelector('#demo-form').before(spacer);window.scrollTo(0,0);});await send('Where is region field');await pointsTo('[name=region]');const box=await page.locator('[name=region]').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=1050);});
 await check('G07_NEW_CONVERSATION_DOES_NOT_REPLAY_CLEARED_REQUEST',async()=>{await panel.locator('#plan:not([disabled])').waitFor();await panel.locator('#new-conversation').click();await panel.getByRole('button',{name:'Start new conversation',exact:true}).click();await panel.locator('#status').getByText(/New conversation started/).waitFor();const before=planned;await panel.locator('#choice-guide').click();await panel.locator('#choice-guide:not([disabled])').waitFor();assert.equal(planned,before);assert.equal(await panel.locator('#log p').count(),0);});
 await check('G08_SHOW_ME_WHERE_USES_LATEST_QUESTION_AFTER_KNOWLEDGE_MODE',async()=>{await fresh();await panel.locator('#choice-question').click();await send('Where is company name field');assert.equal(await marker().count(),0);const before=planned;await panel.locator('#choice-guide').click();await panel.locator('#choice-guide:not([disabled])').waitFor();await pointsTo('[name=company_name]');assert.equal(planned,before);assert.equal(await panel.locator('#error-banner').isVisible(),false);});
 assert.deepEqual(errors,[]);
}finally{await report();await browser.close();parser.stop();await tasks.close();server.closeAllConnections();await new Promise(r=>server.close(r));repo.close();}

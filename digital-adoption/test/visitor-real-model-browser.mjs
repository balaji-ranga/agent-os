import {createPlatformPlanner} from '../src/platform-model.mjs';
import {createKnowledgeAnswer} from '../src/knowledge-answer.mjs';
import {createPrivateTasks} from '../src/private-tasks.mjs';
import {createActionAttempts} from '../src/action-attempts.mjs';
// Real-model browser acceptance with explicitly synthetic registration, identity,
// retrieval and policy fixtures. This does not prove fresh-owner onboarding.
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
const out=new URL(process.env.ADOPTION_VISITOR_OUTPUT||'./evidence/field-guidance-20261019/real-model-browser/',import.meta.url);await mkdir(out,{recursive:true});
const repo=openRepository(),authority=new SessionAuthority({repository:repo,development:true}),origin='http://127.0.0.1:4194',owner={id:'synthetic-owner',organizationId:'synthetic-org',role:'owner'},admin={id:'synthetic-admin',organizationId:'platform',role:'platform_admin'};
const install=authority.registerApproved({embeddingId:'immediate-local',origins:[origin],expiresAt:Date.now()+3_600_000});
// Explicit test fixture, not evidence of unseeded owner onboarding.
repo.map('websites').set('immediate-local',{id:'immediate-local',organizationId:owner.organizationId,origin,environment:'staging',status:'approved',verified:true,installations:[install.installationId],taskPolicy:{attachments:true,pairing:true,workflow:true,actionBindings:['customer','note','opportunity'].map(name=>({id:'save-'+name,path:'/'+name,label:'Save synthetic record',family:'write_internal'}))}});
const learning=createLearningRuntime(repo,createLearningStore(repo)),sourceMap=createSourceMap(repo),coaching=createCoachingGrants(repo),control=createControlPlane(repo,authority),proposals=createProposalStore(repo,{checkBinding:(s,b)=>learning.bindingAllowed(s,b)});
let serviceUrl;
const token=(await readFile(new URL('../.local/guidance-relay-token',import.meta.url),'utf8')).trim(),modelCalls=[];
const model={gatewayUrl:'https://isolated.invalid/complete',serviceToken:token,requestDeadlineMs:120000,fetchImpl:async(_url,init)=>{const start=Date.now(),response=await fetch('http://127.0.0.1:4197/complete',init),payload=await response.json();modelCalls.push({purpose:JSON.parse(init.body).purpose,quality:payload.quality,httpStatus:response.status,code:payload.code,diagnosticCode:payload.diagnosticCode,providerStatus:payload.providerStatus,diagnostics:payload.diagnostics,elapsedMs:Date.now()-start});return new Response(JSON.stringify(payload),{status:response.status,headers:{'Content-Type':'application/json'}});}};
const planner=createPlatformPlanner(model),answer=createKnowledgeAnswer(model);
const evidence=[{chunkId:'synthetic-approved-guide',title:'Synthetic owner-approved delivery guide',revision:'synthetic-r1',text:'Alpha delivery takes three business days. Express is the fastest available delivery option. A customer draft needs Company name, Contact email and Region before saving.',locator:'Section 1'}];
let managed;
const tasks=await createPrivateTasks({root:fileURLToPath(new URL('../.local/visitor-real-model-private-'+process.pid,import.meta.url)),website:id=>repo.map('websites').get(id),activeScope:s=>authority.activeScope(s),planner,answer,actionAttempts:createActionAttempts(repo),commandState:repo.map('command_attempts'),authorizeEffect:async()=>true});
const server=createAdoptionServer({knowledge:{retrieve:async()=>({evidence})},answer,authority,proposals,planner,learning,sourceMap,coaching,privateTasks:tasks,management:args=>managed(args),taskWebsite:id=>repo.map('websites').get(id),development:true});server.listen(0,'127.0.0.1');await once(server,'listening');serviceUrl=`http://127.0.0.1:${server.address().port}/`;
managed=createManagement({authenticate:async token=>{if(token!=='Bearer synthetic-test-owner')throw new Error('Test identity denied');return owner;},control,learning,sourceMap,coaching,platformOrigin:new URL(serviceUrl).origin});

import {startLocalParsers} from '../src/local-parser.mjs';
import {readFile} from 'node:fs/promises';
const parser=startLocalParsers(tasks,async({path})=>({sections:[{locator:'Text',text:await readFile(path,'utf8')}]}));
const browser=await chromium.launch({channel:'chrome',headless:true});let context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),panel=page.frameLocator('iframe[data-adoption-widget]');context.setDefaultTimeout(135000);
const publicInstall=authority.registerApproved({embeddingId:'public-uat',origins:['https://flolah.cloud'],expiresAt:Date.now()+3600000});repo.map('websites').set('public-uat',{id:'public-uat',organizationId:owner.organizationId,origin:'https://flolah.cloud',verified:true,status:'approved',environment:'staging',taskPolicy:{attachments:true,pairing:true,workflow:false}});const results=[],errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
const virtualService='https://login.flolah.cloud/free-tools/digital-adoption/';
await context.route('**/demo-config.json',r=>r.fulfill({json:{serviceUrl,installationToken:install.installationToken}}));
let publicWrites=0;
await context.route('https://flolah.cloud/**',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.request().method())){publicWrites++;return r.abort();}return r.continue();});
await context.route(virtualService+'**',async route=>{const request=route.request(),path=new URL(request.url()).pathname.split('/free-tools/digital-adoption/')[1],headers={...request.headers()};delete headers.host;let body=request.postData();if(path==='v1/sessions'){const input=JSON.parse(body);input.installationToken=headers.origin==='https://flolah.cloud'?publicInstall.installationToken:install.installationToken;body=JSON.stringify(input);}const response=await context.request.fetch(serviceUrl+path,{method:request.method(),headers,data:body||undefined,timeout:135000});await route.fulfill({response});});
const shot=name=>page.screenshot({path:fileURLToPath(new URL(name+'.png',out)),mask:[panel.locator('#pair-code'),panel.locator('#pair-link-code')],fullPage:false});
const report=()=>writeFile(new URL('results.json',out),JSON.stringify({at:new Date().toISOString(),scope:'Real active maker and passive checker, actual browser/SDK/coordinator. Synthetic website registrations, approved retrieval fixture, local UTF-8 parser and isolated policy fixture; production models/settings remain unchanged. HTTPS service transport is proxied only inside this isolated test browser to loopback.',results,errors,modelCalls,publicWrites},null,2));
async function check(id,fn){if(process.env.ADOPTION_VISITOR_CASES&&!process.env.ADOPTION_VISITOR_CASES.split(',').includes(id))return;try{await fn();await shot(id);results.push({id,status:'passed',screenshot:id+'.png'});console.log('PASS '+id);}catch(e){results.push({id,status:'failed',error:e.message});await shot(id+'-failed').catch(()=>{});throw e;}finally{await report();}}
const fresh=async()=>{await page.goto(origin+'/customer');await panel.locator('#tab-tasks').waitFor({state:'visible'});await page.getByRole('button',{name:'Decline analytics',exact:true}).click({timeout:500}).catch(()=>{});};
const send=async text=>{await panel.locator('#message').fill(text);await panel.locator('#plan').click();await panel.locator('#plan:not([disabled])').waitFor();};


async function review(text,pattern){await send(text);assert.equal(await panel.getByRole('button',{name:'Approve field changes',exact:true}).count(),1,await panel.locator('#log').innerText());assert.match(await panel.locator('#review').innerText(),pattern);}
async function approve(){await panel.getByRole('button',{name:'Approve field changes',exact:true}).click();await panel.locator('#status').getByText(/approved field values verified/).waitFor();}
async function start(path='/customer'){await page.goto(origin+path);await panel.locator('#message').waitFor();}
try{
 await start();
 await check('M01_ASK_KNOWLEDGE_WITH_VERIFIED_CITATION',async()=>{await panel.locator('#choice-question').click();await send('How long does Alpha delivery take?');await panel.locator('#log p[data-role=assistant]').filter({hasText:/three|3/}).waitFor();await panel.locator('#log details').waitFor();assert.match(await panel.locator('#log').innerText(),/business days/);assert.equal(await panel.locator('#review button').count(),0);});
 await check('M02_KNOWLEDGE_ABSTAINS_FOR_UNSUPPORTED_SUBJECT',async()=>{await send('What is the refund deadline for Beta orders?');await panel.locator('#log p[data-role=assistant]').filter({hasText:/could not support|could not find/}).waitFor();assert.equal(await panel.locator('#review button').count(),0);});
 await start();await page.getByRole('button',{name:'Add native controls',exact:true}).click();
 await check('M03_PREPARE_TYPOS_CHECKBOX_REVIEW_AND_FILL',async()=>{await panel.locator('#choice-prepare').click();await review('Set shiping method to expres and select Include gift wrap. Do not save.',/Shipping method: Express/);assert.match(await panel.locator('#review').innerText(),/Include gift wrap: Selected/);assert.equal(await page.locator('[name=gift_wrap]').isChecked(),false);await approve();assert.equal(await page.locator('[name=shipping_method]').inputValue(),'express');assert.equal(await page.locator('[name=gift_wrap]').isChecked(),true);});
 await check('M04_FASTEST_OPTION_SEMANTIC_INFERENCE_AND_REJECT',async()=>{await review('Change Shipping method to the fastest available delivery. Do not save.',/Shipping method: Express/);await panel.getByRole('button',{name:'Reject changes',exact:true}).click();assert.equal(await page.locator('[name=shipping_method]').inputValue(),'express');});
 await check('M05_UNKNOWN_CHOICE_CLARIFICATION',async()=>{await send('Set Shipping method to Teleportation. Do not substitute another choice.');await panel.locator('#log p[data-role=assistant]').filter({hasText:/choose|which|available|unsupported|not.*option/i}).last().waitFor();assert.equal(await panel.locator('#review button').count(),0);});
 await check('M06_RECOMMEND_WITHOUT_FILL',async()=>{await send('Explain the Shipping method choices and recommend one for urgency. Do not change any fields.');await panel.locator('#log p[data-role=assistant]').filter({hasText:/Express/}).last().waitFor();assert.equal(await panel.locator('#review button').count(),0);});
 await check('M07_GUIDE_POINTS_AFTER_EXISTING_REQUEST_WITH_NO_WRITES',async()=>{const before=await page.locator('[name=shipping_method]').inputValue();await panel.locator('#choice-guide').click();await page.locator('[data-adoption-highlight=true]').waitFor();assert.equal(await page.locator('[name=shipping_method]').inputValue(),before);});
 await start();await page.getByRole('button',{name:'Add complex controls',exact:true}).click();
 await check('M08_RADIO_NATURAL_INTENT_AND_APPLICATION_STATE',async()=>{await review('Set Delivery preference so I collect the order myself at the shop. Do not save.',/Delivery preference: Store pickup/);await approve();assert.equal(await page.locator('[value=pickup]').isChecked(),true);});
 await start();
 await check('M09_PRIVATE_FILE_SUMMARY_AND_EXTRACTED_FORM_VALUES',async()=>{await panel.locator('#tab-tasks').click();await panel.locator('#transaction-file').setInputFiles({name:'synthetic-orchid.txt',mimeType:'text/plain',buffer:Buffer.from('Company name: Synthetic Orchid\nContact email: orchid@example.test\nRegion: Singapore')});await panel.locator('#task-files li').waitFor({timeout:10000});console.log('M09 upload state: '+await panel.locator('#task-files').innerText());await panel.locator('#task-files').getByText(/ready/).waitFor({timeout:10000});await panel.locator('#tab-guide').click();await panel.locator('#choice-question').click();await send('Summarize the company name, email and region in my file.');assert.match(await panel.locator('#log p[data-role=assistant]').last().innerText(),/Synthetic Orchid/);assert.equal(await panel.locator('#review button').count(),0);await panel.locator('#choice-prepare').click();await review('Prepare the customer form using the details in my attached file. Do not save.',/Synthetic Orchid/);await approve();assert.equal(await page.getByLabel('Company name',{exact:true}).inputValue(),'Synthetic Orchid');assert.equal(await page.getByLabel('Contact email',{exact:true}).inputValue(),'orchid@example.test');});
 await page.goto('https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1');await panel.locator('#message').waitFor();
 await check('M10_PUBLIC_WHERE_POINTS_AT_SEARCH_INPUT',async()=>{await send('Where is search field');await page.locator('[data-adoption-highlight=true]').waitFor();const marker=await page.locator('[data-adoption-highlight=true]').boundingBox(),target=await page.locator('#q').boundingBox();assert.ok(Math.abs(marker.x-target.x+3)<1);});
 await check('M11_PUBLIC_DEFAULT_LANGUAGE_AND_REJECT',async()=>{await panel.locator('#choice-prepare').click();await review('Keep the transport default All transport. Do not submit.',/transport: All transports/i);await panel.getByRole('button',{name:'Reject changes',exact:true}).click();assert.equal(await page.locator('#transport').inputValue(),'');});
 await check('M12_PUBLIC_TYPO_CHOICE_AND_REVIEWED_FILL',async()=>{await send('Please set transprot to stido. Do not submit.');if(!await panel.getByRole('button',{name:'Approve field changes',exact:true}).count()){assert.equal(await panel.locator('#error-banner').isVisible(),false,await panel.locator('#log').innerText());assert.match(await panel.locator('#log p[data-role=assistant]').last().innerText(),/stdio/);assert.equal(await page.locator('#transport').inputValue(),'');await review('Set Transport to stdio. Do not submit.',/transport: stdio/i);}else assert.match(await panel.locator('#review').innerText(),/transport: stdio/i);await approve();assert.equal(await page.locator('#transport').inputValue(),'stdio');assert.equal(publicWrites,0);});
 if(!process.env.ADOPTION_VISITOR_CASES)assert.ok(modelCalls.length>=11);assert.ok(modelCalls.every(call=>call.httpStatus===200&&call.quality?.enabled===true));
}finally{await report();await browser.close();parser.stop();await tasks.close();server.closeAllConnections();await new Promise(r=>server.close(r));repo.close();}

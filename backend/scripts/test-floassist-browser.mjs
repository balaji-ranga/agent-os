// Real browser + real HTTP routes; synthetic email, QR and connector adapters only.
// Set FLOASSIST_PLAYWRIGHT_MODULE to an installed playwright/index.mjs when not locally installed.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import {createFloAssist} from '../src/services/floassist/core.js';
import {createFloAssistRouter} from '../src/routes/floassist.js';
const {chromium}=await import(process.env.FLOASSIST_PLAYWRIGHT_MODULE?pathToFileURL(process.env.FLOASSIST_PLAYWRIGHT_MODULE).href:'playwright');
const db=new Database(':memory:'),owners=new Map(),product=JSON.parse(readFileSync(new URL('../src/services/floassist/product.json',import.meta.url)));
let paired=false,connections=false,failEmail=false,failQrStart=false,qrWaits=0;const requests=[],errors=[];
const s=createFloAssist({db,product,adapters:{settings:()=>({}),legal:()=>({terms_version:'fixture',privacy_version:'fixture'}),managementUrl:()=>'/login',
  findOwner:({id,email})=>owners.get(id||email),newOtp:()=>({code:'123456',codeHash:'fixture'}),matchesOtp:c=>c==='123456',
  sendEmail:async()=>{if(failEmail)throw Error('Synthetic mail failure');},verifyMfa:()=>{},
  createOwner:async r=>{const u={id:r.email,email:r.email,mobile:r.phone,enabled:true,role:'ceo'};owners.set(u.id,u);return u;},resolveCoo:()=>({id:'fixture-coo'}),assertCoo:()=>{},
  setPolicy:()=>{},policy:()=>[{family:'read',label:'Read / research',mode:'autonomous'},{family:'financial_destructive',label:'Financial / destructive',mode:'prohibited'}],
  channelView:()=>({connected:paired,number:paired?'+6599999999':null}),
  qr:async(_p,op)=>{if(op==='start'&&failQrStart)throw Object.assign(new Error('QR gateway timed out'),{status:504});if(op==='wait'){qrWaits++;await new Promise(r=>setTimeout(r,100));}return {connected:paired,number:paired?'+6599999999':null,qr_data_url:paired?null:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW9sAAAAASUVORK5CYII=',message:'Scan your dedicated number (fixture)'};},
  connections:async(_owner,ids)=>ids.map(id=>({id,connected:connections})),connect:async()=>({authorization_url:'https://provider.example.invalid/authorize'}),provision:async()=>{},pause:async()=>{}}});
const app=express();app.use(express.json());app.use((req,_res,next)=>{requests.push({path:req.path,method:req.method,body:req.body});next();});
app.use('/api/floassist',createFloAssistRouter(()=>s,()=> (_req,_res,next)=>next()));
app.use('/__copilot',express.static(fileURLToPath(new URL('../../digital-adoption/web',import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../../deploy/static/flolah-home',import.meta.url))));
const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.FLOASSIST_BROWSER_CHANNEL||'chrome',headless:true});
let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const evidence=fileURLToPath(new URL('../../test-results/floassist/',import.meta.url));mkdirSync(evidence,{recursive:true});
try{
  check((await fetch(origin+'/api/floassist/me')).status,401,'unauthenticated settings denied');
  const context=await browser.newContext({viewport:{width:1280,height:1000}});
  // The synthetic suite never downloads a production installation or model.
  await context.route('https://login.flolah.cloud/free-tools/digital-adoption/site-loader.mjs?*',route=>route.fulfill({contentType:'application/javascript',body:''}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const inspect=()=>page.evaluate(async()=>{const {createInspector}=await import('/__copilot/dom.mjs');return createInspector(document).snapshot({inventory:true,task:'Prepare FloAssist onboarding preferences'});});
  await page.goto(origin+'/free-tools/');await page.getByRole('link',{name:'Set up FloAssist'}).click();
  await page.locator('#details').waitFor({state:'visible'});
  const contactSnapshot=await inspect();
  check(contactSnapshot.fields.map(f=>f.key),['email','phone','country'],'contact fields have live semantic keys; legal consent is excluded');
  check(contactSnapshot.inventory.fields.some(f=>['consent','code','mfa'].includes(f.key)),false,'shared discovery excludes consent and authentication inputs in hidden stages');
  await page.screenshot({path:join(evidence,'registration-desktop.png'),fullPage:true});
  await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Your personal WhatsApp number').fill('+6581234567');await page.locator('[name=consent]').check();
  failEmail=true;await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByText('We could not send your code. Please try again.').waitFor();check(await page.getByRole('button',{name:'Continue',exact:true}).isEnabled(),true,'email failure retry enabled');
  failEmail=false;await page.getByRole('button',{name:'Continue',exact:true}).click();await page.locator('#verify').waitFor({state:'visible'});
  check((await inspect()).fields.length,0,'verification codes remain human-only in the visible verification stage');
  await page.reload();await page.locator('#verify').waitFor({state:'visible'});checks++;
  await page.getByLabel('Verification code').fill('000000');await page.getByRole('button',{name:'Verify and continue'}).click();await page.getByText('That code is incorrect. Try again.').waitFor();checks++;
  await page.getByLabel('Verification code').fill('123456');await page.getByRole('button',{name:'Verify and continue'}).click();await page.locator('#apps').waitFor({state:'visible'});
  check(await page.locator('[name=connector]').count(),6,'six connectors');
  check((await inspect()).fields.filter(f=>f.key?.startsWith('connector_')).map(f=>f.key),product.connectors.map(c=>'connector_'+c.id),'dynamic app choices have distinct semantic keys');
  await page.getByLabel('Gmail',{exact:true}).check();
  const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Connect',exact:true}).click();const popup=await popupPromise;await popup.close();
  connections=true;await page.getByRole('button',{name:'Check connections'}).click();await page.getByText('Your selected apps are connected.').waitFor();
  await page.getByText('Preferences and autonomy',{exact:true}).click();await page.locator('[name=preset]').selectOption('administrative');check(await page.locator('#financial-label').isVisible(),true,'finance choice only in advanced administrative mode');await page.locator('[name=financial]').selectOption('autonomous');
  const preferenceSnapshot=await inspect(),manifest=JSON.parse(readFileSync(new URL('../../digital-adoption/content/flolah-cloud/floassist-map.json',import.meta.url)));
  check(manifest.screens[0].fields.filter(f=>f.form==='apps').every(f=>preferenceSnapshot.fields.some(live=>live.key===f.key&&live.form===f.form)),true,'all fourteen mapped app/preference fields match fresh live DOM controls');
  check(preferenceSnapshot.fields.filter(f=>f.key?.startsWith('responsibility_')).map(f=>f.key),product.responsibilities.map(r=>'responsibility_'+r.id),'responsibilities stay individually addressable');
  await page.getByText('Task alert timing',{exact:true}).click();
  await page.locator('[name=overdue_realert_hours]').fill('12');
  await page.locator('[name=task_alert_daily_limit]').fill('2');
  await page.screenshot({path:join(evidence,'preferences-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Continue to WhatsApp'}).click();await page.locator('#qr').waitFor({state:'visible'});check(await page.getByRole('button',{name:'Start FloAssist'}).isDisabled(),true,'cannot activate before pairing');
  await page.screenshot({path:join(evidence,'whatsapp-desktop.png'),fullPage:true});
  paired=true;await page.getByRole('button',{name:'Start FloAssist'}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('activate').disabled);await page.getByRole('button',{name:'Start FloAssist'}).click();await page.locator('#ready').waitFor({state:'visible'});
  check(await page.getByRole('link',{name:'Open WhatsApp'}).getAttribute('href'),'https://wa.me/6599999999','chat opens linked dedicated number');
  await page.getByRole('button',{name:'Pause checks'}).click();await page.getByRole('button',{name:'Resume checks'}).waitFor();checks++;
  await page.getByRole('button',{name:'Resume checks'}).click();await page.getByRole('button',{name:'Pause checks'}).waitFor();checks++;
  await page.reload();await page.locator('#ready').waitFor({state:'visible'});checks++;
  await page.getByRole('button',{name:'Manage setup'}).click();
  const starts=requests.filter(r=>r.path==='/api/floassist/whatsapp/start').length;failQrStart=true;
  await page.getByRole('button',{name:'Continue to WhatsApp'}).click();await page.waitForFunction(()=>!document.getElementById('activate').disabled);
  check(requests.filter(r=>r.path==='/api/floassist/whatsapp/start').length,starts,'existing pairing skips QR login even when login RPC fails');
  paired=false;await page.getByRole('button',{name:'Show / refresh QR'}).click();await page.getByText('QR gateway timed out',{exact:true}).waitFor();
  check(await page.locator('#qr-status').innerText(),'WhatsApp setup could not finish. Choose Show / refresh QR to retry.','failed start clears preparing state');
  check(await page.getByRole('button',{name:'Show / refresh QR'}).isEnabled(),true,'failed QR can retry');
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Sign out'}).click();await page.locator('#details').waitFor({state:'visible'});check(await page.evaluate(()=>sessionStorage.getItem('floassist.session')),null,'logout clears limited session');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(evidence,'registration-mobile.png'),fullPage:true});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile has no horizontal overflow');
  await page.getByRole('button',{name:'Switch color theme'}).click();await page.screenshot({path:join(evidence,'registration-dark.png'),fullPage:true});
  check(requests.some(r=>r.path==='/api/floassist/policy'&&r.body.financial==='autonomous'),true,'explicit finance policy submitted');
  check(requests.some(r=>r.path==='/api/floassist/preferences'&&r.body.overdue_realert_hours===12&&r.body.task_alert_daily_limit===2&&r.body.task_alert_max_days===5&&r.body.due_soon_hours===72&&r.body.include_due_this_month===true&&r.body.briefing_overdue_high_priority===true),true,'alert lifecycle settings saved through real UI and HTTP');
  check(qrWaits>0,true,'native QR status polling');check(errors,[],'no browser errors');
  writeFileSync(join(evidence,'browser-results.json'),JSON.stringify({passed:true,checks,synthetic:true,viewports:['1280x1000','390x844']},null,2));
  console.log(`FLOASSIST_BROWSER_OK: ${checks} checks; real browser and HTTP, synthetic providers; screenshots in test-results/floassist`);
}finally{await browser.close();await new Promise(r=>server.close(r));db.close();}

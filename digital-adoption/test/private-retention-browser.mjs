// Explicitly authorized scoped UAT: loopback fixture and public Flolah preview.
// Synthetic upload only. No host form filling, saving, login or public submit.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import {WIDGET_REQUEST_TIMEOUT_MS} from '../web/model-timeouts.mjs';
import { fileURLToPath,pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.ADOPTION_PLAYWRIGHT_MODULE||'./frameworks/node_modules/playwright/index.mjs');
const evidence=process.env.ADOPTION_RETENTION_EVIDENCE_DIR?pathToFileURL(process.env.ADOPTION_RETENTION_EVIDENCE_DIR+'/'):new URL('./evidence/private-retention-20261019/',import.meta.url);await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}});
context.setDefaultTimeout(WIDGET_REQUEST_TIMEOUT_MS+10000);
const results=[];let publicWrites=0,hostSubmits=0;
await context.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname==='flolah.cloud'&&!['GET','HEAD','OPTIONS'].includes(request.method())){publicWrites++;return route.abort();}
  return route.continue();
});
await context.addInitScript(()=>document.addEventListener('submit',event=>{window.__uatHostSubmits=(window.__uatHostSubmits||0)+1;event.preventDefault();},true));
const local=await context.newPage(),publicPage=await context.newPage(),panel=p=>p.frameLocator('iframe[data-adoption-widget]');
const open=async p=>{
  const f=panel(p);await f.locator('#private-task').waitFor({state:'attached'});
  const launcher=p.getByRole('button',{name:'Open help chat',exact:true});if(await launcher.isVisible())await launcher.click();
  if(!await f.locator('#private-task').evaluate(e=>e.open))await f.locator('#private-task>summary').press('Space');
  assert.match(await f.locator('#private-task').innerText(),/24-hour retention/);return f;
};
const screenshot=async(p,name)=>{await p.screenshot({path:fileURLToPath(new URL(name,evidence)),fullPage:false});return name;};
try{
  await local.goto('http://127.0.0.1:4194/customer');const f=await open(local);
  results.push({id:'LOCAL_RETENTION_NOTICE',status:'passed',screenshot:await screenshot(local,'local-notice.png')});
  await f.locator('#transaction-file').setInputFiles({name:'synthetic-retention.txt',mimeType:'text/plain',buffer:Buffer.from('Company name: Private Retention Orchid\nContact email: synthetic@example.test\nRegion: Singapore')});
  await f.locator('#task-files').getByText(/ready/).waitFor();results.push({id:'VISITOR_UPLOAD_READY',status:'passed',screenshot:await screenshot(local,'local-upload-ready.png')});
  await f.locator('#task-summary').click();
  if(process.env.ADOPTION_RETENTION_VERIFY_SUMMARY==='1'){
    await f.locator('#log').getByText(/Private Retention Orchid/).first().waitFor();
    results.push({id:'LIVE_PRIVATE_SUMMARY',status:'passed',screenshot:await screenshot(local,'local-summary.png')});
  }else{
    await f.locator('#task-summary').getByText(/Working/).waitFor();
    results.push({id:'SUMMARY_REQUEST_STARTED_FOR_CANCELLATION',status:'passed',screenshot:await screenshot(local,'local-summary-pending.png')});
  }
  await f.locator('#task-end').click();await f.locator('#task-state').getByText(/Task ended/).waitFor();
  assert.equal(await f.locator('#task-files li').count(),0);assert.equal((await f.locator('#log').innerText()).includes('Private Retention Orchid'),false);
  results.push({id:'END_TASK_BROWSER_CONTEXT_CLEARED',status:'passed',screenshot:await screenshot(local,'local-task-ended.png')});
  for(const name of ['Company name','Contact email','Region'])assert.equal(await local.getByLabel(name,{exact:true}).inputValue(),'');
  await publicPage.goto('https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1');await open(publicPage);
  results.push({id:'PUBLIC_RETENTION_NOTICE',status:'passed',screenshot:await screenshot(publicPage,'public-notice.png')});
  hostSubmits=await local.evaluate(()=>window.__uatHostSubmits||0)+await publicPage.evaluate(()=>window.__uatHostSubmits||0);
  assert.equal(hostSubmits,0);assert.equal(publicWrites,0);
}catch(error){results.push({id:'BROWSER_ACCEPTANCE',status:'failed',detail:String(error.message).slice(0,1200)});await screenshot(local,'browser-failure.png');throw error;}
finally{
  await writeFile(new URL('browser-results.json',evidence),JSON.stringify({at:new Date().toISOString(),results,hostSubmits,publicWrites},null,2));
  await browser.close();
}
console.log(JSON.stringify({results,hostSubmits,publicWrites}));

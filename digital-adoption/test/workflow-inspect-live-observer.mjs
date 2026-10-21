// An online browser target for a signed-in, read-only Flolah workflow run.
// Link code is kept in ignored .local; evidence never includes credentials.
import {chromium} from './frameworks/node_modules/playwright/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
const out=new URL('./evidence/uat-20261021/workflow-live/',import.meta.url),privateOut=new URL('../.local/uat-20261021-workflow/',import.meta.url);await mkdir(out,{recursive:true});await mkdir(privateOut,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),panel=page.frameLocator('iframe[data-adoption-widget]');context.setDefaultTimeout(30000);let hostWrites=0;
await context.route('http://127.0.0.1:4194/api/records',route=>{if(route.request().method()!=='GET'){hostWrites++;return route.abort();}return route.continue();});
const shot=()=>page.screenshot({path:fileURLToPath(new URL('recipient.png',out)),mask:[panel.locator('#pair-code'),panel.locator('#pair-link-code')]});
try{
 await page.goto('http://127.0.0.1:4194/customer');await panel.locator('#plan:not(:disabled)').waitFor();await panel.locator('#tab-connections').click();if(!await panel.locator('#pairing-settings').evaluate(e=>e.open))await panel.locator('#pairing-settings>summary').click();await panel.locator('#pair-name').fill('UAT read-only local workflow');await panel.locator('#pair-lifetime').selectOption('1');await panel.locator('#pair-link').click();await panel.locator('#pair-link-code').filter({hasText:/expires/}).waitFor();const code=(await panel.locator('#pair-link-code').innerText()).split(' · ')[0];await writeFile(new URL('link.json',privateOut),JSON.stringify({code}));console.log('Online local copilot ready; link code kept in ignored local file.');
 const rl=createInterface({input:process.stdin});for await(const line of rl){const command=JSON.parse(line);if(command.op==='close'){rl.close();break;}if(command.op==='status'){await panel.locator('#tab-guide').click();const chat=await panel.locator('#log').innerText();await panel.locator('#tab-workflows').click();const activity=await panel.locator('#workflow-activity').innerText();await shot();const state={at:new Date().toISOString(),url:page.url(),chat,activity,hostWrites};await writeFile(new URL('recipient.json',out),JSON.stringify(state,null,2));console.log(JSON.stringify(state));}}
}finally{await browser.close();}

// Authorized synthetic visitor UAT: only loopback and public flolah.cloud.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.ADOPTION_PLAYWRIGHT_MODULE||'./frameworks/node_modules/playwright/index.mjs');
if(!process.env.ADOPTION_UPLOAD_EVIDENCE_DIR)throw new Error('An evidence output directory is required');
const output=pathToFileURL(process.env.ADOPTION_UPLOAD_EVIDENCE_DIR+'/');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050}}),results=[];context.setDefaultTimeout(60000);
let publicWrites=0,hostSubmits=0;
await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.hostname==='flolah.cloud'&&!['GET','HEAD','OPTIONS'].includes(r.method())){publicWrites++;return route.abort();}return route.continue();});
await context.addInitScript(()=>document.addEventListener('submit',e=>{window.__hostSubmits=(window.__hostSubmits||0)+1;e.preventDefault();},true));
try{
 for(const [name,url]of [['local','http://127.0.0.1:4194/customer'],['public','https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1']]){
  const page=await context.newPage();let upload;
  page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/v1/tasks/upload'))upload={url:r.url(),headers:r.headers(),input:r.postDataJSON()};});
  await page.goto(url);const panel=page.frameLocator('iframe[data-adoption-widget]');await panel.locator('#private-task').waitFor({state:'attached'});
  const launcher=page.getByRole('button',{name:'Open help chat',exact:true});if(await launcher.isVisible())await launcher.click();
  await panel.locator('#tab-knowledge').click();assert.equal(await panel.locator('#knowledge-upload').isVisible(),false);assert.equal(await panel.locator('#upload-file').isVisible(),false);
  await page.screenshot({path:fileURLToPath(new URL(name+'-knowledge-owner-only.png',output))});results.push({id:name+'_SHARED_UPLOAD_NOT_OFFERED',status:'passed'});
  await panel.locator('#tab-guide').click();if(!await panel.locator('#private-task').evaluate(e=>e.open))await panel.locator('#private-task>summary').press('Space');
  assert.match(await panel.locator('#task-upload-limits').innerText(),/5 seconds.*5.*minute.*20.*64 MiB/s);
  await panel.locator('#transaction-file').setInputFiles({name:'synthetic-upload-controls.txt',mimeType:'text/plain',buffer:Buffer.from('Company: Upload Controls Synthetic\nRegion: Singapore\nNo personal data.')});
  await panel.locator('#task-files li').first().waitFor();assert.equal(await panel.locator('#transaction-file').isDisabled(),true);assert.ok(upload);
  // Reuse only this synthetic request's credentials in memory, never in evidence.
  const second=await context.request.post(upload.url,{headers:upload.headers,data:{...upload.input,operationId:crypto.randomUUID()}});assert.equal(second.status(),429);assert.equal((await second.json()).code,'UPLOAD_COOLDOWN');assert.ok(Number(second.headers()['retry-after'])>0);
  await page.screenshot({path:fileURLToPath(new URL(name+'-private-upload-cooldown.png',output))});results.push({id:name+'_PRIVATE_UPLOAD_AND_SERVER_COOLDOWN',status:'passed',httpStatus:429});
  const shared=await context.request.post(upload.url.replace('/v1/tasks/upload','/v1/knowledge/upload'),{headers:upload.headers,data:{...upload.input}});assert.equal(shared.status(),403);assert.equal((await shared.json()).code,'OWNER_KNOWLEDGE_UPLOAD_REQUIRED');results.push({id:name+'_AUTHENTICATED_VISITOR_SHARED_UPLOAD_REFUSED',status:'passed',httpStatus:403});
  await panel.locator('#task-files').getByText(/ready/).waitFor();await panel.locator('#transaction-file').waitFor({state:'visible'});await page.waitForTimeout(5200);assert.equal(await panel.locator('#transaction-file').isDisabled(),false);
  await panel.locator('#task-end').click();await panel.locator('#task-state').getByText(/Task ended/).waitFor();assert.equal(await panel.locator('#task-files li').count(),0);results.push({id:name+'_END_TASK_CLEAR',status:'passed'});
  hostSubmits+=await page.evaluate(()=>window.__hostSubmits||0);await page.close();
 }
 assert.equal(publicWrites,0);assert.equal(hostSubmits,0);
}catch(error){results.push({id:'UPLOAD_BROWSER_ACCEPTANCE',status:'failed',detail:error.message});for(const p of context.pages())await p.screenshot({path:fileURLToPath(new URL('browser-failure.png',output))}).catch(()=>{});throw error;}
finally{await writeFile(new URL('browser-results.json',output),JSON.stringify({at:new Date().toISOString(),results,publicWrites,hostSubmits},null,2));await browser.close();}
console.log(JSON.stringify({results,publicWrites,hostSubmits}));

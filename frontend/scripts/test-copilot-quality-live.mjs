// Read/unsaved-edit browser test of the deployed Admin panel. A temporary Admin
// session is kept in memory only and revoked in finally; never log its token.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.ADOPTION_PLAYWRIGHT_PATH).href);
const ssh=['-o','BatchMode=yes','-o','IdentitiesOnly=yes','-i',process.env.TEST_VPS_SSH_KEY,process.env.TEST_VPS_SSH_TARGET,'docker exec -i agent-os-backend-1 node --input-type=module'];
const remote=script=>execFileSync('ssh',ssh,{input:script,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const token=remote("import {getDb} from './src/db/schema.js';import {createSession} from './src/services/auth/session.js';const user=getDb().prepare(\"SELECT id FROM platform_users WHERE role='admin' AND enabled=1 LIMIT 1\").get();if(!user)throw Error('No enabled Admin for test');process.stdout.write(createSession(user.id).token);");
if(!/^[a-f0-9]{64}$/.test(token))throw Error('Temporary test session unavailable');
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1050}});
 await context.addInitScript(value=>localStorage.setItem('agent-os-auth-token',value),token);
 const page=await context.newPage();let settingsWrites=0;page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/admin/copilot-quality')&&request.method()==='PUT')settingsWrites++;});
 const response=await context.request.get(process.env.TEST_PLATFORM_URL+'/api/admin/copilot-quality',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status(),200);const before=await response.json();
 await page.goto(process.env.TEST_PLATFORM_URL+'/admin/models');const panel=page.locator('section[aria-labelledby=copilot-quality-heading]');await panel.getByRole('heading',{name:'Digital Adoption copilot review'}).waitFor({timeout:45000});
 await panel.getByLabel('Checker route').selectOption('ollama_local');
 const options=await panel.getByLabel('Local checker model').locator('option').evaluateAll(nodes=>nodes.map(node=>node.value).filter(Boolean));
 for(const row of before.localModels)assert.ok(options.includes(row.id));
 if(options.length)await panel.getByLabel('Local checker model').selectOption(options[0]);
 await panel.getByLabel(/Enable thinking for this checker/).check();assert.equal(settingsWrites,0);
 if(process.env.ADOPTION_EVIDENCE_DIR){await mkdir(process.env.ADOPTION_EVIDENCE_DIR,{recursive:true});await panel.screenshot({path:process.env.ADOPTION_EVIDENCE_DIR+'/admin-checker-models.png'});}
 await page.reload();await panel.getByLabel('Checker route').waitFor();await page.waitForFunction(()=>{const fieldset=document.querySelector('section[aria-labelledby=copilot-quality-heading] fieldset');return fieldset&&fieldset.disabled===false;});assert.equal(await panel.getByLabel('Checker route').inputValue(),before.checkerMode);
 const after=await (await context.request.get(process.env.TEST_PLATFORM_URL+'/api/admin/copilot-quality',{headers:{Authorization:'Bearer '+token}})).json();
 for(const key of ['enabled','checkerMode','checkerDeploymentId','localThinking','checkerMaxTokens'])assert.equal(after[key],before[key]);assert.equal(await panel.getByLabel('Checker output token budget').inputValue(),String(before.checkerMaxTokens??700));
 const bad=await context.request.put(process.env.TEST_PLATFORM_URL+'/api/admin/copilot-quality',{headers:{Authorization:'Bearer '+token},data:{enabled:true,checkerMode:'ollama_local',checkerDeploymentId:'__missing_synthetic_model__',localThinking:false}});assert.equal(bad.status(),400);
 const result={at:new Date().toISOString(),adminApi:200,registeredLocalModels:options.length,unsavedModelSelection:true,unsavedThinkingSelection:true,reloadPreservesSavedSelection:true,rejectUnknownDeployment:400,productionSelectionChanged:false};
 if(process.env.ADOPTION_EVIDENCE_DIR)await writeFile(process.env.ADOPTION_EVIDENCE_DIR+'/admin-live.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();remote("import {revokeSession} from './src/services/auth/session.js';revokeSession("+JSON.stringify(token)+");");}

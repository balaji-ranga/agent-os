import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.ADOPTION_PLAYWRIGHT_MODULE));
const out=new URL(process.env.ADOPTION_LOCATE_EVIDENCE||'./evidence/guidance-locate-20261024/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),results=[],assets=[];
await page.route('https://flolah.cloud/**',r=>!['GET','HEAD','OPTIONS'].includes(r.request().method())?r.abort():r.continue());
page.on('response',async response=>{try{const name=new URL(response.url()).pathname.split('/').at(-1);if(['sdk.mjs','page-context.mjs','page-targets.mjs','dom.mjs'].includes(name)){const body=await response.body(),local=await readFile(new URL('../web/'+name,import.meta.url));assets.push({name,url:response.url(),cacheControl:response.headers()['cache-control'],sha256:createHash('sha256').update(body).digest('hex'),current:body.toString().replaceAll('\r\n','\n')===local.toString().replaceAll('\r\n','\n')});}}catch{}});
try{
 await page.goto('https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1');const panel=page.frameLocator('iframe[data-adoption-widget]');await panel.locator('#message').waitFor({timeout:40000});
 for(const [index,text] of ['i am not able to locate total listings','Show me where'].entries()){
  const pending=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/v1/plan'),{timeout:150000});await panel.locator('#message').fill(text);await panel.locator('#plan').click();const response=await pending,data=await response.json(),input=response.request().postDataJSON();await panel.locator('#plan:not([disabled])').waitFor({timeout:30000});
  const stat=page.locator('#directory p').filter({hasText:/approved listings/}),label=await stat.innerText(),box=await stat.boundingBox(),marker=page.locator('[data-adoption-highlight=true]');const markerBox=await marker.count()?await marker.boundingBox():null;
  const result={text,status:response.status(),data,snapshot:input.snapshot,markerBox,box,passed:response.status()===200&&data.actions?.some(a=>a.type==='highlight'&&a.label===label)&&markerBox&&Math.abs(markerBox.y-box.y)<5};results.push(result);await page.screenshot({path:fileURLToPath(new URL(`exact-${index}.png`,out))});console.log(JSON.stringify({...result,snapshot:undefined}));
 }
}finally{await writeFile(new URL('results.json',out),JSON.stringify({at:new Date().toISOString(),results,assets},null,2));await browser.close();}
assert.ok(results.length===2&&results.every(r=>r.passed),'Exact locate sequence must highlight the statement on both turns');

// Explicit SDK download failure/recovery; public mode requires an approved unexpired preview.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import('./frameworks/node_modules/playwright/index.mjs');
const out=new URL('../.local/feedback-bootstrap/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),results=[];
try{for(const [name,url] of [['local','http://127.0.0.1:4194/customer'],...(process.env.ADOPTION_UAT_PUBLIC==='1'?[['public','https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1']]:[])]){
 const context=await browser.newContext({viewport:{width:1440,height:1050}}),p=await context.newPage();let blocked=0,publicWrites=0;
 await context.route('**/*',r=>{const req=r.request();if(new URL(req.url()).hostname==='flolah.cloud'&&!['GET','HEAD','OPTIONS'].includes(req.method())){publicWrites++;return r.abort();}return r.continue();});
 await p.route('**/sdk.mjs',r=>{blocked++;return r.abort();});const start=Date.now();await p.goto(url);await p.getByRole('button',{name:'Retry copilot',exact:true}).waitFor({timeout:12000});
 assert.equal(await p.locator(name==='local'?'#demo-form':'#q').isVisible(),true);assert.equal(blocked,1);
 await p.screenshot({path:new URL(`download-failed-${name}.png`,out).pathname.replace(/^\/C:/,'C:'),fullPage:false});
 await p.unroute('**/sdk.mjs');await p.getByRole('button',{name:'Retry copilot',exact:true}).click();await p.frameLocator('iframe[data-adoption-widget]').locator('#panel-connection-status').filter({hasText:/Panel connected/}).waitFor({timeout:12000});
 await p.screenshot({path:new URL(`recovered-${name}.png`,out).pathname.replace(/^\/C:/,'C:'),fullPage:false});assert.equal(publicWrites,0);
 results.push({id:`F13_${name.toUpperCase()}_FAILED_DOWNLOAD_EXPLICIT_RETRY`,status:'passed',blocked,hostRemainedVisible:true,recoveredWithoutHostReload:true,wallMs:Date.now()-start,publicWrites,measurement:'Injected download failure, not an uncontrolled network latency benchmark'});await context.close();
}}finally{await writeFile(new URL('results.json',out),JSON.stringify({at:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));await browser.close();}

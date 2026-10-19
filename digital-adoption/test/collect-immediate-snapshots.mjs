// Read-only structural evidence from the two authorized websites. No host values.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.ADOPTION_PLAYWRIGHT_MODULE||'./frameworks/node_modules/playwright/index.mjs');
const out=new URL('./evidence/immediate-phase-20261019/observed/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
await context.route('**/__uat-immediate/*.mjs',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);if(!/^[a-z-]+\.mjs$/.test(name))return route.abort();try{await route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../web/'+name,import.meta.url),'utf8')});}catch{await route.abort();}});
const snapshots={};
try{for(const [name,url]of [['local','http://127.0.0.1:4194/customer'],['public','https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1']]){
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1000);
 if(name==='local'){await page.getByRole('button',{name:'Add native controls',exact:true}).click();await page.getByRole('button',{name:'Add complex controls',exact:true}).click();}
 snapshots[name]=await page.evaluate(async()=>{const {createInspector}=await import('/__uat-immediate/dom.mjs');const inspector=createInspector(document),snapshot=inspector.snapshot({task:"Review Shipping method, Delivery preference, Interests and transport choices"});inspector.destroy();return snapshot;});
 assert.ok(snapshots[name].fields.length>0);await page.screenshot({path:fileURLToPath(new URL(name+'.png',out)),fullPage:false});
 console.log(name+': '+snapshots[name].fields.map(f=>f.label).join(', '));
}await writeFile(new URL('snapshots.json',out),JSON.stringify({at:new Date().toISOString(),purpose:'Actual supported structural fields; no live values, only public choices',snapshots},null,2));}finally{await browser.close();}

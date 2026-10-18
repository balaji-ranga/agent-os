// Verify the local evidence artifact, not the copilot feature behavior again.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {chromium}=await import('./frameworks/node_modules/playwright/index.mjs');
const origin='http://127.0.0.1:4194',base=origin+'/uat-evidence/';
const out=new URL('../.local/feedback-report/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
 await page.getByText('37 of 37 test cases',{exact:true}).waitFor();
 assert.deepEqual(await page.locator('.stat b').allTextContents(),['30','4','0','3']);
 await page.screenshot({path:new URL('overview.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:false});
 await page.getByRole('button',{name:'Partial',exact:true}).click();
 await page.getByText('4 of 37 test cases',{exact:true}).waitFor();
 await page.screenshot({path:new URL('partial-cases.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:false});
 await page.getByRole('button',{name:'All cases',exact:true}).click();
 await page.getByLabel('Search test cases').fill('F17');
 await page.getByText('1 of 37 test cases',{exact:true}).waitFor();
 await page.locator('tbody summary').click();
 const images=page.locator('tbody img');assert.equal(await images.count(),4);
 await page.screenshot({path:new URL('context-evidence-links.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:false});
 const manifest=await(await page.request.get(base+'manifest.json')).json();
 for(const [name,record]of Object.entries(manifest)){
   const response=await page.request.get(base+name);assert.equal(response.status(),200,name);
   const bytes=await response.body();assert.equal(bytes.length,record.bytes,name);
   assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,name);
 }
 assert.deepEqual(errors,[]);
 await writeFile(new URL('results.json',out),JSON.stringify({at:new Date().toISOString(),caseCount:37,counts:{passed:30,partial:4,failed:0,pending:3},filterAssertions:3,verifiedManifestFiles:Object.keys(manifest).length,pageErrors:errors},null,2));
 console.log(JSON.stringify({report:'passed',files:Object.keys(manifest).length}));
}finally{await browser.close();}

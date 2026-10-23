import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import('./frameworks/node_modules/playwright/index.mjs');
const out=new URL('./evidence/page-inspection-20261023/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),results=[];
let publicWrites=0;
await context.route('https://flolah.cloud/**',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.request().method())){publicWrites++;return r.abort();}return r.continue();});
await context.route('**/__copilot-uat/*.mjs',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);if(!/^[a-z-]+\.mjs$/.test(name))return route.abort();return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../web/'+name,import.meta.url),'utf8')});});
const snapshot=task=>page.evaluate(async task=>{const {createInspector}=await import('/__copilot-uat/dom.mjs');const inspector=createInspector(document),start=performance.now(),snapshot=inspector.snapshot({task});inspector.destroy();return {snapshot,elapsedMs:performance.now()-start,bytes:new TextEncoder().encode(JSON.stringify(snapshot)).length};},task);
try{
 await context.route('http://127.0.0.1:4194/__inspection-fixture',r=>r.fulfill({contentType:'text/html',body:'<main><h1>Independent directory</h1><p>900 results Ã‚Â· page 1</p><section>'+Array.from({length:70},(_,i)=>'<article><h2>Listing '+i+'</h2><p>Public description '+i+'</p></article>').join('')+'</section><input value="PRIVATE_INPUT_CANARY"><textarea>PRIVATE_TEXTAREA_CANARY</textarea><div data-adoption-private>PRIVATE_REGION_CANARY</div><h2>Public title<span hidden>HIDDEN_HEADING_CANARY</span></h2></main>'}));
 await page.goto('http://127.0.0.1:4194/__inspection-fixture');const synthetic=await snapshot('How many listings are loaded on this page? Inspect the full DOM.');
 assert.equal(synthetic.snapshot.pageContext.headings.filter(h=>/^Listing \d+$/.test(h.label)).length,70);assert.ok(synthetic.snapshot.pageContext.collections.some(c=>c.itemCount===70&&!c.truncated));assert.ok((synthetic.snapshot.targets?.length||0)<=24);assert.ok(!JSON.stringify(synthetic.snapshot).includes('CANARY'));assert.ok(synthetic.elapsedMs<500);results.push({id:'all-loaded-headings-independent-of-target-ranking',passed:true,headingItems:70,targetLimit:24,elapsedMs:synthetic.elapsedMs,bytes:synthetic.bytes,privateAndHiddenContentExcluded:true});
 await page.goto('https://flolah.cloud/free-tools/mcp-universe/?digitalAdoptionPreview=1');await page.locator('#grid h2').first().waitFor();const expected=await page.locator('#grid h2').allTextContents(),first=await snapshot('How many MCPs are listed on this page?'),reply=await snapshot('Inspect full dome, there are more?');
 for(const observed of [first,reply])for(const name of expected)assert.ok(observed.snapshot.pageContext.headings.some(h=>h.label===name.trim()),'Missing loaded heading '+name);
 assert.equal(expected.length,24);assert.ok(first.snapshot.pageContext.collections.some(c=>c.itemCount===expected.length&&c.labels.every(name=>expected.includes(name))&&!c.truncated));assert.match(first.snapshot.pageContext.text,/approved listings.*page 1/);assert.ok(first.elapsedMs<500);assert.equal(publicWrites,0);
 await page.screenshot({path:fileURLToPath(new URL('public-mcp-page.png',out)),fullPage:true});
 results.push({id:'actual-public-mcp-loaded-page-and-reply-observation',passed:true,loadedListingCount:expected.length,initialRankedTargets:first.snapshot.targets?.length||0,followupRankedTargets:reply.snapshot.targets?.length||0,allLoadedListingTitlesIncluded:true,elapsedMs:first.elapsedMs,bytes:first.bytes});
 await writeFile(new URL('snapshots.json',out),JSON.stringify({at:new Date().toISOString(),expectedLoaded:expected.length,first:first.snapshot,reply:reply.snapshot},null,2));
 await writeFile(new URL('browser-results.json',out),JSON.stringify({results,publicWrites},null,2));console.log(JSON.stringify({results,publicWrites}));
}finally{await browser.close();}
